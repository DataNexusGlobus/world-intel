export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const prompt = `Search the web for current stock prices for China's Hong Kong market today.
Use ONLY: 0700.HK=Tencent Holdings, 9988.HK=Alibaba Group, 002594.SZ=BYD Company
Return JSON only, no markdown: {"stocks":[{"symbol":"0700.HK","name":"Tencent Holdings","price":"HK$507","change1d":"-0.4%","change1d_raw":-0.4,"signal":"BUY","signalStrength":72}]}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { maxOutputTokens: 8000, temperature: 0.4 }
      })
    });
    const d = await r.json();

    const parts = d?.candidates?.[0]?.content?.parts || [];
    const thoughtParts = parts.filter(p => p.thought).length;
    const textParts = parts.filter(p => p.text && !p.thought);
    const rawText = textParts.map(p => p.text).join("");
    const cleaned = rawText.replace(/^```(?:json)?\s*/i,"").replace(/\s*```\s*$/i,"").trim();

    // Try parse
    let parsed = null;
    try { parsed = JSON.parse(cleaned); } catch {
      // find { }
      const m = cleaned.match(/\{[\s\S]*\}/);
      if(m) try { parsed = JSON.parse(m[0]); } catch {}
    }

    return res.status(200).json({
      finishReason: d?.candidates?.[0]?.finishReason,
      thoughtParts,
      textPartsCount: textParts.length,
      rawLength: rawText.length,
      cleanedFirst300: cleaned.substring(0, 300),
      parsedOk: !!parsed,
      stocksCount: parsed?.stocks?.length || 0,
      firstStock: parsed?.stocks?.[0] || null,
      thinking: d?.usageMetadata?.thoughtsTokenCount,
      outputTokens: d?.usageMetadata?.candidatesTokenCount,
    });
  } catch(e) {
    return res.status(200).json({ error: e.message });
  }
}
