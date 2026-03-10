/**
 * POST /api/search/gemini — Gemini Search with key failover + OpenAI fallback
 */

function authCheck(req) {
  const key = req.headers['x-sal-key'];
  return key === (process.env.API_SECRET || 'sal-live-2026');
}

async function tryGeminiSearch(apiKey, query) {
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
      }),
    }
  );

  if (!res.ok) return null;

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || 'No results found.';
  const chunks = candidate?.groundingMetadata?.groundingChunks || [];
  const sources = chunks
    .filter((c) => c.web)
    .map((c) => ({
      title: c.web.title || 'Source',
      url: c.web.uri || '',
      snippet: '',
    }));

  return { answer: text, sources };
}

async function openaiWebSearch(query) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Provide a comprehensive answer. At the end, list 3-5 relevant sources as:\nSOURCES:\n- [Title](URL)',
        },
        { role: 'user', content: query },
      ],
      max_tokens: 2048,
    }),
  });

  const data = await res.json();
  const fullText = data.choices?.[0]?.message?.content || '';
  const answer = fullText.split('SOURCES:')[0].trim();
  const sourceSection = fullText.split('SOURCES:')[1] || '';
  const sources = [];
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(sourceSection)) !== null) {
    sources.push({ title: match[1], url: match[2], snippet: '' });
  }
  return { answer, sources };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!authCheck(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { query } = req.body;
  res.setHeader('Access-Control-Allow-Origin', '*');

  const keys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_FALLBACK].filter(Boolean);

  // Try each Gemini key
  for (const key of keys) {
    try {
      const result = await tryGeminiSearch(key, query);
      if (result) return res.json(result);
    } catch {
      // Try next key
    }
  }

  // All Gemini keys failed — fallback to OpenAI
  try {
    const result = await openaiWebSearch(query);
    return res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'All search providers failed' });
  }
}
