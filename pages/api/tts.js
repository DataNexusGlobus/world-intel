// pages/api/tts.js — ElevenLabs TTS proxy
// Voice: Aria — warm, natural, conversational
export const config = { runtime: 'edge' };

const VOICE_ID = '9BWtsMINqrJLrRacOk9x'; // Aria

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
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

  const truncated = text.slice(0, 400);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: truncated,
          model_id: 'eleven_flash_v2_5',
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.75,
            style: 0.40,
            use_speaker_boost: true,
          },
        }),
      }
    );
    clearTimeout(timer);

    if (res.ok) {
      // Read full audio into buffer — avoids streaming corruption on edge runtime
      const audioBuffer = await res.arrayBuffer();
      return new Response(audioBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'no-store',
          'Content-Length': audioBuffer.byteLength.toString(),
        },
      });
    }

    if (res.status === 401) {
      return new Response(JSON.stringify({ error: 'bad_key' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (res.status === 429) {
      return new Response(JSON.stringify({ error: 'quota_exceeded' }), {
        status: 429, headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `EL ${res.status}` }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    clearTimeout(timer);
    return new Response(JSON.stringify({
      error: err?.name === 'AbortError' ? 'timeout' : 'fetch_failed',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}
