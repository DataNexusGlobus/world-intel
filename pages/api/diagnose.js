export const config = { runtime: 'edge' };

export default async function handler(req) {
  const base = new URL(req.url).origin;
  const results = {};

  // Step 1: Call /api/search exactly like the frontend does
  let searchText = "";
  try {
    const t1 = Date.now();
    const sr = await fetch(`${base}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "S&P 500 USA stocks today", maxResults: 3 })
    });
    const sd = await sr.json();
    searchText = sd.summary || "";
    results.search = { ok: sr.ok, ms: Date.now()-t1, summary: searchText.slice(0,100) };
  } catch(e) { results.search = { error: e.message }; }

  // Step 2: Call /api/claude exactly like callClaudeJSON does
  try {
    const t2 = Date.now();
    const prompt = `Today March 2026. Market data for USA NYSE (S&P 500).
SEARCH: ${searchText.slice(0,400)}
Tickers→names: AAPL → name is "Apple Inc", MSFT → name is "Microsoft Corp", NVDA → name is "NVIDIA Corp", AMZN → name is "Amazon.com", JPM → name is "JPMorgan Chase"
Return JSON, no markdown:
{"stocks":[{"rank":1,"symbol":"AAPL","name":"Apple Inc","sector":"Technology","price":"$230.00","change1d":"+0.5%","change1d_raw":0.5,"change1w":"+1.2%","change1w_raw":1.2,"change1m":"+3.1%","change1m_raw":3.1,"volume":"55M","marketCap":"$3.5T","pe":"30.2","signal":"BUY","signalStrength":78,"shortTerm":"BULLISH","longTerm":"BULLISH","targetPrice":"$260","upside":"+13%","riskLevel":"LOW","whyNow":"reason","catalyst":"catalyst","trend":"up"}]}`;

    const cr = await fetch(`${base}/api/claude`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, maxTokens: 1000, jsonMode: false })
    });
    const cd = await cr.json();
    const raw = cd.text || "";

    // Simulate _extractJSON like the frontend does
    let parsed = null;
    let parseError = "";
    try {
      // Find outermost { }
      let depth=0,start=-1,inStr=false,esc=false;
      for(let i=0;i<raw.length;i++){
        const ch=raw[i];
        if(esc){esc=false;continue;}
        if(ch==="\\" && inStr){esc=true;continue;}
        if(ch==='"'){inStr=!inStr;continue;}
        if(inStr)continue;
        if(ch==='{'){if(depth===0)start=i;depth++;}
        else if(ch==='}'){depth--;if(depth===0&&start!==-1){try{parsed=JSON.parse(raw.slice(start,i+1));}catch{}break;}}
      }
    } catch(e){ parseError = e.message; }

    results.claude = {
      ok: cr.ok,
      ms: Date.now()-t2,
      rawLength: raw.length,
      rawFirst100: raw.slice(0,100),
      rawLast50: raw.slice(-50),
      parsedOk: !!parsed,
      hasStocks: !!(parsed?.stocks),
      stocksLength: parsed?.stocks?.length,
      firstStockName: parsed?.stocks?.[0]?.name,
      firstStockSymbol: parsed?.stocks?.[0]?.symbol,
      parseError,
      error: cd.error,
    };
  } catch(e) { results.claude = { error: e.message }; }

  results.totalMs = (results.search?.ms||0) + (results.claude?.ms||0);
  results.verdict = results.claude?.parsedOk && results.claude?.hasStocks
    ? "SHOULD SHOW LIVE DATA ✅"
    : "WILL SHOW ESTIMATED DATA ❌ — see claude result for why";

  return new Response(JSON.stringify(results, null, 2), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}
