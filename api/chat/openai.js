/**
 * POST /api/chat/openai — GPT non-streaming proxy
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
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages,
        max_tokens: max_tokens || 2048,
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: err });
    }

    const data = await upstream.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(data);
  } catch (err) {
    console.error('OpenAI proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
