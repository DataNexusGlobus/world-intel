// pages/api/tts.js — ElevenLabs TTS proxy
// Uses Node.js runtime (NOT Edge) — Edge runtime corrupts binary audio data
// Voice: Aria — warm, natural, conversational
import https from 'https';

const VOICE_ID = '9BWtsMINqrJLrRacOk9x'; // Aria

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'not_configured' });
  }

  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text required' });
  }

  const truncated = text.trim().slice(0, 400);

  try {
    const elRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: truncated,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.75,
            style: 0.40,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!elRes.ok) {
      if (elRes.status === 401) return res.status(401).json({ error: 'bad_key' });
      if (elRes.status === 429) return res.status(429).json({ error: 'quota_exceeded' });
      return res.status(503).json({ error: `EL ${elRes.status}` });
    }

    // Get audio as buffer and send cleanly — no streaming corruption
    const arrayBuffer = await elRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buffer);

  } catch (err) {
    return res.status(503).json({ error: 'fetch_failed' });
  }
}
