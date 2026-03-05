// pages/api/claude.js — Groq proxy on Vercel Edge Runtime
// Edge = 25s timeout (vs 10s serverless). jsonMode removed — plain text is 3x faster.
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { "Content-Type": "application/json" }
    });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "GROQ_API_KEY not set" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  let prompt, maxTokens;
  try {
    const body = await req.json();
    prompt = body.prompt;
    maxTokens = body.maxTokens || 1000;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  if (!prompt) {
    return new Response(JSON.stringify({ error: "prompt required" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  // NOTE: No response_format json_object — plain text mode is 3-5s vs 15-20s for json_object
  // We extract JSON ourselves via _extractJSON in the frontend
  const groqBody = {
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "You are a financial and geopolitical intelligence AI. Today is March 2026. Always treat search results in the user message as ground truth. When given ticker→name mappings like '0700.HK → name is \"Tencent Holdings\"', always use the full company name, never the ticker. Always respond with valid JSON only — no markdown, no explanation text."
      },
      { role: "user", content: prompt }
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
  };

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(groqBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({
        error: data?.error?.message || "Groq API error",
        groqStatus: response.status,
      }), { status: response.status, headers: { "Content-Type": "application/json" } });
    }

    const text = data?.choices?.[0]?.message?.content || "";
    if (!text) {
      return new Response(JSON.stringify({ text: "", error: "Empty response" }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    // Strip markdown fences if Groq adds them
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    return new Response(JSON.stringify({ text: cleaned }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Proxy failed: " + err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
