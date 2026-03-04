// pages/api/test.js — TEMPORARY, delete after confirming Groq works
// Visit: https://world-intel-gamma.vercel.app/api/test

export default async function handler(req, res) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return res.status(200).json({
      step: "FAIL — GROQ_API_KEY not set in Vercel",
      fix: "Vercel → Settings → Environment Variables → add GROQ_API_KEY"
    });
  }

  const keyPreview = apiKey.substring(0, 8) + "..." + apiKey.slice(-4);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: "Say hello in one word" }],
        max_tokens: 10,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(200).json({
        step: "FAIL — Groq rejected the request",
        httpStatus: response.status,
        keyUsed: keyPreview,
        groqError: data?.error?.message,
        fullResponse: data,
      });
    }

    const text = data?.choices?.[0]?.message?.content || "";

    return res.status(200).json({
      step: "SUCCESS — Groq is working!",
      keyUsed: keyPreview,
      groqResponse: text,
      message: "Live data will now work on your website."
    });

  } catch (err) {
    return res.status(200).json({
      step: "FAIL — network error",
      keyUsed: keyPreview,
      error: err.message,
    });
  }
}
