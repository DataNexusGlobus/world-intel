// pages/api/tts.js — HuggingFace TTS proxy
// Model: facebook/mms-tts-eng — free, no quota, no credit card ever
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const hfKey = process.env.HUGGINGFACE_API_KEY;
  if (!hfKey) {
    return new Response(JSON.stringify({ error: 'not_configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }

  let text;
  try {
    const raw = await req.json();
    if (!raw || typeof raw !== 'object') throw new Error('bad body');
    text = typeof raw.text === 'string' ? raw.text.trim() : '';
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!text) {
    return new Response(JSON.stringify({ error: 'text required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const truncated = text.slice(0, 500);

  // Try up to 3 times — HF free tier has cold starts that need a retry
  for (let attempt = 0; attempt < 3; attempt++) {
    // Wait before retry (not on first attempt)
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 3000));
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);

    try {
      const res = await fetch(
        'https://api-inference.huggingface.co/models/facebook/mms-tts-eng',
        {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'Authorization': `Bearer ${hfKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: truncated }),
        }
      );
      clearTimeout(timer);

      if (res.ok) {
        // Success — stream audio back
        return new Response(res.body, {
          status: 200,
          headers: {
            'Content-Type': res.headers.get('content-type') || 'audio/flac',
            'Cache-Control': 'no-store',
          },
        });
      }

      // 503 = model still loading — retry
      if (res.status === 503 && attempt < 2) continue;

      // 401 = bad key — no point retrying
      if (res.status === 401) {
        return new Response(JSON.stringify({ error: 'bad_key' }), {
          status: 401, headers: { 'Content-Type': 'application/json' },
        });
      }

      // Other errors — return with retryable flag
      return new Response(JSON.stringify({ error: `HF ${res.status}` }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });

    } catch (err) {
      clearTimeout(timer);
      if (attempt < 2) continue; // retry on network error
      return new Response(JSON.stringify({
        error: err?.name === 'AbortError' ? 'timeout' : 'fetch_failed',
      }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
  }

  return new Response(JSON.stringify({ error: 'max_retries' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  });
}
