export default async function handler(req, res) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(200).json({ status: "FAIL", error: "GROQ_API_KEY not set" });

  const start = Date.now();
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: `Who is the US president in 2026 and what is today's date? Return JSON only: {"president":"name","date":"date"}` }],
        max_tokens: 100,
        response_format: { type: "json_object" }
      })
    });
    const d = await r.json();
    const text = d?.choices?.[0]?.message?.content || "";
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return res.status(200).json({
      status: parsed ? "SUCCESS ✅ Groq working" : "FAIL — parse error",
      elapsedMs: Date.now() - start,
      parsed,
      groqError: r.ok ? undefined : d?.error?.message,
    });
  } catch(e) {
    return res.status(200).json({ status: "FAIL", error: e.message });
  }
}
