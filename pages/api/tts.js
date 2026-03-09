// pages/api/tts.js — HuggingFace TTS proxy
// Uses facebook/mms-tts-eng model — free, no credit card, no quota limits
// Server-side edge function — zero webpack issues
// Needs: HUGGINGFACE_API_KEY env var in Vercel
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const hfKey = process.env.HUGGINGFACE_API_KEY;
  if (!hfKey) {
    // Silent fail — frontend falls back to browser TTS
    return new Response(JSON.stringify({ error: 'TTS not configured' }), {
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

  // HuggingFace free tier has a 500 char practical limit for fast response
  const truncated = text.slice(0, 500);

  const ctrl = new AbortController();
  // 20s timeout — HF cold starts can be slow when model is loading
  const timer = setTimeout(() => ctrl.abort(), 20000);

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

    if (!res.ok) {
      // 503 = model loading (cold start) — tell frontend to fallback
      // 429 = rate limit — also fallback
      return new Response(JSON.stringify({ error: `HF ${res.status}` }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Stream audio bytes straight to client
    // HF returns audio/flac — browser Audio element handles it fine
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'audio/flac',
        'Cache-Control': 'no-store',
      },
    });

  } catch (err) {
    clearTimeout(timer);
    return new Response(JSON.stringify({
      error: err?.name === 'AbortError' ? 'TTS timeout' : 'TTS failed',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}
