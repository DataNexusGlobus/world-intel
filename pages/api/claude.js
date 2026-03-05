// pages/api/claude.js — Groq proxy
export const config = { maxDuration: 30 }; // extend Vercel timeout to 30s

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GROQ_API_KEY not set" });

  const { prompt, maxTokens = 1500, jsonMode = true } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  const body = {
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "You are a financial and geopolitical intelligence AI. Today is March 2026. Your training data is outdated — always treat facts and search results in the user message as ground truth. Never contradict facts stated in the prompt. When given a list like '0700.HK=Tencent Holdings', always use 'Tencent Holdings' as the company name, never the ticker symbol."
      },
      { role: "user", content: prompt }
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
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

    const cleaned = text.replace(/^```(?:json)?\s*/i,"").replace(/\s*```\s*$/i,"").trim();
    return res.status(200).json({ text: cleaned });

  } catch (err) {
    return res.status(500).json({ error: "Proxy failed: " + err.message });
  }
}
