// 🎬 IMMO X — إيمو إكس | الواجهة
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
let STATUS = { hasKey: false, provider: 'gemini' };
let current = null;
let currentKind = 'analysis';
let planData = null;
let copyStore = [];
let progressTimer = null;

// fetch مع مؤقت أمان (عشان ما يتلصق الطلب للأبد)
async function fetchTimeout(url, opts = {}, ms = 240000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); }
  finally { clearTimeout(t); }
}

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ---------- prompt boxes ----------
const promptBox = (t) => {
  if (!t) return '';
  const i = copyStore.push(t) - 1;
  return `<div class="promptbox"><pre>${esc(t)}</pre><button class="mini" data-copy="${i}" title="نسخ البرومبت">📋 نسخ</button></div>`;
};
const KV = (icon, label, val) => (val ? `<div class="kvrow"><i>${icon} ${label}:</i> ${esc(val)}</div>` : '');

// ---------- analysis sections ----------
const SECTIONS = [
  { key: 'hook', title: '🪝 الهوك — أول 3 ثواني', render: (d) => d.hook ? `<div class="hl"><b>شو صار:</b> ${esc(d.hook.first3seconds)}</div><div class="hl alt"><b>ليش يوقف السكرول:</b> ${esc(d.hook.whyItStops)}</div>` : '' },
  { key: 'idea', title: '💡 الفكرة الكبيرة', render: (d) => d.idea ? `<div class="kv">${KV('🎯', 'الفكرة الكبيرة', d.idea.bigIdea)}${KV('💬', 'الرسالة', d.idea.message)}${KV('👥', 'الفئة المستهدفة', d.idea.target)}</div>` : '' },
  { key: 'scenario', title: '📜 السيناريو الكامل', render: (d) => d.scenario ? `<p class="para">${esc(d.scenario)}</p>` : '' },
  { key: 'scenes', title: '🎞️ المشاهد — Storyboard', render: (d) => (d.scenes || []).map((s) => `
    <div class="scene">
      <div class="scenehead"><span class="time">${esc(s.time || '')}</span><b>مشهد ${esc(s.index)}</b><span class="loc">${esc(s.location || '')}</span></div>
      <p class="act">${esc(s.action || '')}</p>
      <div class="kv">
        ${KV('🎙️', 'الحوار', s.dialogue)}
        ${KV('🎥', 'زاوية الكاميرا', s.cameraAngle)}
        ${KV('🌀', 'حركة الكاميرا', s.cameraMove)}
        ${KV('💡', 'الإضاءة', s.lighting)}
        ${KV('🎨', 'الألوان', s.color)}
        ${KV('🌡️', 'المود', s.mood)}
      </div>
    </div>`).join('') },
  { key: 'characters', title: '🧍 برومبتات توليد الشخصيات', render: (d) => (d.characters || []).map((c) => `
    <div class="scene">
      <div class="scenehead"><b>${esc(c.name)}</b></div>
      <p class="act">${esc(c.description || '')}</p>
      ${promptBox(c.genPrompt)}
    </div>`).join('') },
  { key: 'lcms', title: '💡 الإضاءة + الألوان + المود', render: (d) => d.lcms ? `
    <div class="kv">
      ${KV('💡', 'الإضاءة', d.lcms.lighting)}
      ${KV('🎨', 'التصحيح اللوني', d.lcms.colorGrading)}
      ${KV('🌡️', 'المود', d.lcms.mood)}
    </div>
    ${(d.lcms.palette || []).length ? `<div class="palettes">${d.lcms.palette.map((c) => `<span class="sw" style="background:${esc(c)}">${esc(c)}</span>`).join('')}</div>` : ''}` : '' },
  { key: 'cameraAngles', title: '🎥 زوايا الكاميرا', render: (d) => (d.cameraAngles || []).map((c) => `
    <div class="scene"><div class="scenehead"><b>${esc(c.term || c.angle || '')}</b></div><div class="kv">${KV('📍', 'وشين', c.scene)}${KV('❓', 'ليش', c.why)}</div></div>`).join('') },
  { key: 'motion', title: '🌀 أوامر الحركة (Motion)', render: (d) => (d.motion || []).map((m) => `
    <div class="scene"><div class="scenehead"><b>${esc(m.scene || '')}</b></div><p class="act">${esc(m.motion || '')}</p>${promptBox(m.motionPrompt)}</div>`).join('') },
  { key: 'voiceover', title: '🎙️ الحوار والتعليق الصوتي', render: (d) => (d.voiceover || []).map((v) => `<div class="vline"><span class="time">${esc(v.time || '')}</span><span>${esc(v.line || '')}</span></div>`).join('') },
  { key: 'musicSfx', title: '🎵 الموسيقى والأصوات', render: (d) => d.musicSfx ? `<div class="kv">${KV('🎼', 'الموسيقى', d.musicSfx.music)}</div>${(d.musicSfx.sfx || []).length ? `<div class="chips">${d.musicSfx.sfx.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}` : '' },
  { key: 'whyItWorked', title: '🏆 ليش هذا الإعلان نجح', render: (d) => (d.whyItWorked || []).length ? `<ul class="winlist">${d.whyItWorked.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '' }
];

// ---------- plan sections ----------
const PLAN_SECTIONS = [
  { key: 'concept', title: '💡 الفكرة والمفهوم', render: (d) => d.concept ? `<p class="para">${esc(d.concept)}</p>` : '' },
  { key: 'structure', title: '🗺️ هيكل الإعلان على الزمن', render: (d) => d.structure ? `<p class="para">${esc(d.structure)}</p>` : '' },
  { key: 'styleLine', title: '🧬 سطر الأسلوب الموحّد (يضاف لكل برومبت)', render: (d) => promptBox(d.styleLine) },
  { key: 'scenes', title: '🎞️ المشاهد + برومبتات التوليد والحركة', render: (d) => (d.scenes || []).map((s) => `
    <div class="scene">
      <div class="scenehead"><span class="time">${esc(s.time || '')}</span><b>مشهد ${esc(s.index)}</b><span class="loc">${esc(s.location || '')}</span></div>
      <p class="act">${esc(s.action || '')}</p>
      <div class="kv">
        ${KV('🎥', 'الزاوية', s.cameraAngle)}
        ${KV('🌀', 'الحركة', s.cameraMove)}
        ${KV('💡', 'الإضاءة', s.lighting)}
        ${KV('🌡️', 'المود', s.mood)}
        ${KV('🎙️', 'التعليق', s.voiceoverLine)}
        ${KV('🔊', 'الصوت', s.sfx)}
      </div>
      ${promptBox(s.visualPrompt)}
      ${promptBox(s.motionPrompt)}
    </div>`).join('') },
  { key: 'characters', title: '🧍 برومبتات الشخصيات', render: (d) => (d.characters || []).map((c) => `
    <div class="scene"><div class="scenehead"><b>${esc(c.name)}</b></div><p class="act">${esc(c.description || '')}</p>${promptBox(c.genPrompt)}</div>`).join('') },
  { key: 'voiceoverScript', title: '🎙️ سكريبت التعليق الصوتي', render: (d) => (d.voiceoverScript || []).map((v) => `<div class="vline"><span class="time">${esc(v.time || '')}</span><span>${esc(v.line || '')}</span></div>`).join('') },
  { key: 'music', title: '🎵 الموسيقى', render: (d) => d.music ? `<p class="para">${esc(d.music)}</p>` : '' },
  { key: 'cta', title: '📣 الـ CTA — الطلب الأخير', render: (d) => d.cta ? `<div class="hl"><b>${esc(d.cta)}</b></div>` : '' }
];

// ---------- plain text copy ----------
function sectionPlain(sec, d, kind) {
  if (kind === 'plan') {
    switch (sec.key) {
      case 'scenes': return (d.scenes || []).map((s) => `مشهد ${s.index} (${s.time || ''}) — ${s.location || ''}\n${s.action || ''}\nVISUAL: ${s.visualPrompt || ''}\nMOTION: ${s.motionPrompt || ''}\nVO: ${s.voiceoverLine || ''}\nSFX: ${s.sfx || ''}`).join('\n\n');
      case 'characters': return (d.characters || []).map((c) => `${c.name}\n${c.description || ''}\nPROMPT: ${c.genPrompt || ''}`).join('\n\n');
      case 'voiceoverScript': return (d.voiceoverScript || []).map((v) => `[${v.time || ''}] ${v.line || ''}`).join('\n');
      default: { const v = d[sec.key]; return typeof v === 'string' ? v : JSON.stringify(v, null, 1); }
    }
  }
  switch (sec.key) {
    case 'hook': return `الهوك:\n- أول 3 ثواني: ${d.hook ? d.hook.first3seconds : ''}\n- ليش يوقف: ${d.hook ? d.hook.whyItStops : ''}`;
    case 'idea': return `الفكرة: ${d.idea ? d.idea.bigIdea : ''}\nالرسالة: ${d.idea ? d.idea.message : ''}\nالهدف: ${d.idea ? d.idea.target : ''}`;
    case 'scenario': return d.scenario || '';
    case 'scenes': return (d.scenes || []).map((s) => `مشهد ${s.index} (${s.time}) — ${s.location}\n${s.action}\nحوار: ${s.dialogue || '-'}\nكاميرا: ${s.cameraAngle} / ${s.cameraMove}\nإضاءة: ${s.lighting} | ألوان: ${s.color || '-'} | مود: ${s.mood}`).join('\n\n');
    case 'characters': return (d.characters || []).map((c) => `${c.name}:\n${c.description}\nPROMPT: ${c.genPrompt}`).join('\n\n');
    case 'lcms': return `إضاءة: ${d.lcms ? d.lcms.lighting : ''}\nلوحة الألوان: ${d.lcms ? (d.lcms.palette || []).join(', ') : ''}\nتصحيح لوني: ${d.lcms ? d.lcms.colorGrading : ''}\nمود: ${d.lcms ? d.lcms.mood : ''}`;
    case 'cameraAngles': return (d.cameraAngles || []).map((c) => `- ${c.term || c.angle}: ${c.scene} (ليش: ${c.why})`).join('\n');
    case 'motion': return (d.motion || []).map((m) => `${m.scene}:\n${m.motion}\nPROMPT: ${m.motionPrompt}`).join('\n\n');
    case 'voiceover': return (d.voiceover || []).map((v) => `[${v.time || ''}] ${v.line}`).join('\n');
    case 'musicSfx': return `موسيقى: ${d.musicSfx ? d.musicSfx.music : ''}\nأصوات: ${d.musicSfx ? (d.musicSfx.sfx || []).join('، ') : ''}`;
    case 'whyItWorked': return (d.whyItWorked || []).map((w) => '- ' + w).join('\n');
  }
  return '';
}

// ---------- copy ----------
async function copyText(t, btn) {
  if (!t) return;
  let ok = false;
  try { await navigator.clipboard.writeText(t); ok = true; } catch {}
  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      ok = document.execCommand('copy'); ta.remove();
    } catch {}
  }
  if (!ok) {
    $('#copyText').value = t;
    $('#copyModal').classList.remove('hidden');
    return;
  }
  if (btn) { const o = btn.textContent; btn.textContent = '✓ انسخ'; setTimeout(() => (btn.textContent = o), 1000); }
}

// ---------- rendering ----------
function sectionCard(sec, d, kind) {
  const body = sec.render(d);
  if (!body) return '';
  const canRefine = kind === 'analysis' && d.demo !== true;
  return `
  <div class="card sec">
    <div class="sechead">
      <h3>${sec.title}</h3>
      <div class="actions">
        <button class="mini" data-copy-sec="${sec.key}">📋 نسخ الكل</button>
        ${canRefine ? `<button class="mini" data-refine="${sec.key}">✏️ عدّلها بفكرتي</button>` : ''}
      </div>
    </div>
    <div class="secbody">${body}</div>
    ${canRefine ? `
    <div class="refine hidden" id="refine-${sec.key}">
      <textarea rows="2" id="refineTxt-${sec.key}" placeholder="اكتب فكرتك الجديدة... مثال: أبي الشخصية الثانية يمنية ولبسها تراثي وكانتر الدكان ظهري"></textarea>
      <div class="row">
        <button class="mini" data-apply="${sec.key}">✅ طبّق فكرتي</button>
        <span class="refine-msg" id="refineMsg-${sec.key}"></span>
      </div>
    </div>` : ''}
  </div>`;
}

function renderSections(containerId, secList, d, kind) {
  const list = secList.filter((s) => s.render(d));
  $(containerId).innerHTML = `
    <div class="card meta">
      <div class="metatitle">${d.demo ? '<span class="badge demo">وضع تجريبي — محتوى مثالي</span> ' : ''}${esc(d.title || (kind === 'plan' ? 'خطة الإنتاج' : 'تحليل الإعلان'))}</div>
      <div class="chiprow">
        ${d.platform ? `<span class="chip">${esc(d.platform)}</span>` : ''}
        ${d.duration ? `<span class="chip">⏱️ ${esc(d.duration)}</span>` : ''}
        ${d.source && d.source !== 'demo' ? `<span class="chip">🔗 ${esc(String(d.source).slice(0, 45))}</span>` : ''}
      </div>
      <div class="row topbar">
        <button class="mini" data-act="save">💾 حفظ المشروع</button>
        <button class="mini" data-act="export">📄 تصدير Markdown</button>
      </div>
    </div>
    ${list.map((s) => sectionCard(s, d, kind)).join('')}
    ${d.notes ? `<div class="note">📝 ${esc(d.notes)}</div>` : ''}
  `;
  $(containerId).querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copyText(copyStore[+b.dataset.copy], b)));
  $(containerId).querySelectorAll('[data-copy-sec]').forEach((b) => (b.onclick = () => copyText(sectionPlain(secList.find((s) => s.key === b.dataset.copySec), d, kind), b)));
  $(containerId).querySelectorAll('[data-refine]').forEach((b) => (b.onclick = () => { const r = $('#refine-' + b.dataset.refine); if (r) r.classList.toggle('hidden'); }));
  $(containerId).querySelectorAll('[data-apply]').forEach((b) => (b.onclick = () => applyRefine(b.dataset.apply)));
  $(containerId).querySelectorAll('[data-act="save"]').forEach((b) => (b.onclick = openSave));
  $(containerId).querySelectorAll('[data-act="export"]').forEach((b) => (b.onclick = exportMd));
}

const renderAnalysis = () => current && renderSections('#results', SECTIONS, current, 'analysis');
const renderPlan = () => planData && renderSections('#planResults', PLAN_SECTIONS, planData, 'plan');

// ---------- status / banner ----------
async function refreshStatus() {
  try {
    STATUS = await (await fetch('/api/status')).json();
    const el = $('#eyeStatus');
    if (STATUS.hasKey) el.innerHTML = `🟢 العين: <b>${esc(STATUS.provider)}</b>`;
    else el.innerHTML = `🔴 <b>وضع تجريبي</b> <span class="mut">(⚙️)</span>`;
  } catch {}
  updateBanner();
  updateModeHint();
}
function updateBanner() {
  const b = $('#banner');
  if (STATUS.hasKey) { b.innerHTML = ''; return; }
  b.innerHTML = `<div class="banner">🔴 <b>وضع تجريبي:</b> بدون مفتاح، النتيجة اللي بتطلع هي مثال توضيبي. اختارين:
    <button class="linkbtn" onclick="document.getElementById('btnSettings').click()">حط مفتاح Gemini المجاني من ⚙️</button>
    — أو <b>ابعت لي الإعلان هنا في المحادثة</b> وأنا أحله لك بنفسي (عيوني 🎥).</div>`;
}
function updateModeHint() {
  const h = $('#modeHint');
  if (!STATUS.hasKey) { h.textContent = 'بدون مفتاح: بتطلع نتيجة تجريبية (مثال) — جرب الشكل الأول، وبعدين حط المفتاح.'; return; }
  if (!STATUS.tools || !STATUS.tools.ytDlp) { h.textContent = 'ملاحظة: أداة التنزيل غير متوفرة على الجهاز — استخدم "ملف فيديو" أو "لقطات (صور)".'; return; }
  h.textContent = '';
}

// ---------- progress ----------
const PMSG = ['📥 بجهّز الملف...', '🎞️ بسحب الكادرات...', '👀 بيشوف المشهد شاشه شاشه...', '🧠 بيحلل الفكرة والسيناريو...', '📝 بكتب البرومبتات...'];
function showProgress(box, label) {
  box.classList.remove('hidden');
  let i = 0;
  label.textContent = PMSG[0];
  clearInterval(progressTimer);
  progressTimer = setInterval(() => { i = (i + 1) % PMSG.length; label.textContent = PMSG[i]; }, 3500);
}
function hideProgress() {
  clearInterval(progressTimer);
  $$('.progress').forEach((p) => p.classList.add('hidden'));
}

// ---------- analyze ----------
async function analyze() {
  const mode = $('.subtab.active').dataset.mode;
  const fd = new FormData();
  if (mode === 'url') { const u = $('#urlInput').value.trim(); if (!u) return toast('صيف رابط الإعلان أول 🎬'); fd.append('url', u); }
  if (mode === 'video') { const f = $('#videoInput').files[0]; if (!f) return toast('اختار ملف الفيديو أول'); fd.append('file', f); }
  if (mode === 'shots') { const fs = Array.from($('#shotsInput').files); if (!fs.length) return toast('اختار اللقطات (6-12 صورة)'); fs.forEach((f) => fd.append('images', f)); }
  fd.append('platform', $('#platformSel').value);
  fd.append('tools', $('#toolsSel').value);
  copyStore = [];
  $('#results').innerHTML = '';
  showProgress($('#progress'), $('#progressText'));
  try {
    const r = await fetchTimeout('/api/analyze', { method: 'POST', body: fd });
    const data = await r.json();
    hideProgress();
    if (data.error) { $('#results').innerHTML = `<div class="card error">⚠️ ${esc(data.error)}</div>`; return; }
    current = data; currentKind = 'analysis';
    renderAnalysis();
    window.scrollTo({ top: $('#results').offsetTop - 90, behavior: 'smooth' });
  } catch (e) {
    hideProgress();
    const msg = e && e.name === 'AbortError' ? '⏱️ أخذ وقت أطول من المعتاد (الخوادم مشغولة) — أعد المحاولة بعد شوي.' : String(e);
    $('#results').innerHTML = `<div class="card error">⚠️ ${esc(msg)}</div>`;
  }
}

// ---------- refine ----------
async function applyRefine(key) {
  const txt = $('#refineTxt-' + key).value.trim();
  if (!txt) return toast('اكتب فكرتك أول ✏️');
  const msg = $('#refineMsg-' + key);
  msg.textContent = '⏳ شغال على فكرتك...';
  try {
    const r = await fetch('/api/refine', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: current, section: key, instruction: txt })
    });
    const data = await r.json();
    if (data.error) { msg.textContent = '❌ ' + data.error; return; }
    if (data.project) {
      current = data.project;
      renderAnalysis();
      toast('✓ عدّل القسم بفكرتك');
    } else if (data.note) msg.textContent = '🔴 ' + data.note;
  } catch (e) { msg.textContent = '❌ ' + String(e); }
}

// ---------- plan ----------
async function makePlan() {
  const idea = $('#planIdea').value.trim();
  if (!idea) return toast('اكتب فكرتك أول 🎬');
  const body = {
    idea,
    characters: $('#planChars').value.trim(),
    mood: $('#planMood').value.trim(),
    duration: $('#planDur').value.trim() || '30 ثانية',
    platform: $('#planPlatform').value,
    tools: $('#toolsSel').value,
    voiceover: $('#planVo').value.trim(),
    extra: $('#planExtra').value.trim(),
    reference: current && !current.demo ? current : null
  };
  copyStore = [];
  $('#planResults').innerHTML = '';
  showProgress($('#planProgress'), $('#planProgressText'));
  try {
    const r = await fetchTimeout('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    hideProgress();
    if (data.error) { $('#planResults').innerHTML = `<div class="card error">⚠️ ${esc(data.error)}</div>`; return; }
    if (data.demo && !data.scenes) {
      $('#planResults').innerHTML = `<div class="banner">🔴 ${esc(data.note)}</div>`;
      return;
    }
    planData = data; currentKind = 'plan';
    renderPlan();
    window.scrollTo({ top: $('#planResults').offsetTop - 90, behavior: 'smooth' });
  } catch (e) {
    hideProgress();
    const msg = e && e.name === 'AbortError' ? '⏱️ أخذ وقت أطول من المعتاد (الخوادم مشغولة) — أعد المحاولة بعد شوي.' : String(e);
    $('#planResults').innerHTML = `<div class="card error">⚠️ ${esc(msg)}</div>`;
  }
}

// ---------- save / export / projects ----------
function openSave() {
  const d = currentKind === 'plan' ? planData : current;
  if (!d) return;
  $('#saveName').value = d.title || '';
  $('#saveModal').classList.remove('hidden');
}
async function doSave() {
  const d = currentKind === 'plan' ? planData : current;
  if (!d) return;
  const name = $('#saveName').value.trim() || 'مشروع إيمو إكس';
  await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, kind: currentKind, data: d }) });
  $('#saveModal').classList.add('hidden');
  $('#saveName').value = '';
  toast('✓ حفظ المشروع');
  loadProjects();
  renderRecent();
}
async function exportMd() {
  const d = currentKind === 'plan' ? planData : current;
  if (!d) return;
  const r = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('#saveName').value || (d.title || 'مشروع إيمو إكس'), data: d }) });
  const text = await r.text();
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'imo-x-project.md';
  a.click();
}
async function loadProjects() {
  try {
    const list = await (await fetch('/api/projects')).json();
    const box = $('#projectsList');
    if (!list.length) { box.innerHTML = '<p class="mut">ما في مشاريع محفوظة بعد — حلّل إعلان ثم 💾.</p>'; return; }
    box.innerHTML = list.map((p) => `
      <div class="proj">
        <b>${esc(p.name)}</b>
        <span class="chip">${p.kind === 'plan' ? '🎬 خطة إنتاج' : '🔍 تحليل'}</span>
        <span class="mut">${new Date(p.created).toLocaleDateString('ar-EG')}</span>
        <div class="row">
          <button class="mini" data-open="${p.id}">فتح</button>
          <button class="mini" data-pexp="${p.id}">📄</button>
          <button class="mini danger" data-pdel="${p.id}">حذف</button>
        </div>
      </div>`).join('');
    box.querySelectorAll('[data-open]').forEach((b) => (b.onclick = async () => {
      const p = await (await fetch('/api/projects/' + b.dataset.open)).json();
      if (p.kind === 'plan') { planData = p.data; currentKind = 'plan'; renderPlan(); }
      else { current = p.data; currentKind = 'analysis'; renderAnalysis(); }
      const tab = p.kind === 'plan' ? 'plan' : 'analyze';
      $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
      $$('.tabpane').forEach((x) => x.classList.add('hidden'));
      $('#tab-' + tab).classList.remove('hidden');
    }));
    box.querySelectorAll('[data-pexp]').forEach((b) => (b.onclick = () => { window.location = '/api/projects/' + b.dataset.pexp + '/export'; }));
    box.querySelectorAll('[data-pdel]').forEach((b) => (b.onclick = async () => {
      if (!confirm('امسح المشروع؟')) return;
      await fetch('/api/projects/' + b.dataset.pdel, { method: 'DELETE' });
      loadProjects();
    }));
  } catch {}
}

// ---------- settings ----------
function openSettings() {
  $('#setProvider').value = STATUS.provider || 'gemini';
  $('#setModel').value = '';
  $('#setModel').placeholder = STATUS.model || '';
  $('#setKey').value = '';
  $('#settingsModal').classList.remove('hidden');
}
async function saveSettingsFn() {
  await fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: $('#setProvider').value, key: $('#setKey').value, model: $('#setModel').value })
  });
  $('#settingsModal').classList.add('hidden');
  await refreshStatus();
  toast(STATUS.hasKey ? '✓ العين شغالة — إيمو إكس شوفي' : '✓ حفظ — ما في مفتاح بعد (وضع تجريبي)');
}

// ---------- glossary ----------
const GLOSSARY = [
  ['هوك (Hook)', 'الخطاف — أول 3 ثواني اللي تخلي المشاهد يوقف السكرول. يعني: شو اللي يوقفه قبل ما يمسح؟ سؤال، حركة غريبة، صوت مفاجئ، أو وجه بتعبيره.'],
  ['Storyboard', 'لوحة اللقطات — كل مشهد موصوف/مرسوم بالترتيب قبل ما تولد، عشان تعرف وين تمشي.'] ,
  ['Low Angle', 'الكاميرا من تحت لفوق — تعطي إحساس قوة/هيبة (الشخصية أكبر من كل شي حوالينها).'],
  ['High Angle', 'الكاميرا من فوق لتحت — تعطي إحساس صغر/حاجة/ضعف.'],
  ['Dutch Angle', 'إمالة الكاميرا بزاوية مائلة — إحساس توتر/دراما/انكسار.'],
  ['Match Cut', 'قطع متطابق — تنتهي لقطة على شكل وتفتح الثانية على نفس الشكل. انتقال ذكي يربط شي بشي.'],
  ['Tracking Shot', 'الكاميرا بتتبع الموضوع وهو ماشي (خلفه/جنبه) — إحساس حركة مستمر، تخلي المشاهد "يمشي معه".'],
  ['Push-in', 'الكاميرا بتقرب البطيء على وجه/شي — تركيز وتوتر.'],
  ['Orbit / 360', 'الكاميرا تلف حول الموضوع — عشان عرض المنتج من كل الزوايا بشكل فخامي.'],
  ['Smash Zoom', 'قرب سريع وعنيف على شي — ضربة بصرية تقفل لحظة بقوة (شهرتها من كوينتن تارانتينو).'],
  ['Key Light', 'الضوء الرئيسي اللي ينور الشخصية — أساس شكل اللقطة.'],
  ['Backlight / Rim Light', 'ضوء من الخلف — يفصل الشخصية عن الخلفية ويعطيها هالة.'],
  ['Color Grading', 'التصحيح اللوني — الألوان الأخيرة اللي تحدد مود الفيديو كله.'],
  ['LUT', 'فلتر لوني جاهز تلبسه كل لقطاتك مرة واحدة عشان مود موحد.'],
  ['Teal & Orange', 'لوحة ألوان سينمائية شهيرة: أزرق مخضر في الظلال + برتقالي دافي على البشرة.'],
  ['CTA', 'Call To Action — الطلب الأخير: اشترِ، جرّب، اضغط الرابط، تابعنا. بدون CTA الإعلان يضيع.'],
  ['Voiceover', 'التعليق الصوتي — صوت راوٍ فوق الفيديو.'],
  ['B-roll', 'لقطات مساعدة فوق الحوار (تفاصيل، محيط) عشان الصورة ما تمل.'],
  ['Foley', 'أصوات صغيرة مصنوعة يدوياً: خطوات، باب، قماش، قهوة تتصب.'],
  ['9:16', 'نسبة أبعاد الجوال العمودي — TikTok / Reels / Shorts.'],
  ['16:9', 'نسبة أبعاد الشاشة العريض — YouTube / تلفاز.']
];

// ---------- PWA install (اندرويد + كمبيوتر) ----------
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  const b = $('#btnInstall');
  if (b) b.classList.remove('hidden');
});
window.addEventListener('appinstalled', () => {
  const b = $('#btnInstall'); if (b) b.classList.add('hidden');
  toast('✓ تم تثبيت إيمو إكس على جهازك 🎬');
});

// ---------- quick tools & templates ----------
const TEMPLATES = {
  hook: 'إعلان بهيكل "هوك 3 ثواني": أول 3 ثواني بصدمة بصرية توقف السكرول، بعدها مشكلة الزبون، بعدها الحل بمنتجي، بعدها عرض واضح، وخاتمة بـ CTA. المنتج عندي: [اكتب منتجك هنا]...',
  product: 'إعلان "عرض منتج": ابدأ بلقطة ماكرو على المنتج بإضاءة جميلة، بعدها مزاياه بلقطات سريعة، بعدها استخدامه بالحياة الواقعية، بعدها السعر/العرض، وخاتمة بـ CTA واضح. المنتج عندي: [اكتب منتجك هنا]...',
  story: 'إعلان "قصة عاطفية": شخصية تواجه مشكلة حقيقية بقصة بسيطة وفيها لفتة، بعدها يظهر المنتج كمخرج، والخاتمة CTA. المنتج عندي: [اكتب منتجك هنا]...',
  before: 'إعلان "قبل / بعد": النصف الأول يبين المشكلة (قبل)، انتقال على عملية التحسن، بعدها النتيجة (بعد) بدليل واقعي، وخاتمة CTA. منتج/خدمتي: [اكتب هنا]...'
};
function switchTab(name) { const b = document.querySelector('.tab[data-tab="' + name + '"]'); if (b) b.click(); }
function relTime(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'الآن';
  if (s < 3600) return 'قبل ' + Math.floor(s / 60) + ' دقيقة';
  if (s < 86400) return 'قبل ' + Math.floor(s / 3600) + ' ساعة';
  return 'قبل ' + Math.floor(s / 86400) + ' يوم';
}
async function renderRecent() {
  const box = $('#recentList');
  if (!box) return;
  try {
    const list = await (await fetch('/api/projects')).json();
    if (!list.length) { box.innerHTML = '<p class="mut">ما في مشاريع بعد — أول تحليل بيظهر هنا.</p>'; return; }
    box.innerHTML = list.slice(0, 3).map((p) => `
      <div class="projrow">
        <span class="thumb">${p.kind === 'plan' ? '🎬' : '🔍'}</span>
        <span class="prinfo"><b>${esc(p.name)}</b><small>آخر تعديل: ${relTime(p.created)}</small></span>
        <span class="prdots">⋮</span>
      </div>`).join('');
    box.querySelectorAll('.projrow').forEach((r, i) => (r.onclick = async () => {
      const p = await (await fetch('/api/projects/' + list[i].id)).json();
      if (p.kind === 'plan') { planData = p.data; currentKind = 'plan'; renderPlan(); }
      else { current = p.data; currentKind = 'analysis'; renderAnalysis(); }
      switchTab(p.kind === 'plan' ? 'plan' : 'analyze');
    }));
  } catch {}
}

// ---------- init ----------
function init() {
  $$('.tab').forEach((t) => (t.onclick = () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $$('.tabpane').forEach((p) => p.classList.add('hidden'));
    $('#tab-' + t.dataset.tab).classList.remove('hidden');
    if (t.dataset.tab === 'projects') loadProjects();
  }));
  $$('.subtab').forEach((t) => (t.onclick = () => {
    $$('.subtab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $$('.modepane').forEach((p) => p.classList.add('hidden'));
    $('#mode-' + t.dataset.mode).classList.remove('hidden');
  }));
  $('#btnAnalyze').onclick = analyze;
  $('#btnPlan').onclick = makePlan;
  $('#btnSettings').onclick = openSettings;
  $('#closeSettings').onclick = () => $('#settingsModal').classList.add('hidden');
  $('#saveSettings').onclick = saveSettingsFn;
  $('#confirmSave').onclick = doSave;
  $('#closeSave').onclick = () => $('#saveModal').classList.add('hidden');
  $('#closeCopy').onclick = () => $('#copyModal').classList.add('hidden');
  $('#closeTemplates').onclick = () => $('#templatesModal').classList.add('hidden');
  $('#glossary').innerHTML = GLOSSARY.map(([t, d]) => `<details><summary>${esc(t)}</summary><p>${esc(d)}</p></details>`).join('');
  $$('[data-qact]').forEach((b) => (b.onclick = () => {
    const a = b.dataset.qact;
    if (a === 'plan') { switchTab('plan'); setTimeout(() => $('#planIdea').focus(), 120); }
    if (a === 'new') {
      switchTab('analyze');
      $('#urlInput').value = ''; $('#videoInput').value = ''; $('#shotsInput').value = '';
      current = null; planData = null; $('#results').innerHTML = '';
      toast('✨ مشروع جديد — الصق رابطك أو ارفع لقطات');
    }
    if (a === 'templates') $('#templatesModal').classList.remove('hidden');
    if (a === 'improve') {
      switchTab('analyze');
      const s = $('.subtab[data-mode="url"]'); if (s) s.click();
      setTimeout(() => $('#urlInput').focus(), 120);
      toast('🚀 الصق رابط الإعلان اللي تبيه أقوى — حله وعدّله بفكرتك');
    }
  }));
  $$('.tbtn').forEach((b) => (b.onclick = () => {
    $('#planIdea').value = TEMPLATES[b.dataset.tpl] || '';
    $('#templatesModal').classList.add('hidden');
    switchTab('plan');
    toast('✓ القالب اتمل — عدّله بفكرتك');
  }));
  const bi = $('#btnInstall');
  if (bi) bi.onclick = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    bi.classList.add('hidden');
  };
  const ba = $('#btnAllProjects'); if (ba) ba.onclick = () => switchTab('projects');
  refreshStatus();
  loadProjects();
  renderRecent();
}
document.addEventListener('DOMContentLoaded', init);
