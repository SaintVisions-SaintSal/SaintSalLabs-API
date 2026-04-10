# SaintSal Labs — API Gateway (SaintSalLabs-API)

> SaintVision Technologies LLC | CEO: Ryan "Cap" Capatosto | Patent #10,290,222 (HACP)  
> Stack: Node.js · Express · Render · Claude API · OpenAI · xAI · Gemini · Tavily · Perplexity

---

## 1. Tech Stack & Architecture

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (Express) |
| Deploy | Render (auto-deploy on push to main) |
| AI Providers | Claude (Anthropic) · OpenAI · xAI Grok · Google Gemini |
| Search | Tavily · Perplexity |
| DNS | Cloudflare → www.saintsallabs.com (www required — 307 redirect) |

### Critical URL Rule
**Always use `www.saintsallabs.com`** — Cloudflare enforces a 307 redirect.  
Non-www calls will fail in production.

### API Routes
```
POST /api/chat              — Main AI chat (Claude/GPT/Grok/Gemini routing)
POST /api/mcp/chat          — MCP gateway (simple AI, no search)
POST /api/search/gemini     — Gemini-powered search
GET  /api/health            — Health check (returns 200 + status JSON)
POST /api/corpnet           — Corporate network intelligence
```

### Internal File Structure
```
api/
├── chat/
│   ├── anthropic.js    — Claude API handler
│   ├── openai.js       — OpenAI handler
│   └── xai.js          — xAI Grok handler
├── search/
│   └── gemini.js       — Gemini search handler
├── health.js           — Health endpoint
└── corpnet.js          — Corporate net handler
server.js               — Express app entry point
render.yaml             — Render deployment config
```

### Gateway Auth Header
All client requests must include:
```
x-sal-key: saintvision_gateway_2025
```

---

## 2. Project Conventions & Style Guide

- **CommonJS** — this repo uses `require()` / `module.exports` (not ESM)
- **No TypeScript** — plain JavaScript; add JSDoc for complex functions
- **Error handling** — every route wraps in try/catch, returns `{ error, status }` JSON
- **Logging** — `console.error` for errors, `console.log` for request/response summaries
- **No client-facing secrets** — API keys load from `process.env` only
- **SSE responses** — use `res.write()` with `text/event-stream` content-type for streaming
- **CORS** — configured for `saintsallabs.com`, `saintsal.ai`, `localhost:3000`

---

## 3. Testing Requirements

### Before Every Deploy
```bash
# Health check
curl -s -w "\nHTTP: %{http_code}" --max-time 15 https://www.saintsallabs.com/api/health

# Chat endpoint
curl -s -w "\nHTTP: %{http_code}" -X POST https://www.saintsallabs.com/api/chat \
  -H "Content-Type: application/json" \
  -H "x-sal-key: saintvision_gateway_2025" \
  -d '{"messages":[{"role":"user","content":"ping"}],"model":"claude"}'

# MCP gateway
curl -s -w "\nHTTP: %{http_code}" -X POST https://www.saintsallabs.com/api/mcp/chat \
  -H "Content-Type: application/json" \
  -H "x-sal-key: saintvision_gateway_2025" \
  -d '{"messages":[{"role":"user","content":"ping"}]}'
```

Expected: HTTP 200 + valid JSON response on all three.

---

## 4. Git Workflow & Deploy

- **Branch:** `main` only — Render auto-deploys on push
- **Commit format:** `Build #XX — [description]`
- **Deploy time:** ~2 minutes on Render after push
- **Post-deploy:** Re-run all curl tests above to confirm
- **Never restart Render manually** unless health check fails after 5 min

### Deploy Sequence
```bash
git add [planned files only]
git commit -m "Build #XX — [description]"
git push origin main
# Wait 2 min → Render deploys
# Run curl health check
```

---

## 5. Security & Compliance

- **API keys in `.env` only** — Anthropic, OpenAI, xAI, Gemini, Tavily, Perplexity keys
- **`.env` is gitignored** — verify before every commit
- **`.claude/settings.local.json` is gitignored**
- **Gateway key validation** — `x-sal-key` checked on all AI routes
- **Rate limiting** — implement per-IP limits before public launch
- **PreCommit hook** — secret scanning enabled
- **No wildcard CORS** — explicit origin allowlist only

---

## 6. SSE Streaming Pattern

```javascript
// Standard SSE response for AI streaming
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
res.setHeader('Access-Control-Allow-Origin', allowedOrigin);

// Stream chunks
res.write(`data: ${JSON.stringify({ type: 'chunk', content: text })}\n\n`);

// Signal completion
res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
res.end();
```

---

## Anti-Patterns — Never Do These

- Expose raw API provider keys in responses or logs
- Accept requests without `x-sal-key` validation on AI routes
- Use `fetch` streaming on the server — use provider SDKs directly
- Push broken code to `main` (Render deploys immediately)
- Skip the health check after deploy
- Log full request bodies (may contain user data)
