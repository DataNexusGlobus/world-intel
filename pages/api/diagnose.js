// pages/api/diagnose.js — shows exactly what Groq returns for a real tab call
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const apiKey = process.env.GROQ_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;
  const results = {};

  // Step 1: Tavily search
  let searchContext = "";
  try {
    const t1 = Date.now();
    const tr = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: tavilyKey, query: "USA stock market S&P500 today", max_results: 3, include_answer: true })
    });
    const td = await tr.json();
    searchContext = (td.answer || "") + " " + (td.results||[]).map(r=>r.content?.slice(0,200)).join(" ");
    results.tavily = { ok: tr.ok, ms: Date.now()-t1, contextLength: searchContext.length };
  } catch(e) { results.tavily = { error: e.message }; }

  // Step 2: Groq with a simple markets prompt (same as real tab)
  try {
    const t2 = Date.now();
    const gr = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "You are a financial AI. Respond with valid JSON only." },
          { role: "user", content: `Today March 2026. Market data for USA NYSE.
SEARCH: ${searchContext.slice(0,400)}
Tickers→names: AAPL → name is "Apple Inc", MSFT → name is "Microsoft"
Return JSON, no markdown:
{"stocks":[{"rank":1,"symbol":"AAPL","name":"Apple Inc","sector":"Technology","price":"$230","change1d":"+0.5%","change1d_raw":0.5,"signal":"BUY","signalStrength":75}]}` }
        ],
        max_tokens: 400,
        temperature: 0.3,
      })
    });
    const gd = await gr.json();
    const raw = gd?.choices?.[0]?.message?.content || "";
    results.groq = {
      ok: gr.ok,
      ms: Date.now()-t2,
      status: gr.status,
      rawResponse: raw,
      rawLength: raw.length,
      startsWithBrace: raw.trim().startsWith('{'),
      startsWithBracket: raw.trim().startsWith('['),
      error: gd?.error?.message,
    };
    // Try parsing
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i,"").replace(/\s*```\s*$/i,"").trim());
      results.groq.parsedOk = true;
      results.groq.stockName = parsed?.stocks?.[0]?.name;
    } catch(pe) {
      results.groq.parsedOk = false;
      results.groq.parseError = pe.message;
    }
  } catch(e) { results.groq = { error: e.message }; }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}
