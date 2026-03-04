// pages/api/test.js — TEMPORARY, delete after confirming everything works
// Visit: https://world-intel-gamma.vercel.app/api/test

export default async function handler(req, res) {
  const groqKey = process.env.GROQ_API_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const results = {};

  // Test Groq
  if (!groqKey) {
    results.groq = { status: "FAIL", error: "GROQ_API_KEY not set in Vercel" };
  } else {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "Say hello in one word" }], max_tokens: 5 }),
      });
      const d = await r.json();
      results.groq = r.ok
        ? { status: "SUCCESS ✅", response: d?.choices?.[0]?.message?.content }
        : { status: "FAIL ❌", error: d?.error?.message };
    } catch (e) {
      results.groq = { status: "FAIL ❌", error: e.message };
    }
  }

  // Test Finnhub — fetch AAPL price
  if (!finnhubKey) {
    results.finnhub = { status: "FAIL — FINNHUB_API_KEY not set in Vercel", fix: "Add FINNHUB_API_KEY to Vercel Environment Variables" };
  } else {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${finnhubKey}`);
      const d = await r.json();
      results.finnhub = r.ok && d.c > 0
        ? { status: "SUCCESS ✅", AAPL_price: `$${d.c}`, change: `${d.dp?.toFixed(2)}%` }
        : { status: "FAIL ❌", error: "Invalid response", data: d };
    } catch (e) {
      results.finnhub = { status: "FAIL ❌", error: e.message };
    }
  }

  return res.status(200).json({
    summary: `Groq: ${results.groq?.status} | Finnhub: ${results.finnhub?.status}`,
    ...results,
  });
}
