// pages/api/prices.js — Yahoo Finance real-time stock prices
// Supports ALL global exchanges: NSE India, LSE UK, TSX, TSE Japan, HKEX, etc.
// No API key needed. Free and unlimited (unofficial API).
// Graceful fallback: if Yahoo fails for any symbol, Groq estimate is kept.
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ prices: {} }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  let symbols = [];
  try {
    const body = await req.json();
    symbols = body.symbols || [];
  } catch {
    return new Response(JSON.stringify({ prices: {} }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!Array.isArray(symbols) || symbols.length === 0) {
    return new Response(JSON.stringify({ prices: {} }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch all symbols in parallel — cap at 35 (supports 30 asset symbols + 5 headroom)
  const results = {};
  await Promise.all(
    symbols.slice(0, 35).map(async (symbol) => {
      // Guard: must be a non-empty string — reject numbers, objects, null
      if (!symbol || typeof symbol !== 'string') return;
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;

        // 6s timeout per symbol — prevents one hanging fetch from blocking Edge's 25s limit
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);

        let res;
        try {
          res = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; WorldIntel/1.0)',
            },
          });
        } finally {
          clearTimeout(timer);
        }

        if (!res.ok) return; // silent fail — Groq price kept

        const data = await res.json();

        // Yahoo response structure — be liberal, handle multiple formats
        // path 1: result[0].meta
        // path 2: result[0].indicators.quote[0]
        const result = data?.chart?.result?.[0];
        if (!result) return;

        const meta = result.meta;
        if (!meta) return;

        // Current price — try multiple fields Yahoo might return
        // parseFloat on each — Yahoo occasionally returns strings instead of numbers
        const price = parseFloat(
          meta.regularMarketPrice ||       // most common
          meta.currentPrice ||             // sometimes used
          meta.postMarketPrice ||          // after hours
          meta.preMarketPrice ||           // pre market
          0
        ) || null;

        // Reject invalid prices: 0, negative, Infinity, NaN
        if (!price || price <= 0 || !isFinite(price)) return;

        // Previous close for change calculation — also parseFloat for safety
        const prevClose = parseFloat(
          meta.chartPreviousClose ||
          meta.previousClose ||
          meta.regularMarketPreviousClose ||
          0
        ) || null;

        // Change % — parseFloat on changePercent too (Yahoo sometimes returns string)
        let change1d_raw = 0;
        if (prevClose && prevClose > 0 && isFinite(prevClose)) {
          change1d_raw = parseFloat(((price - prevClose) / prevClose * 100).toFixed(2));
        } else if (meta.regularMarketChangePercent != null) {
          change1d_raw = parseFloat(parseFloat(meta.regularMarketChangePercent).toFixed(2));
        }

        results[symbol] = {
          price: parseFloat(price.toFixed(2)),
          change1d_raw,
          prevClose: prevClose || null,
          isReal: true,
        };

      } catch {
        // Silent fail per symbol — Groq price used as fallback
      }
    })
  );

  return new Response(JSON.stringify({ prices: results }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
