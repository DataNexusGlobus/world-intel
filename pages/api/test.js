// pages/api/test.js
// TEMPORARY test endpoint — delete after debugging
// Visit: https://world-intel-gamma.vercel.app/api/test

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;

  // Step 1: Check env var exists
  if (!apiKey) {
    return res.status(200).json({
      step: "FAIL at step 1",
      error: "GEMINI_API_KEY is not set in Vercel environment variables",
      fix: "Go to Vercel → Settings → Environment Variables → add GEMINI_API_KEY"
    });
  }

  // Step 2: Show key prefix (safe — only first 8 chars)
  const keyPreview = apiKey.substring(0, 8) + "..." + apiKey.slice(-4);

  // Step 3: Try simplest possible Gemini call — no tools, no JSON mode
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Say hello in one word" }] }],
        generationConfig: { maxOutputTokens: 10 }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(200).json({
        step: "FAIL at step 3 — Gemini rejected the request",
        httpStatus: response.status,
        keyUsed: keyPreview,
        geminiError: data?.error?.message,
        geminiCode: data?.error?.code,
        geminiStatus: data?.error?.status,
        fullResponse: data
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return res.status(200).json({
      step: "SUCCESS",
      keyUsed: keyPreview,
      geminiResponse: text,
      message: "Gemini is working! The problem is elsewhere."
    });

  } catch (err) {
    return res.status(200).json({
      step: "FAIL at step 3 — network error",
      keyUsed: keyPreview,
      error: err.message
    });
  }
}
