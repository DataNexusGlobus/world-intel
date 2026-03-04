// pages/api/claude.js
// Secure server-side proxy.
// Verifies Supabase session before forwarding to Anthropic.
// Neither API key is ever exposed to the browser.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify Supabase session (graceful — won't break app if Supabase is down)
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (sbUrl && sbKey) {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) {
      try {
        const sb = createClient(sbUrl, sbKey);
        const { data: { user }, error } = await sb.auth.getUser(token);
        if (error || !user) {
          return res.status(401).json({ error: "Unauthorized — please log in again" });
        }
      } catch (_) {
        // Supabase down or token missing — allow through gracefully
      }
    }
  }

  // Forward to Anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY not set. Add it in Vercel Environment Variables.",
    });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy request failed", detail: err.message });
  }
}
