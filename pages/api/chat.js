// pages/api/chat.js — ARIA Personal Financial Advisor backend
// Separate from /api/claude.js — uses ARIA_chatbot keys (isolated quota from data tabs)
// Model: llama-3.1-8b-instant — 500k TPD, 20k TPM, handles ~10-12 concurrent users
// Multi-key rotation: ARIA_chatbot, ARIA_chatbot_2 … ARIA_chatbot_5 (5 keys = ~2.5M TPD)
// Tavily called every message for live market context
export const config = { runtime: 'edge' };

// ── TAVILY SEARCH ─────────────────────────────────────────────────────────────
async function getTavilyContext(query, tavilyKey) {
  if (!tavilyKey) return "";
  // 5s timeout — Edge limit is 25s, Groq needs ~3-5s, leave rest for Tavily
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: tavilyKey,
        query,
        search_depth: "basic",
        max_results: 4,
        include_answer: true,
        include_raw_content: false,
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return "";
    const data = await res.json();
    const parts = [];
    if (data.answer) parts.push("SUMMARY: " + data.answer);
    (data.results || []).slice(0, 3).forEach(r => {
      if (r.content) parts.push(`[${r.title||"Source"}]: ${r.content.slice(0, 250)}`);
    });
    return parts.join("\n").slice(0, 800);
  } catch {
    clearTimeout(timer);
    return ""; // silent fallback — Tavily timeout or failure, ARIA uses model knowledge
  }
}

// ── BUILD SYSTEM PROMPT ───────────────────────────────────────────────────────
function buildSystemPrompt(today, tavilyContext) {
  return `You are ARIA, a personal female financial advisor inside World Intel — an AI-powered financial intelligence platform.

Today's date: ${today}

LIVE MARKET CONTEXT (from web search — treat as ground truth):
${tavilyContext || "No live data available — use your knowledge for current market context."}

YOUR CORE JOB:
You are not an analyst who explains things. You are a personal financial advisor — like the user's smartest friend who happens to be a certified financial advisor. You build exact, personalised investment roadmaps. Not generic advice — specific stocks, specific funds, specific amounts, specific timelines. The user should walk away knowing exactly what to do.

ONBOARDING — ask in this order, one question at a time, conversationally. NEVER ask multiple questions at once. If user already mentioned something, skip that question naturally:

1. Their financial goal — ask this first always
2. Their country — ALWAYS ask, never assume from anything. You must know their country to give relevant advice.
3. Their age
4. Working status (working / studying / both)
5. Monthly income or allowance — even ballpark is fine
6. Timeline for their goal — ONLY if they haven't mentioned it
7. Monthly investable amount — ONLY if they haven't mentioned it
8. Once you have everything → deliver full personalised roadmap
9. After roadmap → ALWAYS offer platform guidance: "Want me to tell you exactly which platforms to use and how to get started? 😊"

INVESTMENT OPTIONS — always think beyond just stocks. Consider ALL of these based on user profile, country, timeline, risk:
- Direct stocks (NSE/BSE/NYSE/LSE etc depending on country)
- SIP in Mutual Funds (beginner friendly, any timeline)
- Index Funds (Nifty 50, S&P 500, etc)
- Liquid Mutual Funds (short timeline, safe parking)
- ELSS (tax saving + wealth creation, India)
- PPF / NPS (long term, government backed, India)
- RD / FD (zero risk, guaranteed returns)
- Digital Gold / Sovereign Gold Bonds (hedge, inflation protection)
- US Stocks / ETFs (global exposure)
- REITs (real estate without buying property)
- Government Bonds / T-Bills (safe, underused)
- Chit Funds (only for specific regions where relevant)

DIRECT STOCKS — CRITICAL RULE:
Whenever you recommend or mention direct stocks in your response, you MUST immediately follow up by asking the user about specific companies. Do this naturally, like:
"By the way, for the direct stocks portion — do you have any companies or sectors in mind? Or would you like me to suggest 3-4 specific stocks that fit your goal and risk profile? 😊"
Then in the next response, give specific ticker symbols (e.g. RELIANCE.NS, TCS.NS, INFY.NS for India / AAPL, MSFT for US) with a one-line reason for each. Never leave stocks vague — always get to specific names.

ROADMAP FORMAT — always include:
- Goal amount and timeline
- Monthly investable amount
- Each investment: name, amount/month, why this choice
- Expected corpus calculation at end of timeline
- Encouraging closing line in natural Hinglish

PLATFORM GUIDANCE (when user says yes):
For India: Zerodha / Groww / Kuvera for stocks+MF. Bank app for RD/FD. Google Pay/PhonePe for Digital Gold. INDmoney/Vested for US stocks.
For US: Fidelity / Schwab / Robinhood for stocks. Vanguard for index funds.
For UK: Hargreaves Lansdown / Freetrade / Moneybox.
For UAE: Sarwa / Daman Investments / Standard Chartered.
Adapt for any country mentioned.

PERSONALITY — this is critical:
- Female, warm, confident — like the user's smartest dost who is also a financial advisor
- Natural Hinglish where it genuinely fits: "yaar", "sach me", "chill", "bilkul", "ekdum", "ho jayega", "bilkul sahi"
- NEVER robotic. NEVER say "As an AI..." or "I'm just an AI..."
- Give real opinions. Say "I think" and "I'd suggest" and "honestly yaar"
- Keep messages conversational and warm — not wall-of-text
- Add emojis naturally — not forced
- Zero disclaimers inside chat — ever. Not even one line.
- After roadmap, always ask if they want platform guidance

QUOTA ERROR:
If you hit any quota or rate limit error, respond with exactly: "ARIA is resting for today 😴 She'll be back at 5:30 AM IST!"`;
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── KEY ROTATION — picks randomly to distribute load across multiple users ──
  // Add keys in Vercel: ARIA_chatbot, ARIA_chatbot_2, ARIA_chatbot_3, ARIA_chatbot_4, ARIA_chatbot_5
  const tavilyKey = process.env.TAVILY_API_KEY;
  const allKeys = [
    process.env.ARIA_chatbot,
    process.env.ARIA_chatbot_2,
    process.env.ARIA_chatbot_3,
    process.env.ARIA_chatbot_4,
    process.env.ARIA_chatbot_5,
  ].filter(Boolean);

  if (allKeys.length === 0) {
    return new Response(JSON.stringify({
      reply: "ARIA is not configured yet. Please add the ARIA_chatbot environment variable in Vercel.",
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // All keys valid — shuffled loop in Groq call section picks and retries on 429
  let message, history, today;
  try {
    const body = await req.json();
    message = body.message || "";
    // Sanitize history — only keep valid role+content pairs, strip any extra fields (id, etc.)
    // Groq rejects messages with unknown fields in strict mode
    const rawHistory = Array.isArray(body.history) ? body.history : [];
    history = rawHistory
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }));
    today   = body.today || new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!message.trim()) {
    return new Response(JSON.stringify({ reply: "" }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── TAVILY — every single message ────────────────────────────────────────
  // Build a smart search query from the user's message
  const searchQuery = message.length > 10
    ? `${message.slice(0, 120)} market investment 2026`
    : "global market investment opportunities 2026";
  const tavilyContext = await getTavilyContext(searchQuery, tavilyKey);

  // ── BUILD MESSAGES ARRAY ─────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(today, tavilyContext);
  const messages = [
    ...history, // rolling 20 from frontend
    { role: "user", content: message },
  ];

  // ── GROQ CALL — with per-key retry on 429 ────────────────────────────────
  // Build payload once, reused across key retries
  const groqPayload = JSON.stringify({
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
    max_tokens: 1000,
    temperature: 0.7,
  });

  // Try each key in a shuffled order — if one is rate-limited, try the next
  // Fisher-Yates shuffle: unlike sort(random-0.5), this gives truly uniform distribution
  // With 5 keys the bias of sort() is significant — first/last keys would be hit too often
  const shuffledKeys = [...allKeys];
  for (let i = shuffledKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledKeys[i], shuffledKeys[j]] = [shuffledKeys[j], shuffledKeys[i]];
  }

  for (let ki = 0; ki < shuffledKeys.length; ki++) {
    const keyToTry = shuffledKeys[ki];
    const groqController = new AbortController();
    const groqTimer = setTimeout(() => groqController.abort(), 20000);

    try {
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: groqController.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${keyToTry}`,
        },
        body: groqPayload,
      });
      clearTimeout(groqTimer);

      const data = await groqRes.json();

      if (!groqRes.ok) {
        // Rate limit — try next key if available
        // Groq rate limits: status 429 + error.code "rate_limit_exceeded"
        // Also catches context window exceeded: status 400 + message includes context_length
        if (groqRes.status === 429 || data?.error?.code === "rate_limit_exceeded") {
          if (ki < shuffledKeys.length - 1) continue; // try next key
          // All keys exhausted
          return new Response(JSON.stringify({
            reply: "ARIA is resting for today 😴 She'll be back at 5:30 AM IST!",
            quotaExceeded: true,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          reply: "Hmm, something went wrong on my end yaar 😅 Try again in a second!",
          error: data?.error?.message || "Groq error",
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      const reply = data?.choices?.[0]?.message?.content || "";
      return new Response(JSON.stringify({ reply }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });

    } catch (err) {
      clearTimeout(groqTimer);
      if (err.name === "AbortError") {
        return new Response(JSON.stringify({
          reply: "Taking too long yaar 😅 ARIA is thinking hard — try again in a second!",
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      // Network error on this key — try next if available
      if (ki < shuffledKeys.length - 1) continue;
      return new Response(JSON.stringify({
        reply: "Network hiccup yaar! Give me a second and try again 😊",
        error: err.message,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Fallback (should never reach here since loop returns)
  return new Response(JSON.stringify({
    reply: "ARIA is resting for today 😴 She'll be back at 5:30 AM IST!",
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
