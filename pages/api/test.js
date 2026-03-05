export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  // Test exactly what fetchMarkets sends for China
  const prompt = `Search the web for current stock prices and market data for China's Shanghai/Hong Kong exchange as of today.
Use ONLY these tickers and their exact company names: 0700.HK=Tencent Holdings,9988.HK=Alibaba Group,002594.SZ=BYD Company,601318.SS=Ping An Insurance,600519.SS=Kweichow Moutai

Return a JSON object with key "stocks" containing array of 5 items with real current data:
{"stocks":[{"rank":1,"symbol":"TICKER","name":"Full Company Name from list","sector":"sector","price":"HK$REAL_CURRENT_PRICE","change1d":"+0.85%","change1d_raw":0.85,"change1w":"+2.1%","change1w_raw":2.1,"change1m":"+5.2%","change1m_raw":5.2,"volume":"12M","marketCap":"HK$VALUE","pe":"28.5","signal":"BUY","signalStrength":78,"shortTerm":"BULLISH","longTerm":"BULLISH","targetPrice":"HK$VALUE","upside":"+12%","riskLevel":"LOW","whyNow":"current reason based on real news","catalyst":"real recent event","trend":"up"}]}
Use real searched prices. signalStrength must be integer 55-92. Return only JSON, no markdown.`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { maxOutputTokens: 2000, temperature: 0.4 }
      })
    });
    const d = await r.json();
    const rawText = d?.candidates?.[0]?.content?.parts?.filter(p=>p.text)?.map(p=>p.text)?.join("") || "";
    
    // Try parsing like our frontend does
    function extractJSON(t, open, close) {
      let depth=0,start=-1,inStr=false;
      for(let i=0;i<t.length;i++){
        const ch=t[i];
        if(ch==='"'&&t[i-1]!=='\\'){inStr=!inStr;continue;}
        if(inStr)continue;
        if(ch===open){if(depth===0)start=i;depth++;}
        else if(ch===close){depth--;if(depth===0&&start!==-1){try{return JSON.parse(t.slice(start,i+1));}catch(e){start=-1;depth=0;}}}
      }
      return null;
    }
    
    const parsed = extractJSON(rawText, '{', '}');
    
    return res.status(200).json({
      httpStatus: r.status,
      rawTextFirst500: rawText.substring(0, 500),
      rawTextLength: rawText.length,
      hasJsonFence: rawText.includes('```json'),
      hasCurlyBrace: rawText.includes('{'),
      parsedSuccessfully: !!parsed,
      parsedKeys: parsed ? Object.keys(parsed) : null,
      stocksCount: parsed?.stocks?.length || 0,
      firstStockName: parsed?.stocks?.[0]?.name || "MISSING",
      finishReason: d?.candidates?.[0]?.finishReason,
      usedSearch: !!d?.candidates?.[0]?.groundingMetadata,
      tokenUsage: d?.usageMetadata,
    });
  } catch(e) {
    return res.status(200).json({ error: e.message });
  }
}
