/**
 * SaintSal Labs — AI API Gateway
 * Proxies requests to Anthropic, xAI, Gemini, OpenAI
 * Keeps API keys server-side. Runs on Render.
 * 
 * Endpoints:
 *   POST /api/chat/anthropic   → Claude streaming (SSE)
 *   POST /api/chat/xai         → Grok streaming (SSE)
 *   POST /api/chat/openai      → GPT non-streaming
 *   POST /api/search/gemini    → Gemini + Google Search grounding
 *   GET  /health               → Health check
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── API Keys from environment ──────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_KEY_FALLBACK = process.env.GEMINI_API_KEY_FALLBACK;
const XAI_API_KEY = process.env.XAI_API_KEY;
const API_SECRET = process.env.API_SECRET || 'sal-live-2026';

// ─── Middleware ──────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

// Simple auth check — app sends x-sal-key header
function authCheck(req, res, next) {
  const key = req.headers['x-sal-key'];
  if (key !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Health ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SaintSal Labs API Gateway',
    version: '1.0.0',
    providers: {
      anthropic: !!ANTHROPIC_API_KEY,
      openai: !!OPENAI_API_KEY,
      gemini: !!GEMINI_API_KEY,
      xai: !!XAI_API_KEY,
    },
  });
});

// ─── Anthropic Claude (SSE streaming) ───────────────────────
app.post('/api/chat/anthropic', authCheck, async (req, res) => {
  const { model, system, messages, max_tokens } = req.body;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 4096,
        system: system || '',
        messages,
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: err });
    }

    // Pipe SSE stream directly to client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    console.error('Anthropic proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── xAI Grok (SSE streaming) ──────────────────────────────
app.post('/api/chat/xai', authCheck, async (req, res) => {
  const { model, messages, max_tokens } = req.body;

  try {
    const upstream = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${XAI_API_KEY}`,
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
});

// ─── OpenAI (non-streaming) ────────────────────────────────
app.post('/api/chat/openai', authCheck, async (req, res) => {
  const { model, messages, max_tokens } = req.body;

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
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
    res.json(data);
  } catch (err) {
    console.error('OpenAI proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Gemini Search (with key failover) ─────────────────────
app.post('/api/search/gemini', authCheck, async (req, res) => {
  const { query } = req.body;
  const keys = [GEMINI_API_KEY, GEMINI_API_KEY_FALLBACK].filter(Boolean);

  for (const key of keys) {
    try {
      const upstream = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': key,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: query }] }],
            tools: [{ google_search: {} }],
          }),
        }
      );

      if (upstream.ok) {
        const data = await upstream.json();
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text || 'No results found.';
        const chunks = candidate?.groundingMetadata?.groundingChunks || [];
        const sources = chunks
          .filter(c => c.web)
          .map(c => ({
            title: c.web.title || 'Source',
            url: c.web.uri || '',
            snippet: '',
          }));

        return res.json({ answer: text, sources });
      }
      // If 429 or error, try next key
    } catch {
      // Try next key
    }
  }

  // All Gemini keys failed — fallback to OpenAI
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Provide a comprehensive answer. At the end, list 3-5 relevant sources as:\nSOURCES:\n- [Title](URL)',
          },
          { role: 'user', content: query },
        ],
        max_tokens: 2048,
      }),
    });

    const data = await upstream.json();
    const fullText = data.choices?.[0]?.message?.content || '';
    const answer = fullText.split('SOURCES:')[0].trim();
    const sourceSection = fullText.split('SOURCES:')[1] || '';
    const sources = [];
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(sourceSection)) !== null) {
      sources.push({ title: match[1], url: match[2], snippet: '' });
    }
    res.json({ answer, sources });
  } catch (err) {
    res.status(500).json({ error: 'All search providers failed' });
  }
});

// ─── Start ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`SaintSal Labs API Gateway running on port ${PORT}`);
  console.log(`Providers: Anthropic=${!!ANTHROPIC_API_KEY} OpenAI=${!!OPENAI_API_KEY} Gemini=${!!GEMINI_API_KEY} xAI=${!!XAI_API_KEY}`);
});
