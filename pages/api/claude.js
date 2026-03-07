// pages/api/claude.js — Groq proxy with Supabase server-side cache
// Edge runtime = 25s timeout (vs 10s serverless)
// Server cache = all users share one Groq call per tab/country per day (20hr TTL)
export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 20 * 60 * 60 * 1000; // 20 hours — key already has date so safe all day

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

// ── DAILY CALL COUNTER ───────────────────────────────────────────────────
// Atomic increment — reads AND writes in one DB operation
// Prevents race condition where two simultaneous requests both read the same
// count, both pass the cap check, and both call Groq (overshoot)
// Key format: "calls:2026-03-07" — auto-resets daily via date in key
const DAILY_GROQ_CAP = 45; // 45 calls × ~1,800 tokens avg = ~81k tokens (safe under 100k)

async function atomicIncrementAndCheck(sbUrl, sbKey) {
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

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const groqKey = process.env.GROQ_API_KEY;
  const sbUrl   = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!groqKey) {
    return new Response(JSON.stringify({ error: 'GROQ_API_KEY not set' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

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

  // ── SERVER-SIDE CACHE CHECK ───────────────────────────────────────────────
  if (cacheKey && sbUrl && sbKey) {
    const cached = await getCached(sbUrl, sbKey, cacheKey);
    if (cached) {
      return new Response(JSON.stringify({ text: cached, serverCached: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── ATOMIC CAP CHECK ─────────────────────────────────────────────────────
  // Increments counter AND checks cap in one DB operation — no race condition
  // If two requests arrive simultaneously, DB serializes them: one gets N, next gets N+1
  // The request that gets a count > CAP is blocked; no overshoot possible
  if (sbUrl && sbKey) {
    const newCount = await atomicIncrementAndCheck(sbUrl, sbKey);
    if (newCount > DAILY_GROQ_CAP) {
      return new Response(JSON.stringify({
        error: 'Daily AI quota reached. Cached data is still available. Fresh data resets at midnight UTC (5:30 AM IST).',
        quotaExceeded: true,
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // ── GROQ CALL ─────────────────────────────────────────────────────────────
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

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify(groqBody),
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      const groqErr = data?.error?.message || 'Groq API error';
      return new Response(JSON.stringify({
        error: groqErr,
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

    // ── STORE IN SERVER CACHE ───────────────────────────────────────────────
    // Counter already incremented atomically before Groq call — no separate increment needed
    if (cacheKey && sbUrl && sbKey && cleaned) {
      await setCached(sbUrl, sbKey, cacheKey, cleaned);
    }

    return new Response(JSON.stringify({ text: cleaned }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Proxy error: ' + err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
