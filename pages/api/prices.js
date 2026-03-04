// pages/api/prices.js
// Finnhub real-time stock price proxy — free tier, no credit card
// Called AFTER Groq returns stock symbols, to enrich with real prices
// FINNHUB_API_KEY stored securely in Vercel env vars

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    // Graceful degradation — if no key, return empty so Groq prices are used
    return res.status(200).json({ prices: {}, error: "FINNHUB_API_KEY not set" });
  }

  const { symbols } = req.body || {};
  if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
    return res.status(200).json({ prices: {} });
  }

  // Fetch all symbols in parallel — Finnhub free: 60 req/min, plenty
  const results = {};

  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        // Finnhub uses different symbol formats for global stocks
        // NSE India: RELIANCE.NS → need to map
        const finnhubSymbol = mapSymbol(symbol);
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${apiKey}`;

        const response = await fetch(url);
        if (!response.ok) return;

        const data = await response.json();

        // Finnhub returns: c=current, h=high, l=low, o=open, pc=prev close, dp=change%
        if (data && data.c && data.c > 0) {
          results[symbol] = {
            price: data.c,
            change1d_raw: data.dp || 0,
            high: data.h,
            low: data.l,
            prevClose: data.pc,
            isReal: true,
          };
        }
      } catch (err) {
        // Silent fail per symbol — Groq price used as fallback
        console.warn(`Price fetch failed for ${symbol}:`, err.message);
      }
    })
  );

  return res.status(200).json({ prices: results });
}

// Map ticker symbols to Finnhub format
function mapSymbol(symbol) {
  if (!symbol) return symbol;

  // Indian NSE stocks: RELIANCE.NS → NSE:RELIANCE
  if (symbol.endsWith(".NS")) return "NSE:" + symbol.replace(".NS", "");
  // Indian BSE stocks: RELIANCE.BO → BSE:RELIANCE
  if (symbol.endsWith(".BO")) return "BSE:" + symbol.replace(".BO", "");
  // London: BP.L → LSE:BP
  if (symbol.endsWith(".L")) return "LSE:" + symbol.replace(".L", "");
  // Tokyo: 7203.T → TYO:7203
  if (symbol.endsWith(".T")) return "TYO:" + symbol.replace(".T", "");
  // Hong Kong: 9988.HK → HKEX:9988
  if (symbol.endsWith(".HK")) return "HKEX:" + symbol.replace(".HK", "");
  // Germany XETRA: SAP.DE → XETRA:SAP
  if (symbol.endsWith(".DE")) return "XETRA:" + symbol.replace(".DE", "");
  // Korea: 005930.KS → KRX:005930
  if (symbol.endsWith(".KS")) return "KRX:" + symbol.replace(".KS", "");
  // Australia: BHP.AX → ASX:BHP
  if (symbol.endsWith(".AX")) return "ASX:" + symbol.replace(".AX", "");
  // Brazil: PETR4.SA → BOVESPA:PETR4
  if (symbol.endsWith(".SA")) return "BOVESPA:" + symbol.replace(".SA", "");
  // Paris: MC.PA → EPA:MC
  if (symbol.endsWith(".PA")) return "EPA:" + symbol.replace(".PA", "");
  // Canada: SHOP.TO → TSX:SHOP
  if (symbol.endsWith(".TO")) return "TSX:" + symbol.replace(".TO", "");
  // Dubai: EMAAR.DU → DFM:EMAAR
  if (symbol.endsWith(".DU")) return "DFM:" + symbol.replace(".DU", "");
  // Abu Dhabi: FAB.AD → ADX:FAB
  if (symbol.endsWith(".AD")) return "ADX:" + symbol.replace(".AD", "");
  // Saudi: 2222.SR → TADAWUL:2222
  if (symbol.endsWith(".SR")) return "TADAWUL:" + symbol.replace(".SR", "");
  // Shanghai: 601398.SS → SHANGHAI:601398
  if (symbol.endsWith(".SS")) return "SHANGHAI:" + symbol.replace(".SS", "");
  // Shenzhen: 002594.SZ → SHENZHEN:002594
  if (symbol.endsWith(".SZ")) return "SHENZHEN:" + symbol.replace(".SZ", "");

  // US stocks — use as-is (AAPL, MSFT, NVDA etc.)
  return symbol;
}
