// pages/api/test.js — tests both Groq and Tavily
// Delete after confirming both work

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
    const text = d?.choices?.[0]?.message?.content || "";
    results.groq = {
      status: r.ok ? "SUCCESS ✅" : "FAIL ❌",
      elapsedMs: Date.now() - start,
      response: text,
      error: r.ok ? undefined : d?.error?.message,
    };
  } catch(e) { results.groq = { status: "FAIL ❌", error: e.message }; }

  // Test 2: Tavily
  if (!tavilyKey) {
    results.tavily = { status: "NOT SET ⚠️", message: "Add TAVILY_API_KEY to Vercel env vars. Get free key at tavily.com" };
  } else {
    try {
      const start = Date.now();
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: tavilyKey, query: "US president 2026", max_results: 2, include_answer: true })
      });
      const d = await r.json();
      results.tavily = {
        status: r.ok ? "SUCCESS ✅" : "FAIL ❌",
        elapsedMs: Date.now() - start,
        answer: d.answer || "",
        resultsCount: d.results?.length || 0,
        error: r.ok ? undefined : d?.message,
      };
    } catch(e) { results.tavily = { status: "FAIL ❌", error: e.message }; }
  }

  const allGood = results.groq?.status?.includes("SUCCESS") && results.tavily?.status?.includes("SUCCESS");
  return res.status(200).json({
    summary: allGood ? "Groq ✅ + Tavily ✅ — Live data pipeline fully working!" : "Check individual results below",
    ...results
  });
}
