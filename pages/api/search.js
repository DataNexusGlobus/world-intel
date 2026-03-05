// pages/api/search.js — Tavily Search proxy using Vercel Edge Runtime
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { "Content-Type": "application/json" }
    });
  }

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ results: [], error: "TAVILY_API_KEY not set" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  let query, maxResults;
  try {
    const body = await req.json();
    query = body.query;
    maxResults = body.maxResults || 5;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  if (!query) {
    return new Response(JSON.stringify({ error: "query required" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: maxResults,
        include_answer: true,
        include_raw_content: false,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({ results: [], error: data?.message || "Tavily error" }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    const summary = data.answer || "";
    const snippets = (data.results || []).map(r => ({
      title: r.title,
      snippet: r.content?.slice(0, 300),
      url: r.url,
    }));

    return new Response(JSON.stringify({ summary, results: snippets }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ results: [], error: err.message }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }
}
