/**
 * GET /api/health — Health check
 */
export default function handler(req, res) {
  res.json({
    status: 'ok',
    service: 'SaintSal Labs API Gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    providers: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      xai: !!process.env.XAI_API_KEY,
    },
  });
}
