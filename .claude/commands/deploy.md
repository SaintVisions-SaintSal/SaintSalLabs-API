# /deploy — Deploy to Render (API)

Push to main — Render auto-deploys in ~2 minutes.

## Steps

```bash
# 1. Pre-commit secret scan
grep -r 'sk-ant-\|sk-\|ANTHROPIC_API_KEY=' --include='*.js' api/ server.js

# 2. Commit and push
git add [planned files only]
git commit -m "Build #XX — [description]"
git push origin main

# 3. Wait 2 minutes for Render deploy

# 4. Health check
curl -s -w "\nHTTP: %{http_code}" --max-time 15 https://www.saintsallabs.com/api/health

# 5. Chat endpoint test
curl -s -w "\nHTTP: %{http_code}" -X POST https://www.saintsallabs.com/api/chat \
  -H "Content-Type: application/json" \
  -H "x-sal-key: saintvision_gateway_2025" \
  -d '{"messages":[{"role":"user","content":"ping"}],"model":"claude"}'

# 6. MCP endpoint test
curl -s -w "\nHTTP: %{http_code}" -X POST https://www.saintsallabs.com/api/mcp/chat \
  -H "Content-Type: application/json" \
  -H "x-sal-key: saintvision_gateway_2025" \
  -d '{"messages":[{"role":"user","content":"ping"}]}'
```

## Success Criteria
- All 3 endpoints: HTTP 200
- Health returns `{ status: "ok" }`
- Chat streams or returns content
