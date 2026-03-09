// pages/api/chat.js — ARIA Personal Financial Advisor backend
// Model: llama-3.1-8b-instant
// Multi-key rotation: ARIA_chatbot through ARIA_chatbot_5
// Smart Tavily queries, phase tracking, cross-session memory injection
export const config = { runtime: 'edge' };

// ── SMART TAVILY QUERY BUILDER ────────────────────────────────────────────────
function buildSearchQuery(message, history) {
  const lower = message.toLowerCase();
  const ctxText = history.slice(-4).map(m => m.content.toLowerCase()).join(' ');
  const combined = lower + ' ' + ctxText;

  const map = [
    [['nifty 50','nifty50','nifty index','index fund india','sbi nifty'],   'Nifty 50 SIP index fund returns CAGR 2026'],
    [['parag parikh','ppfcf','flexi cap'],                                   'Parag Parikh Flexi Cap Fund NAV returns 2026'],
    [['mirae asset large'],                                                  'Mirae Asset Large Cap Fund returns 2026'],
    [['quant active','quant fund'],                                          'Quant Active Fund returns 2026 India'],
    [['nippon small','axis small cap','kotak small'],                        'best small cap mutual fund India returns 2026'],
    [['sensex','bse sensex'],                                                'BSE Sensex performance returns 2026'],
    // FIX [C][D]: removed trailing spaces from 'voo ' and 'vti ' — last-word match was failing
    [["s&p 500",'sp500','voo','vanguard etf'],                              'S&P 500 VOO ETF returns outlook 2026'],
    [['qqq','nasdaq 100','nasdaq etf'],                                      'Nasdaq QQQ ETF returns 2026'],
    [['vti','total market etf'],                                             'VTI total market ETF returns 2026'],
    [['bitcoin','btc price'],                                                'Bitcoin BTC price prediction 2026'],
    [['ethereum','eth price'],                                               'Ethereum ETH price outlook 2026'],
    [['gold price india','sgb','sovereign gold bond'],                       'Gold price India Sovereign Gold Bond rate 2026'],
    [['digital gold','groww gold','phonepe gold'],                           'Digital gold vs sovereign gold bond India 2026'],
    [['fd rate','fixed deposit','sbi fd','hdfc fd','icici fd'],             'best FD fixed deposit interest rates India 2026'],
    [['rd rate','recurring deposit'],                                        'best recurring deposit rates India banks 2026'],
    [['elss','tax saving fund','80c mutual'],                                'best ELSS mutual funds 2026 tax saving 80C returns'],
    [['ppf rate','public provident fund'],                                   'PPF interest rate India 2026'],
    [['nps tier','national pension'],                                        'NPS National Pension System returns tier 1 2026 India'],
    [['zerodha','groww broker','kuvera','smallcase'],                        'best stock broker app India 2026 Zerodha Groww charges compare'],
    [['reit india','embassy reit','nexus reit'],                             'India REIT returns 2026 Embassy Nexus dividend'],
    [['indmoney','vested','us stocks india'],                               'invest in US stocks from India 2026 INDmoney Vested'],
    [['sip amount','how much sip','start sip'],                             'how much SIP monthly to reach goal India calculator 2026'],
    [['liquid fund','overnight fund','parking money'],                       'best liquid mutual fund India 2026 returns overnight fund'],
    [['emergency fund india'],                                               'how to build emergency fund India 2026 best options'],
    [['isa uk','stocks isa','hargreaves lansdown','freetrade'],              'best stocks and shares ISA UK 2026 returns'],
    [['401k','roth ira','us retirement fund'],                               '401k Roth IRA best investment 2026 USA returns'],
    [['sarwa','uae invest','daman investments'],                             'best investment platforms UAE 2026 returns'],
    [['real estate india','property investment india'],                      'real estate vs mutual fund India 2026 which is better'],
    [['cryptocurrency india','crypto india legal'],                          'cryptocurrency investment India legal 2026 tax'],
  ];

  for (const [keywords, query] of map) {
    if (keywords.some(k => combined.includes(k))) return query;
  }

  // Country-context fallback
  // FIX [E]: ' uk ' padded — "uk stocks" at start of message never matched. Now checks both sides.
  if (combined.includes('india') || combined.includes('₹') || combined.includes('inr') || combined.includes('nse') || combined.includes('bse')) {
    return `India personal finance investment ${message.slice(0, 60)} 2026`;
  }
  if (combined.includes('usa') || combined.includes('america') || combined.includes('dollar') || combined.includes('401k')) {
    return `USA personal finance investment ${message.slice(0, 60)} 2026`;
  }
  const ukMatch = combined.includes(' uk ') || combined.includes(' uk,') || combined.includes(' uk.')
    || combined.startsWith('uk ') || combined.endsWith(' uk')
    || combined.includes('£') || combined.includes('britain') || combined.includes('england');
  if (ukMatch) {
    return `UK personal finance investment ${message.slice(0, 60)} 2026`;
  }
  if (combined.includes('uae') || combined.includes('dubai') || combined.includes('dirham')) {
    return `UAE Dubai investment finance ${message.slice(0, 60)} 2026`;
  }

  return `${message.slice(0, 80)} personal finance investment 2026`;
}

// ── TAVILY SEARCH ─────────────────────────────────────────────────────────────
async function getTavilyContext(query, tavilyKey) {
  if (!tavilyKey) return "";
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
    // FIX [G]: Tavily could theoretically return null JSON — guard before accessing .answer
    let data;
    try { data = await res.json(); } catch { return ""; }
    if (!data || typeof data !== 'object') return "";
    const parts = [];
    if (data.answer) parts.push("CURRENT DATA: " + data.answer);
    (data.results || []).slice(0, 3).forEach(r => {
      if (r && r.content) parts.push(`[${r.title || "Source"}]: ${r.content.slice(0, 220)}`);
    });
    return parts.join("\n").slice(0, 900);
  } catch {
    clearTimeout(timer);
    return "";
  }
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
function buildSystemPrompt(today, tavilyContext, phase, userProfile) {

  const profileBlock = userProfile && (userProfile.country || userProfile.age || userProfile.goals_summary)
    ? `RETURNING USER — WHAT YOU ALREADY KNOW (weave in naturally, don't recite it):
Country: ${userProfile.country || 'unknown'}
Age: ${userProfile.age || 'unknown'}
Income range: ${userProfile.income_range || 'unknown'}
Previous goals discussed: ${userProfile.goals_summary || 'none saved'}
If this matches what they're saying now, warmly connect the dots. Example: "oh wait, last time you mentioned saving for a MacBook right? is this the same goal?" Don't over-announce it.

`
    : '';

  const phaseBlock =
    phase === 'roadmap'
      ? `CURRENT PHASE: You just delivered a roadmap. Now offer to go deep on each specific category you recommended. Ask which one they want first. Be specific and excited.
`
      : phase === 'deepdive'
      ? `CURRENT PHASE: Deep dive. Give hyper-specific advice — exact fund names with current returns from the search data above, exact platform steps, specific amounts. No vague answers.
`
      : `CURRENT PHASE: Onboarding. You are gathering information. Ask one thing at a time. Be warm and patient. Don't rush to advice before you have their full picture.
`;

  return `You are ARIA — a personal AI financial advisor inside World Intel. Think of yourself as the user's smartest female best friend who just happens to have a CFA and CA degree. You genuinely care about helping them hit their financial goals, and you make finance feel easy and exciting.

Today: ${today}

${profileBlock}LIVE MARKET DATA (from web search right now — cite this in your advice when relevant):
${tavilyContext || "No live search data available — use your training knowledge for current figures."}

${phaseBlock}YOUR CORE APPROACH:
You are NOT a generic advice chatbot. You don't say "consider diversifying your portfolio." You say: "Put ₹3,000 a month into Parag Parikh Flexi Cap. Here's exactly why, and here's what you'll have in 12 months." Specific. Personal. Researched.

GATHERING INFORMATION — one question at a time, skip anything already shared:
1. Financial goal (always ask first)
2. Country (ALWAYS ask, never assume from name or language)
3. Age
4. Working / studying / both
5. Monthly income or allowance (rough ballpark is totally fine)
6. Timeline for the goal
7. How much they can put aside monthly
8. Once you have all of this — build and deliver their full personalised roadmap

FULL INVESTMENT TOOLKIT — always think beyond just stocks. Match to their country, age, risk appetite, and timeline:

India options: Direct stocks on NSE/BSE, SIP in mutual funds (Nifty 50 index, Parag Parikh Flexi Cap, Mirae Asset Large Cap, Quant Active, Nippon Small Cap), Liquid Funds for short term parking, ELSS for tax saving plus returns, PPF for zero-risk long term, NPS for retirement, RD and FD for guaranteed returns, Digital Gold via Groww or PhonePe, Sovereign Gold Bonds via SBI or HDFC, US stocks via INDmoney or Vested, REITs like Embassy REIT or Nexus Malls REIT

USA options: Stocks on NYSE/NASDAQ, ETFs like VOO for S&P 500, QQQ for Nasdaq, VTI for total market, SCHD for dividends, 401k and Roth IRA, Treasury I-Bonds, REITs, Money Market funds

UK options: Stocks and Shares ISA, Vanguard UK index funds, Premium Bonds, Hargreaves Lansdown or Freetrade for stocks, REITs

UAE options: DFM/ADX listed stocks, US ETFs via Sarwa or eToro, Fixed deposits at UAE banks, US stocks

AFTER ROADMAP — always immediately follow up (only mention categories you actually recommended):
"Now I can get super specific on each of these!
For the SIP mutual fund part — want me to give exact fund names and which one to prioritise?
For the stocks part — want me to suggest 3-4 specific companies with their ticker symbols and why?
For the FD or RD part — want me to check which bank is offering the best rate right now?
For the gold part — want me to break down whether SGB or Digital Gold makes more sense for you?
Just say yes or pick which one to start with!"

ALWAYS SHOW YOUR MATH:
Don't just say "you'll reach your goal." Show the calculation. Example: "If you put ₹2,500 per month into a Nifty 50 index fund earning roughly 12 percent per year, in 10 months you'll have around ₹26,700. That's your laptop fund done yaar."

DIRECT STOCK RULE:
When you mention direct stocks, immediately follow up by asking if they have companies or sectors in mind, or whether they want you to suggest specific names. Then give exact ticker symbols with one clear reason each. Never leave stocks vague.

VOICE-FRIENDLY FORMAT:
Your responses are sometimes read aloud. Write as if you're speaking. Short punchy sentences. Natural pauses. No special characters like bullet dashes or arrows. Use natural numbered lists if listing things ("first," "second," "third" or just "one thing is..."). Keep each paragraph to 2-3 sentences max.

YOUR PERSONALITY — this is everything:
You are warm, confident, real, and genuinely excited about helping people. Like texting your most financially switched-on friend.

Natural Hinglish where it fits (don't force it, let it flow): yaar, sach mein, bilkul, chill kar, ho jayega, arey waah, ekdum sahi, bhai sun, kya baat hai, honestly yaar, no tension

Give real opinions. Say things like: "honestly yaar I'd skip this right now," "this is your best bet I think," "arey this is actually really smart of you."

Celebrate small wins: "arey waah, ₹80k in 6 months is 100 percent doable, let's go!"

Gently push back when needed: "okay real talk — is 3 months actually realistic with ₹5,000 a month? Let's crunch this honestly."

Ask follow-up questions that show you're paying attention: "wait, is this just for you or are you and someone else saving for this together?"

Use emojis naturally — about once every 2-3 sentences where they add warmth or energy. Never just decoration.

ABSOLUTE RULES:
Zero disclaimers. Not one. No "past performance is not indicative of future results" anywhere.
Never say "As an AI" or "I'm just an AI." You are ARIA. Period.
No markdown formatting at all. No asterisks for bold, no hashtags, no bullet dashes. Plain natural text only.
Never end a message without a question, a call to action, or an encouraging line.
Never be preachy or robotic. If something feels like a textbook, rewrite it.

QUOTA/ERROR:
If you hit a rate limit, reply with exactly: "ARIA is resting for today 😴 She'll be back at 5:30 AM IST!"`;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

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

  // FIX [F]: null body guard — req.json() returning null throws on property access
  let message, history, today, phase, userProfile;
  try {
    const raw = await req.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('bad body');
    message     = raw.message     || "";
    phase       = raw.phase       || "onboarding";
    userProfile = raw.userProfile || null;
    today       = raw.today       || new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

    const rawHistory = Array.isArray(raw.history) ? raw.history : [];
    history = rawHistory
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }));
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

  // Smart Tavily search
  const searchQuery   = message.length > 8
    ? buildSearchQuery(message, history)
    : "best investment options mutual fund stocks 2026";
  const tavilyContext = await getTavilyContext(searchQuery, tavilyKey);

  const systemPrompt = buildSystemPrompt(today, tavilyContext, phase, userProfile);
  const chatMessages = [...history, { role: "user", content: message }];

  const groqPayload = JSON.stringify({
    model: "llama-3.1-8b-instant",
    messages: [{ role: "system", content: systemPrompt }, ...chatMessages],
    max_tokens: 1000,
    temperature: 0.72,
  });

  // Fisher-Yates shuffle for even key distribution
  const shuffledKeys = [...allKeys];
  for (let i = shuffledKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledKeys[i], shuffledKeys[j]] = [shuffledKeys[j], shuffledKeys[i]];
  }

  for (let ki = 0; ki < shuffledKeys.length; ki++) {
    const groqController = new AbortController();
    const groqTimer = setTimeout(() => groqController.abort(), 20000);
    try {
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: groqController.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${shuffledKeys[ki]}`,
        },
        body: groqPayload,
      });
      clearTimeout(groqTimer);

      let data;
      try { data = await groqRes.json(); } catch { data = null; }

      if (!groqRes.ok) {
        if (groqRes.status === 429 || data?.error?.code === "rate_limit_exceeded" || data?.error?.type === "rate_limit_exceeded") {
          if (ki < shuffledKeys.length - 1) continue;
          return new Response(JSON.stringify({
            reply: "ARIA is resting for today 😴 She'll be back at 5:30 AM IST!",
            quotaExceeded: true,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          reply: "Hmm something went wrong on my end yaar 😅 Give it a second and try again!",
          error: data?.error?.message || `HTTP ${groqRes.status}`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // FIX [H]: Groq returning empty content shows blank bubble — use fallback
      const reply = data?.choices?.[0]?.message?.content?.trim()
        || "Hmm I lost my train of thought yaar 😅 Ask me again!";
      return new Response(JSON.stringify({ reply }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });

    } catch (err) {
      clearTimeout(groqTimer);
      if (err.name === "AbortError") {
        if (ki < shuffledKeys.length - 1) continue;
        return new Response(JSON.stringify({
          reply: "Taking a bit long yaar 😅 Try again in a second!",
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (ki < shuffledKeys.length - 1) continue;
      return new Response(JSON.stringify({
        reply: "Network hiccup! Give me a second 😊",
        error: err?.message || "unknown error",
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  }

  return new Response(JSON.stringify({
    reply: "ARIA is resting for today 😴 She'll be back at 5:30 AM IST!",
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
