// 🎬 IMMO X — إيمو إكس | الخادم
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
مهمتك: تحليل إعلان/فيديو يصلك ككادرات مرتبة زمنياً (أو كوصف) وإخراج JSON مطابق تماماً للهيكل المطلوب — لا تخرج أي نص خارج الـ JSON.

قواعد التحليل:
1. الكادرات مرتبة زمنياً من أول الإعلان لآخره. وزّع المشاهد على التوقيت بصيغة 00:00-00:04.
2. اكتب: الفكرة الكبيرة، الرسالة، الفئة المستهدفة، والسيناريو كاملاً بالعربية.
3. المشاهد: 5-12 مشهد حسب المدة. لكل مشهد: location المكان، action شو بيصير بالضبط، dialogue الحوار/النص، cameraAngle الزاوية (بالمصطلح الفني + شرح عربي بين قوسين)، cameraMove حركة الكاميرا، lighting الإضاءة، color الألوان، mood المود.
4. الشخصيات: كل شخصية بارزة (بما فيها المنتج/العلامة) مع description وصف عربي + genPrompt برومبت توليد بالإنجليزية التقنية جاهز للنسخ لموديلات توليد الصور (يحتوي: الوصف، المظهر، اللباس، الإضاءة، الخلفية، aspect 9:16 أو 16:9 حسب المنصة، photorealistic/cinematic).
5. lcms: خطة موحدة — lighting نوع الإضاءة، palette لوحة الألوان بأسماء Hex، colorGrading التصحيح اللوني، mood المود العام.
6. cameraAngles: المصطلحات المستخدمة (term) ولوشين كل واحدة (scene) وليش (why).
7. motion: لكل مشهد مهم motion وصف الحركة بالعربية + motionPrompt إنجليزية جاهزة لأدوات توليد الفيديو (camera movement + subject action + style).
8. voiceover: كل جملة حوار/تعليق مع time توقيتها.
9. musicSfx: music وصف الموسيقى (المزاج، الإيقاع، مكان الـ drop) + sfx مؤثرات.
10. hook: first3seconds شو صار أول 3 ثواني بالضبط، whyItStops ليش يوقف السكرول.
11. whyItWorked: 3-5 نقاط "ليش هذا الإعلان نجح".
12. لو شي مو واضح بالكادرات، استنتجه باحتراف واذكر في notes أنك استنتجته.
13. قاعدة البرومبتات الذهبية: كل برومبت توليد (genPrompt / visualPrompt / motionPrompt / styleLine) يكون سطر إنجليزي واحد متواصل ونظيف — بدون علامات اقتباس، بدون سطور فارغة، بدون أسماء أدوات (Midjourney/Veo/Sora)، بدون أي حرف عربي — وينتهي دائماً بنسبة الأبعاد (9:16 أو 16:9) حسب المنصة، عشان ينسخ ويلصق مباشرة بدون أي تعديل.`;

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
const character = {
  type: 'OBJECT',
  properties: { name: str, description: str, genPrompt: str },
  required: ['name', 'description', 'genPrompt']
};
const angle = {
  type: 'OBJECT',
  properties: { term: str, scene: str, why: str },
  required: ['term', 'scene', 'why']
};
const motion = {
  type: 'OBJECT',
  properties: { scene: str, motion: str, motionPrompt: str },
  required: ['scene', 'motion', 'motionPrompt']
};
const vline = {
  type: 'OBJECT',
  properties: { time: str, line: str },
  required: ['line']
};
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
const SECTIONS_AR = {
  idea: 'الفكرة', scenario: 'السيناريو', scenes: 'المشاهد', characters: 'الشخصيات',
  lcms: 'الإضاءة والألوان والمود', cameraAngles: 'زوايا الكاميرا', motion: 'أوامر الحركة',
  voiceover: 'الحوار والتعليق', musicSfx: 'الموسيقى والأصوات', hook: 'الهوك'
};

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

async function geminiCall(model, parts, { system, json = true, temperature = 0.7, schema }) {
  const gp = parts.map((p) => (p.image ? { inlineData: { mimeType: p.mime || 'image/jpeg', data: p.image.toString('base64') } } : { text: p.text }));
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: gp }],
    generationConfig: {
      temperature,
      ...(json ? { responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}) } : {})
    }
  };
  const res = await fetchTimeouted(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiApiKey },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('GEMINI ' + res.status + ': ' + JSON.stringify(data).slice(0, 300));
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error('رد Gemini فاضي');
  return json ? parseJsonLoose(text) : text;
}

async function openaiLikeCall(base, key, model, parts, { system, json = true, temperature = 0.7 }) {
  const content = parts.map((p) =>
    p.image
      ? { type: 'image_url', image_url: { url: `data:${p.mime || 'image/jpeg'};base64,${p.image.toString('base64')}` } }
      : { type: 'text', text: p.text });
  const body = {
    model, temperature,
    messages: [{ role: 'system', content: system }, { role: 'user', content }],
    ...(json ? { response_format: { type: 'json_object' } } : {})
  };
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(new URL(base).host + ' ' + res.status + ': ' + JSON.stringify(data).slice(0, 300));
  const text = data.choices?.[0]?.message?.content || '';
  return json ? parseJsonLoose(text) : text;
}

async function claudeCall(model, parts, { system, json = true, temperature = 0.7 }) {
  const content = parts.map((p) =>
    p.image
      ? { type: 'image', source: { type: 'base64', media_type: p.mime || 'image/jpeg', data: p.image.toString('base64') } }
      : { type: 'text', text: p.text });
  const body = {
    model, max_tokens: 8000, temperature,
    system: json ? system + '\nأجب بـ JSON صالح فقط، بدون أي نص خارج الـ JSON.' : system,
    messages: [{ role: 'user', content }]
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': settings.claudeApiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('CLAUDE ' + res.status + ': ' + JSON.stringify(data).slice(0, 300));
  const text = (data.content || []).map((b) => b.text || '').join('');
  return json ? parseJsonLoose(text) : text;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GEMINI_FALLBACKS = ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'];

function callProviderOnce(p, model, parts, opts) {
  if (p === 'gemini') return geminiCall(model, parts, opts);
  if (p === 'openai') return openaiLikeCall('https://api.openai.com/v1/chat/completions', settings.openaiApiKey, model, parts, opts);
  if (p === 'groq') return openaiLikeCall('https://api.groq.com/openai/v1/chat/completions', settings.groqApiKey, model, parts, opts);
  return claudeCall(model, parts, opts);
}

async function aiCall(parts, opts) {
  if (!activeKey()) { const e = new Error('NO_KEY'); e.code = 'NO_KEY'; throw e; }
  const p = settings.provider || 'gemini';
  const defaults = { gemini: 'gemini-3.6-flash', openai: 'gpt-4o', claude: 'claude-sonnet-4-5', groq: 'meta-llama/llama-3.2-90b-vision-preview' };
  const base = settings.model || defaults[p] || defaults.gemini;
  const chain = [base];
  if (p === 'gemini') for (const m of GEMINI_FALLBACKS) if (!chain.includes(m)) chain.push(m);
  let lastErr = null;
  const maxModels = Math.min(chain.length, 3);
  for (let mi = 0; mi < maxModels; mi++) {
    const model = chain[mi];
    const maxAttempts = mi === 0 ? 3 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const r = await callProviderOnce(p, model, parts, opts);
        if (model !== base) console.log('[imo-x] fallback model answered:', model);
        return r;
      } catch (e) {
        lastErr = e;
        const msg = String(e.message || e);
        const transient = /503|502|\b500\b|429|high demand|UNAVAILABLE|overloaded|RESOURCE_EXHAUSTED|capacity/i.test(msg);
        const modelGone = /404|NOT_FOUND|no longer available/i.test(msg);
        if (transient) {
          if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
          break; // جرب الموديل الاحتياطي
        }
        if (modelGone) break; // الموديل مو متوفر — تخطّه
        throw e; // خطأ حقيقي — وقف
      }
    }
  }
  throw lastErr || new Error('خطأ غير معروف');
}

function friendlyError(e) {
  const msg = String(e.message || e);
  return /503|502|\b500\b|429|high demand|UNAVAILABLE|overloaded|RESOURCE_EXHAUSTED/i.test(msg)
    ? '⏳ Gemini مشغول الحين (ضغط عالي من طرف Google). جربنا تلقائياً أكثر من مرة وبموديلات احتياطية — أعد المحاولة بعد دقيقة-دقيقتين، وغالباً بيمشي من أول ضغطة.'
    : 'حدث خطأ: ' + msg.slice(0, 250);
}

// ---------------- demo data ----------------
const DEMO = {
  demo: true,
  title: 'ZED Runners — "ركض وأنت ناطم" (محتوى تجريبي)',
  platform: 'TikTok / Reels — 9:16',
  duration: '30 ثانية',
  hook: {
    first3seconds: 'لقطة ماكرو بطيئة: نعل حذاء يرتطم براصد الشارع المبلل، ماء يتطاير في كل اتجاه تحت نيون أزرق، مع صوت impact ثقيل. لا كلام، لا شعار — فقط الحركة والصوت.',
    whyItStops: '3 أسباب توقف السكرول: (1) حركة بطيئة مكبرة ما تشوفها بعينك في الواقع، (2) تباين لوني قوي (نيون أزرق/برتقالي)، (3) سؤال بصري: شو هذا الحذاء اللي بيضرب الأرض بهالطريقة؟'
  },
  idea: {
    bigIdea: 'الحذاء مو منتج — هو الوقود. الإعلان ما يبيع حذاء، يبيع "الشعور" إنك أقوى من المدينة اللي تركض فيها.',
    message: 'ZED = طاقة تصدقها',
    target: 'شباب 18-30، رياضيين، مهتمين بالموضة والـ street culture'
  },
  scenario: 'مدينة ليلاً تحت مطر خفيف. فتى (24) واقف قبيل ما يركض — لقطات وجهه محورية. يبدأ الركض والكاميرا بتتبعه: شارع نيون، درج، حواجز. الموسيقى تبني حتى drop عند 00:07. في 00:17 المنتج يطلع: حواء الحذاء بيلف 360 على ضلمة نيون. في النهاية: العداء يوقف، ينزل يلاقي حواه، يتنفس — "انتصار صغير". الختام: الحذاء بيطير للكاميرا + الشعار + CTA. الرسالة: الطاقة اللي بتصدقها تبدأ من أول خطوة.',
  scenes: [
    { index: 1, time: '00:00-00:03', location: 'شارع راصد ليلاً، مطر خفيف', action: 'ماكرو: نعل الحذاء يرتطم بالأرض المبللة، ماء يتطاير (slow motion)', dialogue: '—', cameraAngle: 'Low angle + Macro (زاوية منخفضة مكبرة — تبالغ بقوة الارتطام)', cameraMove: 'ثابت، سرعة 50% slow', lighting: 'نيون أزرق جانبي', color: 'أزرق غامق + سماوي', mood: 'غموض، طاقة كامنة' },
    { index: 2, time: '00:03-00:07', location: 'نفس الشارع', action: 'لقطة قريبة على وجه العداء: عزم، قطرات مطر على الوجه، يخذ نفس عميق ويقلع', dialogue: '—', cameraAngle: 'Low angle (من تحت — تقويه)', cameraMove: 'Push-in بطيء', lighting: 'Rim light دافئ من الخلف (هالة على الشعر والكتف)', color: 'برتقالي على البشرة مقابل أزرق الخلفية', mood: 'توتر قبل الانفجار' },
    { index: 3, time: '00:07-00:12', location: 'شارع نيون', action: 'الركض يبدأ — الكاميرا بتتبعه جنبه من ارتفاع الركبة، انعكاسات النيون على الأرض المبللة', dialogue: '— (الموسيقى drop هنا)', cameraAngle: 'Tracking جنب، ارتفاع منخفض', cameraMove: 'Tracking بسرعة الركض + اهتزاز خفيف handheld', lighting: 'نيون متعدد الألوان من المحلات', color: 'نيون مائي + أزرق', mood: 'طاقة، اندفاع' },
    { index: 4, time: '00:12-00:17', location: 'درج حجري', action: 'يتجاوز الحواجز: درج، قفز، دوران — لقطات سريعة (cut كل ثانية)', dialogue: '—', cameraAngle: 'Low angle من تحت الدرج (تخلي القفزة أعلى)', cameraMove: 'Handheld سريع + whip pan بين اللقطات', lighting: 'Backlight قوي من فوق الدرج', color: 'تباين عالي، ظلال غامقة', mood: 'أدرينالين' },
    { index: 5, time: '00:17-00:22', location: 'ستوديو ضلمة / ساحة خالية', action: 'كشف المنتج: حواء الحذاء بيلف 360 على ضلمة، نيون سماوي من تحت', dialogue: '—', cameraAngle: 'Orbit 360 حول المنتج، مستوى العين', cameraMove: 'دوران كامل سلس (orbit)', lighting: 'Under-light سماوي + rim أبيض', color: 'أسود + سماوي نيون', mood: 'فخامة المنتج' },
    { index: 6, time: '00:22-00:26', location: 'نهاية الشارع', action: 'العداء يوقف، ينزل يلاقي حواه، يتنفس — لحظة "وصلت"', dialogue: '(تنفّس واضح)', cameraAngle: 'Dutch angle خفيف (إحساس انتهاء الجهد)', cameraMove: 'دوران بطيء حوله', lighting: 'Key light دافئ خفيف + ضباب', color: 'دافي، برتقالي هادئ', mood: 'إتمام، راحة بعد الجهد' },
    { index: 7, time: '00:26-00:29', location: '—', action: 'الحذاء بيطير للكاميرا (dynamic zoom) حتى يسد الشاشة', dialogue: '—', cameraAngle: 'Front، مستوى الحذاء', cameraMove: 'Zoom-in سريع (smash)', lighting: 'نيون سماوي', color: 'سماوي على أسود', mood: 'ضربة أخيرة' },
    { index: 8, time: '00:29-00:30', location: 'شاشة ختامية', action: 'الشعار ZED + "ركض وأنت ناطم" + سعر/رابط', dialogue: '(صوت logo sting)', cameraAngle: 'Static graphic', cameraMove: '—', lighting: '—', color: 'أسود + سماوي', mood: 'CTA' }
  ],
  characters: [
    { name: 'العدّاء', description: 'شاب 24، رياضي، تعبير محوري وصامت — بطل الإعلان', genPrompt: 'cinematic character sheet, young male runner 24 years old, athletic lean build, short dark hair, determined silent expression, black tech-wear jacket and running shorts, wet from rain, neon-lit night city background, dramatic rim lighting, 9:16 vertical, photorealistic, 35mm film grain' },
    { name: 'المنتج (حذاء ZED)', description: 'حذاء رنّين أسود بلمسات نيون سماوي — بطل صامت ثاني', genPrompt: 'futuristic running sneaker, matte black with neon cyan accents, floating in dark studio, dramatic under-lighting cyan glow, water droplets, 9:16 vertical product shot, photorealistic, 8k, commercial advertising style' }
  ],
  lcms: {
    lighting: 'أساس: نيون أزرق/سماوي (المدينة) + دافئ برتقالي (العداء). Backlight قوي في مشاهد الجهد، Under-light سماوي في مشهد المنتج.',
    palette: ['#0b1c3a', '#00d4ff', '#ff9d45', '#0a0a0f'],
    colorGrading: 'Teal & Orange: ظلال teal غامقة + highlights دافئة، contrast عالي',
    mood: 'طاقة ليلية: غموض → توتر → اندفاع → فخامة → انتصار'
  },
  cameraAngles: [
    { term: 'Low angle', scene: 'الارتطام، وجه العداء، القفز', why: 'تخلي الشخصية/المنتج أكبر وأقوى من محيطه' },
    { term: 'Macro + Slow motion', scene: 'أول 3 ثواني', why: 'تكبير التفاصيل + بطء = هوك بصري' },
    { term: 'Tracking shot', scene: 'مشهد الركض', why: 'تربط المشاهد بالحركة وتخليك "تركض معه"' },
    { term: 'Orbit 360', scene: 'كشف المنتج', why: 'عرض المنتج من كل الزوايا بشكل فخامي' },
    { term: 'Dutch angle', scene: 'مشهد التوقف الأخير', why: 'إحساس إن الجهد انتهى والوقت مائل' },
    { term: 'Smash zoom', scene: 'الختام', why: 'ضربة بصرية تقفل الإعلان بقوة' }
  ],
  motion: [
    { scene: 'مشهد 1', motion: 'ارتطام النعل + تطاير الماء في slow motion', motionPrompt: 'extreme close-up macro, sneaker sole slams wet asphalt, water droplets explode in slow motion 240fps look, neon blue side light, dark night, cinematic, 9:16' },
    { scene: 'مشهد 3', motion: 'tracking جنب العداء بسرعة الركض', motionPrompt: 'cinematic tracking shot, camera moves sideways at running pace low to the ground, runner in neon street at night, rain, neon reflections on wet road, slight handheld shake, 9:16' },
    { scene: 'مشهد 5', motion: 'دوران 360 حول الحذاء الطافي', motionPrompt: '360 orbit shot around floating sneaker, dark studio, cyan under-light glow, slow smooth rotation, product commercial, 9:16' },
    { scene: 'مشهد 7', motion: 'الحذاء يطير للكاميرا', motionPrompt: 'sneaker flies directly toward camera, fast smash zoom, motion blur, dark background with cyan rim light, 9:16' }
  ],
  voiceover: [
    { time: '00:00', line: '— (لا كلام: صوت impact + مطر)' },
    { time: '00:12', line: 'همسة راوٍ: "المدينة مش غليظة… أنت اللي أقوى منها"' },
    { time: '00:22', line: '— (تنفّس + الموسيقى تنحسر)' },
    { time: '00:29', line: 'راوٍ: "ZED — ركض وأنت ناطم"' }
  ],
  musicSfx: {
    music: 'Trap/Hyperpop: بناء bass ثقيل من 00:00، drop حاد عند 00:07، ينحسر عند 00:22، logo sting عند الختام (~140 BPM)',
    sfx: ['impact نعل على راصد', 'مطر خفيف مستمر', 'heartbeat تحت البناء', 'whoosh على كل cut', 'تنفّس', 'logo sting']
  },
  whyItWorked: [
    'هوك بصري نقي في أول ثانية — بدون كلام ولا شعار، بس حركة + صوت',
    'تصعيد إيقاعي متزامن 100% مع الموسيقى (كل cut على beat)',
    'المنتج ظاهر بوضوح في ~40% من المدة، ولحظة عرض مخصصة (مشهد 5)',
    'رحلة إحساس كاملة: غموض → جهد → انتصار = المشاهد يعيشها',
    'CTA في 3 ثواني أخيرة واضحة: اسم + جملة + سعر'
  ],
  notes: '⚠️ هذا محتوى تجريبي (وضع بدون مفتاح) — مثال احترافي على شكل الإخراج. حط مفتاح Gemini من ⚙️ أو ابعت لي الإعلان الحقيقي هنا في المحادثة عشان تحليل حقيقي.'
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
  if (d.characters) {
    sec('🧍 الشخصيات');
    d.characters.forEach((c) => { L.push(`**${c.name}**\n${c.description || ''}\n\`\`\`${c.genPrompt || ''}\`\`\``); });
  }
  if (d.lcms) { sec('💡 الإضاءة + الألوان + المود'); L.push('- **إضاءة:** ' + d.lcms.lighting); L.push('- **لوحة الألوان:** ' + (d.lcms.palette || []).join(' ')); L.push('- **تصحيح لوني:** ' + (d.lcms.colorGrading || '')); L.push('- **مود:** ' + d.lcms.mood); }
  if (d.cameraAngles) { sec('🎥 زوايا الكاميرا'); d.cameraAngles.forEach((c) => L.push(`- **${c.term || c.angle || ''}:** ${c.scene} (ليش: ${c.why})`)); }
  if (d.motion) {
    sec('🌀 أوامر الحركة');
    d.motion.forEach((m) => { L.push(`**${m.scene}**\n${m.motion}\n\`\`\`${m.motionPrompt || ''}\`\`\``); });
  }
  const vo = d.voiceover || d.voiceoverScript;
  if (vo) { sec('🎙️ الحوار والتعليق الصوتي'); vo.forEach((v) => L.push(`- [${v.time || ''}] ${v.line}`)); }
  if (d.musicSfx) { sec('🎵 الموسيقى والأصوات'); L.push('- **موسيقى:** ' + d.musicSfx.music); L.push('- **أصوات:** ' + (d.musicSfx.sfx || []).join('، ')); }
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
  res.json({
    provider: settings.provider,
    hasKey: !!activeKey(),
    model: settings.model || defaults[settings.provider] || 'gemini-3.6-flash',
    tools: t
  });
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

app.get('/api/projects', (req, res) => {
  res.json(loadProjects().map((p) => ({ id: p.id, name: p.name, created: p.created, kind: p.kind })));
});
app.post('/api/projects', (req, res) => {
  const list = loadProjects();
  const p = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    created: new Date().toISOString(),
    name: (req.body && req.body.name) || 'مشروع بدون اسم',
    kind: (req.body && req.body.kind) || 'analysis',
    data: (req.body && req.body.data) || {}
  };
  list.unshift(p);
  saveProjects(list);
  res.json({ id: p.id });
});
app.get('/api/projects/:id', (req, res) => {
  const p = loadProjects().find((x) => x.id === req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'ما لقينا المشروع' });
});
app.delete('/api/projects/:id', (req, res) => {
  saveProjects(loadProjects().filter((x) => x.id !== req.params.id));
  res.json({ ok: true });
});
app.get('/api/projects/:id/export', (req, res) => {
  const p = loadProjects().find((x) => x.id === req.params.id);
  if (!p) return res.status(404).send('not found');
  res.setHeader('Content-Disposition', `attachment; filename="imo-x-${p.id}.md"`);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(toMarkdown(p.data, p.name));
});
app.post('/api/export', (req, res) => {
  const { name, data } = req.body || {};
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(toMarkdown(data || {}, name));
});

app.post('/api/analyze', upload.any(), async (req, res) => {
  const body = req.body || {};
  const files = (req.files || []).map((f) => f.path);
  const t0 = Date.now();
  const cleanup = () => files.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
  const log = (m) => console.log(`[imo-x] ${m} (${Math.round((Date.now() - t0) / 1000)}s)`);
  try {
    if (!activeKey()) {
      res.json({ ...DEMO, source: body.url || 'demo' });
      return;
    }
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
    parts.push({
      text: `هذا إعلان كامل (${frames.length} كادر/لقطة مرتبة زمنياً${durGuess ? '، مدته تقريباً ' + Math.round(durGuess) + ' ثانية' : ''})${body.platform ? '، المنصة: ' + body.platform : ''}${body.tools ? '، أدوات التوليد: ' + body.tools : ''}. حلله كاملاً ودقّق فيه.`
    });
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
    const sys = BRAIN + `\n\nالمهمة الآن: المستخدم عنده فكرته الجديدة لقسم "${SECTIONS_AR[section]}" في تحليل إعلان. أعد كتابة قسم "${section}" فقط بعد تطبيق فكرته، مع الحفاظ على بقية عناصر القسم المتوافقة. أخرج JSON يحوي مفتاحاً واحداً فقط باسم "${section}" بقيمته الجديدة.`;
    const parts = [
      { text: 'تحليل الإعلان الحالي (JSON):\n' + JSON.stringify(project).slice(0, 12000) },
      { text: `الفكرة الجديدة للمستخدم لقسم "${SECTIONS_AR[section]}":\n${instruction}` }
    ];
    const updated = await aiCall(parts, {
      system: sys, json: true, temperature: 0.8,
      schema: { type: 'OBJECT', properties: { [section]: schema }, required: [section] }
    });
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
  if (!activeKey()) {
    return res.json({ demo: true, note: 'وضع تجريبي — خطة الإنتاج الحقيقية (كل المشاهد + البرومبتات) تحتاج مفتاح من ⚙️. حتى ذلك، تحليلك في تبويب "تحليل إعلان" شغال كمرجع.' });
  }
  const sys = BRAIN + `

مهمتك الجديدة: أنت المخرج اللي بيصنع إعلان جديد من فكرة المستخدم. اخرج خطة إنتاج كاملة JSON:
- title: اسم مقترح للإعلان (قوي، عالمي)
- concept: الفكرة الكبيرة والإحساس العام (فقرتان)
- structure: كيف موزع الإعلان على الزمن (هوك ← تصعيد ← حل ← عرض ← CTA) بالتوقيت
- styleLine: سطر واحد إنجليزي يوصف الأسلوب البصري الموحّد (يضاف لكل برومبت توليد عشان كل اللقطات على نفس المظهر)
- scenes: كل مشهد: index, time, location, action, cameraAngle, cameraMove, lighting, mood, visualPrompt (إنجليزي كامل جاهز للنسخ — يدمج styleLine + الزاوية + الإضاءة + وصف المشهد), motionPrompt (إنجليزي للحركة), voiceoverLine (نص التعليق على المشهد), sfx (صوت)
- characters: كل شخصية مع genPrompt
- voiceoverScript: كل جملة بالتوقيت
- music: وصف الموسيقى
- cta: النص/الطلب الأخير
القواعد: البرومبتات إنجليزية تقنية جاهزة للنسخ، النصوص العربية بلهجة بسيطة، التوقيت بصيغة 00:00-00:05، عدد المشاهد حسب المدة (30 ثانية ≈ 6-9 مشاهد).`;
  const text = [
    'الفكرة: ' + (b.idea || ''),
    b.reference ? 'مرجع تحليلي من إعلان مشابه (استخدمه كمصدر إلهام للمنطق والهيكل، لا تنسخه): ' + JSON.stringify(b.reference).slice(0, 6000) : '',
    'الشخصيات: ' + (b.characters || 'أنت تختار'),
    'المود: ' + (b.mood || 'أنت تختار'),
    'المدة: ' + (b.duration || '30 ثانية'),
    'الحوار/التعليق الصوتي: ' + (b.voiceover || 'أنت تبتكر'),
    'المنصة/الأبعاد: ' + (b.platform || 'TikTok 9:16'),
    'أدوات التوليد: ' + (b.tools || 'شامل'),
    'إضافي: ' + (b.extra || '')
  ].filter(Boolean).join('\n');
  try {
    const result = await aiCall([{ text }], { system: sys, json: true, temperature: 0.8, schema: PLAN_SCHEMA });
    res.json(result);
  } catch (e) {
    res.json({ error: friendlyError(e) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🎬 IMMO X server running on port ' + PORT);
});
