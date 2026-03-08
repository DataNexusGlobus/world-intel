// pages/api/claude.js — Groq proxy with Supabase server-side cache
// Edge runtime = 25s timeout (vs 10s serverless)
// Server cache = all users share one Groq call per tab/country per day (20hr TTL)
// Multi-key rotation: GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3 (optional extras)
// Pool daily cap scales automatically: 45 × numKeys (135 calls = ~240k tokens with 3 keys)
// On 429/rate-limit: rotates to next key in shuffled pool before giving up
export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 20 * 60 * 60 * 1000; // 20 hours — key already has date so safe all day
const CAP_PER_KEY  = 45;                    // 45 calls × ~1,800 tokens avg = ~81k tokens per key

async function getCached(sbUrl, sbKey, cacheKey) {
  try {
    const res = await fetch(
      `${sbUrl}/rest/v1/ai_cache?key=eq.${encodeURIComponent(cacheKey)}&select=value,created_at&limit=1`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    const rows = await res.json();
    if (rows?.[0]) {
      const age = Date.now() - new Date(rows[0].created_at).getTime();
      if (age < CACHE_TTL_MS) return rows[0].value;
    }
  } catch {}
  return null;
}

async function setCached(sbUrl, sbKey, cacheKey, value) {
  try {
    await fetch(`${sbUrl}/rest/v1/ai_cache`, {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ key: cacheKey, value, created_at: new Date().toISOString() }),
    });
  } catch {}
}

// ── DAILY CALL COUNTER ───────────────────────────────────────────────────────
// Atomic increment — reads AND writes in one DB operation
// Prevents race condition where two simultaneous requests both read the same
// count, both pass the cap check, and both call Groq (overshoot)
// Key format: "calls:2026-03-07" — auto-resets daily via date in key
// Cap = 45 × number of active keys (scales automatically as you add keys)
async function atomicIncrementAndCheck(sbUrl, sbKey, dailyCap) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const key = `calls:${today}`;
    // Calls Supabase RPC — increments counter and returns new value atomically
    // No race condition: DB processes each request sequentially with row lock
    const res = await fetch(`${sbUrl}/rest/v1/rpc/increment_call_count`, {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_key: key }),
    });
    const newCount = await res.json();
    return parseInt(newCount) || 0;
  } catch { return 0; } // Supabase down → fail open (allow call, don't block user)
}

// ── KEY POOL HELPERS ─────────────────────────────────────────────────────────
// Builds array from GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3
// Filters out undefined/empty — fully backward compatible if only 1 key exists
function buildKeyPool(env) {
  return [
    env.GROQ_API_KEY,
    env.GROQ_API_KEY_2,
    env.GROQ_API_KEY_3,
  ].filter(k => k && k.trim().length > 10);
}

// Fisher-Yates shuffle — randomises which key is tried first each request
// This distributes load evenly across all keys instead of always hitting key 1 first
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── BUILD KEY POOL ───────────────────────────────────────────────────────
  const groqKeys = buildKeyPool(process.env);
  const sbUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey    = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (groqKeys.length === 0) {
    return new Response(JSON.stringify({ error: 'No Groq API keys configured. Set GROQ_API_KEY in Vercel env vars.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Daily cap scales with pool size: 45 per key × N keys
  const DAILY_GROQ_CAP = CAP_PER_KEY * groqKeys.length;

  let prompt, maxTokens, cacheKey;
  try {
    const body = await req.json();
    prompt    = body.prompt;
    maxTokens = Math.min(4000, Math.max(100, parseInt(body.maxTokens) || 1000)); // clamp 100–4000
    cacheKey  = body.cacheKey || null; // e.g. "mkt:India:2026-03-07"
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!prompt) {
    return new Response(JSON.stringify({ error: 'prompt required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── SERVER-SIDE CACHE CHECK ──────────────────────────────────────────────
  if (cacheKey && sbUrl && sbKey) {
    const cached = await getCached(sbUrl, sbKey, cacheKey);
    if (cached) {
      return new Response(JSON.stringify({ text: cached, serverCached: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── ATOMIC POOL-WIDE CAP CHECK ───────────────────────────────────────────
  // Single counter tracks all calls regardless of which key was used
  // Cap = 45 × numKeys so total token budget stays safe (81k × N)
  if (sbUrl && sbKey) {
    const newCount = await atomicIncrementAndCheck(sbUrl, sbKey, DAILY_GROQ_CAP);
    if (newCount > DAILY_GROQ_CAP) {
      return new Response(JSON.stringify({
        error: 'Daily AI quota reached. Cached data is still available. Fresh data resets at midnight UTC (5:30 AM IST).',
        quotaExceeded: true,
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // ── GROQ PAYLOAD ─────────────────────────────────────────────────────────
  // Plain text mode — faster (3-5s) than structured mode (15-20s), we parse JSON ourselves
  const groqBody = {
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: "You are a financial and geopolitical intelligence AI. Today is March 2026. Always treat search results in the user message as ground truth. When given ticker→name mappings like '0700.HK → name is \"Tencent Holdings\"', always use the full company name, never the ticker. Always respond with valid JSON only — no markdown, no explanation text.",
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
  };

  // ── MULTI-KEY ROTATION ───────────────────────────────────────────────────
  // Shuffle so every request distributes load randomly across the key pool
  // On 429 (rate limit) or network error: continue to next key in shuffled list
  // Only returns quota error after ALL keys exhausted
  const shuffledKeys = shuffleArray(groqKeys);
  let lastError = null;

  for (const currentKey of shuffledKeys) {
    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentKey}`,
        },
        body: JSON.stringify(groqBody),
      });

      const data = await groqRes.json();

      if (!groqRes.ok) {
        // 429 = this key is rate-limited right now → try next key in pool
        if (groqRes.status === 429) {
          lastError = data?.error?.message || 'Rate limited';
          continue; // skip to next key
        }
        // Other errors (400, 500, etc.) → return immediately, retrying won't help
        return new Response(JSON.stringify({
          error: data?.error?.message || 'Groq API error',
          groqStatus: groqRes.status,
          groqType: data?.error?.type,
        }), { status: groqRes.status, headers: { 'Content-Type': 'application/json' } });
      }

      const raw = data?.choices?.[0]?.message?.content || '';
      if (!raw) {
        return new Response(JSON.stringify({ text: '', error: 'Empty Groq response' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      // Strip markdown fences — also catch any residual lone backticks after stripping
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim()
        .replace(/^`+|`+$/g, '') // remove any remaining backticks at edges
        .trim();

      // ── STORE IN SERVER CACHE ────────────────────────────────────────────
      if (cacheKey && sbUrl && sbKey && cleaned) {
        await setCached(sbUrl, sbKey, cacheKey, cleaned);
      }

      return new Response(JSON.stringify({ text: cleaned }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });

    } catch (err) {
      // Network-level error for this key → try next key
      lastError = err.message;
      continue;
    }
  }

  // ── ALL KEYS EXHAUSTED ───────────────────────────────────────────────────
  // Every key in the pool was either rate-limited or errored
  return new Response(JSON.stringify({
    error: lastError || 'All Groq keys rate-limited. Try again in a minute.',
    quotaExceeded: true,
  }), { status: 429, headers: { 'Content-Type': 'application/json' } });
}
