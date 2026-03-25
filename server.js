/**
 * SaintSal Labs — AI API Gateway v4
 * Proxies: Anthropic, xAI, OpenAI, Gemini (4-Tier Model Orchestration)
 * Integrations: CorpNet Business Formation + Tax Registration, Builder V2, Social, Voice, Real Estate
 *
 * Deploy to Render: https://render.com
 * US Patent #10,290,222 · HACP Protocol
 *
 * ENV VARS:
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GEMINI_API_KEY_FALLBACK,
 *   XAI_API_KEY, API_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY,
 *   ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, DEEPGRAM_API_KEY, STRIPE_SECRET_KEY,
 *   TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_SECRET_TOKEN, TWITTER_API_TOKEN,
 *   LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI,
 *   META_APP_ID, META_APP_SECRET, META_REDIRECT_URI,
 *   RENTCAST_API_KEY, PROPERTY_API_KEY, ZILLOW_API_KEY
 */

const crypto  = require('crypto');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');

const app  = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════════════════
//  ENV VARS
// ══════════════════════════════════════════════════════════
const ANTHROPIC_KEY        = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY           = process.env.OPENAI_API_KEY;
const GEMINI_KEY           = process.env.GEMINI_API_KEY;
const GEMINI_KEY_FALLBACK  = process.env.GEMINI_API_KEY_FALLBACK;
const XAI_KEY              = process.env.XAI_API_KEY;
const API_SECRET           = process.env.API_SECRET;
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ELEVENLABS_KEY       = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT     = process.env.ELEVENLABS_AGENT_ID;
const DEEPGRAM_KEY         = process.env.DEEPGRAM_API_KEY;
const STRIPE_SECRET        = process.env.STRIPE_SECRET_KEY;

const TWITTER_CONSUMER_KEY    = process.env.TWITTER_CONSUMER_KEY    || '';
const TWITTER_CONSUMER_SECRET = process.env.TWITTER_CONSUMER_SECRET || '';
const TWITTER_ACCESS_TOKEN    = process.env.TWITTER_ACCESS_TOKEN    || '';
const TWITTER_SECRET_TOKEN    = process.env.TWITTER_SECRET_TOKEN    || '';
const TWITTER_BEARER_TOKEN    = process.env.TWITTER_API_TOKEN       || '';

const LINKEDIN_CLIENT_ID     = process.env.LINKEDIN_CLIENT_ID     || '';
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || '';
const LINKEDIN_REDIRECT_URI  = process.env.LINKEDIN_REDIRECT_URI  || 'saintsallabs://social/linkedin/callback';

const META_APP_ID       = process.env.META_APP_ID       || '';
const META_APP_SECRET   = process.env.META_APP_SECRET   || '';
const META_REDIRECT_URI = process.env.META_REDIRECT_URI || '';

const RENTCAST_API_KEY  = process.env.RENTCAST_API_KEY  || '';
const PROPERTY_API_KEY  = process.env.PROPERTY_API_KEY  || '';
const ZILLOW_API_KEY    = process.env.ZILLOW_API_KEY    || '';

// SECURITY: Fail on startup if gateway secret is not set
if (!API_SECRET) {
  console.error('FATAL: API_SECRET env var is required. Set it in Render dashboard.');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════
//  CORS
// ══════════════════════════════════════════════════════════
const ALLOWED_ORIGINS = [
  'https://saintsallabs.com',
  'https://www.saintsallabs.com',
  'https://saintsal.ai',
  'https://www.saintsal.ai',
];
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:5173', 'http://localhost:8000');
}

// ══════════════════════════════════════════════════════════
//  RATE LIMITERS
// ══════════════════════════════════════════════════════════
const rateLimit = require('express-rate-limit');
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  message: { error: 'Rate limited — 30 requests/min max' },
  standardHeaders: true, legacyHeaders: false,
});
const builderLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { error: 'Rate limited — 10 builds/min max' },
  standardHeaders: true, legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { error: 'Rate limited — 10 attempts/min max' },
  standardHeaders: true, legacyHeaders: false,
});

// ══════════════════════════════════════════════════════════
//  MIDDLEWARE
// ══════════════════════════════════════════════════════════
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked'));
  },
}));
app.use(express.json({ limit: '2mb' }));

app.use('/api/chat', aiLimiter);
app.use('/api/search', aiLimiter);
app.use('/api/social/generate', aiLimiter);
app.use('/api/builder', builderLimiter);
app.use('/api/auth', authLimiter);

// ── Auth ─────────────────────────────────────────────
function auth(req, res, next) {
  if (req.headers['x-sal-key'] !== API_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ══════════════════════════════════════════════════════════
//  SECTION 3: CHAT QUALITY — universal system prompt suffix
// ══════════════════════════════════════════════════════════
const CHAT_QUALITY_SUFFIX = '\n\nBe conversational and direct. Match response length to question complexity. Short questions get 2-3 sentences. Complex questions get thorough answers. Be a smart expert friend, not a textbook.';

// ══════════════════════════════════════════════════════════
//  SECTION 1: 4-TIER MODEL ORCHESTRATION
// ══════════════════════════════════════════════════════════

/**
 * Model provider call helpers.
 * Each returns { text, model_used } or throws.
 */

async function callAnthropic(model, messages, systemPrompt, maxTokens, signal) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 4096,
      system:     systemPrompt || '',
      messages,
    }),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic ${model} ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return { text: data.content?.[0]?.text || '', model_used: model };
}

async function callAnthropicStream(model, messages, systemPrompt, maxTokens, signal) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 4096,
      system:     systemPrompt || '',
      messages,
      stream: true,
    }),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic ${model} ${res.status}: ${errText}`);
  }
  return { stream: res.body, model_used: model, contentType: 'text/event-stream' };
}

async function callOpenAI(model, messages, systemPrompt, maxTokens, signal) {
  const msgs = [];
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
  msgs.push(...messages);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: msgs,
      max_tokens: maxTokens || 4096,
    }),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI ${model} ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content || '', model_used: model };
}

async function callOpenAIStream(model, messages, systemPrompt, maxTokens, signal) {
  const msgs = [];
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
  msgs.push(...messages);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: msgs,
      max_tokens: maxTokens || 4096,
      stream: true,
    }),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI ${model} ${res.status}: ${errText}`);
  }
  return { stream: res.body, model_used: model, contentType: 'text/event-stream' };
}

async function callGemini(model, messages, systemPrompt, maxTokens, signal) {
  const key = GEMINI_KEY || GEMINI_KEY_FALLBACK;
  if (!key) throw new Error('Gemini API key not configured');
  const contents = [];
  if (systemPrompt) {
    contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood. I will follow those instructions.' }] });
  }
  for (const m of messages) {
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { maxOutputTokens: maxTokens || 4096 },
      }),
      signal,
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${model} ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { text, model_used: model };
}

async function callGeminiStream(model, messages, systemPrompt, maxTokens, signal) {
  const key = GEMINI_KEY || GEMINI_KEY_FALLBACK;
  if (!key) throw new Error('Gemini API key not configured');
  const contents = [];
  if (systemPrompt) {
    contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood. I will follow those instructions.' }] });
  }
  for (const m of messages) {
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { maxOutputTokens: maxTokens || 4096 },
      }),
      signal,
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${model} ${res.status}: ${errText}`);
  }
  return { stream: res.body, model_used: model, contentType: 'text/event-stream' };
}

async function callXAI(model, messages, systemPrompt, maxTokens, signal) {
  const msgs = [];
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
  msgs.push(...messages);
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${XAI_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: msgs,
      max_tokens: maxTokens || 4096,
    }),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`xAI ${model} ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content || '', model_used: model };
}

async function callXAIStream(model, messages, systemPrompt, maxTokens, signal) {
  const msgs = [];
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
  msgs.push(...messages);
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${XAI_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: msgs,
      max_tokens: maxTokens || 4096,
      stream: true,
    }),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`xAI ${model} ${res.status}: ${errText}`);
  }
  return { stream: res.body, model_used: model, contentType: 'text/event-stream' };
}

/**
 * Provider dispatch — maps provider name to call/stream functions.
 */
function getProviderFns(provider) {
  switch (provider) {
    case 'anthropic': return { call: callAnthropic, stream: callAnthropicStream };
    case 'openai':    return { call: callOpenAI,    stream: callOpenAIStream };
    case 'gemini':    return { call: callGemini,    stream: callGeminiStream };
    case 'xai':       return { call: callXAI,       stream: callXAIStream };
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * getModelChain(userTier) → ordered array of { provider, model, apiKey, endpoint }
 */
function getModelChain(userTier) {
  switch ((userTier || 'pro').toLowerCase()) {
    case 'max':
      return [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        { provider: 'openai',    model: 'gpt-4o' },
        { provider: 'xai',       model: 'grok-3' },
        { provider: 'gemini',    model: 'gemini-2.5-pro' },
      ];
    case 'pro':
      return [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        { provider: 'openai',    model: 'gpt-4o' },
        { provider: 'gemini',    model: 'gemini-2.5-pro' },
        { provider: 'xai',       model: 'grok-3' },
      ];
    case 'standard':
      return [
        { provider: 'anthropic', model: 'claude-haiku-4-5-20241022' },
        { provider: 'openai',    model: 'gpt-4o-mini' },
        { provider: 'gemini',    model: 'gemini-2.0-flash' },
        { provider: 'xai',       model: 'grok-3-mini' },
      ];
    case 'free':
      return [
        { provider: 'gemini',    model: 'gemini-2.0-flash' },
        { provider: 'openai',    model: 'gpt-4o-mini' },
        { provider: 'anthropic', model: 'claude-haiku-4-5-20241022' },
      ];
    default:
      return getModelChain('pro');
  }
}

/**
 * callWithFallback(modelChain, messages, systemPrompt, options)
 * Tries each model in order. Returns { text, model_used, fallback_used, tier }
 * For streaming: returns { stream, model_used, fallback_used, tier, contentType }
 */
async function callWithFallback(modelChain, messages, systemPrompt, options) {
  const { stream: wantStream, maxTokens, tier } = options || {};
  const errors = [];

  for (let i = 0; i < modelChain.length; i++) {
    const { provider, model } = modelChain[i];
    const fns = getProviderFns(provider);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      let result;
      if (wantStream) {
        result = await fns.stream(model, messages, systemPrompt, maxTokens, controller.signal);
      } else {
        result = await fns.call(model, messages, systemPrompt, maxTokens, controller.signal);
      }
      clearTimeout(timeout);
      return {
        ...result,
        fallback_used: i > 0,
        tier: tier || 'pro',
      };
    } catch (err) {
      clearTimeout(timeout);
      console.error(`Model ${provider}/${model} failed: ${err.message}`);
      errors.push({ provider, model, error: err.message });
    }
  }

  // All models failed
  throw new Error(`All models failed: ${errors.map(e => `${e.provider}/${e.model}: ${e.error}`).join('; ')}`);
}

/**
 * Smart routing: if message under 20 words and no complex keywords → use fastest (last in chain)
 */
function shouldUseFastPath(messages) {
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || !lastMsg.content) return false;
  const text = typeof lastMsg.content === 'string' ? lastMsg.content : '';
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount > 20) return false;
  const complexKeywords = ['explain', 'analyze', 'compare', 'code', 'write', 'build', 'create', 'debug', 'refactor', 'design', 'architect', 'implement', 'detail', 'comprehensive', 'thorough', 'essay', 'report'];
  const lower = text.toLowerCase();
  return !complexKeywords.some(kw => lower.includes(kw));
}

// ── Health ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'SaintSal Labs API Gateway v4',
    patent:  'US #10,290,222',
    version: '4.0.0',
    providers: {
      anthropic:  !!ANTHROPIC_KEY,
      openai:     !!OPENAI_KEY,
      gemini:     !!GEMINI_KEY,
      xai:        !!XAI_KEY,
      elevenlabs: !!ELEVENLABS_KEY,
      deepgram:   !!DEEPGRAM_KEY,
      supabase:   !!SUPABASE_URL,
      stripe:     !!STRIPE_SECRET,
      rentcast:   !!RENTCAST_API_KEY,
      property:   !!PROPERTY_API_KEY,
      zillow:     !!ZILLOW_API_KEY,
      meta:       !!META_APP_ID,
    },
  });
});

// ══════════════════════════════════════════════════════════
//  UNIFIED POST /api/chat — 4-tier orchestration
// ══════════════════════════════════════════════════════════
app.post('/api/chat', auth, async (req, res) => {
  const { messages, system, max_tokens, tier, stream: wantStream } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const systemPrompt = (system || '') + CHAT_QUALITY_SUFFIX;
  let chain = getModelChain(tier || 'pro');

  // Smart routing: simple questions use fastest model
  if (shouldUseFastPath(messages) && chain.length > 1) {
    const fastest = chain[chain.length - 1];
    chain = [fastest, ...chain.filter((_, i) => i !== chain.length - 1)];
  }

  try {
    if (wantStream) {
      const result = await callWithFallback(chain, messages, systemPrompt, {
        stream: true, maxTokens: max_tokens, tier: tier || 'pro',
      });

      res.setHeader('Content-Type',  'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection',    'keep-alive');
      res.setHeader('X-SAL-Model',   result.model_used);
      res.setHeader('X-SAL-Tier',    result.tier);
      res.setHeader('X-SAL-Fallback', String(result.fallback_used));

      const reader  = result.stream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    } else {
      const result = await callWithFallback(chain, messages, systemPrompt, {
        stream: false, maxTokens: max_tokens, tier: tier || 'pro',
      });
      res.json({
        text:          result.text,
        model_used:    result.model_used,
        tier:          result.tier,
        fallback_used: result.fallback_used,
      });
    }
  } catch (err) {
    console.error('Unified chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  LEGACY CHAT ENDPOINTS (aliases using callWithFallback)
// ══════════════════════════════════════════════════════════

// ── /api/chat/anthropic → anthropic-first chain ──────
app.post('/api/chat/anthropic', auth, async (req, res) => {
  const { model, system, messages, max_tokens, stream: wantStream } = req.body;
  const systemPrompt = (system || '') + CHAT_QUALITY_SUFFIX;

  const chain = [
    { provider: 'anthropic', model: model || 'claude-sonnet-4-20250514' },
    { provider: 'openai',    model: 'gpt-4o' },
    { provider: 'gemini',    model: 'gemini-2.5-pro' },
    { provider: 'xai',       model: 'grok-3' },
  ];

  try {
    if (wantStream !== false) {
      // Default to streaming (preserving original behavior)
      const result = await callWithFallback(chain, messages, systemPrompt, {
        stream: true, maxTokens: max_tokens, tier: 'legacy',
      });

      res.setHeader('Content-Type',  'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection',    'keep-alive');
      res.setHeader('X-SAL-Model',   result.model_used);

      const reader  = result.stream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    } else {
      const result = await callWithFallback(chain, messages, systemPrompt, {
        stream: false, maxTokens: max_tokens, tier: 'legacy',
      });
      res.json({ text: result.text, model_used: result.model_used, fallback_used: result.fallback_used });
    }
  } catch (err) {
    console.error('Anthropic chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/chat/xai → xai-first chain ─────────────────
app.post('/api/chat/xai', auth, async (req, res) => {
  const { model, messages, max_tokens, stream: wantStream } = req.body;
  const systemPrompt = CHAT_QUALITY_SUFFIX.trim();

  const chain = [
    { provider: 'xai',       model: model || 'grok-3' },
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    { provider: 'openai',    model: 'gpt-4o' },
    { provider: 'gemini',    model: 'gemini-2.5-pro' },
  ];

  try {
    if (wantStream !== false) {
      const result = await callWithFallback(chain, messages, systemPrompt, {
        stream: true, maxTokens: max_tokens, tier: 'legacy',
      });

      res.setHeader('Content-Type',  'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection',    'keep-alive');
      res.setHeader('X-SAL-Model',   result.model_used);

      const reader  = result.stream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    } else {
      const result = await callWithFallback(chain, messages, systemPrompt, {
        stream: false, maxTokens: max_tokens, tier: 'legacy',
      });
      res.json({ text: result.text, model_used: result.model_used, fallback_used: result.fallback_used });
    }
  } catch (err) {
    console.error('xAI chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/chat/openai → openai-first chain ────────────
app.post('/api/chat/openai', auth, async (req, res) => {
  const { model, messages, max_tokens } = req.body;
  const systemPrompt = CHAT_QUALITY_SUFFIX.trim();

  const chain = [
    { provider: 'openai',    model: model || 'gpt-4o-mini' },
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    { provider: 'gemini',    model: 'gemini-2.5-pro' },
    { provider: 'xai',       model: 'grok-3' },
  ];

  try {
    const result = await callWithFallback(chain, messages, systemPrompt, {
      stream: false, maxTokens: max_tokens, tier: 'legacy',
    });
    res.json({
      choices: [{ message: { role: 'assistant', content: result.text } }],
      model_used:    result.model_used,
      fallback_used: result.fallback_used,
    });
  } catch (err) {
    console.error('OpenAI chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/search/gemini → gemini-first chain (with grounding) ──
app.post('/api/search/gemini', auth, async (req, res) => {
  const { query } = req.body;
  const keys = [GEMINI_KEY, GEMINI_KEY_FALLBACK].filter(Boolean);

  // Try Gemini with grounding first (original behavior)
  for (const key of keys) {
    try {
      const upstream = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
          body:    JSON.stringify({
            contents: [{ parts: [{ text: query }] }],
            tools:    [{ google_search: {} }],
          }),
        }
      );

      if (upstream.ok) {
        const data      = await upstream.json();
        const candidate = data.candidates?.[0];
        const text      = candidate?.content?.parts?.[0]?.text || 'No results found.';
        const chunks    = candidate?.groundingMetadata?.groundingChunks || [];
        const sources   = chunks
          .filter(c => c.web)
          .map(c => ({ title: c.web.title || 'Source', url: c.web.uri || '', snippet: '' }));

        return res.json({ answer: text, sources });
      }
    } catch (e) {
      console.error('Gemini search error:', e.message);
    }
  }

  // Fallback: use callWithFallback for text search
  const fallbackChain = [
    { provider: 'openai',    model: 'gpt-4o-mini' },
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    { provider: 'xai',       model: 'grok-3' },
  ];

  try {
    const result = await callWithFallback(
      fallbackChain,
      [{ role: 'user', content: query }],
      'Answer comprehensively. End with:\nSOURCES:\n- [Title](URL)',
      { stream: false, maxTokens: 2048 }
    );
    const fullText = result.text || '';
    const answer   = fullText.split('SOURCES:')[0].trim();
    const srcSec   = fullText.split('SOURCES:')[1] || '';
    const sources  = [];
    const re       = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let m;
    while ((m = re.exec(srcSec)) !== null) sources.push({ title: m[1], url: m[2], snippet: '' });
    res.json({ answer, sources, model_used: result.model_used, fallback_used: result.fallback_used });
  } catch (err) {
    console.error('Search fallback error:', err.message);
    res.status(500).json({ error: 'All search providers failed' });
  }
});

// ══════════════════════════════════════════════════════════
//  SECTION 2: BUILDER OVERHAUL
// ══════════════════════════════════════════════════════════

const BUILDER_SYSTEM = `You are SAL Builder — the world's best full-stack AI engineer for SaintSal™ Labs (saintsallabs.com), backed by US Patent #10,290,222 HACP Protocol.

WHEN BUILDING CODE:
1. Start with a 2-3 sentence architecture overview
2. Generate EVERY file — complete, no placeholders, no truncation
3. Label EVERY code block with file path: \`\`\`tsx src/app/page.tsx
4. Include: package.json, .env.example, README.md, vercel.json
5. Code must be TypeScript-first, production-ready, immediately deployable

TECH DEFAULTS (unless instructed otherwise):
- Framework: Next.js 14 App Router
- Styling: Tailwind CSS + shadcn/ui
- Database: Supabase or Upstash
- Auth: Clerk
- Payments: Stripe
- Deploy: Vercel
- Colors: #0C0C0F bg · #F59E0B amber · #E8E6E1 text (SaintSal design system)

AFTER CODE — ALWAYS INCLUDE:
- Environment variables needed (every key)
- Deploy steps (3-5 steps max)

FOR SOCIAL: Return JSON only — {"twitter":"...","linkedin":"...","instagram":"...","tiktok":"...","facebook":"..."}
FOR IMAGES: Return DALL-E 3, Midjourney, Stable Diffusion, and Director Notes
FOR VIDEO: Return Hook → Script → Shot List → Runway Prompts → Captions → Music → CTA

NEVER use placeholder comments. NEVER truncate. ALWAYS complete.` + CHAT_QUALITY_SUFFIX;

const BUILDER_V2_SYSTEM = `You are SAL Builder V2. You generate complete web applications. You MUST respond with ONLY valid JSON — no markdown, no backticks, no explanation outside the JSON. Generate complete, production-ready code. Every file must be complete — no placeholders, no truncation. Default stack: vanilla HTML/CSS/JS for simple apps, React+Vite for complex apps. SaintSal design: #0C0C0F bg, #F59E0B amber, #E8E6E1 text.

You MUST respond with ONLY this JSON structure:
{"thought":"Brief explanation of approach","files":[{"path":"index.html","content":"complete file content","language":"html"}],"preview_entry":"index.html","dependencies":[],"next_steps":["suggestion 1","suggestion 2"]}

Rules:
- Every file must be complete and production-ready
- No placeholder comments like "// TODO" or "// add code here"
- Include all necessary files (HTML, CSS, JS, config)
- The preview_entry must be an HTML file that can be opened directly
- For React/Vite apps, generate a complete index.html that loads the bundle
- Apply SaintSal design system colors when appropriate` + CHAT_QUALITY_SUFFIX;

const BUILDER_REVIEW_PROMPT = `You are a senior code reviewer for SaintSal Labs. Review the following generated code for:
1. Bugs, syntax errors, or runtime issues
2. Missing imports or dependencies
3. Security vulnerabilities
4. Incomplete implementations or placeholder code
5. UX/design issues

If you find issues, fix them and return the corrected code in the SAME JSON format.
If the code is good, return it unchanged with a brief review note.

Return ONLY valid JSON:
{"files":[...],"review_notes":"Brief summary of changes or 'No issues found'","passed":true}`;

/**
 * Detect framework from prompt or files
 */
function detectFramework(prompt, files) {
  const text = (prompt || '').toLowerCase();
  const fileNames = (files || []).map(f => (f.path || f.name || '').toLowerCase());

  if (text.includes('react native') || text.includes('react-native') || fileNames.some(f => f.includes('App.tsx') || f.includes('app.json'))) return 'react-native';
  if (text.includes('next') || text.includes('nextjs') || fileNames.some(f => f.includes('next.config'))) return 'nextjs';
  if (text.includes('fastapi') || text.includes('python') || fileNames.some(f => f.endsWith('.py'))) return 'python-fastapi';
  if (text.includes('express') || text.includes('node') || fileNames.some(f => f.includes('server.js') || f.includes('app.js'))) return 'node-express';
  if (text.includes('react') || text.includes('vite') || fileNames.some(f => f.includes('vite.config'))) return 'react';
  return 'html';
}

// ── GET /api/builder/info ────────────────────────────
app.get('/api/builder/info', (req, res) => {
  res.json({
    name: 'SAL Builder V2',
    version: '2.0.0',
    description: 'AI-powered full-stack code generation and deployment',
    patent: 'US #10,290,222',
    capabilities: [
      'Full-stack web app generation',
      'Multi-turn conversational building',
      'Framework detection (React, Next.js, Python FastAPI, Node Express, HTML, React Native)',
      'Code review pass for quality assurance',
      'Project save/load via Supabase',
      'Deploy preview generation',
    ],
    supported_frameworks: ['react', 'nextjs', 'python-fastapi', 'node-express', 'html', 'react-native'],
    design_system: {
      bg: '#0C0C0F',
      accent: '#F59E0B',
      text: '#E8E6E1',
    },
    tiers: ['max', 'pro', 'standard', 'free'],
  });
});

// ── Legacy /api/builder (streaming) ──────────────────
app.post('/api/builder', auth, async (req, res) => {
  const { prompt, files, framework, tier, system: customSystem } = req.body;

  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const fileContext = files?.length
    ? '\n\nEXISTING PROJECT FILES:\n' + files.map(f => `\`\`\`${f.lang} ${f.name}\n${f.content}\n\`\`\``).join('\n\n')
    : '';

  const frameworkHint = framework ? `\nTarget framework: ${framework}.` : '';
  const system = customSystem || (BUILDER_SYSTEM + frameworkHint);

  const chain = getModelChain(tier || 'pro');

  try {
    const result = await callWithFallback(chain,
      [{ role: 'user', content: prompt + fileContext }],
      system,
      { stream: true, maxTokens: 8192, tier: tier || 'pro' }
    );

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-SAL-Tier',    tier || 'pro');
    res.setHeader('X-SAL-Model',   result.model_used);

    const reader  = result.stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    console.error('Builder error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/builder/v2/generate (updated with review pass) ──
app.post('/api/builder/v2/generate', auth, async (req, res) => {
  console.log('POST /api/builder/v2/generate');
  const { prompt, project_id, files, conversation, tier } = req.body;

  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const framework_detected = detectFramework(prompt, files);

  // Build messages array
  const messages = [];
  if (conversation?.length) {
    for (const msg of conversation) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Build user message with file context for iterative edits
  let userContent = prompt;
  if (files?.length) {
    const fileContext = files.map(f =>
      `--- ${f.path} ---\n${f.content}`
    ).join('\n\n');
    userContent = `EXISTING PROJECT FILES (edit these, do not start fresh):\n\n${fileContext}\n\nUSER REQUEST:\n${prompt}`;
  }

  messages.push({ role: 'user', content: userContent });

  const chain = getModelChain(tier || 'pro');

  try {
    // GENERATION PASS
    const genResult = await callWithFallback(chain, messages, BUILDER_V2_SYSTEM, {
      stream: false, maxTokens: 16384, tier: tier || 'pro',
    });

    const rawText = genResult.text || '';
    const cleaned = rawText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // If JSON parse fails, wrap raw text as a single file
      return res.json({
        thought: 'Response was not structured JSON — returning raw output.',
        files: [{ path: 'output.txt', content: rawText, language: 'text' }],
        preview_entry: 'output.txt',
        framework_detected,
        model_used: genResult.model_used,
        reviewed: false,
        review_notes: 'Skipped — generation output was not valid JSON.',
      });
    }

    // REVIEW PASS — send code back with review prompt
    let reviewed = false;
    let reviewNotes = '';
    let finalFiles = parsed.files || [];

    try {
      const reviewMessages = [
        { role: 'user', content: `Review this generated code:\n\n${JSON.stringify(parsed, null, 2)}` },
      ];
      const reviewResult = await callWithFallback(chain, reviewMessages, BUILDER_REVIEW_PROMPT, {
        stream: false, maxTokens: 8192, tier: tier || 'pro',
      });

      const reviewRaw = (reviewResult.text || '').replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
      try {
        const reviewParsed = JSON.parse(reviewRaw);
        if (reviewParsed.files && Array.isArray(reviewParsed.files) && reviewParsed.files.length > 0) {
          finalFiles = reviewParsed.files;
        }
        reviewNotes = reviewParsed.review_notes || 'Review completed.';
        reviewed = true;
      } catch {
        reviewNotes = 'Review pass returned non-JSON — using original.';
      }
    } catch (reviewErr) {
      console.error('Review pass failed:', reviewErr.message);
      reviewNotes = 'Review pass failed — delivering original.';
    }

    res.json({
      thought: parsed.thought || '',
      files: finalFiles,
      preview_entry: parsed.preview_entry || 'index.html',
      framework_detected,
      model_used: genResult.model_used,
      reviewed,
      review_notes: reviewNotes,
      next_steps: parsed.next_steps || [],
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request timed out' });
    }
    console.error('Builder V2 generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/builder/v2/chat — Multi-turn conversational builder ──
app.post('/api/builder/v2/chat', auth, async (req, res) => {
  console.log('POST /api/builder/v2/chat');
  const { messages: inputMessages, tier } = req.body;

  if (!inputMessages || !Array.isArray(inputMessages) || inputMessages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const chain = getModelChain(tier || 'pro');

  const chatSystem = BUILDER_V2_SYSTEM + `\n\nADDITIONAL RULES FOR CHAT MODE:
- If the user's request is vague or ambiguous, ask 1-2 clarifying questions before generating code.
- When asking clarifying questions, respond with JSON: {"clarification":true,"questions":["question 1","question 2"]}
- When generating code, respond with the standard JSON format.
- Maintain context from the conversation history.`;

  try {
    const result = await callWithFallback(chain, inputMessages, chatSystem, {
      stream: false, maxTokens: 16384, tier: tier || 'pro',
    });

    const rawText = result.text || '';
    const cleaned = rawText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      res.json({
        ...parsed,
        model_used: result.model_used,
        fallback_used: result.fallback_used,
      });
    } catch {
      res.json({
        response: rawText,
        model_used: result.model_used,
        fallback_used: result.fallback_used,
      });
    }
  } catch (err) {
    console.error('Builder V2 chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Builder V2 — Save Project to Supabase ───────────
app.post('/api/builder/v2/projects', auth, async (req, res) => {
  console.log('POST /api/builder/v2/projects');
  const { user_id, name, files, preview_entry, conversation } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const upstream = await fetch(`${SUPABASE_URL}/rest/v1/builder_projects`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        user_id,
        name,
        files: files || [],
        preview_entry: preview_entry || 'index.html',
        conversation: conversation || [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: `Supabase error: ${err}` });
    }

    const data = await upstream.json();
    res.json(data[0] || data);
  } catch (err) {
    console.error('Builder V2 save project error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Builder V2 — List User Projects ─────────────────
app.get('/api/builder/v2/projects/:user_id', auth, async (req, res) => {
  console.log(`GET /api/builder/v2/projects/${req.params.user_id}`);
  const { user_id } = req.params;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const upstream = await fetch(
      `${SUPABASE_URL}/rest/v1/builder_projects?user_id=eq.${encodeURIComponent(user_id)}&order=updated_at.desc`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: `Supabase error: ${err}` });
    }

    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    console.error('Builder V2 list projects error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Builder V2 — Deploy (Generate Preview HTML) ─────
app.post('/api/builder/v2/deploy', auth, async (req, res) => {
  console.log('POST /api/builder/v2/deploy');
  const { files, preview_entry } = req.body;

  if (!files?.length) return res.status(400).json({ error: 'files array is required' });

  try {
    const entry = preview_entry || 'index.html';
    const htmlFile = files.find(f => f.path === entry);

    if (!htmlFile) {
      return res.status(400).json({ error: `Preview entry "${entry}" not found in files array` });
    }

    // Build a lookup map for quick file access
    const fileMap = {};
    for (const f of files) {
      fileMap[f.path] = f.content;
    }

    let html = htmlFile.content;

    // Inline CSS: replace <link rel="stylesheet" href="X"> with <style>content</style>
    html = html.replace(
      /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
      (match, href) => {
        const css = fileMap[href];
        if (css) return `<style>\n${css}\n</style>`;
        return match;
      }
    );

    // Also handle <link href="X" rel="stylesheet"> (href before rel)
    html = html.replace(
      /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*\/?>/gi,
      (match, href) => {
        const css = fileMap[href];
        if (css) return `<style>\n${css}\n</style>`;
        return match;
      }
    );

    // Inline JS: replace <script src="X"></script> with <script>content</script>
    html = html.replace(
      /<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi,
      (match, src) => {
        const js = fileMap[src];
        if (js) return `<script>\n${js}\n</script>`;
        return match;
      }
    );

    res.json({ html, preview_url: null });
  } catch (err) {
    console.error('Builder V2 deploy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  SECTION 5: SOCIAL MEDIA (LinkedIn, Twitter, Meta, Generate)
// ══════════════════════════════════════════════════════════

// ── LinkedIn OAuth — Authorization URL ───────────────
app.get('/api/social/linkedin/auth', (req, res) => {
  if (!LINKEDIN_CLIENT_ID) {
    return res.status(503).json({ error: 'LinkedIn OAuth not configured' });
  }

  const state = Buffer.from(crypto.randomUUID()).toString('base64url');
  const scopes = 'openid profile email w_member_social';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     LINKEDIN_CLIENT_ID,
    redirect_uri:  LINKEDIN_REDIRECT_URI,
    state,
    scope:         scopes,
  });

  res.json({
    authorization_url: `https://www.linkedin.com/oauth/v2/authorization?${params}`,
    state,
  });
});

// ── LinkedIn OAuth — Token Exchange ──────────────────
app.post('/api/social/linkedin/callback', async (req, res) => {
  const { code, state } = req.body;

  if (!code) return res.status(400).json({ error: 'code is required' });
  if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
    return res.status(503).json({ error: 'LinkedIn OAuth not configured' });
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  LINKEDIN_REDIRECT_URI,
        client_id:     LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(tokenRes.status).json({ error: `LinkedIn token error: ${err}` });
    }

    const tokenData = await tokenRes.json();

    // Fetch user profile with the access token
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    let name = null, email = null, profile_id = null;
    if (profileRes.ok) {
      const profile = await profileRes.json();
      name       = profile.name || null;
      email      = profile.email || null;
      profile_id = profile.sub || null;
    }

    res.json({
      access_token: tokenData.access_token,
      expires_in:   tokenData.expires_in,
      name,
      email,
      profile_id,
    });
  } catch (err) {
    console.error('LinkedIn callback error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── LinkedIn Post ────────────────────────────────────
app.post('/api/social/linkedin/post', auth, async (req, res) => {
  const { access_token, content, visibility } = req.body;

  if (!access_token) return res.status(400).json({ error: 'access_token is required' });
  if (!content)      return res.status(400).json({ error: 'content is required' });

  try {
    // Get the user's profile ID for the author URN
    const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!meRes.ok) {
      return res.status(401).json({ error: 'Invalid or expired LinkedIn access token' });
    }

    const me = await meRes.json();
    const authorUrn = `urn:li:person:${me.sub}`;

    // Create post via Community Management API
    const postRes = await fetch('https://api.linkedin.com/rest/posts', {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        Authorization:        `Bearer ${access_token}`,
        'LinkedIn-Version':   '202401',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author:          authorUrn,
        commentary:      content,
        visibility:      (visibility || 'PUBLIC'),
        distribution:    { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState:  'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    });

    if (!postRes.ok) {
      const err = await postRes.text();
      return res.status(postRes.status).json({ error: `LinkedIn post error: ${err}` });
    }

    // Post ID is in the x-restli-id header
    const postId = postRes.headers.get('x-restli-id') || null;

    res.json({ success: true, post_id: postId });
  } catch (err) {
    console.error('LinkedIn post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Social Content Generation (updated to use callWithFallback) ──
app.post('/api/social/generate', auth, async (req, res) => {
  const { prompt, platforms, tone, includeHashtags, tier } = req.body;

  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const targetPlatforms = platforms?.length ? platforms : ['twitter', 'linkedin', 'instagram', 'tiktok', 'facebook'];
  const hashtagNote     = includeHashtags !== false ? 'Include 3-5 relevant hashtags per platform.' : 'Do NOT include hashtags.';

  const systemPrompt = `You are a world-class social media content strategist for SaintSal™ Labs.
Generate platform-native content for each requested platform. Each post should feel native to that platform's culture and format.

Guidelines:
- Twitter: 280 chars max, punchy, conversational
- LinkedIn: Professional, thought-leadership style, 1-3 paragraphs
- Instagram: Visual-first caption, emoji-friendly, story-driven
- TikTok: Hook-first, trending style, script-like
- Facebook: Community-focused, shareable, slightly longer form
${tone ? `Tone: ${tone}` : 'Tone: professional yet approachable'}
${hashtagNote}

RESPOND WITH ONLY valid JSON — no markdown, no code fences:
{"twitter":"...","linkedin":"...","instagram":"...","tiktok":"...","facebook":"..."}
Only include the platforms requested: ${targetPlatforms.join(', ')}` + CHAT_QUALITY_SUFFIX;

  const chain = getModelChain(tier || 'pro');

  try {
    const result = await callWithFallback(chain,
      [{ role: 'user', content: prompt }],
      systemPrompt,
      { stream: false, maxTokens: 2048, tier: tier || 'pro' }
    );

    const rawText = result.text || '';

    // Parse JSON — strip any accidental markdown wrapping
    const cleaned = rawText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();

    try {
      const content = JSON.parse(cleaned);
      res.json({ ...content, model_used: result.model_used });
    } catch {
      // If JSON parse fails, return the raw text keyed to the first platform
      res.json({ [targetPlatforms[0]]: rawText, _raw: true, model_used: result.model_used });
    }
  } catch (err) {
    console.error('Social generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Twitter OAuth1 Helpers ───────────────────────────
function generateOAuth1Header(method, url, params, consumerKey, consumerSecret, accessToken, tokenSecret) {
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  };
  const allParams = { ...oauthParams, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys.map(k =>
    `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`
  ).join('&');
  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  oauthParams.oauth_signature = signature;
  const header = 'OAuth ' + Object.keys(oauthParams).sort().map(k =>
    `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`
  ).join(', ');
  return header;
}

// ── Twitter Post ─────────────────────────────────────
app.post('/api/social/twitter/post', auth, async (req, res) => {
  const { content, access_token, access_secret } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });

  // Use per-user tokens if provided, else fall back to env vars
  const userAccessToken  = access_token  || TWITTER_ACCESS_TOKEN;
  const userAccessSecret = access_secret || TWITTER_SECRET_TOKEN;

  if (!TWITTER_CONSUMER_KEY || !TWITTER_CONSUMER_SECRET) {
    return res.status(503).json({ error: 'Twitter consumer keys not configured. Add TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET.' });
  }
  if (!userAccessToken || !userAccessSecret) {
    return res.status(401).json({ error: 'Twitter access tokens not provided.' });
  }

  try {
    const tweetUrl = 'https://api.twitter.com/2/tweets';
    const authHeader = generateOAuth1Header(
      'POST', tweetUrl, {},
      TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET,
      userAccessToken, userAccessSecret
    );
    const tweetRes = await fetch(tweetUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ text: content.slice(0, 280) }),
    });
    const tweetData = await tweetRes.json();
    if (!tweetRes.ok) {
      return res.status(tweetRes.status).json({ error: `Twitter error: ${JSON.stringify(tweetData)}` });
    }
    res.json({ success: true, tweet_id: tweetData.data?.id, url: `https://x.com/i/status/${tweetData.data?.id}` });
  } catch (err) {
    console.error('Twitter post error:', err.message);
    res.status(500).json({ error: 'Twitter post failed' });
  }
});

// ── Twitter Verify ───────────────────────────────────
app.get('/api/social/twitter/verify', auth, async (req, res) => {
  if (!TWITTER_CONSUMER_KEY || !TWITTER_CONSUMER_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_SECRET_TOKEN) {
    return res.json({ connected: false, reason: 'Missing consumer keys or access tokens' });
  }
  try {
    const verifyUrl = 'https://api.twitter.com/2/users/me';
    const authHeader = generateOAuth1Header(
      'GET', verifyUrl, {},
      TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET,
      TWITTER_ACCESS_TOKEN, TWITTER_SECRET_TOKEN
    );
    const verifyRes = await fetch(verifyUrl, {
      headers: { 'Authorization': authHeader },
    });
    const data = await verifyRes.json();
    if (verifyRes.ok && data.data) {
      res.json({ connected: true, username: data.data.username, name: data.data.name, id: data.data.id });
    } else {
      res.json({ connected: false, reason: data.detail || 'Verification failed' });
    }
  } catch (err) {
    res.json({ connected: false, reason: err.message });
  }
});

// ── Meta OAuth — Authorization URL ───────────────────
app.post('/api/social/meta/auth', (req, res) => {
  if (!META_APP_ID) {
    return res.status(503).json({ error: 'Meta OAuth not configured' });
  }

  const state = Buffer.from(crypto.randomUUID()).toString('base64url');
  const scopes = 'pages_show_list,pages_manage_posts,instagram_basic,instagram_content_publish';
  const params = new URLSearchParams({
    client_id:     META_APP_ID,
    redirect_uri:  META_REDIRECT_URI,
    state,
    scope:         scopes,
    response_type: 'code',
  });

  res.json({
    authorization_url: `https://www.facebook.com/v19.0/dialog/oauth?${params}`,
    state,
  });
});

// ── Meta OAuth — Token Exchange ──────────────────────
app.post('/api/social/meta/callback', async (req, res) => {
  const { code, state } = req.body;

  if (!code) return res.status(400).json({ error: 'code is required' });
  if (!META_APP_ID || !META_APP_SECRET) {
    return res.status(503).json({ error: 'Meta OAuth not configured' });
  }

  try {
    // Exchange code for short-lived token
    const tokenParams = new URLSearchParams({
      client_id:     META_APP_ID,
      client_secret: META_APP_SECRET,
      redirect_uri:  META_REDIRECT_URI,
      code,
    });

    const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${tokenParams}`);

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(tokenRes.status).json({ error: `Meta token error: ${err}` });
    }

    const tokenData = await tokenRes.json();

    // Exchange for long-lived token
    const longParams = new URLSearchParams({
      grant_type:        'fb_exchange_token',
      client_id:         META_APP_ID,
      client_secret:     META_APP_SECRET,
      fb_exchange_token: tokenData.access_token,
    });

    const longRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${longParams}`);
    let longToken = tokenData.access_token;
    let expiresIn = tokenData.expires_in || 3600;

    if (longRes.ok) {
      const longData = await longRes.json();
      longToken = longData.access_token || longToken;
      expiresIn = longData.expires_in || expiresIn;
    }

    // Fetch user info
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,email&access_token=${longToken}`);
    let name = null, userId = null;
    if (meRes.ok) {
      const meData = await meRes.json();
      name   = meData.name || null;
      userId = meData.id || null;
    }

    // Fetch pages
    const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${longToken}`);
    let pages = [];
    if (pagesRes.ok) {
      const pagesData = await pagesRes.json();
      pages = (pagesData.data || []).map(p => ({
        id:           p.id,
        name:         p.name,
        access_token: p.access_token,
      }));
    }

    res.json({
      access_token: longToken,
      expires_in:   expiresIn,
      user_id:      userId,
      name,
      pages,
    });
  } catch (err) {
    console.error('Meta callback error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Meta Post (Facebook page post or Instagram media publish) ──
app.post('/api/social/meta/post', auth, async (req, res) => {
  const { access_token, page_id, content, platform, image_url, instagram_account_id } = req.body;

  if (!access_token) return res.status(400).json({ error: 'access_token is required' });
  if (!content)      return res.status(400).json({ error: 'content is required' });

  try {
    if (platform === 'instagram') {
      // Instagram requires a two-step process: create container, then publish
      if (!instagram_account_id) {
        return res.status(400).json({ error: 'instagram_account_id is required for Instagram posts' });
      }
      if (!image_url) {
        return res.status(400).json({ error: 'image_url is required for Instagram posts' });
      }

      // Step 1: Create media container
      const containerParams = new URLSearchParams({
        image_url,
        caption:      content,
        access_token,
      });
      const containerRes = await fetch(
        `https://graph.facebook.com/v19.0/${instagram_account_id}/media`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: containerParams }
      );

      if (!containerRes.ok) {
        const err = await containerRes.text();
        return res.status(containerRes.status).json({ error: `Instagram container error: ${err}` });
      }

      const containerData = await containerRes.json();
      const creationId = containerData.id;

      // Step 2: Publish
      const publishParams = new URLSearchParams({
        creation_id:  creationId,
        access_token,
      });
      const publishRes = await fetch(
        `https://graph.facebook.com/v19.0/${instagram_account_id}/media_publish`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: publishParams }
      );

      if (!publishRes.ok) {
        const err = await publishRes.text();
        return res.status(publishRes.status).json({ error: `Instagram publish error: ${err}` });
      }

      const publishData = await publishRes.json();
      res.json({ success: true, media_id: publishData.id, platform: 'instagram' });

    } else {
      // Facebook page post
      const targetPage = page_id || 'me';
      const postParams = new URLSearchParams({
        message:      content,
        access_token,
      });

      const postRes = await fetch(
        `https://graph.facebook.com/v19.0/${targetPage}/feed`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: postParams }
      );

      if (!postRes.ok) {
        const err = await postRes.text();
        return res.status(postRes.status).json({ error: `Facebook post error: ${err}` });
      }

      const postData = await postRes.json();
      res.json({ success: true, post_id: postData.id, platform: 'facebook' });
    }
  } catch (err) {
    console.error('Meta post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Social Account Status (updated to include meta) ──
app.get('/api/social/status', auth, (req, res) => {
  res.json({
    linkedin: {
      configured:    !!LINKEDIN_CLIENT_ID && !!LINKEDIN_CLIENT_SECRET,
      client_id_set: !!LINKEDIN_CLIENT_ID,
    },
    twitter: {
      configured: !!TWITTER_CONSUMER_KEY && !!TWITTER_ACCESS_TOKEN,
      has_consumer_keys: !!TWITTER_CONSUMER_KEY && !!TWITTER_CONSUMER_SECRET,
      has_access_tokens: !!TWITTER_ACCESS_TOKEN && !!TWITTER_SECRET_TOKEN,
    },
    meta: {
      configured: !!META_APP_ID && !!META_APP_SECRET,
      app_id_set: !!META_APP_ID,
    },
    instagram: { configured: !!META_APP_ID && !!META_APP_SECRET },
    tiktok:    { configured: false },
    facebook:  { configured: !!META_APP_ID && !!META_APP_SECRET },
  });
});

// ══════════════════════════════════════════════════════════
//  VOICE: ElevenLabs + Deepgram
// ══════════════════════════════════════════════════════════

// ── ElevenLabs Voice — Signed URL ────────────────────
app.get('/api/voice/signed-url', auth, async (req, res) => {
  if (!ELEVENLABS_KEY || !ELEVENLABS_AGENT) {
    return res.status(503).json({ error: 'ElevenLabs not configured' });
  }
  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT}`,
      { headers: { 'xi-api-key': ELEVENLABS_KEY } }
    );
    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: err });
    }
    const data = await upstream.json();
    res.json({ signed_url: data.signed_url });
  } catch (err) {
    console.error('ElevenLabs signed-url error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ElevenLabs TTS ───────────────────────────────────
app.post('/api/voice/tts', auth, async (req, res) => {
  const { text, voice_id, model_id } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (!ELEVENLABS_KEY) return res.status(503).json({ error: 'ElevenLabs not configured' });

  const vid = voice_id || '21m00Tcm4TlvDq8ikWAM'; // Rachel default
  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${vid}/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': ELEVENLABS_KEY },
        body: JSON.stringify({
          text,
          model_id: model_id || 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
        }),
      }
    );
    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: err });
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Deepgram STT ─────────────────────────────────────
app.post('/api/voice/stt', auth, async (req, res) => {
  if (!DEEPGRAM_KEY) return res.status(503).json({ error: 'Deepgram not configured' });

  try {
    const upstream = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=en',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${DEEPGRAM_KEY}`,
          'Content-Type': req.headers['content-type'] || 'audio/wav',
        },
        body: req,
      }
    );
    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: err });
    }
    const data = await upstream.json();
    const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    res.json({ transcript, confidence: data.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0 });
  } catch (err) {
    console.error('STT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  AUTH: Supabase Verify
// ══════════════════════════════════════════════════════════

app.post('/api/auth/verify', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }
  try {
    const upstream = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY },
    });
    if (!upstream.ok) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const user = await upstream.json();
    res.json({ valid: true, user_id: user.id, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  BILLING: Stripe Checkout
// ══════════════════════════════════════════════════════════

app.post('/api/billing/checkout', auth, async (req, res) => {
  const { price_id, user_id, email, success_url, cancel_url } = req.body;
  if (!price_id) return res.status(400).json({ error: 'price_id is required' });
  if (!STRIPE_SECRET) return res.status(503).json({ error: 'Stripe not configured' });

  try {
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', price_id);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', success_url || 'saintsallabs://billing/success');
    params.append('cancel_url', cancel_url || 'saintsallabs://billing/cancel');
    if (email) params.append('customer_email', email);
    if (user_id) params.append('metadata[user_id]', user_id);

    const upstream = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(STRIPE_SECRET + ':').toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data.error?.message || 'Stripe error' });
    res.json({ url: data.url, session_id: data.id });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  SECTION 4: REAL ESTATE
// ══════════════════════════════════════════════════════════

// ── GET /api/realestate/search?q=&type=buy|rent|invest|distressed ──
app.get('/api/realestate/search', auth, async (req, res) => {
  const { q, type, city, state: st, zip, bedrooms, bathrooms, limit: maxResults } = req.query;

  if (!q && !city && !zip) {
    return res.status(400).json({ error: 'Search query (q), city, or zip is required' });
  }

  const searchType = (type || 'buy').toLowerCase();
  const resultLimit = parseInt(maxResults) || 20;

  try {
    let listings = [];
    let source = 'rentcast';

    if (searchType === 'distressed' && PROPERTY_API_KEY) {
      // Distressed: PropertyAPI first
      try {
        const params = new URLSearchParams();
        if (q) params.append('q', q);
        if (city) params.append('city', city);
        if (st) params.append('state', st);
        if (zip) params.append('zip', zip);
        params.append('limit', String(resultLimit));
        params.append('status', 'distressed');

        const propRes = await fetch(`https://api.propertyapi.com/v1/listings?${params}`, {
          headers: { 'Authorization': `Bearer ${PROPERTY_API_KEY}`, 'Content-Type': 'application/json' },
        });

        if (propRes.ok) {
          const propData = await propRes.json();
          listings = propData.listings || propData.data || [];
          source = 'propertyapi';
        }
      } catch (e) {
        console.error('PropertyAPI search error:', e.message);
      }
    }

    // RentCast fallback (or primary for buy/rent/invest)
    if (listings.length === 0 && RENTCAST_API_KEY) {
      const endpoint = (searchType === 'rent') ? '/v1/listings/rental' : '/v1/listings/sale';
      const params = new URLSearchParams();
      if (city) params.append('city', city);
      if (st) params.append('state', st);
      if (zip) params.append('zipCode', zip);
      if (bedrooms) params.append('bedrooms', bedrooms);
      if (bathrooms) params.append('bathrooms', bathrooms);
      params.append('limit', String(resultLimit));

      const rcRes = await fetch(`https://api.rentcast.io${endpoint}?${params}`, {
        headers: { 'X-Api-Key': RENTCAST_API_KEY, 'Content-Type': 'application/json' },
      });

      if (rcRes.ok) {
        const rcData = await rcRes.json();
        listings = Array.isArray(rcData) ? rcData : (rcData.listings || rcData.data || []);
        source = 'rentcast';
      } else {
        const errText = await rcRes.text();
        console.error('RentCast search error:', rcRes.status, errText);
      }
    }

    res.json({
      listings,
      count: listings.length,
      type: searchType,
      source,
    });
  } catch (err) {
    console.error('Real estate search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/realestate/value?address= ───────────────
app.get('/api/realestate/value', auth, async (req, res) => {
  const { address } = req.query;

  if (!address) return res.status(400).json({ error: 'address is required' });

  try {
    let valuation = null;
    let source = null;

    // RentCast AVM primary
    if (RENTCAST_API_KEY) {
      try {
        const params = new URLSearchParams({ address });
        const avmRes = await fetch(`https://api.rentcast.io/v1/avm/value?${params}`, {
          headers: { 'X-Api-Key': RENTCAST_API_KEY, 'Content-Type': 'application/json' },
        });

        if (avmRes.ok) {
          valuation = await avmRes.json();
          source = 'rentcast';
        }
      } catch (e) {
        console.error('RentCast AVM error:', e.message);
      }
    }

    // Zillow supplementary data
    let zillowData = null;
    if (ZILLOW_API_KEY) {
      try {
        const params = new URLSearchParams({ address });
        const zilRes = await fetch(`https://api.bridgedataoutput.com/api/v2/zestimates?${params}`, {
          headers: { 'Authorization': `Bearer ${ZILLOW_API_KEY}`, 'Content-Type': 'application/json' },
        });

        if (zilRes.ok) {
          zillowData = await zilRes.json();
        }
      } catch (e) {
        console.error('Zillow supplementary error:', e.message);
      }
    }

    if (!valuation && !zillowData) {
      return res.status(404).json({ error: 'Could not retrieve valuation for this address' });
    }

    res.json({
      address,
      valuation,
      zillow: zillowData,
      source: source || (zillowData ? 'zillow' : null),
    });
  } catch (err) {
    console.error('Real estate value error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/realestate/distressed/:category ─────────
app.get('/api/realestate/distressed/:category', auth, async (req, res) => {
  const { category } = req.params;
  const { city, state: st, zip, limit: maxResults } = req.query;
  const resultLimit = parseInt(maxResults) || 20;

  const validCategories = ['foreclosure', 'preforeclosure', 'auction', 'bank-owned', 'short-sale', 'tax-lien'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: `Invalid category. Valid: ${validCategories.join(', ')}` });
  }

  try {
    let listings = [];
    let source = null;

    // PropertyAPI PRIMARY
    if (PROPERTY_API_KEY) {
      try {
        const params = new URLSearchParams();
        params.append('category', category);
        if (city) params.append('city', city);
        if (st) params.append('state', st);
        if (zip) params.append('zip', zip);
        params.append('limit', String(resultLimit));

        const propRes = await fetch(`https://api.propertyapi.com/v1/distressed?${params}`, {
          headers: { 'Authorization': `Bearer ${PROPERTY_API_KEY}`, 'Content-Type': 'application/json' },
        });

        if (propRes.ok) {
          const propData = await propRes.json();
          listings = propData.listings || propData.data || [];
          source = 'propertyapi';
        }
      } catch (e) {
        console.error('PropertyAPI distressed error:', e.message);
      }
    }

    // RentCast fallback
    if (listings.length === 0 && RENTCAST_API_KEY) {
      try {
        const params = new URLSearchParams();
        if (city) params.append('city', city);
        if (st) params.append('state', st);
        if (zip) params.append('zipCode', zip);
        params.append('limit', String(resultLimit));
        params.append('status', 'distressed');

        const rcRes = await fetch(`https://api.rentcast.io/v1/listings/sale?${params}`, {
          headers: { 'X-Api-Key': RENTCAST_API_KEY, 'Content-Type': 'application/json' },
        });

        if (rcRes.ok) {
          const rcData = await rcRes.json();
          listings = Array.isArray(rcData) ? rcData : (rcData.listings || rcData.data || []);
          source = 'rentcast';
        }
      } catch (e) {
        console.error('RentCast distressed fallback error:', e.message);
      }
    }

    res.json({
      category,
      listings,
      count: listings.length,
      source,
    });
  } catch (err) {
    console.error('Distressed search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/realestate/deal-analyze ────────────────
app.post('/api/realestate/deal-analyze', auth, async (req, res) => {
  const {
    purchase_price,
    monthly_rent,
    down_payment_pct,
    interest_rate,
    loan_term_years,
    monthly_expenses,
    closing_costs,
    vacancy_rate,
    annual_appreciation,
    tier,
  } = req.body;

  if (!purchase_price || !monthly_rent) {
    return res.status(400).json({ error: 'purchase_price and monthly_rent are required' });
  }

  try {
    // Calculate deal metrics
    const price = parseFloat(purchase_price);
    const rent  = parseFloat(monthly_rent);
    const downPct = parseFloat(down_payment_pct || 20) / 100;
    const rate  = parseFloat(interest_rate || 7) / 100 / 12;
    const termMonths = parseInt(loan_term_years || 30) * 12;
    const expenses = parseFloat(monthly_expenses || 0);
    const closing  = parseFloat(closing_costs || 0);
    const vacancy  = parseFloat(vacancy_rate || 5) / 100;
    const appreciation = parseFloat(annual_appreciation || 3) / 100;

    const downPayment = price * downPct;
    const loanAmount  = price - downPayment;

    // Monthly mortgage payment (P&I)
    let monthlyMortgage = 0;
    if (rate > 0 && loanAmount > 0) {
      monthlyMortgage = loanAmount * (rate * Math.pow(1 + rate, termMonths)) / (Math.pow(1 + rate, termMonths) - 1);
    }

    // Effective monthly rent (accounting for vacancy)
    const effectiveRent = rent * (1 - vacancy);

    // Monthly cash flow
    const monthlyCashflow = effectiveRent - monthlyMortgage - expenses;

    // Annual cash flow
    const annualCashflow = monthlyCashflow * 12;

    // Total cash invested
    const totalCashInvested = downPayment + closing;

    // Cash-on-cash return
    const cashOnCash = totalCashInvested > 0 ? (annualCashflow / totalCashInvested) * 100 : 0;

    // Cap rate (Net Operating Income / Purchase Price)
    const noi = (effectiveRent - expenses) * 12;
    const capRate = price > 0 ? (noi / price) * 100 : 0;

    // ROI (first year, simplified)
    const annualAppreciation = price * appreciation;
    const roi = totalCashInvested > 0 ? ((annualCashflow + annualAppreciation) / totalCashInvested) * 100 : 0;

    // DSCR (Debt Service Coverage Ratio)
    const annualDebtService = monthlyMortgage * 12;
    const dscr = annualDebtService > 0 ? noi / annualDebtService : 0;

    const metrics = {
      cash_on_cash:      Math.round(cashOnCash * 100) / 100,
      cap_rate:          Math.round(capRate * 100) / 100,
      monthly_cashflow:  Math.round(monthlyCashflow * 100) / 100,
      annual_cashflow:   Math.round(annualCashflow * 100) / 100,
      roi:               Math.round(roi * 100) / 100,
      dscr:              Math.round(dscr * 100) / 100,
      monthly_mortgage:  Math.round(monthlyMortgage * 100) / 100,
      effective_rent:    Math.round(effectiveRent * 100) / 100,
      total_invested:    Math.round(totalCashInvested * 100) / 100,
      noi:               Math.round(noi * 100) / 100,
    };

    // AI commentary via callWithFallback
    let aiCommentary = '';
    try {
      const chain = getModelChain(tier || 'standard');
      const commentaryPrompt = `Analyze this real estate deal and give brief, actionable investment commentary (3-5 sentences):

Purchase Price: $${price.toLocaleString()}
Monthly Rent: $${rent.toLocaleString()}
Down Payment: ${(downPct * 100)}%
Metrics:
- Cash-on-Cash Return: ${metrics.cash_on_cash}%
- Cap Rate: ${metrics.cap_rate}%
- Monthly Cash Flow: $${metrics.monthly_cashflow.toLocaleString()}
- ROI (Year 1): ${metrics.roi}%
- DSCR: ${metrics.dscr}

Is this a good deal? What should the investor watch out for?`;

      const aiResult = await callWithFallback(chain,
        [{ role: 'user', content: commentaryPrompt }],
        'You are an expert real estate investment analyst. Be direct and specific.' + CHAT_QUALITY_SUFFIX,
        { stream: false, maxTokens: 1024, tier: tier || 'standard' }
      );
      aiCommentary = aiResult.text || '';
    } catch (e) {
      console.error('AI commentary failed:', e.message);
      aiCommentary = 'AI analysis unavailable.';
    }

    res.json({
      metrics,
      ai_commentary: aiCommentary,
      inputs: {
        purchase_price: price,
        monthly_rent: rent,
        down_payment_pct: downPct * 100,
        interest_rate: rate * 12 * 100,
        loan_term_years: termMonths / 12,
        vacancy_rate: vacancy * 100,
      },
    });
  } catch (err) {
    console.error('Deal analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/realestate/portfolio/save (auth) ───────
app.post('/api/realestate/portfolio/save', auth, async (req, res) => {
  const { user_id, property } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  if (!property) return res.status(400).json({ error: 'property is required' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const upstream = await fetch(`${SUPABASE_URL}/rest/v1/realestate_portfolio`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        user_id,
        property,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: `Supabase error: ${err}` });
    }

    const data = await upstream.json();
    res.json(data[0] || data);
  } catch (err) {
    console.error('Portfolio save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/realestate/portfolio/:user_id (auth) ────
app.get('/api/realestate/portfolio/:user_id', auth, async (req, res) => {
  const { user_id } = req.params;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  try {
    const upstream = await fetch(
      `${SUPABASE_URL}/rest/v1/realestate_portfolio?user_id=eq.${encodeURIComponent(user_id)}&order=created_at.desc`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: `Supabase error: ${err}` });
    }

    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    console.error('Portfolio list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  CORPNET — Business Formation + Tax Registration
// ══════════════════════════════════════════════════════════
const corpnetRouter = require('./api/corpnet');
app.use('/api/corpnet', corpnetRouter);

// ══════════════════════════════════════════════════════════
//  START SERVER
// ══════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`SaintSal Labs API Gateway v4 on port ${PORT}`);
  console.log(`AI: Anthropic=${!!ANTHROPIC_KEY} OpenAI=${!!OPENAI_KEY} Gemini=${!!GEMINI_KEY} xAI=${!!XAI_KEY}`);
  console.log(`Voice: ElevenLabs=${!!ELEVENLABS_KEY} Deepgram=${!!DEEPGRAM_KEY}`);
  console.log(`Auth: Supabase=${!!SUPABASE_URL} Stripe=${!!STRIPE_SECRET}`);
  console.log(`Social: LinkedIn=${!!LINKEDIN_CLIENT_ID} Twitter=${!!TWITTER_CONSUMER_KEY} Meta=${!!META_APP_ID}`);
  console.log(`RealEstate: RentCast=${!!RENTCAST_API_KEY} PropertyAPI=${!!PROPERTY_API_KEY} Zillow=${!!ZILLOW_API_KEY}`);
  console.log(`CorpNet: env=${process.env.CORPNET_ENV || 'staging'} token=${!!(process.env.CORPNET_BEARER_TOKEN || 'staging-default')}`);
});
