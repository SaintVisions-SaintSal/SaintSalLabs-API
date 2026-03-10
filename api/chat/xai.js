/**
 * POST /api/chat/xai — Grok SSE streaming proxy
 */

function authCheck(req) {
  const key = req.headers['x-sal-key'];
  return key === (process.env.API_SECRET || 'sal-live-2026');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!authCheck(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { model, messages, max_tokens } = req.body;

  try {
    const upstream = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || 'grok-3',
        messages,
        max_tokens: max_tokens || 4096,
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: err });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    console.error('xAI proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
