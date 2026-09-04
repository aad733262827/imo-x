// Updated server.js: delegate AI calls to agents.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const SETTINGS_FILE = path.join(ROOT, 'settings.json');
const PROJECTS_FILE = path.join(ROOT, 'projects.json');
const TMP = path.join(ROOT, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const BIN = path.join(ROOT, 'bin');
const toolPath = (name) => (fs.existsSync(path.join(BIN, name)) ? path.join(BIN, name) : name);
// ضمان صلاحيات التشغيل بعد أي إعادة تشغيل بيئة
for (const t of ['ffmpeg', 'yt-dlp']) {
  const p = path.join(BIN, t);
  if (fs.existsSync(p)) { try { fs.chmodSync(p, 0o755); } catch {} }
}

app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(ROOT, 'public')));

// ---------------- settings ----------------
const settings = { provider: 'gemini', geminiApiKey: '', openaiApiKey: '', claudeApiKey: '', groqApiKey: '', model: '' };
// مفتاح من بيئة التشغيل (Render) — بيفضل محفوظ بعد أي إعادة نشر
if (process.env.GEMINI_API_KEY) settings.geminiApiKey = process.env.GEMINI_API_KEY;
if (process.env.OPENAI_API_KEY) settings.openaiApiKey = process.env.OPENAI_API_KEY;
if (process.env.CLAUDE_API_KEY) settings.claudeApiKey = process.env.CLAUDE_API_KEY;
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch {}
const saveSettings = () => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
const activeKey = () => settings[`${settings.provider}ApiKey`] || '';

// ---------------- projects ----------------
const loadProjects = () => { try { return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')); } catch { return []; } };
const saveProjects = (list) => fs.writeFileSync(PROJECTS_FILE, JSON.stringify(list, null, 2));

const upload = multer({ dest: TMP, limits: { fileSize: 300 * 1024 * 1024 } });

// ---------------- tool helpers ----------------
function hasTool(cmd) {
  return new Promise((res) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; res(v); } };
    let p;
    try { p = spawn(cmd, ['--version']); } catch { return finish(false); }
    p.on('error', () => finish(false));
    p.stdout.on('data', () => finish(true));
    p.stderr.on('data', () => finish(true));
    p.on('close', () => finish(true));
    setTimeout(() => finish(false), 2500);
  });
}
let toolsCache = null;
async function getTools() {
  if (!toolsCache) toolsCache = { ffmpeg: await hasTool(toolPath('ffmpeg')), ytDlp: await hasTool(toolPath('yt-dlp')) };
  return toolsCache;
}
function run(cmd, args, { timeout = 120000, cwd = TMP } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('تجاوز الوقت: ' + cmd)); }, timeout);
    p.on('error', (e) => { clearTimeout(t); reject(new Error('أداة غير متوفرة: ' + cmd)); });
    p.on('close', (code) => {
      clearTimeout(t);
      code === 0 ? resolve({ out, err }) : reject(new Error((err || out || cmd + ' failed').slice(-300)));
    });
  });
}
function runRaw(cmd, args, { timeout = 60000, cwd = TMP } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.on('error', (e) => { clearTimeout(t); resolve({ out, err: err + ' ' + e.message }); });
    p.on('close', () => { clearTimeout(t); resolve({ out, err }); });
  });
}
async function getDuration(file) {
  try {
    const { err } = await runRaw(toolPath('ffmpeg'), ['-hide_banner', '-i', file]);
    const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(err || '');
    if (m) {
      const secs = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
      if (isFinite(secs) && secs > 0) return secs;
    }
  } catch (e) {}
  return 10;
}
async function extractFrames(video, count = 12) {
  const dur = await getDuration(video).catch(() => 10);
  const fps = Math.max(count / dur, 0.1);
  const outDir = path.join(TMP, 'frames_' + Date.now());
  fs.mkdirSync(outDir, { recursive: true });
  await run(toolPath('ffmpeg'), ['-y', '-i', video, '-vf', `fps=${fps.toFixed(4)}`, '-frames:v', String(count), '-q:v', '4', path.join(outDir, 'f_%03d.jpg')]);
  return fs.readdirSync(outDir).filter((f) => f.endsWith('.jpg')).sort().map((f) => path.join(outDir, f));
}
async function downloadVideo(url) {
  const out = path.join(TMP, 'dl_' + Date.now() + '.mp4');
  await run(toolPath('yt-dlp'), ['-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/bv*+ba/b', '--merge-output-format', 'mp4', '-o', out, url], { timeout: 180000 });
  return out;
}

// ---------------- AI brain ----------------
const BRAIN = `أنت "إيمو إكس" (IMMO X): مخرج إعلاني سينمائي محترف، ممنتج، ومهندس أوامر ذكاء اصطناعي، ذكي وفنان.
أسلوبك: دقة مخرج سينمائي + لغة عربية بسيطة مفهومة لأي صانع محتوى (بدون تعقيد).
مهمتك: تحليل إعلان/فيديو يصلك ككادرات مرتبة زمنياً (أو كوصف) وإخراج JSON مطابق تماماً للهيكل المطلوب — لا تخرّج نص خارجي.`;

const str = { type: 'STRING' };
const arrStr = { type: 'ARRAY', items: { type: 'STRING' } };
const scene = {
  type: 'OBJECT',
  properties: {
    index: { type: 'NUMBER' }, time: str, location: str, action: str, dialogue: str,
    cameraAngle: str, cameraMove: str, lighting: str, color: str, mood: str
  },
  required: ['index', 'time', 'location', 'action', 'cameraAngle', 'cameraMove', 'lighting', 'mood']
};
const character = { type: 'OBJECT', properties: { name: str, description: str, genPrompt: str }, required: ['name', 'description', 'genPrompt'] };
const angle = { type: 'OBJECT', properties: { term: str, scene: str, why: str }, required: ['term', 'scene', 'why'] };
const motion = { type: 'OBJECT', properties: { scene: str, motion: str, motionPrompt: str }, required: ['scene', 'motion', 'motionPrompt'] };
const vline = { type: 'OBJECT', properties: { time: str, line: str }, required: ['line'] };
const S = { str, arrStr, scene, character, angle, motion, vline };

const ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: S.str, platform: S.str, duration: S.str,
    hook: { type: 'OBJECT', properties: { first3seconds: S.str, whyItStops: S.str }, required: ['first3seconds', 'whyItStops'] },
    idea: { type: 'OBJECT', properties: { bigIdea: S.str, message: S.str, target: S.str }, required: ['bigIdea', 'message'] },
    scenario: S.str,
    scenes: { type: 'ARRAY', items: S.scene },
    characters: { type: 'ARRAY', items: S.character },
    lcms: { type: 'OBJECT', properties: { lighting: S.str, palette: S.arrStr, colorGrading: S.str, mood: S.str }, required: ['lighting', 'mood'] },
    cameraAngles: { type: 'ARRAY', items: S.angle },
    motion: { type: 'ARRAY', items: S.motion },
    voiceover: { type: 'ARRAY', items: S.vline },
    musicSfx: { type: 'OBJECT', properties: { music: S.str, sfx: S.arrStr }, required: ['music'] },
    whyItWorked: S.arrStr,
    notes: S.str
  },
  required: ['title', 'hook', 'idea', 'scenario', 'scenes', 'characters', 'lcms', 'cameraAngles', 'motion', 'voiceover', 'musicSfx', 'whyItWorked']
};

const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: S.str, concept: S.str, structure: S.str, styleLine: S.str,
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          index: { type: 'NUMBER' }, time: S.str, location: S.str, action: S.str,
          cameraAngle: S.str, cameraMove: S.str, lighting: S.str, mood: S.str,
          visualPrompt: S.str, motionPrompt: S.str, voiceoverLine: S.str, sfx: S.str
        },
        required: ['index', 'time', 'action', 'visualPrompt', 'motionPrompt']
      }
    },
    characters: { type: 'ARRAY', items: S.character },
    voiceoverScript: { type: 'ARRAY', items: S.vline },
    music: S.str, cta: S.str, notes: S.str
  },
  required: ['title', 'concept', 'structure', 'styleLine', 'scenes', 'characters', 'voiceoverScript', 'cta']
};

const SECTION_SCHEMAS = {
  idea: { type: 'OBJECT', properties: { bigIdea: S.str, message: S.str, target: S.str }, required: ['bigIdea'] },
  scenario: S.str,
  scenes: { type: 'ARRAY', items: S.scene },
  characters: { type: 'ARRAY', items: S.character },
  lcms: { type: 'OBJECT', properties: { lighting: S.str, palette: S.arrStr, colorGrading: S.str, mood: S.str }, required: ['lighting'] },
  cameraAngles: { type: 'ARRAY', items: S.angle },
  motion: { type: 'ARRAY', items: S.motion },
  voiceover: { type: 'ARRAY', items: S.vline },
  musicSfx: { type: 'OBJECT', properties: { music: S.str, sfx: S.arrStr }, required: ['music'] },
  hook: { type: 'OBJECT', properties: { first3seconds: S.str, whyItStops: S.str }, required: ['first3seconds', 'whyItStops'] }
};
const SECTIONS_AR = { idea: 'الفكرة', scenario: 'السيناريو', scenes: 'المشاهد', characters: 'الشخصيات',
  lcms: 'الإضاءة والألوان والمود', cameraAngles: 'زوايا الكاميرا', motion: 'أوامر الحركة',
  voiceover: 'الحوار والتعليق', musicSfx: 'الموسيقى والأصوات', hook: 'الهوك' };

// lightweight JSON parser used by agents as well
function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  throw new Error('رد الموديل مو JSON صالح');
}

const fetchTimeouted = (url, opts = {}, ms = 180000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
};

// Delegate AI calls to agents.js for clarity and maintainability
const agents = require('./agents');
async function aiCall(parts, opts) { return agents.aiCall(settings, parts, opts); }
function friendlyError(e) { return agents.friendlyError(e); }

// ---------------- demo data ----------------
const DEMO = {
  demo: true,
  title: 'ZED Runners — "ركض وأنت ناطم" (محتوى تجريبي)',
  platform: 'TikTok / Reels — 9:16',
  duration: '30 ثانية',
  hook: { first3seconds: 'لقطة ماكرو بطيئة: نعل حذاء يرتطم براصد الشارع المبلل، ماء يتطاير...', whyItStops: '3 أسباب توقف السكرول...' },
  idea: { bigIdea: 'الحذاء مو منتج — هو الوقود.', message: 'ZED = طاقة تصدقها', target: 'شباب 18-30' },
  scenario: 'مدينة ليلاً تحت مطر خفيف...',
  scenes: [], characters: [], lcms: {}, cameraAngles: [], motion: [], voiceover: [], musicSfx: {}, whyItWorked: [], notes: '⚠️ هذا محتوى تجريبي'
};

// ---------------- markdown export ----------------
function toMarkdown(d, name) {
  const L = [];
  L.push('# 🎬 إيمو إكس — ' + (name || 'مشروع'));
  if (d.demo) L.push('> ⚠️ وضع تجريبي (محتوى مثالي)');
  L.push('');
  if (d.title) L.push('**العنوان:** ' + d.title);
  if (d.duration) L.push('**المدة:** ' + d.duration + (d.platform ? ' | **المنصة:** ' + d.platform : ''));
  const sec = (t) => L.push('\n## ' + t + '\n');
  if (d.concept) { sec('💡 الفكرة والمفهوم'); L.push(d.concept); }
  if (d.structure) { sec('🗺️ هيكل الإعلان على الزمن'); L.push(d.structure); }
  if (d.styleLine) { sec('🧬 سطر الأسلوب الموحّد'); L.push('```' + d.styleLine + '```'); }
  if (d.hook) { sec('🪝 الهوك'); L.push('- **أول 3 ثواني:** ' + d.hook.first3seconds); L.push('- **ليش يوقف:** ' + d.hook.whyItStops); }
  if (d.idea) { sec('💡 الفكرة الكبيرة'); L.push('- **الفكرة:** ' + d.idea.bigIdea); L.push('- **الرسالة:** ' + (d.idea.message || '')); L.push('- **الهدف:** ' + (d.idea.target || '')); }
  if (d.scenario) { sec('📜 السيناريو'); L.push(d.scenario); }
  if (d.scenes) {
    sec('🎞️ المشاهد');
    d.scenes.forEach((s) => {
      L.push(`### مشهد ${s.index} (${s.time || ''})`);
      L.push(`- **المكان:** ${s.location || '-'}`);
      L.push(`- **الوصف:** ${s.action || '-'}`);
      L.push(`- **الحوار:** ${s.dialogue || s.voiceoverLine || '-'}`);
      L.push(`- **الكاميرا:** ${s.cameraAngle || '-'} / ${s.cameraMove || '-'}`);
      L.push(`- **الإضاءة:** ${s.lighting || '-'} | **المود:** ${s.mood || '-'}`);
      if (s.visualPrompt) L.push('- **Visual Prompt:**\n  ```' + s.visualPrompt + '```');
      if (s.motionPrompt) L.push('- **Motion Prompt:**\n  ```' + s.motionPrompt + '```');
    });
  }
  if (d.characters) { sec('🧍 الشخصيات'); d.characters.forEach((c) => { L.push(`**${c.name}**\n${c.description || ''}\n\`\`\`${c.genPrompt || ''}\`\`\``); }); }
  if (d.lcms) { sec('💡 الإضاءة + الألوان + المود'); L.push('- **إضاءة:** ' + (d.lcms.lighting || '-')); L.push('- **لوحة الألوان:** ' + ((d.lcms.palette || []).join(', ') || '-')); }
  if (d.cameraAngles) { sec('🎥 زوايا الكاميرا'); d.cameraAngles.forEach((c) => L.push(`- **${c.term || c.angle || ''}:** ${c.scene} (ليش: ${c.why})`)); }
  if (d.motion) { sec('🌀 أوامر الحركة'); d.motion.forEach((m) => { L.push(`**${m.scene}**\n${m.motion}\n\`\`\`${m.motionPrompt || ''}\`\`\``); }); }
  const vo = d.voiceover || d.voiceoverScript;
  if (vo) { sec('🎙️ الحوار والتعليق الصوتي'); vo.forEach((v) => L.push(`- [${v.time || ''}] ${v.line}`)); }
  if (d.musicSfx) { sec('🎵 الموسيقى والأصوات'); L.push('- **موسيقى:** ' + (d.musicSfx.music || '-')); L.push('- **أصوات:** ' + ((d.musicSfx.sfx || []).join('، ') || '-')); }
  if (d.music) { sec('🎵 الموسيقى'); L.push(d.music); }
  if (d.cta) { sec('📣 الـ CTA'); L.push(d.cta); }
  if (d.whyItWorked) { sec('🏆 ليش نجح'); d.whyItWorked.forEach((w) => L.push('- ' + w)); }
  if (d.notes) { L.push('\n> 📝 ' + d.notes); }
  L.push('\n---\n*أُنشئ بواسطة إيمو إكس IMMO X 🎬*');
  return L.join('\n');
}

// ---------------- API ----------------
app.get('/api/status', async (req, res) => {
  const t = await getTools();
  const defaults = { gemini: 'gemini-3.6-flash', openai: 'gpt-4o', claude: 'claude-sonnet-4-5', groq: 'meta-llama/llama-3.2-90b-vision-preview' };
  res.json({ provider: settings.provider, hasKey: !!activeKey(), model: settings.model || defaults[settings.provider] || 'gemini-3.6-flash', tools: t });
});

app.post('/api/settings', (req, res) => {
  const { provider, key, model } = req.body || {};
  if (provider && ['gemini', 'openai', 'claude', 'groq'].includes(provider)) settings.provider = provider;
  const k = (key || '').trim();
  if (k !== '' && settings[`${settings.provider}ApiKey`] === undefined) settings[`${settings.provider}ApiKey`] = '';
  if (k) settings[`${settings.provider}ApiKey`] = k;
  if (typeof model === 'string') settings.model = model.trim();
  saveSettings();
  res.json({ ok: true, hasKey: !!activeKey() });
});

app.get('/api/providers', (req, res) => {
  res.json({ provider: settings.provider, model: settings.model });
});

app.get('/api/projects', (req, res) => { res.json(loadProjects().map((p) => ({ id: p.id, name: p.name, created: p.created, kind: p.kind }))); });
app.post('/api/projects', (req, res) => { const list = loadProjects(); const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: new Date().toISOString(), name: (req.body && req.body.name) || 'مشروع بدون اسم', kind: (req.body && req.body.kind) || 'analysis', data: (req.body && req.body.data) || {} }; list.unshift(p); saveProjects(list); res.json({ id: p.id }); });
app.get('/api/projects/:id', (req, res) => { const p = loadProjects().find((x) => x.id === req.params.id); p ? res.json(p) : res.status(404).json({ error: 'ما لقينا المشروع' }); });
app.delete('/api/projects/:id', (req, res) => { saveProjects(loadProjects().filter((x) => x.id !== req.params.id)); res.json({ ok: true }); });
app.get('/api/projects/:id/export', (req, res) => { const p = loadProjects().find((x) => x.id === req.params.id); if (!p) return res.status(404).send('not found'); res.setHeader('Content-Disposition', `attachment; filename="imo-x-${p.id}.md"`); res.setHeader('Content-Type', 'text/markdown; charset=utf-8'); res.send(toMarkdown(p.data, p.name)); });
app.post('/api/export', (req, res) => { const { name, data } = req.body || {}; res.setHeader('Content-Type', 'text/markdown; charset=utf-8'); res.send(toMarkdown(data || {}, name)); });

app.post('/api/analyze', upload.any(), async (req, res) => {
  const body = req.body || {};
  const files = (req.files || []).map((f) => f.path);
  const t0 = Date.now();
  const cleanup = () => files.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
  const log = (m) => console.log(`[imo-x] ${m} (${Math.round((Date.now() - t0) / 1000)}s)`);
  try {
    if (!activeKey()) { res.json({ ...DEMO, source: body.url || 'demo' }); return; }
    log('analyze start: url=' + (body.url || '-') + ' files=' + (((req.files || []).map((f) => f.originalname).join(',')) || 'none'));
    const t = await getTools();
    const uploads = req.files || [];
    const images = uploads.filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f.originalname)).map((f) => f.path).slice(0, 16);
    let frames = images;
    let videoFile = null;
    let durGuess = 0;
    if (!frames.length) {
      const video = uploads.find((f) => /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(f.originalname));
      if (body.url) {
        if (!t.ytDlp) throw new Error('أداة التنزيل (yt-dlp) غير متوفرة على الجهاز — ارفع لقطات صور (6-12) من الإعلان بدل الرابط.');
        log('downloading url...');
        videoFile = await downloadVideo(String(body.url));
        log('download done: ' + videoFile);
      } else if (video) videoFile = video.path;
      else throw new Error('ما وصلني فيديو ولا لقطات. صيف رابط أو ارفع ملف فيديو أو لقطات صور.');
      if (!t.ffmpeg) throw new Error('أداة ffmpeg غير متوفرة على الجهاز — ارفع لقطات صور (6-12) من الإعلان بدل الفيديو.');
      log('extracting frames...');
      frames = await extractFrames(videoFile);
      durGuess = await getDuration(videoFile).catch(() => 0);
      log('frames ready: ' + frames.length + ' (dur~' + Math.round(durGuess) + 's)');
    } else {
      log('images ready: ' + frames.length);
    }
    const parts = frames.map((f) => ({ image: fs.readFileSync(f), mime: 'image/jpeg' }));
    parts.push({ text: `هذا إعلان كامل (${frames.length} كادر/لقطة مرتبة زمنياً${durGuess ? '، مدته تقريباً ' + Math.round(durGuess) + ' ثانية' : ''})${body.prompt ? '\nملاحظات: ' + body.prompt : ''}` });
    log('calling AI with ' + frames.length + ' frames...');
    const result = await aiCall(parts, { system: BRAIN, json: true, temperature: 0.6, schema: ANALYSIS_SCHEMA });
    result.source = body.url || 'file';
    cleanup();
    log('analyze done ✓');
    res.json(result);
  } catch (e) {
    cleanup();
    console.error('[imo-x] analyze error:', String(e.message || e).slice(-400));
    if (e && e.code === 'NO_KEY') res.json({ ...DEMO, source: body.url || 'demo' });
    else res.json({ error: friendlyError(e) });
  }
});

app.post('/api/refine', async (req, res) => {
  const { project, section, instruction } = req.body || {};
  if (!project || !section || !instruction) return res.status(400).json({ error: 'نواقص في الطلب' });
  if (!activeKey()) return res.json({ demoEdit: true, note: 'وضع تجريبي — التعديل الحقيقي بفكرتك يحتاج مفتاح (من ⚙️).' });
  const schema = SECTION_SCHEMAS[section];
  if (!schema) return res.status(400).json({ error: 'قسم غير معروف' });
  try {
    const sys = BRAIN + `\n\nالمهمة الآن: المستخدم عنده فكرته الجديدة لقسم "${SECTIONS_AR[section]}" في تحليل إعلان. أعد كتابة قسم "${SECTIONS_AR[section]}" في JSON.`;
    const parts = [ { text: 'تحليل الإعلان الحالي (JSON):\n' + JSON.stringify(project).slice(0, 12000) }, { text: `الفكرة الجديدة للمستخدم لقسم "${SECTIONS_AR[section]}":\n${instruction}` } ];
    const updated = await aiCall(parts, { system: sys, json: true, temperature: 0.8, schema: { type: 'OBJECT', properties: { [section]: schema }, required: [section] } });
    if (updated[section] !== undefined) {
      project[section] = updated[section];
      return res.json({ section, project, ok: true });
    }
    res.json({ error: 'الموديل ما أرجع القسم بالاسم المطلوب — جرب مرة ثانية.' });
  } catch (e) {
    res.json({ error: friendlyError(e) });
  }
});

app.post('/api/plan', async (req, res) => {
  const b = req.body || {};
  if (!activeKey()) { return res.json({ demo: true, note: 'وضع تجريبي — خطة الإنتاج الحقيقية (كل المشاهد + البرومبتات) تحتاج مفتاح من ⚙️.' }); }
  const sys = BRAIN + `\n\nمهمتك الجديدة: أنت المخرج اللي بيصنع إعلان جديد من فكرة المستخدم. اخرج خطة إنتاج كاملة JSON...`;
  const text = [ 'الفكرة: ' + (b.idea || ''), b.reference ? 'مرجع تحليلي من إعلان مشابه: ' + JSON.stringify(b.reference).slice(0, 2000) : '', 'الشخصيات: ' + (b.characters || 'أنت تختار'), 'المود: ' + (b.mood || 'أنت تختار'), 'المدة: ' + (b.duration || '30 ثانية'), 'الحوار/التعليق الصوتي: ' + (b.voiceover || 'أنت تبتكر'), 'المنصة/الأبعاد: ' + (b.platform || 'TikTok 9:16'), 'أدوات التوليد: ' + (b.tools || 'شامل'), 'إضافي: ' + (b.extra || '') ].filter(Boolean).join('\n');
  try {
    const result = await aiCall([{ text }], { system: sys, json: true, temperature: 0.8, schema: PLAN_SCHEMA });
    res.json(result);
  } catch (e) { res.json({ error: friendlyError(e) }); }
});

app.listen(PORT, '0.0.0.0', () => { console.log('🎬 IMMO X server running on port ' + PORT); });
