// pages/api/test.js — deep diagnostic
export default async function handler(req, res) {
  const groqKey = process.env.GROQ_API_KEY;
  const results = {};

  // Test 1: Basic call
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {"Content-Type":"application/json","Authorization":`Bearer ${groqKey}`},
      body: JSON.stringify({model:"llama-3.3-70b-versatile",messages:[{role:"user",content:"Who is the current US president as of March 2026?"}],max_tokens:50}),
    });
    const d = await r.json();
    results.basicTest = {
      status: r.status,
      ok: r.ok,
      response: d?.choices?.[0]?.message?.content,
      error: d?.error?.message,
      tokensUsed: d?.usage?.total_tokens
    };
  } catch(e){ results.basicTest = {error: e.message}; }

  // Test 2: JSON mode with small prompt
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {"Content-Type":"application/json","Authorization":`Bearer ${groqKey}`},
      body: JSON.stringify({model:"llama-3.3-70b-versatile",messages:[{role:"user",content:'Return JSON: {"country":"India","gdpGrowth":"7.1%","president":"Narendra Modi"}'}],max_tokens:100,response_format:{type:"json_object"}}),
    });
    const d = await r.json();
    results.jsonTest = {
      status: r.status,
      ok: r.ok,
      response: d?.choices?.[0]?.message?.content,
      error: d?.error?.message,
      tokensUsed: d?.usage?.total_tokens
    };
  } catch(e){ results.jsonTest = {error: e.message}; }

  // Test 3: Rate limit headers
  results.rateInfo = {
    groqKeyPrefix: groqKey ? groqKey.substring(0,12)+"..." : "NOT SET",
    timestamp: new Date().toISOString()
  };

  return res.status(200).json(results);
}
