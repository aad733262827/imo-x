# API — IMMO X

Base URL: http://<HOST>:3000

Endpoints

## GET /api/status
Response:
```json
{
  "provider": "gemini",
  "hasKey": true,
  "model": "gemini-3.6-flash",
  "tools": { "ffmpeg": true, "ytDlp": true }
}
```

## POST /api/settings
Set provider/key/model (used by the server).
- Body JSON:
```json
{ "provider": "gemini|openai|claude|groq", "key": "<API_KEY>", "model": "<modelName>" }
```
- Response:
```json
{ "ok": true, "hasKey": true }
```

## POST /api/analyze
Analyze video/images or a URL.

- multipart/form-data fields:
  - `file` — video file (mp4, mov, ...)
  - `images` — multiple image files (6-12 recommended)
  - `url` — optional (server downloads via yt-dlp if available)
  - optional fields: `platform`, `tools`, `p` (extra options)

- Example (file upload):
```bash
curl -F "file=@ad.mp4" http://localhost:3000/api/analyze
```

- Example (URL):
```bash
curl -X POST -H "Content-Type: application/json" -d '{"url":"https://youtu.be/..."}' http://localhost:3000/api/analyze
```

- Response: JSON matching ANALYSIS_SCHEMA in the server code, or a demo payload when no key is configured.

## POST /api/plan
Generate a production plan from an idea.
- Body JSON:
```json
{
  "idea": "<your idea>",
  "characters": "<optional>",
  "mood": "<optional>",
  "duration": "<e.g. 30s>",
  "platform": "<TikTok|YouTube|...>",
  "tools": "<preferred tools>",
  "voiceover": "<optional>",
  "extra": "<optional>",
  "reference": "<optional analysis JSON>"
}
```
- Response: JSON matching PLAN_SCHEMA or a demo response.

## POST /api/refine
Refine a section of an existing project.
- Body JSON:
```json
{ "project": <projectObject>, "section": "<sectionName>", "instruction": "<what to change>" }
```
- Response:
```json
{ "section": "<sectionName>", "project": <updatedProject>, "ok": true }
```

## Projects (CRUD)
- GET /api/projects — list saved projects (id, name, created, kind)
- POST /api/projects — save a project
  - Body: `{ "name": "<name>", "kind": "analysis|plan", "data": <projectData> }`
  - Response: `{ "id": "<projectId>" }`
- GET /api/projects/:id — get project
- DELETE /api/projects/:id — delete
- GET /api/projects/:id/export — downloads markdown export

Notes
- analyze(url) requires yt-dlp installed on host; extracting frames requires ffmpeg.
- The server includes retries/fallbacks for AI providers. If no API key is set, endpoints return demo/example content.
- Monitor API usage on the provider side (costs/quotas).
