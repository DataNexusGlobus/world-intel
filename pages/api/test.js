export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  const start = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `Search the web: who is the current US president and what is Apple stock price today? Return JSON only, no markdown: {"president":"name","applePrice":"$XXX"}` }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.4 }
      })
    });
    const d = await r.json();
    const elapsed = Date.now() - start;
    const rawText = d?.candidates?.[0]?.content?.parts?.filter(p=>p.text)?.map(p=>p.text)?.join("") || "";
    const cleaned = rawText.replace(/^```(?:json)?\s*/i,"").replace(/\s*```\s*$/i,"").trim();
    let parsed = null;
    try { parsed = JSON.parse(cleaned); } catch { const m=cleaned.match(/\{[\s\S]*\}/); if(m) try{parsed=JSON.parse(m[0]);}catch{} }

    return res.status(200).json({
      model: "gemini-2.0-flash (1500 req/day free)",
      status: parsed ? "SUCCESS ✅" : "FAIL",
      elapsedMs: elapsed,
      finishReason: d?.candidates?.[0]?.finishReason,
      usedSearch: !!d?.candidates?.[0]?.groundingMetadata,
      outputTokens: d?.usageMetadata?.candidatesTokenCount,
      parsed,
      rawIfFailed: parsed ? undefined : cleaned.substring(0, 400),
      httpError: r.ok ? undefined : d?.error?.message,
    });
  } catch(e) {
    return res.status(200).json({ status: "FAIL", error: e.message });
  }
}
