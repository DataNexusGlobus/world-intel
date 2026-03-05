// pages/api/claude.js
// Gemini 2.5 Flash proxy — 250,000 TPM free, Google Search grounding built-in
// GEMINI_API_KEY stored in Vercel env vars

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not set in Vercel" });

  const { prompt, maxTokens = 2000 } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  // Gemini 2.5 Flash is a thinking model — thinking tokens count against output limit.
  // thoughtsTokenCount can be 2000-4000 on its own, so we need a much higher ceiling.
  // We request enough for thinking + actual JSON output.
  const outputTokens = Math.max(maxTokens + 4000, 8000);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      maxOutputTokens: outputTokens,
      temperature: 0.4,
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini error:", response.status, JSON.stringify(data?.error));
      return res.status(response.status).json({
        error: data?.error?.message || "Gemini API error",
        geminiStatus: response.status,
        geminiCode: data?.error?.status,
      });
    }

    const candidate = data?.candidates?.[0];
    const finishReason = candidate?.finishReason;

    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return res.status(200).json({ text: "", error: "Blocked: " + finishReason });
    }

    // Filter out thought parts (p.thought === true) — only keep actual output text
    const text = candidate?.content?.parts
      ?.filter(p => p.text && !p.thought)
      ?.map(p => p.text)
      ?.join("") || "";

    if (!text) {
      console.warn("Empty Gemini response, finishReason:", finishReason);
      return res.status(200).json({ text: "", error: "Empty response" });
    }

    // Strip markdown code fences — Gemini adds ```json ... ``` despite instructions
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    return res.status(200).json({ text: cleaned });

  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: "Proxy failed: " + err.message });
  }
}
