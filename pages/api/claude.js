// pages/api/claude.js — Groq proxy (works in India, free, no credit card)
// Gemini free tier has limit:0 in India — blocked at regional level

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GROQ_API_KEY not set" });

  const { prompt, maxTokens = 2000 } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Groq API error",
        groqStatus: response.status,
      });
    }

    const text = data?.choices?.[0]?.message?.content || "";
    if (!text) return res.status(200).json({ text: "", error: "Empty response" });

    return res.status(200).json({ text });

  } catch (err) {
    return res.status(500).json({ error: "Proxy failed: " + err.message });
  }
}
