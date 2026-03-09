// pages/api/tts.js — HuggingFace Parler-TTS proxy
// Model: parler-tts/parler-tts-mini-v1
// Natural, expressive, describable voice — free on HF, no credit card ever
export const config = { runtime: 'edge' };

// Voice description — controls how ARIA sounds
// Parler-TTS reads this and generates accordingly
const VOICE_DESCRIPTION =
  "A young woman speaks warmly and naturally with a clear American English accent. " +
  "Her voice is expressive, friendly, and conversational — like talking to a smart friend. " +
  "Moderate pace, clear pronunciation, slightly upbeat tone.";

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

  // Parler works best with shorter chunks — 200 chars is the sweet spot
  const truncated = text.slice(0, 200);

  // Retry up to 3 times — HF free tier has cold starts
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 4000));
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);

    try {
      const res = await fetch(
        'https://api-inference.huggingface.co/models/parler-tts/parler-tts-mini-v1',
        {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'Authorization': `Bearer ${hfKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: truncated,
            parameters: {
              description: VOICE_DESCRIPTION,
            },
          }),
        }
      );
      clearTimeout(timer);

      if (res.ok) {
        return new Response(res.body, {
          status: 200,
          headers: {
            'Content-Type': res.headers.get('content-type') || 'audio/wav',
            'Cache-Control': 'no-store',
          },
        });
      }

      if (res.status === 401) {
        return new Response(JSON.stringify({ error: 'bad_key' }), {
          status: 401, headers: { 'Content-Type': 'application/json' },
        });
      }

      // 503 = model loading — retry
      if (res.status === 503 && attempt < 2) continue;

      return new Response(JSON.stringify({ error: `HF ${res.status}` }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });

    } catch (err) {
      clearTimeout(timer);
      if (attempt < 2) continue;
      return new Response(JSON.stringify({
        error: err?.name === 'AbortError' ? 'timeout' : 'fetch_failed',
      }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
  }

  return new Response(JSON.stringify({ error: 'max_retries' }), {
    status: 503, headers: { 'Content-Type': 'application/json' },
  });
}
