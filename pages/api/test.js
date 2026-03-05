export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const start = Date.now();

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `Search the web: who is the current US president and what is Apple's stock price today? Return JSON only: {"president":"name","applePrice":"$XXX"}` }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } }
      })
    });
    const d = await r.json();
    const elapsed = Date.now() - start;
    const rawText = d?.candidates?.[0]?.content?.parts?.filter(p=>p.text)?.map(p=>p.text)?.join("") || "";
    const cleaned = rawText.replace(/^```(?:json)?\s*/i,"").replace(/\s*```\s*$/i,"").trim();
    let parsed = null;
    try { parsed = JSON.parse(cleaned); } catch { const m=cleaned.match(/\{[\s\S]*\}/); if(m) try{parsed=JSON.parse(m[0]);}catch{} }

    return res.status(200).json({
      status: parsed ? "SUCCESS ✅" : "PARTIAL — response received but JSON parse failed",
      elapsedMs: elapsed,
      finishReason: d?.candidates?.[0]?.finishReason,
      thinkingTokens: d?.usageMetadata?.thoughtsTokenCount || 0,
      outputTokens: d?.usageMetadata?.candidatesTokenCount,
      usedSearch: !!d?.candidates?.[0]?.groundingMetadata,
      parsed,
      rawIfFailed: parsed ? undefined : cleaned.substring(0,300),
    });
  } catch(e) {
    return res.status(200).json({ status: "FAIL", error: e.message, elapsed: Date.now()-start });
  }
}
