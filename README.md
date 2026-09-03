# 🎬 IMMO X — Documentation (README)

النسخة العربية موجودة أيضاً في `README-الرفع-و-التثبيت.md`. هذا الملف يشرح بسرعة كيفية تشغيل المشروع محلياً، ربطه بمزودات الذكاء الاصطناعي، ونشره كخدمة/تطبيق.

## What this is
IMMO X هو خادم Node.js بسيط يحوّل لقطات/فيديو إلى تحليل إنتاجي إعلانٍ بالكامل باستخدام نماذج ذكاء اصطناعي (Gemini / OpenAI / Claude / Groq). يأتي مع واجهة ويب في `public/` ويعمل كتطبيق قابل للتثبيت (PWA).

### Stack
- **Language(s):** JavaScript (Node.js)
- **Framework / runtime:** Express
- **Notable libraries:** express, multer

## How it's organized
```text
server.js        # Main server + AI integration and API endpoints
public/          # Frontend (PWA): index.html, app.js, style.css, manifest.json
render.yaml      # Render.com blueprint to install ffmpeg + yt-dlp and run the app
package.json     # Node manifest
README-الرفع-و-التثبيت.md  # Arabic deploy & install guide
.gitignore       # local files to ignore
settings.example.json # example local settings (do not store real keys)
```

**How it fits together:** server.js handles HTTP endpoints (/api/analyze, /api/plan, /api/settings, /api/projects). For analysis it either accepts uploaded images/video or downloads a URL (yt-dlp), extracts frames (ffmpeg), then calls a configured AI provider to return a structured JSON analysis.

## Quick local run

1. Clone and install:

```bash
git clone https://github.com/aad733262827/imo-x.git
cd imo-x
npm install
```

2. Run locally with a provider key (example Gemini):

```bash
export GEMINI_API_KEY="your_gemini_api_key"
node server.js
# open http://localhost:3000
```

3. Check status:

```bash
curl http://localhost:3000/api/status
```

## Docker (for VPS / predictable runtime)

A Dockerfile and docker-compose.yml are included. Example:

```bash
# build and run locally
docker-compose up --build -d
# see logs
docker-compose logs -f
```

The container includes system ffmpeg and downloads yt-dlp during build so the analyze endpoint can accept URLs.

## Environment / Provider configuration

Set one of these environment variables (preferred in production):
- GEMINI_API_KEY
- OPENAI_API_KEY
- CLAUDE_API_KEY
- GROQ_API_KEY

Or set via the running server API:

```bash
curl -X POST http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","key":"sk-...","model":"gpt-4o"}'
```

## Deploy on Render
This repo includes `render.yaml` which installs ffmpeg and yt-dlp automatically. Steps:
1. Sign up at render.com and connect GitHub
2. Create a new Web Service from Blueprint and choose this repo
3. Add GEMINI_API_KEY (or other) in Environment -> Environment Variables
4. Deploy and visit the live URL

## PWA / Install as an app
Open the site in Chrome/Edge and use “Install” / “Add to Home Screen” to get a native-like experience. `public/manifest.json` is present to support PWA install.

## Security notes
- Do not commit real API keys. Use environment variables.
- `.gitignore` is included to ignore `settings.json`, `projects.json`, and `bin/`.

---

If you want, I can now:
- add docs/API.md with detailed request/response examples
- open a PR with these changes (or push directly as I did)

