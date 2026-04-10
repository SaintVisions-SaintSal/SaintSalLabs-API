# /review — Code Review (API)

Review API code before any push to main (Render auto-deploys on push).

## Steps

1. `git diff main` — list all changed files
2. For each changed file check:
   - No API keys or secrets hardcoded
   - All routes wrapped in try/catch
   - Gateway key (`x-sal-key`) validated on AI routes
   - CORS origin allowlist — no wildcards
   - SSE responses properly closed with `res.end()`
   - No raw error objects exposed to client
3. Verify `render.yaml` is valid if changed

## Output
```
REVIEW: SaintSalLabs-API
Files changed: X
Security issues: X (BLOCKS PUSH if > 0)
Error handling gaps: X
CORS issues: X

VERDICT: APPROVED | BLOCKED
```
