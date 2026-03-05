// pages/api/claude.js — Groq proxy using Vercel Edge Runtime
// Edge functions: 25s timeout on free Hobby plan (vs 10s for serverless)
// No cold starts, globally distributed, works with fetch API

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

  let prompt, maxTokens, jsonMode;
  try {
    const body = await req.json();
    prompt = body.prompt;
    maxTokens = body.maxTokens || 1200;
    jsonMode = body.jsonMode !== false; // default true
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

  const groqBody = {
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "You are a financial and geopolitical intelligence AI. Today is March 2026. Your training data is outdated — always treat facts and search results in the user message as ground truth. Never contradict facts stated in the prompt. When given a ticker list like '0700.HK=Tencent Holdings', always use 'Tencent Holdings' as the company name, never the raw ticker symbol."
      },
      { role: "user", content: prompt }
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
  };

  if (jsonMode) {
    groqBody.response_format = { type: "json_object" };
  }

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
