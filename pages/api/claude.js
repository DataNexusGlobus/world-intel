// pages/api/claude.js — Groq proxy with Supabase server-side cache
// Edge runtime = 25s timeout (vs 10s serverless)
// Server cache = all users share one Groq call per tab/country per 30 mins
export const config = { runtime: 'edge' };

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

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
    maxTokens = body.maxTokens || 1000;
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

  // ── GROQ CALL ─────────────────────────────────────────────────────────────
  // No response_format json_object — plain text mode is 3-5s vs 15-20s
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

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    // ── STORE IN SERVER CACHE ───────────────────────────────────────────────
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
