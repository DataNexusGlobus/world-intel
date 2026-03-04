// pages/api/claude.js
// Groq proxy — free, no credit card, works in India
// Uses llama-3.3-70b-versatile — fast and accurate
// GROQ_API_KEY stored securely in Vercel env vars

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GROQ_API_KEY not set in Vercel Environment Variables",
    });
  }

  const { prompt, maxTokens = 2500, jsonMode = false } = req.body || {};

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  const url = "https://api.groq.com/openai/v1/chat/completions";

  const body = {
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    temperature: jsonMode ? 0.4 : 0.7,
  };

  // JSON mode — forces pure JSON output, no markdown
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Groq error:", JSON.stringify(data));
      return res.status(response.status).json({
        error: data?.error?.message || "Groq API error",
        groqStatus: response.status,
        detail: data?.error,
      });
    }

    const text = data?.choices?.[0]?.message?.content || "";

    if (!text) {
      console.warn("Groq returned empty response:", JSON.stringify(data));
      return res.status(200).json({ text: "", error: "Empty response from Groq" });
    }

    return res.status(200).json({ text });

  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: "Proxy failed: " + err.message });
  }
}
