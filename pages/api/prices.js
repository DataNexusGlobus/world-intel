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

  // Fetch all symbols in parallel — Yahoo handles concurrent requests fine
  const results = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      if (!symbol) return;
      try {
        // Yahoo Finance chart API — works for all global exchanges
        // Symbol format is same as what we already use:
        // RELIANCE.NS, TCS.NS, HSBA.L, 0700.HK, 7203.T etc — Yahoo accepts all of these directly
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;

        const res = await fetch(url, {
          headers: {
            // Yahoo sometimes blocks requests without a user agent
            'User-Agent': 'Mozilla/5.0 (compatible; WorldIntel/1.0)',
          },
        });

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

        if (!price || price <= 0) return;

        // Previous close for change calculation — also parseFloat for safety
        const prevClose = parseFloat(
          meta.chartPreviousClose ||
          meta.previousClose ||
          meta.regularMarketPreviousClose ||
          0
        ) || null;

        // Change % — calculate ourselves or use Yahoo's value
        let change1d_raw = 0;
        if (prevClose && prevClose > 0) {
          change1d_raw = parseFloat(((price - prevClose) / prevClose * 100).toFixed(2));
        } else if (meta.regularMarketChangePercent != null) {
          change1d_raw = parseFloat(meta.regularMarketChangePercent.toFixed(2));
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
