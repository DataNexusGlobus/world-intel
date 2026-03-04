// pages/api/claude.js
// Gemini 2.0 Flash proxy — replaces Anthropic.
// Supports web search (Google grounding) and JSON mode.
// GEMINI_API_KEY is stored securely in Vercel env vars — never exposed to browser.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY not set. Add it in Vercel Environment Variables.",
    });
  }

  const { prompt, maxTokens = 2500, useSearch = false, jsonMode = false } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  // Choose model — flash is fast and free
  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Build the request body
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.7,
    },
  };

  // Web search mode — enable Google Search grounding
  if (useSearch) {
    body.tools = [{ google_search: {} }];
  }

  // JSON mode — tell Gemini to respond with pure JSON only
  if (jsonMode) {
    body.generationConfig.responseMimeType = "application/json";
    body.generationConfig.temperature = 0.4; // lower temp for consistent JSON
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini error:", data);
      return res.status(response.status).json({
        error: data?.error?.message || "Gemini API error",
      });
    }

    // Extract text from Gemini response structure
    const candidate = data?.candidates?.[0];

    // Handle Gemini blocking response for safety/recitation
    const finishReason = candidate?.finishReason;
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      console.warn("Gemini blocked response, reason:", finishReason);
      return res.status(200).json({ text: "", error: `Gemini blocked: ${finishReason}` });
    }

    const text =
      candidate?.content?.parts
        ?.filter((p) => p.text)
        ?.map((p) => p.text)
        ?.join("") || "";

    if (!text) {
      return res.status(200).json({ text: "", error: "Empty response from Gemini" });
    }

    return res.status(200).json({ text });

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy request failed", detail: err.message });
  }
}
