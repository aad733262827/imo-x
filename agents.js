// agents.js — AI provider call logic used by server.js
// Exposes aiCall(settings, parts, opts) and friendlyError(e)

const fetchTimeouted = (url, opts = {}, ms = 180000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
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

// ---------------- Gemini ----------------
async function geminiCall(model, parts, opts, apiKey) {
  const contents = [{
    role: 'user',
    parts: parts.map((p) => (p.text !== undefined
      ? { text: p.text }
      : { inline_data: { mime_type: p.mime || 'image/jpeg', data: p.image.toString('base64') } }))
  }];
  const generationConfig = { temperature: opts.temperature ?? 0.6 };
  if (opts.json) {
    generationConfig.responseMimeType = 'application/json';
    if (opts.schema) generationConfig.responseSchema = opts.schema;
  }
  const body = { contents, generationConfig };
  if (opts.system) body.systemInstruction = { role: 'system', parts: [{ text: opts.system }] };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetchTimeouted(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `Gemini HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) {
    const finish = data?.candidates?.[0]?.finishReason;
    throw new Error('ما وصل رد من Gemini' + (finish ? ` (${finish})` : ''));
  }
  return opts.json ? parseJsonLoose(text) : text;
}

// ---------------- OpenAI-like (OpenAI / Groq) ----------------
async function openaiLikeCall(base, key, model, parts, opts) {
  const content = [];
  for (const p of parts) {
    if (p.text !== undefined) content.push({ type: 'text', text: p.text });
    else content.push({ type: 'image_url', image_url: { url: `data:${p.mime || 'image/jpeg'};base64,${p.image.toString('base64')}` } });
  }
  const messages = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content });

  const body = { model, messages, temperature: opts.temperature ?? 0.6 };
  if (opts.json) body.response_format = { type: 'json_object' };

  const res = await fetchTimeouted(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('ما وصل رد من الموديل');
  return opts.json ? parseJsonLoose(text) : text;
}

// ---------------- Claude (Anthropic) ----------------
async function claudeCall(model, parts, opts, apiKey) {
  const content = [];
  for (const p of parts) {
    if (p.text !== undefined) content.push({ type: 'text', text: p.text });
    else content.push({ type: 'image', source: { type: 'base64', media_type: p.mime || 'image/jpeg', data: p.image.toString('base64') } });
  }
  const body = {
    model,
    max_tokens: 4096,
    temperature: opts.temperature ?? 0.6,
    messages: [{ role: 'user', content }]
  };
  if (opts.system) body.system = opts.system;
  if (opts.json) {
    body.messages[0].content.push({ type: 'text', text: '\n\nأجب فقط بكائن JSON صالح بدون أي نص إضافي.' });
  }

  const res = await fetchTimeouted('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `Claude HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const text = (data?.content || []).map((c) => c.text || '').join('');
  if (!text) throw new Error('ما وصل رد من Claude');
  return opts.json ? parseJsonLoose(text) : text;
}

// ---------------- dispatcher ----------------
async function callProviderOnce(settings, p, model, parts, opts) {
  if (p === 'gemini') return geminiCall(model, parts, opts, settings.geminiApiKey);
  if (p === 'openai') return openaiLikeCall('https://api.openai.com/v1', settings.openaiApiKey, model, parts, opts);
  if (p === 'groq') return openaiLikeCall('https://api.groq.com/openai/v1', settings.groqApiKey, model, parts, opts);
  if (p === 'claude') return claudeCall(model, parts, opts, settings.claudeApiKey);
  throw new Error('مزود غير مدعوم: ' + p);
}

const GEMINI_FALLBACKS = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const DEFAULT_MODELS = { gemini: 'gemini-3.6-flash', openai: 'gpt-4o', claude: 'claude-sonnet-4-5', groq: 'meta-llama/llama-3.2-90b-vision-preview' };

function isTransientError(e) {
  const status = e && e.status;
  const msg = String((e && e.message) || e || '').toLowerCase();
  if ([503, 502, 500, 429].includes(status)) return true;
  return /high demand|unavailable|overloaded|resource_exhausted|capacity/.test(msg);
}

async function aiCall(settings, parts, opts = {}) {
  const provider = settings.provider || 'gemini';
  const key = settings[`${provider}ApiKey`] || '';
  if (!key) {
    const err = new Error('ما في مفتاح API');
    err.code = 'NO_KEY';
    throw err;
  }

  const baseModel = settings.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.gemini;
  const chain = provider === 'gemini'
    ? Array.from(new Set([baseModel, ...GEMINI_FALLBACKS]))
    : [baseModel];

  let lastErr = null;
  for (const model of chain) {
    const retries = 2;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await callProviderOnce(settings, provider, model, parts, opts);
      } catch (e) {
        lastErr = e;
        if (isTransientError(e) && attempt < retries) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        break;
      }
    }
  }
  throw lastErr || new Error('فشل الاتصال بالموديل');
}

function friendlyError(e) {
  if (e && e.code === 'NO_KEY') return 'ما في مفتاح API — أضف مفتاحك من ⚙️.';
  if (isTransientError(e)) return 'الخدمة مزدحمة حالياً، جرب بعد شوي 🙏';
  return 'حدث خطأ: ' + (e && e.message ? e.message : String(e));
}

module.exports = { aiCall, friendlyError };
