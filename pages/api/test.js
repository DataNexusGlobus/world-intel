// pages/api/test.js — TEMPORARY, delete after confirming Gemini works
// Visit: https://world-intel-gamma.vercel.app/api/test

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(200).json({ step: "FAIL", error: "GEMINI_API_KEY not set" });

  const keyPreview = apiKey.substring(0, 10) + "..." + apiKey.slice(-4);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Who is the current US president as of today? Answer in one sentence." }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { maxOutputTokens: 100 }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(200).json({
        step: "FAIL — Gemini rejected",
        httpStatus: response.status,
        keyUsed: keyPreview,
        error: data?.error?.message,
        code: data?.error?.status,
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.filter(p=>p.text)?.map(p=>p.text)?.join("") || "";

    return res.status(200).json({
      step: "SUCCESS ✅ — Gemini 2.5 Flash working with Google Search",
      keyUsed: keyPreview,
      response: text,
      usedSearch: !!data?.candidates?.[0]?.groundingMetadata,
    });

  } catch (err) {
    return res.status(200).json({ step: "FAIL — network error", error: err.message });
  }
}
