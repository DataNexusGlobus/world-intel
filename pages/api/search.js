// pages/api/search.js — Tavily Search proxy
// Free 1000 searches/month, works in India, no card needed
// Sign up at tavily.com to get TAVILY_API_KEY

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return res.status(200).json({ results: [], error: "TAVILY_API_KEY not set" });

  const { query, maxResults = 5 } = req.body || {};
  if (!query) return res.status(400).json({ error: "query required" });

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",   // basic = faster, advanced = more thorough
        max_results: maxResults,
        include_answer: true,    // Tavily generates a direct answer summary
        include_raw_content: false,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Tavily error:", response.status, data);
      return res.status(200).json({ results: [], error: data?.message || "Tavily error" });
    }

    // Return clean summary + top result snippets
    const summary = data.answer || "";
    const snippets = (data.results || []).map(r => ({
      title: r.title,
      snippet: r.content?.slice(0, 300),
      url: r.url,
      score: r.score,
    }));

    return res.status(200).json({ summary, results: snippets });

  } catch (err) {
    console.error("Search proxy error:", err.message);
    return res.status(200).json({ results: [], error: err.message });
  }
}
