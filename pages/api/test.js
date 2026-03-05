export default async function handler(req, res) {
  const groqKey = process.env.GROQ_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;
  const results = {};

  // Test 1: Groq
  try {
    const start = Date.now();
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: `Return JSON only: {"status":"working","model":"llama-3.3-70b"}` }],
        max_tokens: 50,
        response_format: { type: "json_object" }
      })
    });
    const d = await r.json();
    results.groq = {
      status: r.ok ? "SUCCESS ✅" : "FAIL ❌",
      elapsedMs: Date.now() - start,
      error: r.ok ? undefined : d?.error?.message,
    };
  } catch(e) { results.groq = { status: "FAIL ❌", error: e.message }; }

  // Test 2: Tavily — use specific factual query to avoid misinformation
  if (!tavilyKey) {
    results.tavily = { status: "NOT SET ⚠️", message: "Add TAVILY_API_KEY to Vercel env vars" };
  } else {
    try {
      const start = Date.now();
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: "S&P 500 index price today March 2026",
          max_results: 2,
          include_answer: true
        })
      });
      const d = await r.json();
      results.tavily = {
        status: r.ok ? "SUCCESS ✅" : "FAIL ❌",
        elapsedMs: Date.now() - start,
        answer: d.answer || "",
        resultsCount: d.results?.length || 0,
        note: "Tavily is used for stock prices & news only — political facts come from WF context block",
        error: r.ok ? undefined : d?.message,
      };
    } catch(e) { results.tavily = { status: "FAIL ❌", error: e.message }; }
  }

  const allGood = results.groq?.status?.includes("SUCCESS") && results.tavily?.status?.includes("SUCCESS");
  return res.status(200).json({
    summary: allGood ? "Groq ✅ + Tavily ✅ — pipeline working!" : "Check results below",
    ...results
  });
}
