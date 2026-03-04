// pages/api/claude.js
// Gemini 2.0 Flash proxy — free, no credit card needed
// GEMINI_API_KEY stored securely in Vercel env vars

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY not set in Vercel Environment Variables",
    });
  }

  const { prompt, maxTokens = 2500, useSearch = false, jsonMode = false } = req.body || {};

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Build Gemini request
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: jsonMode ? 0.4 : 0.7,
    },
  };

  // Web search — Google Search grounding (NOT compatible with jsonMode)
  if (useSearch) {
    body.tools = [{ googleSearch: {} }];
  }

  // JSON mode — force pure JSON output
  if (jsonMode) {
    body.generationConfig.responseMimeType = "application/json";
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    // Return full Gemini error for visibility
    if (!response.ok) {
      console.error("Gemini API error:", JSON.stringify(data));
      return res.status(response.status).json({
        error: data?.error?.message || "Gemini API error",
        geminiStatus: response.status,
        detail: data?.error,
      });
    }

    const candidate = data?.candidates?.[0];

    // Gemini blocked the response (safety, recitation, etc.)
    const finishReason = candidate?.finishReason;
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      console.warn("Gemini blocked:", finishReason);
      return res.status(200).json({ text: "", error: "Blocked: " + finishReason });
    }

    const text =
      candidate?.content?.parts
        ?.filter((p) => p.text)
        ?.map((p) => p.text)
        ?.join("") || "";

    if (!text) {
      console.warn("Gemini returned empty text. Full response:", JSON.stringify(data));
      return res.status(200).json({ text: "", error: "Empty response from Gemini" });
    }

    return res.status(200).json({ text });

  } catch (err) {
    console.error("Proxy fetch error:", err.message);
    return res.status(500).json({ error: "Proxy failed: " + err.message });
  }
}
