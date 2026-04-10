# /test-all — Full Test Suite (API)

Test all endpoints. Run before every push to main.

## Endpoint Tests

```bash
BASE="https://www.saintsallabs.com"
KEY="saintvision_gateway_2025"

# Health
curl -s -w "\nHTTP: %{http_code}" $BASE/api/health

# Chat — Claude
curl -s -w "\nHTTP: %{http_code}" -X POST $BASE/api/chat \
  -H "Content-Type: application/json" \
  -H "x-sal-key: $KEY" \
  -d '{"messages":[{"role":"user","content":"ping"}],"model":"claude"}'

# Chat — GPT
curl -s -w "\nHTTP: %{http_code}" -X POST $BASE/api/chat \
  -H "Content-Type: application/json" \
  -H "x-sal-key: $KEY" \
  -d '{"messages":[{"role":"user","content":"ping"}],"model":"gpt"}'

# MCP Chat
curl -s -w "\nHTTP: %{http_code}" -X POST $BASE/api/mcp/chat \
  -H "Content-Type: application/json" \
  -H "x-sal-key: $KEY" \
  -d '{"messages":[{"role":"user","content":"ping"}]}'

# Gemini Search
curl -s -w "\nHTTP: %{http_code}" -X POST $BASE/api/search/gemini \
  -H "Content-Type: application/json" \
  -H "x-sal-key: $KEY" \
  -d '{"query":"test"}'
```

## Pass Criteria
All endpoints: HTTP 200 + valid JSON or stream response
