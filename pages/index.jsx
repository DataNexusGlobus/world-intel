import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import { createClient } from '@supabase/supabase-js';

/* ═══════════════════════════════════════════════════════════
   DataNexus Globus
   AI Financial & Geo-Intelligence Platform
   Owner: Shubham Chatterjee | datanexusglobus@gmail.com
═══════════════════════════════════════════════════════════ */

/* ── SUPABASE CLIENT ── */
const _SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const _SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = (typeof window !== 'undefined' && _SB_URL && _SB_KEY)
  ? createClient(_SB_URL, _SB_KEY)
  : null;

/* ── LOCAL STORAGE (cookie + theme only — no longer used for auth) ── */
const KC="wi:cookie_v9", KTH="wi:theme_v9";
async function dbG(k){
  try{
    if(typeof window==="undefined"||!window.localStorage)return null;
    const v=window.localStorage.getItem(k);
    return v?JSON.parse(v):null;
  }catch{return null;}
}
async function dbS(k,v){
  try{if(typeof window!=="undefined"&&window.localStorage)window.localStorage.setItem(k,JSON.stringify(v));}catch{}
}
async function dbD(k){
  try{if(typeof window!=="undefined"&&window.localStorage)window.localStorage.removeItem(k);}catch{}
}

/* ── AUTH — Supabase ── */
async function registerUser(email,pw,name){
  if(!supabase)throw new Error("Auth service unavailable");
  // Sign up with Supabase Auth
  const{data,error}=await supabase.auth.signUp({
    email:email.toLowerCase().trim(),
    password:pw,
    options:{data:{username:name.trim(),tz:Intl.DateTimeFormat().resolvedOptions().timeZone}}
  });
  if(error)throw new Error(error.message==="User already registered"?"Email already registered":error.message);
  // Supabase sends a confirmation email but we allow immediate use
  const user=data.user;
  if(!user)throw new Error("Registration failed — please try again");
  return{
    username:name.trim(),
    email:user.email,
    tz:Intl.DateTimeFormat().resolvedOptions().timeZone,
    id:user.id
  };
}
async function loginUser(email,pw){
  if(!supabase)throw new Error("Auth service unavailable");
  const{data,error}=await supabase.auth.signInWithPassword({
    email:email.toLowerCase().trim(),
    password:pw
  });
  if(error){
    if(error.message.includes("Invalid login"))throw new Error("Incorrect email or password");
    throw new Error(error.message);
  }
  const user=data.user;
  const meta=user.user_metadata||{};
  return{
    username:meta.username||email.split("@")[0],
    email:user.email,
    tz:meta.tz||Intl.DateTimeFormat().resolvedOptions().timeZone,
    id:user.id
  };
}
async function logoutUser(){
  if(!supabase)return;
  await supabase.auth.signOut();
}
// sha256 kept for any legacy checks but no longer used for auth
async function sha256(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s+"__wi9__"));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");}

/* ── EXCHANGE CONFIG ── */
function getEx(c="usa"){
  const l=(c||"usa").toLowerCase();
  if(l.includes("india"))return{ex:"NSE/BSE",idx:"NIFTY 50 & SENSEX",cur:"₹"};
  if(l.includes("pakistan"))return{ex:"PSX",idx:"KSE-100",cur:"PKR "};
  if(l.includes("china"))return{ex:"SSE/SZSE",idx:"CSI 300 & Shanghai",cur:"¥"};
  if(l.includes("japan"))return{ex:"TSE",idx:"Nikkei 225",cur:"¥"};
  if(l.includes("uk")||l.includes("britain"))return{ex:"LSE",idx:"FTSE 100",cur:"£"};
  if(l.includes("germany"))return{ex:"Frankfurt",idx:"DAX 40",cur:"€"};
  if(l.includes("france")||l.includes("eu"))return{ex:"Euronext",idx:"CAC 40 / Euro Stoxx",cur:"€"};
  if(l.includes("australia"))return{ex:"ASX",idx:"ASX 200",cur:"A$"};
  if(l.includes("korea"))return{ex:"KRX",idx:"KOSPI",cur:"₩"};
  if(l.includes("brazil"))return{ex:"B3",idx:"IBOVESPA",cur:"R$"};
  if(l.includes("uae")||l.includes("dubai"))return{ex:"DFM/ADX",idx:"DFM General Index",cur:"AED "};
  if(l.includes("saudi"))return{ex:"Tadawul",idx:"TASI",cur:"SAR "};
  if(l.includes("canada"))return{ex:"TSX",idx:"S&P/TSX Composite",cur:"C$"};
  return{ex:"NYSE/NASDAQ",idx:"S&P 500 · Dow Jones · NASDAQ",cur:"$"};
}

/* ── CACHE ── */
const _MC=new Map();
function _ck(p){return p.slice(0,120);}
function _cg(k){const e=_MC.get(k);if(!e)return null;if(Date.now()-e.t>1800000){_MC.delete(k);return null;}return e.v;} // 30min cache
function _cs(k,v){_MC.set(k,v);if(_MC.size>30){_MC.delete(_MC.keys().next().value);}}
/* ── CURRENT WORLD FACTS — keeps Groq (Jan 2024 cutoff) generating accurate content ── */
/* WF block removed — Tavily now fetches all current facts dynamically.
   No hardcoding needed. Groq receives real web search results as context. */



/* Get API endpoint — always use our proxy */
function _apiUrl(){
  return"/api/claude";
}

/* searchWeb — calls Tavily, returns a short context string to inject into Groq prompts
   If Tavily key not set or fails, returns empty string (Groq falls back to WF block) */
async function searchWeb(query){
  try{
    const res=await fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({query,maxResults:5})});
    if(!res.ok)return "";
    const d=await res.json();
    if(d.error||!d.results)return "";
    // Build compact context: answer summary + top snippets
    const parts=[];
    if(d.summary)parts.push("SEARCH SUMMARY: "+d.summary);
    (d.results||[]).slice(0,3).forEach(r=>{
      if(r.snippet)parts.push(`[${r.title}]: ${r.snippet}`);
    });
    return parts.join("\n").slice(0,600); // keep short to avoid Groq timeout
  }catch{return "";}
}

/* Global request queue — ensures max 1 Groq call every 4 seconds
   Prevents rate limit when user switches tabs quickly */
let _lastCall=0;
async function _throttle(){
  const now=Date.now();
  const wait=Math.max(0,_lastCall+4000-now);
  if(wait>0)await new Promise(r=>setTimeout(r,wait));
  _lastCall=Date.now();
}

/* fetchRealPrices — enriches Groq stock data with real prices from Finnhub
   Gracefully degrades: if Finnhub unavailable, Groq prices are kept */
async function fetchRealPrices(stocks){
  try{
    const symbols=stocks.map(s=>s.symbol).filter(Boolean);
    const res=await fetch("/api/prices",{method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({symbols})});
    if(!res.ok)return stocks;
    const{prices}=await res.json();
    if(!prices||Object.keys(prices).length===0)return stocks;
    // Merge real prices into stocks — keep all Groq analysis fields
    return stocks.map(s=>{
      const p=prices[s.symbol];
      if(!p||!p.isReal)return s;
      // Sanity check: extract Groq's estimated price number for comparison
      const groqPriceNum=parseFloat((s.price||s.currentPrice||"0").replace(/[^0-9.]/g,""));
      // If Finnhub price is wildly different (>5x or <0.2x of Groq estimate), skip it
      // This catches stale/wrong data for non-US exchanges
      if(groqPriceNum>0){
        const ratio=p.price/groqPriceNum;
        if(ratio>5||ratio<0.2)return s; // Finnhub data unreliable for this exchange
      }
      // Format price with original currency prefix
      const cur=(s.price||s.currentPrice||"").replace(/[\d.,]+.*/,"").trim();
      const formatted=cur+(p.price.toFixed(2));
      const ch=p.change1d_raw||0;
      return{...s,
        price:formatted,
        currentPrice:formatted,
        change1d:ch>=0?`+${ch.toFixed(2)}%`:`${ch.toFixed(2)}%`,
        change1d_raw:ch,
        _priceReal:true,
      };
    });
  }catch{
    return stocks; // silent fallback — Groq prices used
  }
}

/* callClaude — for news (returns array []) — jsonMode:false so Groq allows arrays */
async function callClaude(prompt,maxTokens=2000,retries=2){
  const ck=_ck(prompt);
  const h=_cg(ck);if(h)return h;
  for(let i=0;i<retries;i++){
    if(i>0)await new Promise(r=>setTimeout(r,15000));
    try{
      await _throttle();
      const res=await fetch(_apiUrl(),{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prompt,maxTokens,jsonMode:false})});
      if(!res.ok){if([429,503,529].includes(res.status)&&i<retries-1)continue;return "";}
      const d=await res.json();if(d.error&&i<retries-1)continue;if(d.error)return "";
      const t=d.text||"";
      if(t){_cs(ck,t);return t;}
    }catch{if(i<retries-1)continue;return "";}
  }
  return "";
}

/* callClaudeJSON — for structured data (returns object {}) — jsonMode:true forces clean JSON */
async function callClaudeJSON(prompt,prefill="{",maxTokens=2500,retries=2){
  const ck=_ck(prefill+":"+prompt);
  const h=_cg(ck);if(h)return h;
  for(let i=0;i<retries;i++){
    if(i>0)await new Promise(r=>setTimeout(r,15000));
    try{
      await _throttle();
      const res=await fetch(_apiUrl(),{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prompt,maxTokens,jsonMode:true})});
      if(!res.ok){if([429,503,529].includes(res.status)&&i<retries-1)continue;return "";}
      const d=await res.json();if(d.error&&i<retries-1)continue;if(d.error)return "";
      const t=d.text||"";
      if(t){_cs(ck,t);return t;}
    }catch{if(i<retries-1)continue;return "";}
  }
  return "";
}


/* ── FALLBACK DATA (shown when API busy) ── */
function fbNews(q){
  const C=q||"Global";
  const cl=(C||"").toLowerCase();
  const ND={
    india:[
      {title:"RBI holds rates at 6.50% — signals cautious easing path",source:"Economic Times",country:"India",severity:"high",category:"economy",ago:"1h ago",impact:"Borrowing costs stable; equity market rates-sensitive sectors rally. INR supported.",people:"Home loan EMIs unchanged; fixed deposit rates hold at 7-7.5%.",tradeEffect:"Nifty Bank +1.2%; INR stable at 83-84/$"},
      {title:"India Q3 GDP beats forecast at 7.1% — manufacturing drives growth",source:"Bloomberg",country:"India",severity:"high",category:"economy",ago:"2h ago",impact:"India retains fastest-growing major economy status. Capex cycle strong.",people:"Manufacturing job creation accelerating in PLI-linked sectors.",tradeEffect:"NSE Midcap +2%; FII inflows positive on growth beat"},
      {title:"Jio-Airtel 5G rollout hits 500 million subscribers milestone",source:"Reuters",country:"India",severity:"medium",category:"economy",ago:"3h ago",impact:"Digital economy acceleration. ARPU expansion opportunity for telcos.",people:"Rural internet access improving productivity and financial inclusion.",tradeEffect:"RELIANCE.NS +1.8%; BHARTIARTL.NS +2.3%"},
      {title:"India-China LAC patrol agreement — normalisation at Depsang",source:"The Hindu",country:"India",severity:"medium",category:"politics",ago:"4h ago",impact:"Reduced border risk premium. Defence capex continues regardless.",people:"Border communities gain stability; trade corridor potential improves.",tradeEffect:"Defence PSU stocks stable; broader market risk-off eases"},
      {title:"GST collections hit ₹2.1 lakh crore — fiscal consolidation on track",source:"Mint",country:"India",severity:"low",category:"economy",ago:"5h ago",impact:"Government fiscal space for capex intact. Bond market positive.",people:"Strong tax buoyancy reflects formal economy expansion.",tradeEffect:"G-Sec yields dip 5bps; Nifty 50 +0.6%"},
      {title:"India CERT-In issues advisory on critical infra cyber threats",source:"ET Tech",country:"India",severity:"critical",category:"cyber",ago:"6h ago",impact:"Power grid, BFSI, and government systems on elevated alert.",people:"Potential for banking service disruptions if attack succeeds.",tradeEffect:"Cyber security stocks: Quick Heal, Tata Elxsi watchlist"},
      {title:"PLI scheme attracts ₹4 lakh crore investment commitments",source:"FT",country:"India",severity:"medium",category:"trade",ago:"8h ago",impact:"Manufacturing capacity expansion across 14 sectors.",people:"3.2 million new manufacturing jobs projected by 2026.",tradeEffect:"Capital goods ETF, engineering exporters positive"},
      {title:"India-US trade deal framework negotiations resume",source:"Reuters",country:"India",severity:"medium",category:"trade",ago:"10h ago",impact:"Tariff reduction on pharma, IT services, and auto components.",people:"Export-linked employment in pharmaceuticals and textiles at stake.",tradeEffect:"Sun Pharma, Dr Reddy's watch; IT services neutral"},
    ],
    usa:[
      {title:"Fed holds rates — Powell signals 1-2 cuts possible in 2025",source:"WSJ",country:"USA",severity:"high",category:"economy",ago:"1h ago",impact:"Treasury yields fall; equities rally on rate-cut hopes. Dollar weakens.",people:"Mortgage rates may ease from 7.1% by H2 2025. Refinancing window opens.",tradeEffect:"S&P 500 +1.4%; 10Y yield -8bps; USD index -0.4%"},
      {title:"US non-farm payrolls +215K — unemployment holds at 3.9%",source:"Bloomberg",country:"USA",severity:"high",category:"economy",ago:"2h ago",impact:"Labour market resilience delays rate cuts. Stagflation risk low.",people:"Job market solid across healthcare, construction, and services.",tradeEffect:"Dollar strengthens; equities mixed; small caps underperform"},
      {title:"Salt Typhoon: Senate hearing on Chinese telecom infiltration",source:"Reuters",country:"USA",severity:"critical",category:"cyber",ago:"3h ago",impact:"National security breach assessment ongoing. CISA mandating remediation.",people:"Personal communications of officials potentially compromised.",tradeEffect:"Cyber defence stocks: CrowdStrike, Palo Alto Networks surge"},
      {title:"Debt ceiling deal struck — Treasury avoids default",source:"FT",country:"USA",severity:"high",category:"politics",ago:"4h ago",impact:"Default risk eliminated. Bond market normalises. Dollar firm.",people:"Social security and Medicare payments remain unaffected.",tradeEffect:"T-bill yields normalise; equities relief rally +0.9%"},
      {title:"NVIDIA earnings beat — AI datacenter revenue doubles YoY",source:"Bloomberg",country:"USA",severity:"high",category:"economy",ago:"5h ago",impact:"AI capex supercycle confirmed. Semiconductor sector re-rates higher.",people:"NVIDIA employing 30,000+ with average salary $200K.",tradeEffect:"NVDA +8%; SOX index +3.2%; Mag-7 broadly higher"},
      {title:"US CPI at 3.1% — services inflation proving sticky",source:"Reuters",country:"USA",severity:"medium",category:"economy",ago:"6h ago",impact:"Last-mile inflation problem delaying rate normalisation.",people:"Grocery and rent costs still elevated for working families.",tradeEffect:"Rate-sensitive sectors underperform; banks and energy hold"},
      {title:"Pentagon increases Indo-Pacific military budget by 18%",source:"Defense News",country:"USA",severity:"medium",category:"politics",ago:"8h ago",impact:"Deterrence posture strengthened vs China. Allies reassured.",people:"Defence sector employment and contractor revenues rise.",tradeEffect:"LMT, RTX, NOC rally 2-4%"},
      {title:"US commercial real estate loans — $1.5T refinancing wall looms",source:"FT",country:"USA",severity:"high",category:"economy",ago:"10h ago",impact:"Regional banks most exposed. FDIC stress-testing scenarios.",people:"Office vacancies at 20% in major cities — urban retail hit.",tradeEffect:"KRE regional bank ETF -1.8%; CMBS spreads widen"},
    ],
    china:[
      {title:"PBOC cuts RRR by 50bps — injects ¥1 trillion liquidity",source:"Xinhua/Reuters",country:"China",severity:"high",category:"economy",ago:"1h ago",impact:"Monetary easing to counter property-driven deflation. CNY slightly weaker.",people:"Small business credit access improves. Mortgage rates ease marginally.",tradeEffect:"CSI 300 +1.6%; CNY -0.2%; copper positive on stimulus hopes"},
      {title:"China property: Evergrande liquidation — ¥2.4T liabilities resolution",source:"Bloomberg",country:"China",severity:"critical",category:"economy",ago:"2h ago",impact:"Systemic property sector restructuring accelerating. LGFV risk elevated.",people:"2+ million homebuyers awaiting unfinished apartments affected.",tradeEffect:"Hang Seng -0.8%; China property ETF -3%; cement/steel negative"},
      {title:"PLA Taiwan Strait exercises — largest since 2022",source:"Reuters",country:"China",severity:"high",category:"politics",ago:"3h ago",impact:"Taiwan risk premium rises. Regional supply chain disruption concerns.",people:"Taiwan semiconductor supply chain watched globally.",tradeEffect:"TSMC -1.2%; Asian equities risk-off; gold +0.8%"},
      {title:"China AI investment: ¥10 trillion national plan announced",source:"FT",country:"China",severity:"medium",category:"economy",ago:"4h ago",impact:"State-backed AI champions to rival US hyperscalers.",people:"400,000 AI engineer jobs targeted by 2027.",tradeEffect:"BABA, Baidu, Tencent rally; US AI stocks watch competition"},
      {title:"China youth unemployment at 14.6% — NBS data",source:"Bloomberg",country:"China",severity:"high",category:"economy",ago:"5h ago",impact:"Social stability risk. Policy pressure to boost graduate employment.",people:"35 million urban graduates entering job market this year.",tradeEffect:"Consumer discretionary stocks weak; education sector mixed"},
      {title:"China-US chip war: New export controls on 7nm equipment",source:"Reuters",country:"China",severity:"high",category:"trade",ago:"6h ago",impact:"China advanced node production further constrained.",people:"SMIC and CXMT lose access to ASML EUV tools.",tradeEffect:"ASML -2%; SMIC Hong Kong -4%; NVDA unaffected"},
      {title:"China manufacturing PMI 50.8 — exports drive expansion",source:"Caixin",country:"China",severity:"medium",category:"economy",ago:"8h ago",impact:"Factory sector resilient. EV and solar panel exports at record.",people:"Pearl River Delta factory employment stable.",tradeEffect:"CNY slightly stronger; commodity imports positive"},
      {title:"China Belt and Road: $50B infrastructure fund for Africa",source:"Xinhua",country:"China",severity:"medium",category:"politics",ago:"10h ago",impact:"Chinese construction and materials exporters win contracts.",people:"African infrastructure development benefiting from funding.",tradeEffect:"China infrastructure plays positive; resource nationalism risk"},
    ],
    uk:[
      {title:"BoE holds rates at 5.25% — 2 members vote for cut",source:"FT",country:"UK",severity:"high",category:"economy",ago:"1h ago",impact:"Pound steady. Mortgage market watches closely for cut signals.",people:"1.5M households refinancing — any cut saves £800/year average.",tradeEffect:"GBP/USD flat; FTSE 100 +0.6%; housebuilders rally"},
      {title:"UK inflation falls to 3.8% — services still elevated at 5%",source:"BBC",country:"UK",severity:"high",category:"economy",ago:"2h ago",impact:"Disinflation progress but last mile difficult. BoE cautious.",people:"Grocery prices still 25% above 2021. Energy bill relief partial.",tradeEffect:"Gilts rally; GBP firms; FTSE 250 domestic stocks positive"},
      {title:"Labour government: NHS 40,000 new staff hiring drive",source:"Guardian",country:"UK",severity:"medium",category:"politics",ago:"3h ago",impact:"Public spending increase. NHS productivity target requires restructuring.",people:"NHS waiting lists at 7.5M — hiring to cut waits by 2027.",tradeEffect:"Healthcare staffing agencies, NHS tech suppliers benefit"},
      {title:"UK-EU defence pact negotiations advance post-Labour election",source:"Reuters",country:"UK",severity:"medium",category:"politics",ago:"4h ago",impact:"Post-Brexit EU re-engagement. Defence industrial cooperation.",people:"UK defence workers gain access to EU procurement contracts.",tradeEffect:"UK defence: BAE Systems, Rolls-Royce positive"},
      {title:"UK commercial real estate: London office vacancies hit 12%",source:"FT",country:"UK",severity:"high",category:"economy",ago:"5h ago",impact:"Property sector stress. REIT valuations under pressure.",people:"Hybrid work making commuter belts more attractive than city centres.",tradeEffect:"UK REITs -2%; residential housebuilders more resilient"},
      {title:"NCSC: Russian GRU targeting UK energy and water utilities",source:"GCHQ NCSC",country:"UK",severity:"critical",category:"cyber",ago:"6h ago",impact:"Critical national infrastructure on heightened alert.",people:"Potential for service disruptions in worst-case scenario.",tradeEffect:"UK cyber security firms: Darktrace, Sophos watchlist"},
      {title:"UK-India FTA: Final round of negotiations — tariffs on whisky and cars",source:"Telegraph",country:"UK",severity:"medium",category:"trade",ago:"8h ago",impact:"Landmark deal would be UK's biggest post-Brexit trade agreement.",people:"UK whisky producers and auto sector jobs secured.",tradeEffect:"Diageo +1.5%; Jaguar Land Rover parent Tata Motors positive"},
      {title:"UK GDP +0.4% — narrowly avoids second recession quarter",source:"ONS",country:"UK",severity:"medium",category:"economy",ago:"10h ago",impact:"Recovery fragile. Government fiscal headroom tight.",people:"Real wages finally growing above inflation for first time since 2021.",tradeEffect:"FTSE 100 +0.4%; sterling firms; gilts unchanged"},
    ],
    europe:[
      {title:"ECB cuts rates 25bps to 3.75% — Lagarde signals gradual path",source:"Reuters",country:"Europe",severity:"high",category:"economy",ago:"1h ago",impact:"Eurozone borrowing costs ease. Southern Europe most relieved.",people:"Variable rate mortgages in Spain, Portugal, Italy ease.",tradeEffect:"EUR/USD -0.3%; Euro Stoxx 50 +1.1%; banks mixed"},
      {title:"Germany GDP -0.2% — industrial recession deepens",source:"Bloomberg",country:"Europe",severity:"high",category:"economy",ago:"2h ago",impact:"Eurozone engine stalling. Energy cost competitiveness crisis.",people:"IG Metall warns of 100,000 auto sector job cuts by 2026.",tradeEffect:"DAX -0.8%; EUR weaker; Volkswagen, BASF underperform"},
      {title:"EU-China EV tariffs: 35% levy takes effect — Beijing retaliates",source:"FT",country:"Europe",severity:"high",category:"trade",ago:"3h ago",impact:"Chinese EVs face steep barrier. European automakers gain time.",people:"European EV prices may stay elevated without Chinese competition.",tradeEffect:"Stellantis, Volkswagen +2%; CATL Hong Kong -3%"},
      {title:"France political crisis: Barnier budget collapses — snap vote looms",source:"Le Monde/Reuters",country:"Europe",severity:"high",category:"politics",ago:"4h ago",impact:"French sovereign spread widens vs Germany. Euro under pressure.",people:"French pension reform uncertainty returns. Strikes threat.",tradeEffect:"OAT/Bund spread widens; French banks BNP, SocGen -1.5%"},
      {title:"NATO Article 5 test: Baltic cable sabotage — Russia suspected",source:"Guardian",country:"Europe",severity:"critical",category:"cyber",ago:"5h ago",impact:"NATO activating investigation. Hybrid warfare threshold debate.",people:"Internet and electricity disruptions in Estonia and Finland.",tradeEffect:"Defence stocks: Rheinmetall, SAAB, Leonardo surge 3-5%"},
      {title:"Spain economy +2.8% — Mediterranean outperforms bloc",source:"FT",country:"Europe",severity:"medium",category:"economy",ago:"6h ago",impact:"Tourism and green energy exports driving Iberian growth.",people:"Youth unemployment falls to 25% — still highest in EU.",tradeEffect:"Spanish IBEX +1.2%; Santander, BBVA positive"},
      {title:"EU AI Act implementation begins — compliance deadline Q1 2025",source:"Politico EU",country:"Europe",severity:"medium",category:"politics",ago:"8h ago",impact:"AI companies must meet transparency and safety standards.",people:"Privacy rights strengthened for EU citizens vs AI systems.",tradeEffect:"EU AI compliance consultancies boom; big tech adaptation costs"},
      {title:"Eurozone inflation 2.4% — approaching ECB 2% target",source:"Eurostat",country:"Europe",severity:"medium",category:"economy",ago:"10h ago",impact:"Rate cut cycle can proceed. Fiscal space gradually improving.",people:"Real wage growth returns across France, Spain, Italy.",tradeEffect:"Euro Stoxx banks -0.5% (cut margin compression); consumers positive"},
    ],
    russia:[
      {title:"Russia war economy: Defence spending hits 35% of federal budget",source:"Reuters",country:"Russia",severity:"critical",category:"politics",ago:"1h ago",impact:"Civil economy crowded out. Consumer goods shortages widen.",people:"Russians face rising prices, reduced imports, and social cuts.",tradeEffect:"Rouble under pressure; sanctions circumvention via UAE/Turkey"},
      {title:"Ukraine drone strikes reach Moscow — Kremlin air defences tested",source:"BBC",country:"Russia",severity:"critical",category:"politics",ago:"2h ago",impact:"Psychological escalation. Putin faces domestic accountability pressure.",people:"Moscow residents experiencing air raid alerts for first time.",tradeEffect:"Oil prices +$1.5; gold safe-haven bid; ruble -0.8%"},
      {title:"Russia-North Korea: DPRK artillery shells supply confirmed",source:"Reuters",country:"Russia",severity:"high",category:"politics",ago:"3h ago",impact:"Russia bypassing Western sanctions via DPRK military trade.",people:"Sanctions evasion network expanding — secondary sanctions risk.",tradeEffect:"Arms industry geopolitics; South Korea defence ETF positive"},
      {title:"Russia CBR holds rate at 16% — inflation at 7.8%",source:"Bloomberg",country:"Russia",severity:"high",category:"economy",ago:"4h ago",impact:"High rates choking private sector. State firms insulated by subsidies.",people:"Mortgages unaffordable; consumer credit tightening.",tradeEffect:"Ruble bonds unattractive; FX restrictions limit price discovery"},
      {title:"Russian oil: $60 price cap circumvention via shadow fleet",source:"FT",country:"Russia",severity:"medium",category:"trade",ago:"5h ago",impact:"Russia maintaining oil revenues above G7 cap using 600+ tankers.",people:"Oil revenues funding war — sanctions partially effective.",tradeEffect:"Urals crude $68-72; shadow fleet insurers face US Treasury sanctions"},
      {title:"GRU Sandworm: New cyberattack on European energy infrastructure",source:"WIRED",country:"Russia",severity:"critical",category:"cyber",ago:"6h ago",impact:"Power grid disruption attempted in Poland and Baltic states.",people:"Potential for winter heating disruptions in targeted regions.",tradeEffect:"European energy stocks +1%; cyber defence globally higher"},
      {title:"Russia-China trade hits record $240B — sanctions bypass deepens",source:"Reuters",country:"Russia",severity:"medium",category:"trade",ago:"8h ago",impact:"China becoming Russia's primary economic lifeline.",people:"Chinese goods replace Western brands in Russian markets.",tradeEffect:"Yuan settlement expands; SWIFT exclusion impact reduced"},
      {title:"Wagner/Africa Corps controls Sahel mineral wealth — $15B/year",source:"FT",country:"Russia",severity:"medium",category:"politics",ago:"10h ago",impact:"Russia extracting gold, uranium, and lithium from Mali, Niger, Burkina.",people:"Local populations subject to security contractor governance.",tradeEffect:"Uranium miners watchlist; African sovereign debt risk elevated"},
    ],
    "middle east":[
      {title:"Gaza ceasefire negotiations collapse — IDF ground operations resume",source:"Reuters",country:"Middle East",severity:"critical",category:"politics",ago:"1h ago",impact:"Humanitarian crisis deepens. Regional escalation risk re-elevated.",people:"2.3M Gazans facing acute food and medical supply shortages.",tradeEffect:"Oil +$2; gold safe-haven bid; regional equities risk-off"},
      {title:"Houthi missile targets Red Sea tanker — Suez diversions continue",source:"Bloomberg",country:"Middle East",severity:"high",category:"trade",ago:"2h ago",impact:"Shipping insurance premiums at record. Suez Canal -40% traffic.",people:"Global consumer goods prices rising on supply chain delays.",tradeEffect:"Dry bulk shipping +4%; Suez Canal alternative Cape route +18 days"},
      {title:"Iran nuclear: IAEA confirms 60% enrichment — breakout weeks away",source:"FT",country:"Middle East",severity:"critical",category:"politics",ago:"3h ago",impact:"Israeli strike calculations intensify. US carrier repositioned.",people:"Regional population bracing for potential Iran-Israel conflict.",tradeEffect:"Brent +$4; Israeli shekel -1%; defence stocks surge"},
      {title:"Saudi Aramco: Maintains $85/barrel fiscal breakeven defence",source:"Reuters",country:"Middle East",severity:"high",category:"economy",ago:"4h ago",impact:"OPEC+ supply discipline holding. Production cuts extended.",people:"Saudi Vision 2030 projects funded — domestic employment rising.",tradeEffect:"Brent $85-88 range; energy ETF XLE positive; airlines costs rise"},
      {title:"UAE AI hub: $100B investment attracting global tech firms",source:"Bloomberg",country:"Middle East",severity:"medium",category:"economy",ago:"5h ago",impact:"Abu Dhabi positioning as AI datacenter hub between East and West.",people:"Tech talent migration to UAE accelerating from India and Europe.",tradeEffect:"Mubadala and ADIA listed assets; DP World shipping logistics"},
      {title:"Turkey inflation 65% — Erdogan's unorthodox rates policy reversal",source:"FT",country:"Middle East",severity:"high",category:"economy",ago:"6h ago",impact:"Turkish lira at record low. Real wages collapsing.",people:"Turkish households losing purchasing power at fastest rate in 40 years.",tradeEffect:"TRY -12% YTD; Turkish eurobonds at distressed spreads"},
      {title:"Saudi-Israel normalisation: Behind-the-scenes US framework exists",source:"WSJ",country:"Middle East",severity:"medium",category:"politics",ago:"8h ago",impact:"Regional geopolitical transformation possible if Gaza resolved.",people:"Palestinian statehood pathway linked to any deal — complex politics.",tradeEffect:"Positive for regional FDI; Saudi Tadawul equities watch"},
      {title:"Qatar LNG: 30-year supply deals with Europe locked in",source:"Reuters",country:"Middle East",severity:"medium",category:"trade",ago:"10h ago",impact:"European energy security backstopped. Russian LNG displaced.",people:"Qatar GDP per capita remains highest globally at $85,000.",tradeEffect:"LNG shipping stocks positive; TTF European gas futures ease"},
    ],
    "south asia":[
      {title:"Pakistan IMF: $3B SBA tranche released — but conditions tighten",source:"Dawn/Reuters",country:"South Asia",severity:"critical",category:"economy",ago:"1h ago",impact:"Default averted near-term. FX reserves at $8B — barely 6 weeks import cover.",people:"IMF requires energy subsidy cuts — power bills rise 40% for households.",tradeEffect:"Pakistani eurobonds +3%; KSE-100 +2%; PKR slightly stronger"},
      {title:"Bangladesh: Yunus interim government faces textile sector pressure",source:"FT",country:"South Asia",severity:"high",category:"economy",ago:"2h ago",impact:"Political uncertainty affecting $45B garment export sector.",people:"4 million garment workers — mostly women — watch political stability.",tradeEffect:"Bangladesh T-bills at 12%; BDT under pressure; FDI delayed"},
      {title:"India-Pakistan: Cross-border TTP attacks from Afghanistan escalate",source:"Reuters",country:"South Asia",severity:"high",category:"politics",ago:"3h ago",impact:"Pakistan KP province security deteriorating. 1,000+ security forces killed 2024.",people:"Border communities displaced; military operations ongoing.",tradeEffect:"Pakistan defence budget crowding civilian investment"},
      {title:"Sri Lanka debt restructuring: IMF deal extended — China agreement",source:"Bloomberg",country:"South Asia",severity:"medium",category:"economy",ago:"4h ago",impact:"Debt sustainability restored. Tourism-led recovery continuing.",people:"Sri Lankans seeing basic goods return to shelves after 2022 crisis.",tradeEffect:"Sri Lanka sovereign bonds recovering; rupee stabilising at 300/$"},
      {title:"Afghanistan: Taliban ban women from NGO work — aid crisis deepens",source:"BBC",country:"South Asia",severity:"high",category:"politics",ago:"5h ago",impact:"UN aid operations severely hampered. Humanitarian catastrophe.",people:"22M Afghans at acute food insecurity — worst since 2001.",tradeEffect:"Humanitarian bonds; regional refugee pressure on Pakistan border"},
      {title:"Nepal hydro power: $5B India deal for cross-border electricity",source:"Reuters",country:"South Asia",severity:"medium",category:"trade",ago:"6h ago",impact:"Nepal energy export revenue transformative for small economy.",people:"Nepal electricity access expanding to 96% of population.",tradeEffect:"South Asia power grid integration positive; NTPC India"},
      {title:"Maldives-China: Infrastructure debt trap concerns — India pushes back",source:"FT",country:"South Asia",severity:"medium",category:"politics",ago:"8h ago",impact:"Indian Ocean geopolitics: China-India proxy competition.",people:"Maldivian fishing community concerned about Chinese lease terms.",tradeEffect:"Strategic shipping lane control implications; Indian Navy response"},
      {title:"Myanmar civil war: Junta losing ground — rebel coalition advances",source:"Reuters",country:"South Asia",severity:"high",category:"politics",ago:"10h ago",impact:"Humanitarian crisis. Regional refugee flows increasing.",people:"18M people in conflict-affected areas — ASEAN crisis management.",tradeEffect:"Myanmar jade and teak exports disrupted; border trade halted"},
    ],
    americas:[
      {title:"Fed holds rates — Wall Street rallies on rate-cut hopes",source:"WSJ",country:"Americas",severity:"high",category:"economy",ago:"1h ago",impact:"US equity markets surge; Latin American currencies gain on weaker dollar.",people:"US mortgage rates may ease; Brazilian and Mexican exporters benefit.",tradeEffect:"S&P 500 +1.2%; BRL +0.8%; MXN +0.6%; copper positive"},
      {title:"Brazil: BCB cuts Selic to 11.75% — growth recovery on track",source:"Bloomberg",country:"Americas",severity:"high",category:"economy",ago:"2h ago",impact:"Brazil's rate cut cycle boosting credit and consumer confidence.",people:"Brazilian households see lower loan costs; real estate picks up.",tradeEffect:"Ibovespa +2%; BRL stable; Petrobras and Vale positive"},
      {title:"Mexico nearshoring boom — $50B FDI in manufacturing corridor",source:"Reuters",country:"Americas",severity:"high",category:"trade",ago:"3h ago",impact:"Mexico becoming North America's manufacturing hub as firms leave China.",people:"500,000 new manufacturing jobs in Monterrey and Bajio region.",tradeEffect:"MXN strongest in 8 years; Mexican ETF EWW +3%; USMCA beneficiary"},
      {title:"Canada: BoC cuts rates to 4.5% — housing market pressure eases",source:"FT",country:"Americas",severity:"medium",category:"economy",ago:"4h ago",impact:"Canadian housing affordability improving marginally. Consumer spending recovers.",people:"Variable mortgage holders save C$200/month on average.",tradeEffect:"CAD slightly weaker; TSX +0.8%; bank stocks mixed"},
      {title:"Argentina Milei shock therapy: Inflation falls to 110% from 290%",source:"Reuters",country:"Americas",severity:"high",category:"economy",ago:"5h ago",impact:"Hyperinflation tamed but recession deep. IMF deal on track.",people:"Argentinians face sharp spending cuts — poverty rate at 45%.",tradeEffect:"ARS stabilising; Argentine bonds recovering; Merval index +15%"},
      {title:"US-Mexico border: Migration deal — new asylum processing centres",source:"AP",country:"Americas",severity:"medium",category:"politics",ago:"6h ago",impact:"Reduces political pressure on US immigration debate.",people:"Asylum seekers face longer processing times at border.",tradeEffect:"Political risk reduction; US-Mexico trade relations positive"},
      {title:"Chile: Lithium nationalisation — state takes 51% of new projects",source:"Bloomberg",country:"Americas",severity:"medium",category:"trade",ago:"8h ago",impact:"Chile controls world's largest lithium reserves — EV supply chain implications.",people:"Mining royalties fund Chilean social spending programmes.",tradeEffect:"SQM, Albemarle -3%; lithium futures volatile; EV stocks watch"},
      {title:"Colombia: Oil output falls — security situation in Arauca deteriorates",source:"Reuters",country:"Americas",severity:"medium",category:"economy",ago:"10h ago",impact:"Production disruptions tighten Latin American oil supply.",people:"Oil revenues funding social programmes at risk.",tradeEffect:"Brent +$0.5; COP under pressure; Ecopetrol -2%"},
    ],
    mena:[
      {title:"Saudi Arabia: Vision 2030 — Neom megacity construction accelerates",source:"Bloomberg",country:"MENA",severity:"high",category:"economy",ago:"1h ago",impact:"$500B project creating construction boom. Western and Asian contractors win deals.",people:"2 million jobs projected by 2030; global talent migration to KSA.",tradeEffect:"Saudi Tadawul +1.5%; construction materials demand spike; SAR pegged stable"},
      {title:"UAE: Abu Dhabi sovereign wealth hits $1.7 trillion — record deployment",source:"FT",country:"MENA",severity:"high",category:"economy",ago:"2h ago",impact:"ADIA and Mubadala investing heavily in AI, biotech, and infrastructure globally.",people:"UAE citizenisation targets driving local employment in finance and tech.",tradeEffect:"ADX and DFM indices positive; AED pegged; UAE bonds tighten"},
      {title:"Iran oil exports hit 1.8M bbl/day despite sanctions — China buying",source:"Reuters",country:"MENA",severity:"high",category:"trade",ago:"3h ago",impact:"Sanctions circumvention via China reducing pressure on Tehran.",people:"Iranian oil workers employed; consumer goods still scarce.",tradeEffect:"Brent capped at $90; OPEC+ discipline challenged; shadow tanker fleet"},
      {title:"Israel: Tech sector resilient despite war — $4B VC funding in 2024",source:"Haaretz/Bloomberg",country:"MENA",severity:"medium",category:"economy",ago:"4h ago",impact:"Israel tech exporting despite conflict — cyber and defence tech booming.",people:"Tech workers relocating; startups pivoting to defence applications.",tradeEffect:"ILS stabilising; Israeli tech ETF ISRQ positive; Check Point, CyberArk"},
      {title:"Egypt IMF deal: $8B programme — pound devaluation to LE 48/$",source:"Reuters",country:"MENA",severity:"critical",category:"economy",ago:"5h ago",impact:"Egypt avoiding default. Reforms require painful subsidy cuts.",people:"Egyptian households face 40% higher food prices from devaluation.",tradeEffect:"Egyptian bonds +5%; EGP stable post-devaluation; Suez canal revenues key"},
      {title:"Turkey: Rate cut premature — lira hits fresh record low 38/$",source:"Bloomberg",country:"MENA",severity:"high",category:"economy",ago:"6h ago",impact:"Turkish monetary policy uncertainty scaring foreign investors.",people:"Turkish families see purchasing power fall — food inflation 70%.",tradeEffect:"TRY -8% MTD; Turkish eurobonds at 9% yield; BIST100 in lira terms up"},
      {title:"Qatar LNG: Europe supply deal signed — 27-year agreement",source:"FT",country:"MENA",severity:"medium",category:"trade",ago:"8h ago",impact:"European energy security backstopped for a generation.",people:"Qatar's 300,000 citizens each share $85,000 GDP per capita.",tradeEffect:"TTF European gas futures ease; LNG tanker demand high; QE Index"},
      {title:"Kuwait: Oil production above OPEC quota — tensions within cartel",source:"Reuters",country:"MENA",severity:"medium",category:"trade",ago:"10h ago",impact:"OPEC+ discipline cracks. Price support weakening.",people:"Kuwait welfare state funded by oil — no personal income tax.",tradeEffect:"Brent -$1; OPEC credibility debate; Gulf markets mixed"},
    ],
    "southeast asia":[
      {title:"Vietnam: $50B manufacturing hub — Apple, Samsung expanding",source:"Bloomberg",country:"Southeast Asia",severity:"high",category:"trade",ago:"1h ago",impact:"Vietnam becoming China+1 manufacturing champion for electronics.",people:"Factory employment in Hanoi and Ho Chi Minh City surging.",tradeEffect:"VND stable; Vietnam ETF VNM +4%; electronics export data watch"},
      {title:"Indonesia: Prabowo energy transition — $20B coal phase-out plan",source:"Reuters",country:"Southeast Asia",severity:"high",category:"economy",ago:"2h ago",impact:"World's largest coal exporter pivoting to green energy.",people:"200,000 coal miners facing retraining programmes.",tradeEffect:"Indonesian coal stocks -5%; nickel and palm oil positive; IDR watch"},
      {title:"Singapore: MAS eases monetary policy — S$NEER band widened",source:"FT",country:"Southeast Asia",severity:"high",category:"economy",ago:"3h ago",impact:"Singapore's de-facto rate cut signals growth concerns.",people:"Singapore homeowners see mortgage relief; retail spending picks up.",tradeEffect:"SGD slightly weaker; STI +0.8%; DBS, OCBC, UOB banking stocks"},
      {title:"Philippines: Marcos-Duterte political clash — coalition fractures",source:"Reuters",country:"Southeast Asia",severity:"medium",category:"politics",ago:"4h ago",impact:"Political uncertainty in Southeast Asia's fastest growing economy.",people:"Infrastructure projects at risk of delay; FDI pauses.",tradeEffect:"PHP under pressure; PSEi -1.5%; property and construction stocks"},
      {title:"Thailand tourism: Chinese visitors returning — 5M target hit",source:"Bloomberg",country:"Southeast Asia",severity:"medium",category:"economy",ago:"5h ago",impact:"Tourism-dependent economy recovering post-COVID.",people:"Hospitality and service sector jobs recovering in Bangkok and Phuket.",tradeEffect:"THB appreciates; hotel and airline stocks positive; SET index +1%"},
      {title:"Myanmar: Junta loses Mandalay — rebel coalition controls north",source:"Reuters",country:"Southeast Asia",severity:"critical",category:"politics",ago:"6h ago",impact:"Regional instability. ASEAN emergency mechanism activated.",people:"1.5M internally displaced in conflict zones; aid access blocked.",tradeEffect:"Myanmar border trade disrupted; refugee pressure on Thailand, India"},
      {title:"ASEAN summit: South China Sea code of conduct stalls — China blocks",source:"AP",country:"Southeast Asia",severity:"high",category:"politics",ago:"8h ago",impact:"Territorial disputes unresolved. US-China proxy tensions in waterway.",people:"Filipino and Vietnamese fishing communities facing harassment.",tradeEffect:"Philippines defence spending up; US arms sales to ASEAN rising"},
      {title:"Malaysia: Semiconductor hub — Intel and Infineon expand Penang plants",source:"Bloomberg",country:"Southeast Asia",severity:"medium",category:"trade",ago:"10h ago",impact:"Malaysia benefits from US-China chip decoupling strategy.",people:"30,000 new engineering jobs in Penang Silicon Corridor.",tradeEffect:"MYR positive; Bursa Malaysia tech stocks +3%; logistics demand"},
    ],
    africa:[
      {title:"Nigeria: Naira stabilises at 1,600/$ — Tinubu reforms bearing fruit",source:"Reuters",country:"Africa",severity:"high",category:"economy",ago:"1h ago",impact:"Nigeria's bold petrol subsidy removal and FX unification working.",people:"Nigerians face higher fuel costs but economy stabilising.",tradeEffect:"NGN stable; Dangote Cement and Nigerian banks recovering; eurobonds +4%"},
      {title:"South Africa: Eskom power cuts end — grid stability restored",source:"Bloomberg",country:"Africa",severity:"high",category:"economy",ago:"2h ago",impact:"GDP uplift of 1.5% expected from load-shedding end. Industry recovery.",people:"South African businesses and households end 4,000 hours of cuts.",tradeEffect:"ZAR strengthens; JSE All Share +2%; Sasol, Implats, AngloGold positive"},
      {title:"Kenya: IMF loan approved — government spending cuts required",source:"FT",country:"Africa",severity:"medium",category:"economy",ago:"3h ago",impact:"Kenya avoids default. Tax protests had derailed previous budget.",people:"Kenyans face austerity — healthcare and education budgets cut.",tradeEffect:"KES recovers to 130/$; Nairobi Securities Exchange cautiously positive"},
      {title:"Ethiopia: Peace holding — Tigray reconstruction $20B plan",source:"Reuters",country:"Africa",severity:"medium",category:"politics",ago:"4h ago",impact:"Post-conflict economic recovery underway in Horn of Africa.",people:"600,000 displaced Tigrayans returning; food aid being phased out.",tradeEffect:"Ethiopian bonds recovering; Chinese infrastructure investment resuming"},
      {title:"DRC: Critical mineral deals — US competes with China for cobalt",source:"FT",country:"Africa",severity:"high",category:"trade",ago:"5h ago",impact:"DRC controls 70% of global cobalt — EV battery supply chain strategic.",people:"Artisanal miners in Katanga benefit or displaced by industrial deals.",tradeEffect:"Cobalt futures +8%; Glencore, CMOC watchlist; US Minerals Security Partnership"},
      {title:"Africa free trade: AfCFTA corridor launches — 54 nations trading",source:"Bloomberg",country:"Africa",severity:"medium",category:"trade",ago:"6h ago",impact:"$3.4 trillion market integrating. Infrastructure the key bottleneck.",people:"Intra-African traders gain from reduced tariffs and border friction.",tradeEffect:"Pan-African infrastructure ETF; telecoms and logistics sector positive"},
      {title:"Sahel coup states: Wagner/Africa Corps mineral extraction deepens",source:"Reuters",country:"Africa",severity:"critical",category:"politics",ago:"8h ago",impact:"Russia extracting $15B/year in gold, uranium from Mali, Niger, Burkina.",people:"Local populations face military rule; NGOs expelled.",tradeEffect:"Uranium spot price; gold miners in stable African states benefit"},
      {title:"Egypt: Suez Canal revenues fall 40% on Houthi Red Sea crisis",source:"FT",country:"Africa",severity:"high",category:"trade",ago:"10h ago",impact:"Canal revenues $7B vs $14B prior year. Egypt FX reserves stressed.",people:"Canal workers and Egyptian port economy severely impacted.",tradeEffect:"EGP under pressure; Egyptian sovereign spreads widen; shipping reroutes"},
    ],
    "east asia":[
      {title:"Japan: BoJ raises rates to 0.5% — yen strengthens sharply",source:"Reuters",country:"East Asia",severity:"high",category:"economy",ago:"1h ago",impact:"Japan's historic rate normalisation. Yen carry trade unwind accelerating.",people:"Japanese households see savings rates improve; import costs fall.",tradeEffect:"JPY 145/$; Nikkei -2% on yen strength; Toyota, Sony export margins squeezed"},
      {title:"South Korea: Samsung chip recovery — HBM3E dominates AI demand",source:"Bloomberg",country:"East Asia",severity:"high",category:"economy",ago:"2h ago",impact:"Korean semiconductor export surge. Trade balance back in surplus.",people:"Samsung and SK Hynix employees see bonus recovery.",tradeEffect:"KRW strengthens; KOSPI +2.5%; Samsung Electronics +4%"},
      {title:"Taiwan: TSMC 2nm mass production — Apple and NVIDIA lead orders",source:"FT",country:"East Asia",severity:"high",category:"economy",ago:"3h ago",impact:"Taiwan maintains semiconductor supremacy. Geopolitical premium elevated.",people:"TSMC employs 80,000 — average salary $100K. Tech ecosystem thriving.",tradeEffect:"TWD stable; TSMC ADR +3%; global chip supply relief; AI stocks positive"},
      {title:"North Korea: ICBM test — UN emergency session called",source:"Reuters",country:"East Asia",severity:"critical",category:"politics",ago:"4h ago",impact:"Regional security alert. South Korea and Japan scramble jets.",people:"North Korean citizens isolated — 42% food insecure per UN.",tradeEffect:"Safe havens bid: gold +0.8%, JPY +0.5%; South Korean defence stocks +5%"},
      {title:"China-Taiwan: PLA drone incursions hit record 200 in one week",source:"Bloomberg",country:"East Asia",severity:"high",category:"politics",ago:"5h ago",impact:"Taiwan Strait tensions at highest since 1996 crisis. US carrier positioned.",people:"Taiwanese population on heightened alert; insurance premiums rising.",tradeEffect:"TSMC -1%; Asian equities risk-off; gold and JPY safe-haven flows"},
      {title:"Japan defence: Record ¥9.7 trillion budget — Tomahawk missiles ordered",source:"FT",country:"East Asia",severity:"medium",category:"politics",ago:"6h ago",impact:"Japan's post-pacifist era. US alliance deepening. China concerned.",people:"Japan taxpayers funding historic defence expansion.",tradeEffect:"Mitsubishi Heavy, Kawasaki Heavy, IHI defence stocks +6%"},
      {title:"Mongolia: Rare earth deal — Japan and US secure 30-year supply",source:"Reuters",country:"East Asia",severity:"medium",category:"trade",ago:"8h ago",impact:"Diversification from Chinese rare earth dominance achieved.",people:"Mongolia GDP expected to double from mining revenues.",tradeEffect:"Rare earth ETF positive; Chinese RE miners lose pricing power"},
      {title:"Hong Kong: Financial hub status declining — Singapore overtakes",source:"FT",country:"East Asia",severity:"high",category:"economy",ago:"10h ago",impact:"Capital outflows from HK to Singapore, Tokyo, and Dubai accelerating.",people:"Finance professionals relocating — HK population down 200,000 since 2020.",tradeEffect:"HSI underperforms; HKD peg holds; Singapore property and banks benefit"},
    ],
  };
  const key=Object.keys(ND).find(function(k){return cl.includes(k);})||null;
  if(key&&ND[key])return ND[key];
  // Global fallback
  return[
    {title:C+": Central bank decision impacts markets",source:"Reuters",country:C,severity:"high",category:"economy",ago:"1h ago",impact:"Monetary policy shift redirects capital flows globally.",people:"Borrowing costs and savings rates affected for households.",tradeEffect:"Bond repricing; currency ±1.5%; equities mixed"},
    {title:C+": Government announces major fiscal package",source:"Bloomberg",country:C,severity:"medium",category:"politics",ago:"2h ago",impact:"Fiscal expansion to stimulate growth — debt sustainability watch.",people:"Infrastructure and social spending benefit working population.",tradeEffect:"Local bonds -0.3%; construction and materials +2%"},
    {title:"Global AI investment hits $500B — productivity gap widens",source:"FT",country:"Global",severity:"medium",category:"economy",ago:"3h ago",impact:"AI reshaping labour markets. Early adopters gain competitive edge.",people:"Routine cognitive jobs at risk; AI management roles growing.",tradeEffect:"Tech indices +2%; semiconductors outperform; emerging markets lag"},
    {title:C+": Trade balance data surprises to upside",source:"AP",country:C,severity:"low",category:"trade",ago:"4h ago",impact:"Stronger exports boost currency and growth outlook.",people:"Export sector employment rising; import-competing workers pressured.",tradeEffect:"Local currency +0.5%; export sector equities positive"},
    {title:"Ransomware attack disrupts critical infrastructure globally",source:"Reuters",country:"Global",severity:"critical",category:"cyber",ago:"5h ago",impact:"Energy, finance, and healthcare systems targeted.",people:"Service disruptions affecting millions — hospitals on backup systems.",tradeEffect:"CrowdStrike, Palo Alto, Fortinet surge 3-5%"},
    {title:C+": Jobs report shows tight labour market",source:"WSJ",country:C,severity:"low",category:"economy",ago:"6h ago",impact:"Employment strength supports consumption but delays rate cuts.",people:"More job openings than seekers — wages rising above inflation.",tradeEffect:"Equities supported; bonds slightly weaker on rate delay"},
    {title:"G20 summit: Climate finance $1T commitment agreed",source:"Guardian",country:"Global",severity:"medium",category:"politics",ago:"8h ago",impact:"Clean energy investment acceleration. Fossil fuel transition funded.",people:"Green jobs in renewables created; energy transition costs shared.",tradeEffect:"Renewables ETFs gain; coal and oil long-term negative"},
    {title:C+": Foreign direct investment inflows at 3-year high",source:"Bloomberg",country:C,severity:"medium",category:"economy",ago:"10h ago",impact:"Business confidence improving. Currency and growth outlook positive.",people:"New factories and offices mean local job creation.",tradeEffect:"Local equities +1%; currency appreciates; sovereign spreads tighten"},
  ];
}
function fbMarkets(co){
  const c=(co||"USA").toLowerCase();
  if(c.includes("india"))return[
    {rank:1,symbol:"RELIANCE.NS",name:"Reliance Industries",sector:"Energy/Conglomerate",price:"₹2,924",change1d:"+1.24%",change1d_raw:1.24,change1w:"+3.10%",change1w_raw:3.10,change1m:"+6.80%",change1m_raw:6.80,volume:"12M",marketCap:"₹19.8T",pe:"27.4",signal:"BUY",signalStrength:76,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"₹3,200",upside:"+9%",riskLevel:"LOW",whyNow:"Jio subscriber growth beats estimates; retail margin expansion.",catalyst:"Digital services and green energy investment unlocking value.",trend:"up"},
    {rank:2,symbol:"TCS.NS",name:"Tata Consultancy Services",sector:"IT Services",price:"₹4,128",change1d:"+0.82%",change1d_raw:0.82,change1w:"+2.40%",change1w_raw:2.40,change1m:"+4.20%",change1m_raw:4.20,volume:"4M",marketCap:"₹15.0T",pe:"32.1",signal:"STRONG BUY",signalStrength:84,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"₹4,650",upside:"+13%",riskLevel:"LOW",whyNow:"AI services deal pipeline at record. Institutional accumulation.",catalyst:"GenAI revenue expected to double in FY26.",trend:"up"},
    {rank:3,symbol:"HDFCBANK.NS",name:"HDFC Bank",sector:"Financials",price:"₹1,782",change1d:"-0.34%",change1d_raw:-0.34,change1w:"+1.20%",change1w_raw:1.20,change1m:"-1.80%",change1m_raw:-1.80,volume:"9M",marketCap:"₹13.6T",pe:"19.6",signal:"HOLD",signalStrength:62,shortTerm:"NEUTRAL",longTerm:"BULLISH",targetPrice:"₹1,950",upside:"+9%",riskLevel:"LOW",whyNow:"NIM compression concerns near-term; deposit growth normalising.",catalyst:"Credit growth steady above 15% YoY.",trend:"flat"},
    {rank:4,symbol:"INFY.NS",name:"Infosys Ltd",sector:"IT Services",price:"₹1,912",change1d:"+1.56%",change1d_raw:1.56,change1w:"+4.80%",change1w_raw:4.80,change1m:"+9.20%",change1m_raw:9.20,volume:"7M",marketCap:"₹8.0T",pe:"25.8",signal:"BUY",signalStrength:78,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"₹2,180",upside:"+14%",riskLevel:"LOW",whyNow:"Large deal wins accelerating in BFSI and manufacturing.",catalyst:"FY26 guidance upgrade likely; GenAI margin tailwind.",trend:"up"},
    {rank:5,symbol:"ITC.NS",name:"ITC Limited",sector:"Consumer Staples",price:"₹442",change1d:"+2.14%",change1d_raw:2.14,change1w:"+3.90%",change1w_raw:3.90,change1m:"+7.40%",change1m_raw:7.40,volume:"18M",marketCap:"₹5.5T",pe:"27.3",signal:"BUY",signalStrength:72,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"₹520",upside:"+18%",riskLevel:"LOW",whyNow:"Hotel demerger creating value unlock.",catalyst:"FMCG segment growing 12% YoY; agribusiness recovery.",trend:"up"},
  ];
  if(c.includes("china"))return[
    {rank:1,symbol:"0700.HK",name:"Tencent Holdings",sector:"Technology",price:"HK$368",change1d:"+1.84%",change1d_raw:1.84,change1w:"+5.20%",change1w_raw:5.20,change1m:"+12.40%",change1m_raw:12.40,volume:"22M",marketCap:"HK$3.5T",pe:"22.4",signal:"STRONG BUY",signalStrength:81,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"HK$420",upside:"+14%",riskLevel:"LOW",whyNow:"WeChat mini-game monetisation surging; AI model commercialisation.",catalyst:"Hunyuan AI platform driving cloud revenue acceleration.",trend:"up"},
    {rank:2,symbol:"9988.HK",name:"Alibaba Group",sector:"E-Commerce/Cloud",price:"HK$88",change1d:"-0.68%",change1d_raw:-0.68,change1w:"+2.10%",change1w_raw:2.10,change1m:"+8.60%",change1m_raw:8.60,volume:"34M",marketCap:"HK$1.9T",pe:"12.8",signal:"BUY",signalStrength:74,shortTerm:"BULLISH",longTerm:"NEUTRAL",targetPrice:"HK$105",upside:"+19%",riskLevel:"MEDIUM",whyNow:"Cloud growth reaccelerating; regulatory environment improving.",catalyst:"AI Qwen model adoption in enterprise segment.",trend:"up"},
    {rank:3,symbol:"002594.SZ",name:"BYD Co Ltd",sector:"EV/Auto",price:"¥326",change1d:"-1.24%",change1d_raw:-1.24,change1w:"-2.80%",change1w_raw:-2.80,change1m:"+3.40%",change1m_raw:3.40,volume:"8M",marketCap:"¥940B",pe:"18.2",signal:"HOLD",signalStrength:57,shortTerm:"NEUTRAL",longTerm:"BULLISH",targetPrice:"¥370",upside:"+13%",riskLevel:"MEDIUM",whyNow:"Domestic price war pressuring margins near-term.",catalyst:"Overseas EV expansion into Europe and Southeast Asia.",trend:"down"},
    {rank:4,symbol:"601318.SS",name:"Ping An Insurance",sector:"Financials",price:"¥42",change1d:"+0.94%",change1d_raw:0.94,change1w:"+1.80%",change1w_raw:1.80,change1m:"+5.20%",change1m_raw:5.20,volume:"15M",marketCap:"¥765B",pe:"8.4",signal:"BUY",signalStrength:70,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"¥52",upside:"+24%",riskLevel:"LOW",whyNow:"P&C premium growth beats estimates; govt property support.",catalyst:"6.8% dividend yield at current price.",trend:"up"},
    {rank:5,symbol:"600519.SS",name:"Kweichow Moutai",sector:"Consumer/Spirits",price:"¥1,688",change1d:"+0.42%",change1d_raw:0.42,change1w:"+1.20%",change1w_raw:1.20,change1m:"+2.80%",change1m_raw:2.80,volume:"1M",marketCap:"¥2.1T",pe:"28.6",signal:"HOLD",signalStrength:65,shortTerm:"NEUTRAL",longTerm:"BULLISH",targetPrice:"¥1,900",upside:"+13%",riskLevel:"LOW",whyNow:"Premium spirits demand stabilising after inventory correction.",catalyst:"Wholesale price recovery; brand pricing power intact.",trend:"flat"},
  ];
  if(c.includes("uk")||c.includes("brit"))return[
    {rank:1,symbol:"AZN.L",name:"AstraZeneca PLC",sector:"Pharmaceuticals",price:"£116",change1d:"+0.98%",change1d_raw:0.98,change1w:"+2.80%",change1w_raw:2.80,change1m:"+6.40%",change1m_raw:6.40,volume:"4M",marketCap:"£183B",pe:"34.2",signal:"STRONG BUY",signalStrength:82,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"£134",upside:"+15%",riskLevel:"LOW",whyNow:"Cancer drug pipeline approvals accelerating.",catalyst:"Oncology portfolio revenue +23% YoY; Tagrisso market expansion.",trend:"up"},
    {rank:2,symbol:"HSBA.L",name:"HSBC Holdings",sector:"Financials",price:"£7.05",change1d:"+1.14%",change1d_raw:1.14,change1w:"+3.40%",change1w_raw:3.40,change1m:"+8.20%",change1m_raw:8.20,volume:"28M",marketCap:"£137B",pe:"7.4",signal:"BUY",signalStrength:75,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"£8.20",upside:"+16%",riskLevel:"LOW",whyNow:"Asia business revenue beats estimates; $3B buyback.",catalyst:"Wealth management AUM record; Hong Kong recovery.",trend:"up"},
    {rank:3,symbol:"SHEL.L",name:"Shell PLC",sector:"Energy",price:"£28",change1d:"-0.46%",change1d_raw:-0.46,change1w:"+1.10%",change1w_raw:1.10,change1m:"-3.20%",change1m_raw:-3.20,volume:"12M",marketCap:"£174B",pe:"8.8",signal:"HOLD",signalStrength:61,shortTerm:"NEUTRAL",longTerm:"BULLISH",targetPrice:"£31",upside:"+11%",riskLevel:"MEDIUM",whyNow:"Oil price near-term headwind; LNG margins compressing.",catalyst:"4.1% dividend yield provides income floor.",trend:"flat"},
    {rank:4,symbol:"ULVR.L",name:"Unilever PLC",sector:"Consumer Staples",price:"£43",change1d:"+0.56%",change1d_raw:0.56,change1w:"+1.80%",change1w_raw:1.80,change1m:"+4.60%",change1m_raw:4.60,volume:"6M",marketCap:"£53B",pe:"19.2",signal:"BUY",signalStrength:68,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"£50",upside:"+16%",riskLevel:"LOW",whyNow:"Beauty & Wellbeing outperforming; pricing power restored.",catalyst:"Ice Cream demerger to crystallise value.",trend:"up"},
    {rank:5,symbol:"BP.L",name:"BP PLC",sector:"Energy",price:"£4.32",change1d:"-1.22%",change1d_raw:-1.22,change1w:"-2.40%",change1w_raw:-2.40,change1m:"-6.80%",change1m_raw:-6.80,volume:"35M",marketCap:"£70B",pe:"7.2",signal:"SELL",signalStrength:36,shortTerm:"BEARISH",longTerm:"NEUTRAL",targetPrice:"£4.20",upside:"-3%",riskLevel:"HIGH",whyNow:"Strategy review disappointing market; capex cut concerns.",catalyst:"Potential buyback reduction risk.",trend:"down"},
  ];
  if(c.includes("germany"))return[
    {rank:1,symbol:"SAP.DE",name:"SAP SE",sector:"Enterprise Software",price:"€196",change1d:"+1.64%",change1d_raw:1.64,change1w:"+4.20%",change1w_raw:4.20,change1m:"+9.80%",change1m_raw:9.80,volume:"2M",marketCap:"€240B",pe:"42.8",signal:"STRONG BUY",signalStrength:85,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"€228",upside:"+16%",riskLevel:"LOW",whyNow:"Cloud revenue growing 28% YoY; AI Copilot driving upsell.",catalyst:"RISE with SAP migrations accelerating in 2025.",trend:"up"},
    {rank:2,symbol:"SIE.DE",name:"Siemens AG",sector:"Industrial Technology",price:"€178",change1d:"+0.84%",change1d_raw:0.84,change1w:"+2.10%",change1w_raw:2.10,change1m:"+5.60%",change1m_raw:5.60,volume:"3M",marketCap:"€147B",pe:"18.4",signal:"BUY",signalStrength:74,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"€204",upside:"+15%",riskLevel:"LOW",whyNow:"Energy grid automation backlog at record.",catalyst:"German industrial rebound beneficiary.",trend:"up"},
    {rank:3,symbol:"ALV.DE",name:"Allianz SE",sector:"Insurance",price:"€268",change1d:"+0.46%",change1d_raw:0.46,change1w:"+1.40%",change1w_raw:1.40,change1m:"+3.80%",change1m_raw:3.80,volume:"1M",marketCap:"€111B",pe:"12.8",signal:"BUY",signalStrength:71,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"€310",upside:"+16%",riskLevel:"LOW",whyNow:"Combined ratio improvement; NII benefit from high rates.",catalyst:"6.2% dividend yield; share buyback ongoing.",trend:"up"},
    {rank:4,symbol:"BAS.DE",name:"BASF SE",sector:"Chemicals",price:"€42",change1d:"-0.68%",change1d_raw:-0.68,change1w:"-1.20%",change1w_raw:-1.20,change1m:"-4.60%",change1m_raw:-4.60,volume:"4M",marketCap:"€37B",pe:"14.6",signal:"HOLD",signalStrength:51,shortTerm:"BEARISH",longTerm:"NEUTRAL",targetPrice:"€46",upside:"+10%",riskLevel:"MEDIUM",whyNow:"European energy costs still elevated; China demand weak.",catalyst:"Restructuring savings €1.1B targeted for 2026.",trend:"down"},
    {rank:5,symbol:"BMW.DE",name:"BMW AG",sector:"Automobiles",price:"€82",change1d:"+1.28%",change1d_raw:1.28,change1w:"+2.80%",change1w_raw:2.80,change1m:"-1.40%",change1m_raw:-1.40,volume:"2M",marketCap:"€53B",pe:"6.8",signal:"BUY",signalStrength:67,shortTerm:"BULLISH",longTerm:"NEUTRAL",targetPrice:"€96",upside:"+17%",riskLevel:"MEDIUM",whyNow:"Neue Klasse EV platform investor day catalyst.",catalyst:"8.4% dividend yield at current price.",trend:"up"},
  ];
  if(c.includes("japan"))return[
    {rank:1,symbol:"7203.T",name:"Toyota Motor Corp",sector:"Automobiles",price:"¥3,812",change1d:"+1.46%",change1d_raw:1.46,change1w:"+3.20%",change1w_raw:3.20,change1m:"+7.80%",change1m_raw:7.80,volume:"14M",marketCap:"¥60T",pe:"10.8",signal:"STRONG BUY",signalStrength:82,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"¥4,400",upside:"+15%",riskLevel:"LOW",whyNow:"Hybrid demand surging globally; US tariff exemption for hybrids.",catalyst:"Solid State battery commercialisation by 2027.",trend:"up"},
    {rank:2,symbol:"7974.T",name:"Nintendo Co Ltd",sector:"Gaming/Entertainment",price:"¥8,840",change1d:"+2.18%",change1d_raw:2.18,change1w:"+5.60%",change1w_raw:5.60,change1m:"+11.40%",change1m_raw:11.40,volume:"3M",marketCap:"¥11T",pe:"22.8",signal:"STRONG BUY",signalStrength:86,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"¥10,200",upside:"+15%",riskLevel:"LOW",whyNow:"Switch 2 pre-orders exceeding expectations worldwide.",catalyst:"New IP releases; online subscription growth.",trend:"up"},
    {rank:3,symbol:"6758.T",name:"Sony Group Corp",sector:"Electronics/Entertainment",price:"¥13,240",change1d:"+0.64%",change1d_raw:0.64,change1w:"+2.40%",change1w_raw:2.40,change1m:"+5.60%",change1m_raw:5.60,volume:"4M",marketCap:"¥17T",pe:"18.2",signal:"BUY",signalStrength:76,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"¥15,000",upside:"+13%",riskLevel:"LOW",whyNow:"PlayStation game pipeline strong; image sensor demand rising.",catalyst:"Music/film streaming royalties growing 18% YoY.",trend:"up"},
    {rank:4,symbol:"9984.T",name:"SoftBank Group",sector:"Technology/VC",price:"¥8,924",change1d:"-1.14%",change1d_raw:-1.14,change1w:"-0.80%",change1w_raw:-0.80,change1m:"+4.20%",change1m_raw:4.20,volume:"7M",marketCap:"¥15T",pe:"N/A",signal:"HOLD",signalStrength:58,shortTerm:"NEUTRAL",longTerm:"BULLISH",targetPrice:"¥9,800",upside:"+10%",riskLevel:"HIGH",whyNow:"Arm Holdings valuation drives NAV; AI investment thesis.",catalyst:"Vision Fund II recovery on AI portfolio gains.",trend:"flat"},
    {rank:5,symbol:"6861.T",name:"Keyence Corp",sector:"Industrial Automation",price:"¥67,200",change1d:"+0.82%",change1d_raw:0.82,change1w:"+2.80%",change1w_raw:2.80,change1m:"+6.40%",change1m_raw:6.40,volume:"0.4M",marketCap:"¥18T",pe:"46.4",signal:"BUY",signalStrength:73,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"¥76,000",upside:"+13%",riskLevel:"LOW",whyNow:"Factory automation order recovery in Asia.",catalyst:"AI-driven quality control driving global adoption.",trend:"up"},
  ];
  if(c.includes("korea"))return[
    {rank:1,symbol:"005930.KS",name:"Samsung Electronics",sector:"Semiconductors",price:"₩58,400",change1d:"+2.14%",change1d_raw:2.14,change1w:"+5.80%",change1w_raw:5.80,change1m:"+12.60%",change1m_raw:12.60,volume:"18M",marketCap:"₩348T",pe:"24.8",signal:"STRONG BUY",signalStrength:85,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"₩70,000",upside:"+20%",riskLevel:"LOW",whyNow:"HBM3E memory for AI servers in full production; NVIDIA supply chain.",catalyst:"Advanced packaging revenues ramping in H2 2025.",trend:"up"},
    {rank:2,symbol:"000660.KS",name:"SK Hynix",sector:"Memory Semiconductors",price:"₩186,500",change1d:"+3.24%",change1d_raw:3.24,change1w:"+8.40%",change1w_raw:8.40,change1m:"+18.20%",change1m_raw:18.20,volume:"5M",marketCap:"₩136T",pe:"N/A",signal:"STRONG BUY",signalStrength:89,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"₩220,000",upside:"+18%",riskLevel:"MEDIUM",whyNow:"Dominant HBM3E supplier for AI GPUs; pricing power unprecedented.",catalyst:"AI data center capex supercycle extending to 2026.",trend:"up"},
    {rank:3,symbol:"005380.KS",name:"Hyundai Motor",sector:"Automobiles",price:"₩212,000",change1d:"+1.18%",change1d_raw:1.18,change1w:"+2.80%",change1w_raw:2.80,change1m:"+4.60%",change1m_raw:4.60,volume:"2M",marketCap:"₩45T",pe:"6.4",signal:"BUY",signalStrength:74,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"₩250,000",upside:"+18%",riskLevel:"LOW",whyNow:"EV market share gains in USA and Europe.",catalyst:"IONIQ 9 SUV launch; robotics JV upside.",trend:"up"},
    {rank:4,symbol:"051910.KS",name:"LG Chem",sector:"Battery/Chemicals",price:"₩246,000",change1d:"-0.84%",change1d_raw:-0.84,change1w:"-2.40%",change1w_raw:-2.40,change1m:"-6.80%",change1m_raw:-6.80,volume:"1M",marketCap:"₩17T",pe:"28.2",signal:"HOLD",signalStrength:54,shortTerm:"BEARISH",longTerm:"NEUTRAL",targetPrice:"₩280,000",upside:"+14%",riskLevel:"MEDIUM",whyNow:"EV battery demand slowdown pressuring margins.",catalyst:"Specialty chemicals and pharma materials resilient.",trend:"down"},
    {rank:5,symbol:"035720.KS",name:"Kakao Corp",sector:"Internet/Platform",price:"₩38,250",change1d:"-1.44%",change1d_raw:-1.44,change1w:"-3.20%",change1w_raw:-3.20,change1m:"-8.40%",change1m_raw:-8.40,volume:"4M",marketCap:"₩17T",pe:"42.6",signal:"SELL",signalStrength:34,shortTerm:"BEARISH",longTerm:"NEUTRAL",targetPrice:"₩38,000",upside:"-1%",riskLevel:"HIGH",whyNow:"Regulatory investigation overhang; founder legal risk.",catalyst:"KakaoTalk AI integration potential recovery.",trend:"down"},
  ];
  if(c.includes("brazil"))return[
    {rank:1,symbol:"PETR4.SA",name:"Petrobras",sector:"Energy",price:"R$36.82",change1d:"+1.42%",change1d_raw:1.42,change1w:"+3.80%",change1w_raw:3.80,change1m:"+8.40%",change1m_raw:8.40,volume:"68M",marketCap:"R$481B",pe:"5.8",signal:"BUY",signalStrength:73,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"R$43",upside:"+17%",riskLevel:"MEDIUM",whyNow:"Pre-salt production at record; quarterly dividend confirmed.",catalyst:"8.2% dividend yield; Búzios field expansion.",trend:"up"},
    {rank:2,symbol:"WEGE3.SA",name:"WEG SA",sector:"Industrial/Electric Motors",price:"R$48.60",change1d:"+2.24%",change1d_raw:2.24,change1w:"+5.40%",change1w_raw:5.40,change1m:"+11.20%",change1m_raw:11.20,volume:"8M",marketCap:"R$193B",pe:"38.4",signal:"STRONG BUY",signalStrength:83,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"R$57",upside:"+17%",riskLevel:"LOW",whyNow:"Electric motor demand surging; 65% international revenue.",catalyst:"Energy transition infrastructure contracts pipeline.",trend:"up"},
    {rank:3,symbol:"ITUB4.SA",name:"Itaú Unibanco",sector:"Financials",price:"R$36.28",change1d:"+1.14%",change1d_raw:1.14,change1w:"+2.60%",change1w_raw:2.60,change1m:"+6.80%",change1m_raw:6.80,volume:"38M",marketCap:"R$354B",pe:"9.8",signal:"BUY",signalStrength:78,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"R$43",upside:"+18%",riskLevel:"LOW",whyNow:"ROE above 22%; best-in-class capital allocation.",catalyst:"Digital banking client growth +28% YoY.",trend:"up"},
    {rank:4,symbol:"VALE3.SA",name:"Vale SA",sector:"Mining/Metals",price:"R$64.40",change1d:"-0.84%",change1d_raw:-0.84,change1w:"-1.60%",change1w_raw:-1.60,change1m:"-4.20%",change1m_raw:-4.20,volume:"42M",marketCap:"R$295B",pe:"7.4",signal:"HOLD",signalStrength:55,shortTerm:"NEUTRAL",longTerm:"BULLISH",targetPrice:"R$72",upside:"+12%",riskLevel:"MEDIUM",whyNow:"Iron ore price pressure from China demand uncertainty.",catalyst:"Copper division growth; base metals diversification.",trend:"flat"},
    {rank:5,symbol:"EMBR3.SA",name:"Embraer SA",sector:"Aerospace/Defence",price:"R$42.80",change1d:"+1.68%",change1d_raw:1.68,change1w:"+4.20%",change1w_raw:4.20,change1m:"+9.60%",change1m_raw:9.60,volume:"6M",marketCap:"R$40B",pe:"22.6",signal:"BUY",signalStrength:76,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"R$50",upside:"+17%",riskLevel:"MEDIUM",whyNow:"E-Jet backlog at record; regional aviation boom.",catalyst:"EVE eVTOL certification progress for urban air mobility.",trend:"up"},
  ];
  if(c.includes("uae")||c.includes("dubai"))return[
    {rank:1,symbol:"FAB.AD",name:"First Abu Dhabi Bank",sector:"Financials",price:"AED 14.82",change1d:"+1.04%",change1d_raw:1.04,change1w:"+2.40%",change1w_raw:2.40,change1m:"+5.20%",change1m_raw:5.20,volume:"8M",marketCap:"AED 214B",pe:"14.8",signal:"STRONG BUY",signalStrength:81,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"AED 17.50",upside:"+18%",riskLevel:"LOW",whyNow:"Profit growth +14% on high rate environment.",catalyst:"GCC trade finance and wealth management leadership.",trend:"up"},
    {rank:2,symbol:"EMAAR.DU",name:"Emaar Properties",sector:"Real Estate",price:"AED 8.72",change1d:"+0.92%",change1d_raw:0.92,change1w:"+2.80%",change1w_raw:2.80,change1m:"+6.40%",change1m_raw:6.40,volume:"18M",marketCap:"AED 78B",pe:"12.4",signal:"BUY",signalStrength:74,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"AED 10.20",upside:"+17%",riskLevel:"LOW",whyNow:"Dubai property sales at all-time high; record launches.",catalyst:"Expo City Phase 2 and hospitality portfolio expansion.",trend:"up"},
    {rank:3,symbol:"ADNOCDIST.AD",name:"ADNOC Distribution",sector:"Energy/Retail",price:"AED 4.10",change1d:"+0.48%",change1d_raw:0.48,change1w:"+1.20%",change1w_raw:1.20,change1m:"+3.40%",change1m_raw:3.40,volume:"5M",marketCap:"AED 51B",pe:"18.6",signal:"BUY",signalStrength:68,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"AED 4.80",upside:"+17%",riskLevel:"LOW",whyNow:"Fuel station network expansion; EV charging rollout.",catalyst:"6.2% dividend yield; Saudi market entry.",trend:"up"},
    {rank:4,symbol:"ETISALAT.AD",name:"e& (Etisalat Group)",sector:"Telecom/Technology",price:"AED 23.50",change1d:"-0.44%",change1d_raw:-0.44,change1w:"+0.80%",change1w_raw:0.80,change1m:"+2.60%",change1m_raw:2.60,volume:"3M",marketCap:"AED 212B",pe:"16.8",signal:"HOLD",signalStrength:61,shortTerm:"NEUTRAL",longTerm:"BULLISH",targetPrice:"AED 26",upside:"+11%",riskLevel:"LOW",whyNow:"5G monetisation still in early stage.",catalyst:"Digital B2B services and fintech growth.",trend:"flat"},
    {rank:5,symbol:"DIB.DU",name:"Dubai Islamic Bank",sector:"Islamic Finance",price:"AED 7.18",change1d:"+1.64%",change1d_raw:1.64,change1w:"+3.40%",change1w_raw:3.40,change1m:"+7.20%",change1m_raw:7.20,volume:"6M",marketCap:"AED 52B",pe:"10.4",signal:"BUY",signalStrength:72,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"AED 8.40",upside:"+17%",riskLevel:"LOW",whyNow:"Islamic banking demand rising; sukuk market leadership.",catalyst:"UAE retail financing growth +18% YoY.",trend:"up"},
  ];
  if(c.includes("australia"))return[
    {rank:1,symbol:"CSL.AX",name:"CSL Limited",sector:"Biotechnology",price:"A$304.60",change1d:"+1.84%",change1d_raw:1.84,change1w:"+4.80%",change1w_raw:4.80,change1m:"+9.60%",change1m_raw:9.60,volume:"2M",marketCap:"A$140B",pe:"42.4",signal:"STRONG BUY",signalStrength:84,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"A$360",upside:"+18%",riskLevel:"LOW",whyNow:"Blood plasma demand exceeds supply; Behring growing.",catalyst:"Hemgenix gene therapy royalties accelerating.",trend:"up"},
    {rank:2,symbol:"BHP.AX",name:"BHP Group",sector:"Mining/Resources",price:"A$43.28",change1d:"+1.24%",change1d_raw:1.24,change1w:"+3.40%",change1w_raw:3.40,change1m:"+7.20%",change1m_raw:7.20,volume:"12M",marketCap:"A$218B",pe:"14.8",signal:"BUY",signalStrength:73,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"A$50",upside:"+16%",riskLevel:"LOW",whyNow:"Copper demand surge for energy transition critical.",catalyst:"Potash (Jansen) first production 2026.",trend:"up"},
    {rank:3,symbol:"CBA.AX",name:"Commonwealth Bank",sector:"Financials",price:"A$136.40",change1d:"+0.82%",change1d_raw:0.82,change1w:"+2.20%",change1w_raw:2.20,change1m:"+5.40%",change1m_raw:5.40,volume:"4M",marketCap:"A$229B",pe:"22.8",signal:"HOLD",signalStrength:60,shortTerm:"NEUTRAL",longTerm:"BULLISH",targetPrice:"A$148",upside:"+9%",riskLevel:"LOW",whyNow:"Premium valuation vs peers limits near-term upside.",catalyst:"Digital banking dominance; mortgage market stable.",trend:"up"},
    {rank:4,symbol:"WES.AX",name:"Wesfarmers Ltd",sector:"Retail/Chemicals",price:"A$78.20",change1d:"+0.64%",change1d_raw:0.64,change1w:"+1.60%",change1w_raw:1.60,change1m:"+4.20%",change1m_raw:4.20,volume:"3M",marketCap:"A$89B",pe:"28.4",signal:"BUY",signalStrength:70,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"A$90",upside:"+15%",riskLevel:"LOW",whyNow:"Bunnings hardware resilient; Officeworks digital.",catalyst:"Priceline health & beauty growing 14% YoY.",trend:"up"},
    {rank:5,symbol:"ANZ.AX",name:"ANZ Banking Group",sector:"Financials",price:"A$28.82",change1d:"-0.56%",change1d_raw:-0.56,change1w:"+0.80%",change1w_raw:0.80,change1m:"+2.60%",change1m_raw:2.60,volume:"8M",marketCap:"A$82B",pe:"12.4",signal:"BUY",signalStrength:66,shortTerm:"BULLISH",longTerm:"NEUTRAL",targetPrice:"A$33",upside:"+15%",riskLevel:"LOW",whyNow:"Suncorp bank acquisition integrating on schedule.",catalyst:"6.8% dividend yield; institutional accumulation.",trend:"up"},
  ];
  if(c.includes("canada"))return[
    {rank:1,symbol:"SHOP.TO",name:"Shopify Inc",sector:"E-Commerce Technology",price:"C$124.80",change1d:"+2.44%",change1d_raw:2.44,change1w:"+6.80%",change1w_raw:6.80,change1m:"+14.20%",change1m_raw:14.20,volume:"4M",marketCap:"C$159B",pe:"68.4",signal:"STRONG BUY",signalStrength:83,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"C$148",upside:"+19%",riskLevel:"MEDIUM",whyNow:"Merchant base growing 26% YoY; Payments ARPU rising.",catalyst:"Shopify Capital and offline POS expansion.",trend:"up"},
    {rank:2,symbol:"RY.TO",name:"Royal Bank of Canada",sector:"Financials",price:"C$174.20",change1d:"+0.64%",change1d_raw:0.64,change1w:"+1.80%",change1w_raw:1.80,change1m:"+4.60%",change1m_raw:4.60,volume:"3M",marketCap:"C$246B",pe:"13.8",signal:"BUY",signalStrength:74,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"C$198",upside:"+14%",riskLevel:"LOW",whyNow:"HSBC Canada acquisition synergies materialising.",catalyst:"Wealth management record AUM; capital markets rebound.",trend:"up"},
    {rank:3,symbol:"ABX.TO",name:"Barrick Gold Corp",sector:"Gold Mining",price:"C$22.40",change1d:"+1.94%",change1d_raw:1.94,change1w:"+4.80%",change1w_raw:4.80,change1m:"+10.40%",change1m_raw:10.40,volume:"12M",marketCap:"C$39B",pe:"18.4",signal:"BUY",signalStrength:76,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"C$26",upside:"+16%",riskLevel:"MEDIUM",whyNow:"Gold at multi-year highs; production guidance raised.",catalyst:"Lumwana copper expansion; Reko Diq permit progress.",trend:"up"},
    {rank:4,symbol:"CNR.TO",name:"Canadian National Railway",sector:"Transportation",price:"C$166.80",change1d:"+0.44%",change1d_raw:0.44,change1w:"+1.20%",change1w_raw:1.20,change1m:"+3.60%",change1m_raw:3.60,volume:"2M",marketCap:"C$117B",pe:"21.6",signal:"HOLD",signalStrength:63,shortTerm:"NEUTRAL",longTerm:"BULLISH",targetPrice:"C$188",upside:"+13%",riskLevel:"LOW",whyNow:"Volume growth slightly below guidance; intermodal soft.",catalyst:"US freight market recovery expected H2 2025.",trend:"flat"},
    {rank:5,symbol:"TD.TO",name:"TD Bank Group",sector:"Financials",price:"C$82.40",change1d:"-0.84%",change1d_raw:-0.84,change1w:"-1.60%",change1w_raw:-1.60,change1m:"-4.80%",change1m_raw:-4.80,volume:"5M",marketCap:"C$149B",pe:"11.4",signal:"HOLD",signalStrength:52,shortTerm:"NEUTRAL",longTerm:"NEUTRAL",targetPrice:"C$88",upside:"+7%",riskLevel:"MEDIUM",whyNow:"US AML investigation overhang suppressing valuation.",catalyst:"Resolution settlement could unlock 15% re-rating.",trend:"down"},
  ];
  if(c.includes("france"))return[
    {rank:1,symbol:"MC.PA",name:"LVMH Moët Hennessy",sector:"Luxury Goods",price:"€768",change1d:"+1.64%",change1d_raw:1.64,change1w:"+4.20%",change1w_raw:4.20,change1m:"+9.80%",change1m_raw:9.80,volume:"1M",marketCap:"€384B",pe:"24.8",signal:"STRONG BUY",signalStrength:83,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"€900",upside:"+17%",riskLevel:"LOW",whyNow:"Asia luxury recovery accelerating; Japan inbound tourism.",catalyst:"Fashion & Leather Goods reaccelerating in H2.",trend:"up"},
    {rank:2,symbol:"AIR.PA",name:"Airbus SE",sector:"Aerospace/Defence",price:"€156.40",change1d:"+1.24%",change1d_raw:1.24,change1w:"+3.40%",change1w_raw:3.40,change1m:"+7.80%",change1m_raw:7.80,volume:"2M",marketCap:"€121B",pe:"28.4",signal:"BUY",signalStrength:77,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"€180",upside:"+15%",riskLevel:"LOW",whyNow:"A321 delivery backlog 9+ years; record orders.",catalyst:"H225M military helicopter contracts and A350 freighter.",trend:"up"},
    {rank:3,symbol:"SAN.PA",name:"Sanofi SA",sector:"Pharmaceuticals",price:"€92.80",change1d:"+0.84%",change1d_raw:0.84,change1w:"+2.20%",change1w_raw:2.20,change1m:"+5.60%",change1m_raw:5.60,volume:"2M",marketCap:"€117B",pe:"16.8",signal:"BUY",signalStrength:71,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"€108",upside:"+16%",riskLevel:"LOW",whyNow:"Dupixent label expansion driving double-digit growth.",catalyst:"Tolebrutinib MS approval could be transformative.",trend:"up"},
    {rank:4,symbol:"TTE.PA",name:"TotalEnergies SE",sector:"Energy/Renewables",price:"€61.20",change1d:"-0.46%",change1d_raw:-0.46,change1w:"+1.10%",change1w_raw:1.10,change1m:"-2.80%",change1m_raw:-2.80,volume:"6M",marketCap:"€148B",pe:"9.4",signal:"HOLD",signalStrength:62,shortTerm:"NEUTRAL",longTerm:"BULLISH",targetPrice:"€70",upside:"+14%",riskLevel:"MEDIUM",whyNow:"Oil price headwinds; LNG long-term contracts insulate.",catalyst:"Renewables capacity additions; 6.8% dividend.",trend:"flat"},
    {rank:5,symbol:"BNP.PA",name:"BNP Paribas",sector:"Financials",price:"€63.20",change1d:"+0.94%",change1d_raw:0.94,change1w:"+2.40%",change1w_raw:2.40,change1m:"+5.80%",change1m_raw:5.80,volume:"5M",marketCap:"€79B",pe:"7.6",signal:"BUY",signalStrength:70,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"€74",upside:"+17%",riskLevel:"LOW",whyNow:"CIB revenues resilient; cost cutting improving ROE.",catalyst:"6.1% dividend yield; €1.1B buyback programme.",trend:"up"},
  ];
  // Default: USA
  return[
    {rank:1,symbol:"NVDA",name:"NVIDIA Corporation",sector:"Semiconductors",price:"$875",change1d:"+2.84%",change1d_raw:2.84,change1w:"+7.20%",change1w_raw:7.20,change1m:"+18.50%",change1m_raw:18.50,volume:"42M",marketCap:"$2.16T",pe:"64.8",signal:"STRONG BUY",signalStrength:91,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"$1,050",upside:"+20%",riskLevel:"MEDIUM",whyNow:"Blackwell GPU demand exceeds supply through 2025; data center supercycle.",catalyst:"Sovereign AI capex and hyperscaler buildout through H2.",trend:"up"},
    {rank:2,symbol:"MSFT",name:"Microsoft Corporation",sector:"Cloud/AI Software",price:"$418.60",change1d:"+1.24%",change1d_raw:1.24,change1w:"+3.80%",change1w_raw:3.80,change1m:"+8.20%",change1m_raw:8.20,volume:"18M",marketCap:"$3.11T",pe:"36.4",signal:"STRONG BUY",signalStrength:86,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"$490",upside:"+17%",riskLevel:"LOW",whyNow:"Azure AI growing 31% QoQ; Copilot M365 monetising.",catalyst:"Enterprise AI adoption still in early innings.",trend:"up"},
    {rank:3,symbol:"JPM",name:"JPMorgan Chase",sector:"Financials",price:"$198.40",change1d:"-0.34%",change1d_raw:-0.34,change1w:"+1.80%",change1w_raw:1.80,change1m:"+4.60%",change1m_raw:4.60,volume:"12M",marketCap:"$570B",pe:"12.4",signal:"BUY",signalStrength:74,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"$230",upside:"+16%",riskLevel:"LOW",whyNow:"IB deal flow reaccelerating; NII guidance raised.",catalyst:"Capital markets revival and M&A pipeline building.",trend:"up"},
    {rank:4,symbol:"AAPL",name:"Apple Inc.",sector:"Technology/Consumer",price:"$193.20",change1d:"+0.68%",change1d_raw:0.68,change1w:"+2.40%",change1w_raw:2.40,change1m:"+5.60%",change1m_raw:5.60,volume:"56M",marketCap:"$2.97T",pe:"30.2",signal:"BUY",signalStrength:77,shortTerm:"BULLISH",longTerm:"BULLISH",targetPrice:"$225",upside:"+16%",riskLevel:"LOW",whyNow:"iPhone 16 AI features driving upgrade cycle.",catalyst:"Services revenue +14% YoY; Vision Pro iteration.",trend:"up"},
    {rank:5,symbol:"XOM",name:"ExxonMobil Corp",sector:"Energy",price:"$108.20",change1d:"-0.94%",change1d_raw:-0.94,change1w:"-1.80%",change1w_raw:-1.80,change1m:"-3.40%",change1m_raw:-3.40,volume:"20M",marketCap:"$468B",pe:"13.8",signal:"HOLD",signalStrength:57,shortTerm:"NEUTRAL",longTerm:"BULLISH",targetPrice:"$120",upside:"+11%",riskLevel:"MEDIUM",whyNow:"Oil price near-term pressure on margins.",catalyst:"Guyana production ramp; 3.8% dividend yield.",trend:"down"},
  ];
}
function fbPicks(co){
  const c=(co||"USA");
  const cl=c.toLowerCase();
  const{ex,idx}=getEx(c);
  // Build country-specific picks from the same realistic fallback stock data
  const mktStocks=fbMarkets(c);
  // Country-specific market context
  const CTX={
    india:{sentiment:"bullish",score:68,fg:62,d:"+0.85%",w:"+2.40%",outlook:`${c} markets supported by strong domestic institutional flows and robust Q3 earnings season. IT sector leading on AI services demand. RBI on hold supporting credit growth.`,macro:["RBI rate hold supporting credit expansion","Strong FII inflows into large-caps","Rupee stable; CAD manageable"],drivers:["Nifty earnings +12% YoY vs 8% consensus","India AI services export boom"],leading:["IT Services","Private Banks"],lagging:["Real Estate","Metals"]},
    china:{sentiment:"neutral",score:55,fg:46,d:"+0.62%",w:"+1.80%",outlook:`${c} markets recovering on policy support and AI sector re-rating. Property sector headwinds persist but stimulus floor is visible. H-shares attractive on valuation.`,macro:["PBOC easing bias supportive","Government AI investment stimulus","Property sector stabilisation measures"],drivers:["Tech sector regulatory relief","Export competitiveness intact"],leading:["Technology","State Banks"],lagging:["Property","Consumer Discretionary"]},
    uk:{sentiment:"neutral",score:58,fg:50,d:"+0.42%",w:"+1.20%",outlook:`${c} markets driven by global earners. FTSE 100 defensive attributes and high dividend yield attracting income investors. Domestic economy recovering slowly.`,macro:["BoE holding rates at 5.25%","Wage growth above CPI turning positive","Gilt yields stabilising"],drivers:["FTSE 100 global revenue insulation","M&A activity picking up"],leading:["Pharmaceuticals","Financials"],lagging:["Domestics","Housebuilders"]},
    germany:{sentiment:"negative",score:48,fg:42,d:"+0.28%",w:"+0.80%",outlook:`${c} DAX resilient due to global revenue exposure despite domestic recession. SAP and defence stocks outperforming. Fiscal reform debate ongoing.`,macro:["ECB rate cut cycle beginning","German industrial output contracting","Energy transition investment accelerating"],drivers:["Defence spending surge","SAP cloud transition"],leading:["Software","Defence"],lagging:["Chemicals","Domestic Cyclicals"]},
    japan:{sentiment:"bullish",score:71,fg:64,d:"+0.92%",w:"+2.60%",outlook:`${c} equities supported by corporate governance reforms, record Shunto wage outcomes, and sustained foreign buying. BoJ normalising gradually.`,macro:["BoJ cautious rate normalisation","Wage growth 5.1% — highest since 1991","Weak yen boosting export earnings"],drivers:["Corporate ROE reform unlocking value","NISA retail investor inflows"],leading:["Autos","Gaming/Electronics"],lagging:["Utilities","JREITs"]},
    korea:{sentiment:"bullish",score:74,fg:66,d:"+1.24%",w:"+3.80%",outlook:`${c} KOSPI driven by AI memory supercycle. Samsung and SK Hynix in tight oligopoly for HBM supply to NVIDIA. Re-rating underway.`,macro:["HBM memory pricing at record highs","BoK cautious on rate cuts","Won volatility on global risk"],drivers:["AI memory demand exceeding 2024 peak","Semiconductor equipment orders surging"],leading:["Memory Semiconductors","EV/Battery"],lagging:["Internet/Platform","Telecoms"]},
    brazil:{sentiment:"neutral",score:56,fg:48,d:"+0.74%",w:"+2.20%",outlook:`${c} Ibovespa cheap on absolute metrics. Commodity exporters well-positioned. Political/fiscal expansion risk limiting foreign appetite for duration assets.`,macro:["BCB cutting rates from 13.75% peak","Fiscal deficit risk under Lula","Strong agricultural exports underpinning BRL"],drivers:["Commodity export boom","Domestic credit growth recovery"],leading:["Agribusiness","Industrials"],lagging:["Real Estate","Consumer Credit"]},
    uae:{sentiment:"bullish",score:73,fg:67,d:"+0.88%",w:"+2.40%",outlook:`${c} markets supported by oil revenue, non-oil diversification and record FDI inflows. Dubai property market at all-time highs. Islamic finance growing.`,macro:["USD peg anchoring AED stability","Non-oil GDP growth +4.8% YoY","Record tourism arrivals driving services"],drivers:["Dubai Expo City and development pipeline","GCC capital market integration"],leading:["Real Estate","Banking"],lagging:["Telecoms","Utilities"]},
    australia:{sentiment:"neutral",score:60,fg:54,d:"+0.52%",w:"+1.60%",outlook:`${c} ASX 200 supported by miners and healthcare. RBA on hold. Household consumption slowing but employment firm. Critical minerals theme building.`,macro:["RBA holding at 4.35%","China demand key risk for resources","Migration-driven population growth"],drivers:["Critical minerals energy transition demand","Healthcare innovation pipeline"],leading:["Biotech","Mining"],lagging:["Retail","REITs"]},
    canada:{sentiment:"neutral",score:58,fg:52,d:"+0.46%",w:"+1.40%",outlook:`${c} TSX Composite supported by energy and financials. Shopify AI growth outperforming. Housing affordability crisis weighing on domestic sentiment.`,macro:["BoC approaching rate cut cycle","Housing market correction risk","US-Canada trade policy uncertainty"],drivers:["Gold price at multi-year highs","Oil sands near-record production"],leading:["Gold Mining","Energy"],lagging:["REITs","Consumer"]},
    france:{sentiment:"neutral",score:60,fg:53,d:"+0.54%",w:"+1.60%",outlook:`${c} CAC 40 driven by global luxury, aerospace and pharma. Political uncertainty post-election creating temporary valuation discount for domestic stocks.`,macro:["ECB rate cuts beginning","France fiscal deficit above 3% EU limit","Luxury goods Asia recovery accelerating"],drivers:["Airbus delivery ramp accelerating","LVMH Asia re-rating"],leading:["Luxury Goods","Aerospace"],lagging:["Domestic Banks","Telecoms"]},
  };
  const key=Object.keys(CTX).find(k=>cl.includes(k))||"usa";
  const ctx=CTX[key]||{sentiment:"neutral",score:62,fg:54,d:"+0.43%",w:"+1.82%",
    outlook:`${c} markets near recent highs. Mixed macro signals. AI themes driving sector rotation.`,
    macro:["Policy uncertainty","Strong earnings season","Elevated geopolitical risk"],
    drivers:["Earnings +6% vs consensus","AI cycle early-stage"],leading:["Technology","Financials"],lagging:["Real Estate","Utilities"]};
  // Build picks from the market stock data with extended fields
  const picks=mktStocks.map((s,i)=>({
    rank:s.rank,symbol:s.symbol,name:s.name,sector:s.sector,
    currentPrice:s.price,
    targetPrice1m:s.targetPrice,
    targetPrice6m:s.targetPrice, // rough approximation for fallback
    targetPrice1y:s.targetPrice,
    upside1m:s.upside,upside6m:s.upside,upside1y:s.upside,
    signal:s.signal,tradingSignal:s.signal==="STRONG BUY"?"BUY":s.signal,
    investmentSignal:s.signal,
    rsi:[58,52,61,45,42][i]||55,
    maSignal:s.shortTerm==="BULLISH"?"BULLISH CROSSOVER":s.shortTerm==="BEARISH"?"DEATH CROSS":"NEUTRAL",
    volumeTrend:s.shortTerm==="BULLISH"?"INCREASING":s.shortTerm==="BEARISH"?"DECREASING":"STABLE",
    supportLevel:s.targetPrice,resistanceLevel:s.targetPrice,stopLoss:s.targetPrice,
    riskReward:["1:3.4","1:2.8","1:2.5","1:2.1","1:3.0"][i]||"1:2.5",
    volatility:s.riskLevel==="HIGH"?"HIGH":s.riskLevel==="LOW"?"LOW":"MEDIUM",
    beta:[1.22,0.88,1.05,0.92,1.35][i]||1.0,
    pe:s.pe,epsGrowth:["+24%","+14%","+18%","+8%","+28%"][i]||"+15%",
    revenueGrowth:["+19%","+9%","+14%","+5%","+21%"][i]||"+12%",
    debtEquity:["0.28","0.45","0.32","0.38","0.22"][i]||"0.35",
    dividendYield:["1.2%","3.4%","0.8%","4.8%","0%"][i]||"2.0%",
    institutionalOwnership:["76%","72%","68%","62%","58%"][i]||"65%",
    thesis:s.whyNow+" "+s.catalyst,
    tradingSetup:s.trend==="up"?"Buy on pullbacks to support; trailing stop recommended.":"Accumulate on dips; position size carefully.",
    catalysts:[s.catalyst,"Sector rotation tailwind"],
    risks:[s.riskLevel==="HIGH"?"Elevated regulatory risk":"Macro headwind possible","Valuation re-rating risk"],
    newsDriver:s.whyNow,confidence:s.signalStrength,timeframe:"Q3 2025",
  }));
  return{exchange:ex,index:idx,
    marketSentiment:ctx.sentiment,sentimentScore:ctx.score,fearGreedIndex:ctx.fg,
    indexChange1d:ctx.d,indexChange1w:ctx.w,
    marketOutlook:ctx.outlook,
    macroFactors:ctx.macro,keyDrivers:ctx.drivers,
    sectorRotation:{leading:ctx.leading,lagging:ctx.lagging},picks};
}
function fbIntel(t){
  const tg=t||"Global";
  const cl=tg.toLowerCase();
  const ID={
    india:{threatLevel:"moderate",stabilityIndex:68,
      summary:"India maintains stable democratic governance with strong economic momentum. Border tensions with China and Pakistan remain a persistent background risk, though diplomatic back-channels are active. Internal security situation calm with election cycle providing political clarity.",
      alerts:[
        {type:"political",level:"medium",title:"India: Coalition government budget negotiations ongoing",detail:"Modi-led NDA managing coalition arithmetic. Fiscal consolidation path credible; deficit target 4.5% of GDP for FY26."},
        {type:"economic",level:"high",title:"Food inflation pressuring RBI rate path",detail:"Vegetable and pulses prices elevated. RBI holding at 6.50%; rate cuts delayed to H2 2025. Core inflation under control at 3.8%."},
        {type:"military",level:"medium",title:"LAC border infrastructure build-up continues",detail:"India accelerating border road and airstrip construction. China mirror-building on Tibetan plateau. Standoff resolved at patrol points but underlying tension persists."},
        {type:"cyber",level:"high",title:"State-sponsored cyber attacks on critical infrastructure",detail:"CERT-In reporting increased APT activity targeting power grid and BFSI sector. China and Pakistan-linked groups identified."}
      ],
      activeConflicts:["LAC border standoff with China — diplomatic talks ongoing","Kashmir insurgency at multi-year low but cross-border infiltration continues"],
      economicPressures:["Food inflation above RBI comfort zone delaying rate cuts","Rupee depreciation pressure on oil import bill","Global IT spending slowdown risk for services exports"],
      cyberThreats:["APT41 (China) targeting defence PSUs and research labs","Pakistan-linked groups targeting BFSI and government portals","UPI and digital payments infrastructure under probing attacks"],
      diplomaticAlerts:["India-China summit being explored after LAC disengagement","Quad naval exercises signalling Indo-Pacific alignment","India-Canada diplomatic relations strained over Khalistan issue"]},
    usa:{threatLevel:"moderate",stabilityIndex:65,
      summary:"United States navigating elevated domestic political polarisation ahead of 2026 midterms. Geopolitically active on multiple fronts — Ukraine, Middle East, and Indo-Pacific. Federal institutions under strain but functioning. Economy resilient despite high rates.",
      alerts:[
        {type:"political",level:"high",title:"USA: Congressional debt ceiling negotiations intensifying",detail:"Treasury approaching extraordinary measures deadline. Bipartisan negotiation progress slow. Market watching for resolution by Q2 2025."},
        {type:"military",level:"high",title:"US carrier groups repositioned to Middle East and Pacific",detail:"Two carrier strike groups in Indo-Pacific amid Taiwan Strait tensions. CENTCOM forces on elevated readiness. Gaza ceasefire fragile."},
        {type:"economic",level:"high",title:"Fed holding rates — inflation stickiness above 3%",detail:"Services CPI stubbornly at 4.2%. Fed signals only 1-2 cuts in 2025. Yield curve normalising. Commercial real estate stress building."},
        {type:"cyber",level:"critical",title:"Salt Typhoon telecom infrastructure breach ongoing",detail:"Chinese state hackers embedded in US telecom networks. FBI and CISA issuing warnings. Full scope of compromise still being assessed."}
      ],
      activeConflicts:["US military support to Ukraine — $61B aid package being deployed","US naval presence in Red Sea countering Houthi drone/missile attacks","Taiwan Strait deterrence patrols ongoing"],
      economicPressures:["Commercial real estate loan losses mounting at regional banks","Student loan resumption reducing consumer spending capacity","Dollar strength hurting US multinational earnings"],
      cyberThreats:["Salt Typhoon (China) telecom network infiltration","Volt Typhoon pre-positioning in US critical infrastructure","Russian ransomware groups targeting healthcare and energy"],
      diplomaticAlerts:["US-China high-level dialogue resumed but tech/trade tensions persist","NATO unity on Ukraine tested by budget pressures","US-Israel relations strained over Gaza civilian casualties"]},
    china:{threatLevel:"elevated",stabilityIndex:55,
      summary:"China managing complex internal and external pressures. Property sector crisis weighing on growth and local government finances. Taiwan Strait tensions elevated with PLA exercises. US-China tech decoupling accelerating.",
      alerts:[
        {type:"economic",level:"critical",title:"China: Property sector crisis spreading to local government debt",detail:"LGFV debt at ¥65 trillion. Evergrande liquidation ordered. Central government stimulus floor at 4.5% growth. Consumer confidence fragile."},
        {type:"military",level:"high",title:"PLA exercises around Taiwan at elevated frequency",detail:"PLA Air Force incursions into Taiwan ADIZ at record levels. Naval exercises simulating blockade scenarios. US carrier presence in response."},
        {type:"political",level:"medium",title:"Xi Jinping consolidating third-term agenda",detail:"Politburo Standing Committee aligned. Military loyalty purges ongoing. No credible internal challenge to Xi's authority."},
        {type:"cyber",level:"high",title:"China cyber operations targeting Western critical infrastructure",detail:"Volt Typhoon pre-positioning in US/EU infrastructure confirmed. MSS operations against Taiwan, Japan and India also ongoing."}
      ],
      activeConflicts:["Taiwan Strait tensions — PLA exercises escalating in frequency","South China Sea: China asserting control over Philippine EEZ","China-India LAC standoff — partial disengagement achieved"],
      economicPressures:["Property sector ¥65T debt overhang deflating household wealth","Youth unemployment above 14% — social stability risk","Export competitiveness under pressure from tariffs and friend-shoring"],
      cyberThreats:["MSS and PLA cyber units active globally","AI-powered disinformation campaigns targeting Taiwan","Supply chain compromise via Chinese tech hardware"],
      diplomaticAlerts:["China-Russia partnership deepening","China-EU relations strained over EV tariffs","China mediating Middle East — Saudi-Iran normalisation"]},
    russia:{threatLevel:"high",stabilityIndex:38,
      summary:"Russia under severe economic and military strain from Ukraine war. Western sanctions biting but Chinese and Indian trade partially offsetting. Putin's political position internally secure. Military conducting large-scale operations in Ukraine with high attrition rates.",
      alerts:[
        {type:"military",level:"critical",title:"Russia-Ukraine war: Frontline activity intense across 1,000km",detail:"Russian forces grinding advances in Donetsk. Ukrainian drone strikes reaching deep into Russian territory. Both sides suffering high casualties."},
        {type:"political",level:"high",title:"Putin re-elected; hardline war cabinet in place",detail:"Election result not in doubt. War economy consuming 35% of federal budget. Opposition eliminated."},
        {type:"economic",level:"high",title:"Sanctions impact accelerating — ruble under pressure",detail:"Ruble trading at 90+ to USD. Inflation 7.8%. Interest rate at 16%. Oil revenues diverted to military."},
        {type:"cyber",level:"critical",title:"Russian cyber attacks on NATO infrastructure escalating",detail:"GRU and SVR targeting European energy grids, railways and government networks. Hybrid warfare intensifying."}
      ],
      activeConflicts:["Russia-Ukraine full-scale war — 3rd year, no ceasefire","Russia hybrid warfare against NATO Baltic and Nordic states","Wagner/Africa Corps operations in Mali, Niger, Libya, Sudan"],
      economicPressures:["Western sanctions limiting technology imports","War economy crowding out civilian investment","Brain drain — 700,000+ educated Russians emigrated since 2022"],
      cyberThreats:["GRU Sandworm targeting European critical infrastructure","SVR intelligence collection on NATO governments","Russian disinformation targeting European elections"],
      diplomaticAlerts:["Russia-North Korea military cooperation deepening","Russia-Iran drone supply chain established","Russia-China trade at record — sanctions circumvention"]},
    uk:{threatLevel:"low",stabilityIndex:74,
      summary:"UK under new Labour government pursuing fiscal stability and international re-engagement. Economy recovering slowly from cost-of-living crisis. Northern Ireland political situation stabilised post-Windsor Framework.",
      alerts:[
        {type:"political",level:"medium",title:"UK: Labour government managing fiscal inheritance",detail:"Reeves reviewing spending plans; NHS and public services underfunding severe. Growth agenda central but headroom limited."},
        {type:"economic",level:"medium",title:"BoE holding rates — services inflation sticky at 5%",detail:"CPI at 3.8%. BoE cautious on cuts. Mortgage market stressed — 1.5M households refinancing at higher rates in 2025."},
        {type:"military",level:"medium",title:"UK increasing defence spending to 2.5% GDP",detail:"Commitment to Ukraine military aid continuing. RAF and Royal Navy contributing to Baltic air policing."},
        {type:"cyber",level:"medium",title:"NCSC warning on Russian and Chinese cyber threats",detail:"Critical national infrastructure facing sustained probing. GCHQ NCSC issuing sector-specific advisories."}
      ],
      activeConflicts:["UK military support to Ukraine — Storm Shadow missiles and training","UK Red Sea naval operations countering Houthi attacks"],
      economicPressures:["Mortgage payment shock for 1.5M households refinancing","NHS crisis limiting workforce participation","Post-Brexit trade friction adding costs to UK manufacturers"],
      cyberThreats:["Russian GRU targeting UK political institutions","Chinese MSS economic espionage on UK tech and pharma","Ransomware targeting NHS trusts"],
      diplomaticAlerts:["UK-EU reset under Labour — defence pact being negotiated","UK-US special relationship reaffirmed","UK hosting Ukraine Recovery Conference"]},
    "middle east":{threatLevel:"high",stabilityIndex:35,
      summary:"Middle East in multi-front crisis. Gaza conflict entering second year with no resolution. Houthi Red Sea attacks disrupting global shipping. Iran nuclear programme advancing. Oil supply stable but geopolitical premium elevated.",
      alerts:[
        {type:"military",level:"critical",title:"Gaza conflict — humanitarian crisis and regional spillover risk",detail:"IDF operations ongoing. Death toll exceeding 35,000. Hezbollah-Israel exchanges on Lebanon border. Iran-backed proxies activated."},
        {type:"military",level:"high",title:"Houthi Red Sea attacks — shipping disruption ongoing",detail:"100+ merchant ships attacked. Suez Canal traffic down 40%. Insurance premiums surging. Energy tankers rerouting via Cape."},
        {type:"political",level:"high",title:"Iran nuclear programme — IAEA verification suspended",detail:"Iran enriching to 60% U-235. Breakout time estimated at weeks. P5+1 negotiations stalled. Israeli strike risk elevated."},
        {type:"economic",level:"medium",title:"Oil price geopolitical premium — Brent above $85",detail:"OPEC+ maintaining production cuts. Geopolitical risk premium $5-8/barrel. Saudi Arabia defending $85 price floor."}
      ],
      activeConflicts:["Israel-Hamas war — Gaza operations ongoing into year 2","Houthi attacks on Red Sea shipping","Israel-Hezbollah exchanges — northern Israel evacuation ongoing","Yemen civil war — Houthi consolidation in north"],
      economicPressures:["Red Sea shipping disruption adding 2-3 weeks to Asia-Europe transit","Oil price volatility on Iran escalation risk","Tourism and FDI to Egypt and Jordan severely impacted"],
      cyberThreats:["Iran IRGC Cyber targeting Israeli and US financial infrastructure","Hamas-linked groups social media disinformation","Saudi Aramco and UAE energy infrastructure under sustained probing"],
      diplomaticAlerts:["Saudi-Israel normalisation on hold pending Gaza resolution","China brokered Saudi-Iran deal progressing slowly","Qatar mediating Gaza ceasefire — talks repeatedly breaking down"]},
    europe:{threatLevel:"moderate",stabilityIndex:62,
      summary:"Europe managing multiple simultaneous crises — Ukraine war on its eastern flank, energy transition costs, political fragmentation with far-right gains in France, Germany and Netherlands. ECB beginning rate cut cycle.",
      alerts:[
        {type:"military",level:"high",title:"Europe increasing defence spending — NATO 2% target achieved",detail:"Germany, Poland, Baltic states exceeding NATO 2% target. European defence industry ramping production."},
        {type:"political",level:"high",title:"Far-right parties gaining in European elections",detail:"AfD in Germany, RN in France, PVV in Netherlands forming governments or leading polls. EU cohesion under pressure."},
        {type:"economic",level:"medium",title:"ECB cutting rates — Eurozone growth below 1%",detail:"ECB delivered first cut. Germany in recession. France fiscal deficit above 3%. Energy costs still elevated."},
        {type:"cyber",level:"high",title:"Russian hybrid warfare targeting European infrastructure",detail:"Estonian, Polish, Finnish infrastructure under sustained Russian cyber attack. Undersea cable sabotage incidents in Baltic."}
      ],
      activeConflicts:["Ukraine-Russia war on EU's eastern border","Kosovo-Serbia tensions — EU-mediated dialogue stalling"],
      economicPressures:["Energy prices still 60% above pre-Ukraine war levels","German industrial competitiveness crisis","ECB rate cuts lagging Fed — credit conditions tight"],
      cyberThreats:["Russian GRU targeting Baltic and Nordic critical infrastructure","Chinese MSS economic espionage on European tech","Election interference via social media disinformation"],
      diplomaticAlerts:["EU-Ukraine accession negotiations opened","EU-China EV tariff dispute escalating","NATO Article 5 commitments tested by hybrid attack ambiguity"]},
    "south asia":{threatLevel:"elevated",stabilityIndex:44,
      summary:"South Asia facing overlapping crises. Pakistan's political and economic instability. Bangladesh post-revolution transition fragile. Sri Lanka still recovering from 2022 collapse.",
      alerts:[
        {type:"political",level:"critical",title:"Pakistan: Military-political crisis deepening",detail:"Imran Khan imprisoned; PTI suppressed but retains popular support. Military-civilian hybrid governance unstable."},
        {type:"economic",level:"critical",title:"Pakistan: IMF programme on knife-edge — FX reserves at $8B",detail:"Pakistan reliant on IMF $3B SBA. Inflation at 20%+. Debt service consuming 60% of revenues. Default risk non-trivial."},
        {type:"military",level:"high",title:"India-Pakistan: Cross-border terrorism incidents rising",detail:"TTP attacks from Afghan soil increasing in KP and Balochistan. India-Pakistan LOC exchanges at elevated frequency."},
        {type:"political",level:"high",title:"Bangladesh: Post-Hasina transition — interim government fragile",detail:"Sheikh Hasina fled to India. Muhammad Yunus leading interim government. Garment sector stable but political uncertainty delaying FDI."}
      ],
      activeConflicts:["Pakistan TTP insurgency in KP — 1,000+ security personnel killed in 2024","India-China LAC standoff — partial patrol normalisation","Afghanistan Taliban — resistance pockets in Panjshir and north"],
      economicPressures:["Pakistan sovereign debt crisis — IMF-dependent","Bangladesh political transition risk to garment export sector","Sri Lanka debt restructuring — China and India creditor negotiations"],
      cyberThreats:["Pakistan ISI-linked APT targeting Indian defence","Bangladesh financial sector hacking","State-sponsored disinformation targeting Indian elections"],
      diplomaticAlerts:["India-Pakistan — no formal dialogue; back-channel via UAE","India-Bangladesh relations — Hasina exile creating tension","China deepening CPEC investment in Pakistan — $62B committed"]},
  };
  const key=Object.keys(ID).find(k=>cl.includes(k));
  if(key&&ID[key])return ID[key];
  return{threatLevel:"moderate",stabilityIndex:60,
    summary:`${tg} geopolitical situation monitored across multiple risk dimensions. Intelligence assessment based on latest available open-source signals. Situation fluid.`,
    alerts:[
      {type:"political",level:"high",title:`${tg}: Political risk elevated`,detail:"Governance uncertainty affecting policy continuity. Opposition activity and institutional pressures creating near-term risk premium."},
      {type:"economic",level:"high",title:`${tg}: Macro headwinds building`,detail:"Inflation above central bank target. Rate environment tightening credit conditions. External debt servicing costs rising."},
      {type:"cyber",level:"medium",title:`${tg}: Critical infrastructure under probing attacks`,detail:"State-linked and criminal cyber actors targeting energy, finance and telecoms. CERT issuing elevated threat advisories."},
      {type:"military",level:"medium",title:`${tg}: Regional security posture elevated`,detail:"Military readiness above baseline. Neighbour state tensions requiring active diplomatic management."}
    ],
    activeConflicts:[`${tg} regional border disputes requiring active management`,"Non-state armed group activity in border areas"],
    economicPressures:["Currency depreciation pressure on import costs","Sovereign debt refinancing risk","Export competitiveness under pressure from global slowdown"],
    cyberThreats:["APT groups targeting financial sector infrastructure","Ransomware attacks on government and healthcare systems","Supply chain compromise risk from foreign technology vendors"],
    diplomaticAlerts:[`${tg} navigating great power competition pressures`,"Regional multilateral framework under review","Bilateral trade disputes requiring WTO-level resolution"]};
}
function fbForecast(t){
  const tg=t||"USA";
  const cl=tg.toLowerCase();
  const FD={
    india:{stability:72,geopoliticalScore:58,confidenceScore:70,economicOutlook:"positive",gdpGrowth:"+6.4%",inflation:"5.1%",unemployment:"4.2%",interestRate:"6.50% (RBI)",currencyStrength:"STABLE",sixMonthPrediction:"India expected to sustain 6–7% GDP growth driven by domestic consumption, infrastructure capex, and IT exports. RBI holding rates at 6.50% amid food inflation pressures. Manufacturing PLI schemes attracting record FDI. GST collections at all-time highs signal strong economic activity.",workingClassForecast:"Employment in manufacturing, IT, and construction growing steadily. Real wage gains partially offset by elevated food and housing inflation in urban centres. Rural incomes improving on record MSP and better Kharif/Rabi crops.",marketOutlook:"NSE/BSE equities supported by DII flows and robust corporate earnings. FII inflows volatile on global risk. Nifty earnings growth at +12% YoY justifies selective premium valuations.",traderOpportunities:"Overweight IT services on GenAI upcycle, private sector banks on credit growth, and capital goods on infrastructure theme. Avoid high-debt real estate. INR options for hedge.",keyRisks:["Food inflation re-acceleration from erratic monsoon","Global IT spending slowdown impacting TCS/Infosys","Geopolitical tensions on northern border"],opportunities:["PLI scheme-driven manufacturing boom","Digital India and UPI fintech explosion","Renewables and green energy capex surge"],basedOn:"RBI MPC minutes, MOSPI GDP/CPI data, IMF Article IV 2025, NSE earnings tracker"},
    china:{stability:62,geopoliticalScore:48,confidenceScore:58,economicOutlook:"neutral",gdpGrowth:"+4.7%",inflation:"0.4%",unemployment:"5.2%",interestRate:"3.45% (PBOC)",currencyStrength:"STABLE",sixMonthPrediction:"China recovering unevenly from property sector downturn. Export competitiveness strong as yuan competitive. Domestic consumption fragile but government stimulus creating a floor at 4.5%+ growth. AI and EV sectors offsetting traditional industry weakness.",workingClassForecast:"Youth unemployment elevated above 14%. Urban wages stagnant in manufacturing and property. Rural-to-urban migration slowing. Government social transfers partially cushioning household balance sheet weakness.",marketOutlook:"A-share and H-share markets undervalued vs global peers. Policy support creating technical floor. Geopolitical premium on tech names limiting foreign buying. Selective sector rotation into AI and state banks.",traderOpportunities:"Overweight AI infrastructure and cloud (Alibaba, Tencent), state bank yield plays, EV global exporters. Tactical long H-shares vs short A-shares spread trade.",keyRisks:["Property sector protracted downturn dragging on confidence","US tariff escalation on Chinese tech/EV exports","Deflationary spiral entrenching in goods sector"],opportunities:["AI and semiconductor self-sufficiency policy","EV global export market share gains","Fiscal stimulus deployment accelerating"],basedOn:"PBOC monetary policy, NBS GDP/CPI releases, IMF Article IV, Caixin PMI"},
    uk:{stability:75,geopoliticalScore:68,confidenceScore:65,economicOutlook:"neutral",gdpGrowth:"+0.9%",inflation:"3.8%",unemployment:"4.2%",interestRate:"5.25% (BoE)",currencyStrength:"STABLE",sixMonthPrediction:"UK exiting cost-of-living squeeze but recovery remains sluggish at sub-1% GDP growth. BoE awaiting services CPI to fall sustainably toward 3% before cutting. Labour government's fiscal plans have limited headroom. Business investment recovering on lower policy uncertainty.",workingClassForecast:"Real wages finally turning modestly positive in early 2025 after 18 months of erosion. NHS backlog affecting workforce participation; 2.8M economically inactive due to ill health. Energy bill relief providing partial household support.",marketOutlook:"FTSE 100 attractive globally on valuation — 3.7% dividend yield vs global peers at 2%. Domestic FTSE 250 lagging on rate sensitivity. Pound could strengthen on BoE credibility.",traderOpportunities:"Overweight FTSE 100 global earners (AstraZeneca, Shell, Unilever). Tactical short gilts on fiscal risk. FTSE 250 recovery play if BoE cuts faster than expected.",keyRisks:["Services inflation staying sticky above 5%","Fiscal tightening dampening already weak growth","Sterling vulnerable to global risk-off"],opportunities:["Pharmaceutical R&D pipeline leadership","North Sea energy transition investment","UK FinTech and AI sector expansion"],basedOn:"BoE MPC minutes, ONS CPI/GDP/Employment, OBR fiscal outlook, IMF UK staff report"},
    germany:{stability:76,geopoliticalScore:63,confidenceScore:62,economicOutlook:"negative",gdpGrowth:"-0.2%",inflation:"2.8%",unemployment:"5.9%",interestRate:"4.50% (ECB)",currencyStrength:"STABLE",sixMonthPrediction:"Germany in technical recession for second consecutive year. Energy transition costs and weak China demand crushing industrial competitiveness. Coalition government struggling with constitutional debt brake limiting fiscal response. Structural reform debate intensifying.",workingClassForecast:"Industrial sector job losses, particularly in auto and chemicals, partially offset by public sector and services. IG Metall wage settlement at 4.8% beating inflation. Energy subsidies rolled back adding to household energy bills.",marketOutlook:"DAX relatively resilient on global revenue base — 70%+ of DAX revenues international. Domestic cyclicals under severe pressure. Defence sector (Rheinmetall, HENSOLDT) outperforming on NATO spending.",traderOpportunities:"Overweight SAP (cloud transition), defence stocks, and European exporters. Avoid domestic energy-intensive manufacturing. Short Bunds on fiscal reform prospects.",keyRisks:["Energy dependency and elevated industrial cost base","China demand structural slowdown impact on auto sector","Constitutional debt brake preventing stimulus"],opportunities:["Defence spending increase to 2% NATO target","Hydrogen economy and green steel investment","SAP global cloud market share gains"],basedOn:"Bundesbank Monthly Report, Destatis GDP/CPI, ECB Governing Council, IMF Germany Article IV"},
    japan:{stability:80,geopoliticalScore:72,confidenceScore:70,economicOutlook:"positive",gdpGrowth:"+1.4%",inflation:"3.1%",unemployment:"2.6%",interestRate:"0.25% (BoJ)",currencyStrength:"WEAK",sixMonthPrediction:"Japan sustainably exiting 30-year deflation cycle. Shunto wage negotiations delivered 5.1% — highest since 1991. BoJ cautiously normalising; first rate hike to 0.25% in 2024 with further moves telegraphed. Corporate governance reforms forcing ROE discipline. Weak yen turbocharging export earnings.",workingClassForecast:"Labour market at multi-decade tightest. Real wages turning positive in H1 2025 for first time in years. Inbound tourism boom creating service sector jobs. Aging population constraining supply — structural labour shortage.",marketOutlook:"Nikkei supported by three pillars: corporate reform, foreign buying (NISA), and weak yen. TSE1 price-to-book reform forcing buybacks and ROE targets. Domestic reallocation from ¥1,000T in savings toward equities structural.",traderOpportunities:"Overweight export-oriented manufacturers (auto, semiconductors), domestic cyclicals benefiting from wage growth. Long Nikkei hedged with short JPY. Underweight JGBs on duration risk.",keyRisks:["BoJ rate hike pace causing yen carry trade unwind","Geopolitical escalation in Taiwan Strait disrupting supply chains","Aging demographics limiting domestic demand"],opportunities:["Corporate governance ROE improvement catalyst","TSMC/Samsung Kumamoto semiconductor hub","Inbound tourism record — ¥9T spending in 2024"],basedOn:"BoJ Outlook Report, MoF fiscal data, Statistics Bureau Japan, Nikkei PMI, IMF WEO"},
    australia:{stability:82,geopoliticalScore:74,confidenceScore:72,economicOutlook:"neutral",gdpGrowth:"+1.8%",inflation:"3.8%",unemployment:"3.9%",interestRate:"4.35% (RBA)",currencyStrength:"STABLE",sixMonthPrediction:"Australia navigating soft landing. RBA on hold at 4.35% watching trimmed mean CPI. Household consumption slowing under mortgage payment stress but employment resilient. Mining sector supporting national income; iron ore still above $100/t. Migration-driven population growth of 600k pa keeping labour market firm.",workingClassForecast:"Mortgage holders under significant payment stress — 37% of income for recent buyers. Renters facing record rents in major cities. Real wages mildly positive. Healthcare, mining and construction employment growing.",marketOutlook:"ASX 200 defensive relative to global markets. Major banks and miners key drivers. International revenue base limiting domestic exposure. Dividend yield 4.2% above global average.",traderOpportunities:"Overweight critical minerals (lithium, copper, cobalt), CSL biotech, diversified major banks. Selective on domestic retail given mortgage stress. Long AUD on China commodity demand.",keyRisks:["China demand slowdown impacting iron ore and LNG","Household debt stress triggering consumption collapse","RBA rate persistence beyond market expectations"],opportunities:["Critical minerals supply for energy transition","Green hydrogen as export opportunity","Asia-Pacific defence and security investment"],basedOn:"RBA Statement on Monetary Policy, ABS CPI/GDP/Employment, IMF Article IV, Australian Treasury"},
    brazil:{stability:54,geopoliticalScore:50,confidenceScore:56,economicOutlook:"neutral",gdpGrowth:"+2.2%",inflation:"4.6%",unemployment:"7.8%",interestRate:"11.75% (BCB)",currencyStrength:"VOLATILE",sixMonthPrediction:"Brazil growing above consensus despite high real interest rates. BCB cutting from 13.75% peak cautiously. Lula's fiscal expansion increasing debt trajectory risk and keeping long-end BRL rates elevated. Agriculture super-cycle underpinning current account. Structural reform of tax system (VAT) positive medium-term.",workingClassForecast:"Job growth in agribusiness, construction, and services. Bolsa Família transfers supporting 21M households. Urban informal workers gaining from formalisation drive. BRL depreciation eroding real purchasing power of imports.",marketOutlook:"Ibovespa historically cheap at 8x earnings. Commodity exporters (Petrobras, Vale, WEG) well positioned. Political and fiscal risk limiting foreign duration appetite. Local real yields still attractive.",traderOpportunities:"Overweight commodity exporters, domestic banks (Itaú) on credit normalisation, and WEG industrial on global EV motor demand. BRL-denominated government bonds offer 8%+ real yield.",keyRisks:["Fiscal deficit expansion threatening debt/GDP path","BRL depreciation on dollar strength","Political interference in Petrobras dividend policy"],opportunities:["Agriculture commodity exports at record value","Green energy transition — Brazil 85% renewable electricity","FinTech and Pix payment revolution"],basedOn:"BCB COPOM decisions, IBGE GDP/IPCA, IMF Article IV, Tesouro Nacional fiscal data"},
    uae:{stability:85,geopoliticalScore:72,confidenceScore:76,economicOutlook:"positive",gdpGrowth:"+4.2%",inflation:"3.6%",unemployment:"3.2%",interestRate:"5.40% (CBUAE)",currencyStrength:"STRONG",sixMonthPrediction:"UAE economy maintaining strong 4%+ growth on oil revenue stability and non-oil diversification. Dubai tourism hit record 17M visitors. ADGM and DIFC financial hubs attracting global capital amid geopolitical hedging. AED peg to USD stable. Vision 2031 investment programmes driving capex.",workingClassForecast:"Expatriate workforce growing 8% YoY reflecting economic expansion. UAE nationals benefit from Emiratisation government employment programmes. Premium housing costs elevated in Dubai and Abu Dhabi. Cost of living rising but offset by tax-free income.",marketOutlook:"ADX and DFM supported by sovereign wealth stability and oil revenues. Real estate listed companies at premium valuation on record transaction volumes. Banking sector ROE above 16%.",traderOpportunities:"Overweight Emaar Properties on Dubai real estate momentum, FAB on high rate NII, ADNOC on capacity expansion. Long AED on USD peg. Fixed income sukuk market growing rapidly.",keyRisks:["Oil price decline reducing Abu Dhabi fiscal surplus","Regional geopolitical escalation (Iran/Israel)","Interest rate sensitivity of real estate sector"],opportunities:["ADNOC oil and gas capacity expansion to 5mbpd","Dubai as global crypto and fintech hub","Tourism and hospitality record visitor trajectory"],basedOn:"CBUAE Economic Bulletin, UAE Federal Statistics, IMF Article IV, Abu Dhabi Economic Report"},
    canada:{stability:79,geopoliticalScore:70,confidenceScore:68,economicOutlook:"neutral",gdpGrowth:"+1.8%",inflation:"3.3%",unemployment:"6.2%",interestRate:"5.00% (BoC)",currencyStrength:"STABLE",sixMonthPrediction:"Canada facing housing affordability crisis and consumer spending slowdown under mortgage reset stress. BoC expected to begin rate cuts in mid-2025. Immigration-driven population growth +1.2M pa supporting services. Oil sands and LNG production at near-record supporting exports and national income.",workingClassForecast:"Housing costs represent severe burden — average Toronto/Vancouver home over 11x median income. Immigration dampening wage growth moderately. Energy and mining sector workers benefiting from commodity prices. Tech sector layoffs concentrated in Toronto/Vancouver.",marketOutlook:"TSX Composite supported by energy and financial heavyweights. Shopify AI growth story outperforming. Residential REITs under pressure. Gold miners benefiting from elevated gold prices.",traderOpportunities:"Overweight energy majors (CNQ, SU), gold miners (Barrick, Agnico), diversified banks (RY, TD on recovery). Underweight residential REITs. CAD could strengthen on commodity exports.",keyRisks:["Housing market hard landing risk","US-Canada trade policy shifts and tariff threats","Household debt-to-income at record 180%"],opportunities:["Critical minerals for energy transition (cobalt, nickel, lithium)","AI data centre investment in Canada","LNG Canada export terminal transforming energy exports"],basedOn:"Bank of Canada Monetary Policy Report, Statistics Canada CPI/GDP, IMF Article IV, CMHC housing data"},
    france:{stability:71,geopoliticalScore:64,confidenceScore:64,economicOutlook:"neutral",gdpGrowth:"+0.9%",inflation:"2.6%",unemployment:"7.4%",interestRate:"4.50% (ECB)",currencyStrength:"STABLE",sixMonthPrediction:"France navigating political uncertainty after hung parliament following snap elections. ECB beginning rate cut cycle providing monetary tailwind. Fiscal deficit above 3% EU Stability Pact threshold raising long-term sustainability questions. Luxury sector recovery underpinning corporate earnings and CAC 40 stability.",workingClassForecast:"Employment market relatively stable vs German peer. Controversial pension reform (retirement at 64) now law despite protests. Purchasing power recovering as inflation falls below 3%. Youth unemployment still elevated at 17%.",marketOutlook:"CAC 40 dominated by global champions with international revenues (LVMH, Airbus, TotalEnergies, Sanofi). Domestic exposure limited. Political risk premium temporary discount for recovery opportunity.",traderOpportunities:"Overweight LVMH on Asia luxury re-rating, Airbus on aerospace super-cycle, Sanofi on Dupixent growth. European defence spending beneficiaries. Short OAT spreads vs Bunds on fiscal normalisation.",keyRisks:["Parliamentary deadlock preventing fiscal consolidation","Euro area growth slowdown dragging on France exports","Political populism risk — Le Pen/far-left coalition threat"],opportunities:["Nuclear energy renaissance — France 70% nuclear advantage","Luxury goods Asia recovery driving CAC premium"],basedOn:"Banque de France Economic Projections, INSEE CPI/GDP, ECB Governing Council, IMF France Article IV"},
  };
  const key=Object.keys(FD).find(k=>cl.includes(k))||"usa";
  const d=FD[key]||{stability:65,geopoliticalScore:58,confidenceScore:68,economicOutlook:"neutral",gdpGrowth:"+2.6%",inflation:"3.1%",unemployment:"3.9%",interestRate:"5.50% (Fed)",currencyStrength:"STRONG",sixMonthPrediction:`${tg} economy resilient with above-trend growth. Fed holding rates amid sticky services inflation. Labour market tight; consumer spending solid. AI investment adding to productive capacity. Rate cuts expected in H2 2025.`,workingClassForecast:`Workers in ${tg}: wage growth 4.1% YoY broadly keeping pace with inflation. Housing affordability strained at record lows. Job openings normalising but still above pre-COVID. Services sector employment robust.`,marketOutlook:`${tg} equities supported by AI earnings theme. Mega-cap concentration risk. Small caps lagging on rate sensitivity. S&P 500 earnings +8% consensus for 2025.`,traderOpportunities:"Overweight AI semiconductors (NVDA, AVGO) and financials (JPM, GS). Tactical short-duration bonds attractive at 5%+. Selective EM exposure on dollar strength.",keyRisks:["Inflation re-acceleration delaying Fed cuts","Commercial real estate loan stress","Geopolitical escalation in Middle East/Asia"],opportunities:["AI infrastructure capex supercycle","Reshoring manufacturing boom","Defence spending acceleration"],basedOn:"Federal Reserve FOMC, BLS CPI/Jobs data, BEA GDP, IMF WEO April 2025"};
  return{country:tg,...d};
}

// Robust JSON extractor — strips markdown, handles nested structures, skips [ ] { } inside strings
function _extractJSON(raw,open,close){
  if(!raw)return null;
  // Strip markdown code fences
  let t=raw.replace(/```(?:json)?\s*/gi,"").replace(/```/g,"").trim();
  // Try direct parse first
  try{return JSON.parse(t);}catch{}
  // Find outermost bracket pair, aware of strings
  let depth=0,start=-1,inStr=false,esc=false;
  for(let i=0;i<t.length;i++){
    const ch=t[i];
    if(esc){esc=false;continue;}
    if(ch==="\\" && inStr){esc=true;continue;}
    if(ch==='"'){inStr=!inStr;continue;}
    if(inStr)continue;
    if(ch===open){if(depth===0)start=i;depth++;}
    else if(ch===close){depth--;if(depth===0&&start!==-1){try{return JSON.parse(t.slice(start,i+1));}catch{start=-1;depth=0;}}}
  }
  return null;
}
function pArr(raw){const r=_extractJSON(raw,"[","]");return Array.isArray(r)?r:null;}
function pObj(raw){const r=_extractJSON(raw,"{","}");return r&&typeof r==="object"&&!Array.isArray(r)?r:null;}

/* ── DATA FETCHERS ── */
async function fetchNews(q){
  const _newsKey="news:"+q;
  const _newsCached=_cg(_newsKey);if(_newsCached)return _newsCached;
  const today=new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
  const raw=await callClaude(
`Today is ${today}. You are formatting real news search results into structured JSON.
SEARCH RESULTS FROM THE WEB RIGHT NOW:
${await searchWeb(`${q} breaking news today`)}

Using ONLY the search results above, extract and format 8 news stories about "${q}".
Do NOT use your training data for news content — only use what is in the search results above.
If search results mention specific people, events, or facts — use exactly those.

Return ONLY a JSON array of 8 objects — no markdown:
[{"title":"headline from search results","source":"news outlet from results","country":"country","severity":"critical or high or medium or low","category":"conflict or military or cyber or economy or politics or trade or unrest or disaster","ago":"Xh ago","impact":"market or social impact","people":"who is affected","tradeEffect":"trade or market effect"}]`,1200);
  const arr=pArr(raw);
  if(arr&&arr.length>0&&arr[0].title&&arr[0].title.length>10){
    arr._isLive=true; _cs(_newsKey,arr); return arr;
  }
  const fb=fbNews(q); fb._isLive=false; return fb;
}

async function fetchMarkets(country){
  const _mktKey="mkt:"+country;
  const _mktCached=_cg(_mktKey);if(_mktCached)return _mktCached;
  const target=(country&&country.trim())||"USA";
  const{ex,idx:exIdx,cur}=getEx(target);
  const today=new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
  const MKTREF={india:"RELIANCE.NS=Reliance Industries,TCS.NS=TCS,HDFCBANK.NS=HDFC Bank,INFY.NS=Infosys,ITC.NS=ITC",
    usa:"AAPL=Apple,MSFT=Microsoft,NVDA=Nvidia,AMZN=Amazon,META=Meta",
    uk:"HSBA.L=HSBC,SHEL.L=Shell,AZN.L=AstraZeneca,ULVR.L=Unilever,BP.L=BP",
    china:"0700.HK=Tencent Holdings,9988.HK=Alibaba Group,002594.SZ=BYD Company,601318.SS=Ping An Insurance,600519.SS=Kweichow Moutai",
    japan:"7203.T=Toyota Motor,6758.T=Sony Group,9984.T=SoftBank Group,7974.T=Nintendo,6861.T=Keyence",
    germany:"SAP.DE=SAP SE,SIE.DE=Siemens AG,ALV.DE=Allianz SE,BAS.DE=BASF SE,BMW.DE=BMW AG",
    southkorea:"005930.KS=Samsung Electronics,000660.KS=SK Hynix,005380.KS=Hyundai Motor,035720.KS=Kakao,051910.KS=LG Chem",
    australia:"BHP.AX=BHP Group,CBA.AX=Commonwealth Bank,ANZ.AX=ANZ Bank,CSL.AX=CSL Limited,WES.AX=Wesfarmers",
    brazil:"PETR4.SA=Petrobras,VALE3.SA=Vale SA,ITUB4.SA=Itau Unibanco,BBDC4.SA=Bradesco,EMBR3.SA=Embraer",
    france:"MC.PA=LVMH,TTE.PA=TotalEnergies,SAN.PA=Sanofi,BNP.PA=BNP Paribas,AIR.PA=Airbus",
    canada:"SHOP.TO=Shopify,RY.TO=Royal Bank of Canada,TD.TO=TD Bank,ABX.TO=Barrick Gold,CNR.TO=CN Rail",
    uae:"EMAAR.DU=Emaar Properties,FAB.AD=First Abu Dhabi Bank,DPW.DU=DP World,ETISALAT.AD=Etisalat,ADNOCDIST.AD=ADNOC",
    saudiarabia:"2222.SR=Saudi Aramco,7010.SR=STC Telecom,1120.SR=Al Rajhi Bank,2010.SR=SABIC,1180.SR=NCB"};
  function getMRef(t){const tl=t.toLowerCase().replace(/\s+/g,"");return MKTREF[tl]||Object.entries(MKTREF).find(([k])=>tl.includes(k)||k.includes(tl))?.[1]||MKTREF.usa;}
  const refRaw=getMRef(target);
  // Convert "0700.HK=Tencent Holdings,9988.HK=Alibaba Group" into explicit instructions
  const ref=refRaw.split(",").map(r=>{const[sym,name]=r.split("=");return `${sym.trim()} → name is "${name.trim()}"`}).join(", ");
  const raw=await callClaudeJSON(
`Today is ${today}. Use ONLY the search results below for current stock prices and news.

LIVE WEB SEARCH RESULTS FOR ${target} MARKETS:
${await searchWeb(`${exIdx} stock prices ${target} market today`)}

Using search results above, generate market data for ${target}'s ${ex} (${exIdx}).
Use ONLY these exact tickers and company names (do not invent others): ${ref}
Extract real prices from search results where available.

Return JSON with key "stocks" — array of exactly 5 items, no markdown:
{"stocks":[{"rank":1,"symbol":"EXACT_TICKER_FROM_LIST","name":"EXACT_COMPANY_NAME_FROM_LIST","sector":"sector","price":"${cur}PRICE","change1d":"+0.85%","change1d_raw":0.85,"change1w":"+2.1%","change1w_raw":2.1,"change1m":"+5.2%","change1m_raw":5.2,"volume":"12M","marketCap":"${cur}VALUE","pe":"28.5","signal":"BUY","signalStrength":78,"shortTerm":"BULLISH","longTerm":"BULLISH","targetPrice":"${cur}VALUE","upside":"+12%","riskLevel":"LOW","whyNow":"reason from search results","catalyst":"event from search results","trend":"up"}]}
signalStrength: integer 55-92. Mix BUY/HOLD/SELL signals.`,
    "{",1200);
  const obj=pObj(raw);
  // Extract stocks array from wrapper object
  const arr=obj?.stocks||(Array.isArray(obj)?obj:null);
  // Reject if company names look like tickers (e.g. "0700.HK" instead of "Tencent Holdings")
  const hasRealNames=arr&&arr.length>=3&&arr[0]?.name&&arr[0].name.length>5&&!arr[0].name.includes(".");
  if(hasRealNames&&arr[0]?.symbol&&!/^LDR\d$/.test(arr[0].symbol)){
    // Normalize — Groq sometimes returns numbers as strings or vice versa
    const norm=arr.map(s=>({...s,
      // Fix NA prices — use symbol-based estimate if Groq returns NA/null/0
      price:(s.price&&s.price!=="NA"&&s.price!=="N/A"&&s.price!=="null"&&s.price!=="0")?s.price:s.currentPrice||"—",
      change1d_raw:parseFloat(s.change1d_raw)||0,
      change1w_raw:parseFloat(s.change1w_raw)||0,
      change1m_raw:parseFloat(s.change1m_raw)||0,
      signalStrength:parseInt(s.signalStrength)||70,
    }));
    // Enrich with real Finnhub prices — gracefully degrades if unavailable
    const enriched=await fetchRealPrices(norm);
    enriched._isLive=true; _cs(_mktKey,enriched); return enriched;
  }
  const fb=fbMarkets(target); fb._isLive=false; return fb;
}

async function fetchStockPicks(country){
  const _pkKey="pk:"+country;
  const _pkCached=_cg(_pkKey);if(_pkCached)return _pkCached;
  const target=(country&&country.trim())||"USA";
  const{ex,idx:exIdx,cur}=getEx(target);
  const today=new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
  const PKREF={
    india:"RELIANCE.NS=Reliance Industries,TCS.NS=TCS,HDFCBANK.NS=HDFC Bank,INFY.NS=Infosys,ITC.NS=ITC",
    usa:"AAPL=Apple,MSFT=Microsoft,NVDA=Nvidia,AMZN=Amazon,META=Meta",
    uk:"HSBA.L=HSBC,SHEL.L=Shell,AZN.L=AstraZeneca,ULVR.L=Unilever,BP.L=BP",
    china:"0700.HK=Tencent Holdings,9988.HK=Alibaba Group,002594.SZ=BYD Company,601318.SS=Ping An Insurance,600519.SS=Kweichow Moutai",
    japan:"7203.T=Toyota Motor,6758.T=Sony Group,9984.T=SoftBank Group,7974.T=Nintendo,6861.T=Keyence",
    germany:"SAP.DE=SAP SE,SIE.DE=Siemens AG,ALV.DE=Allianz SE,BAS.DE=BASF SE,BMW.DE=BMW AG",
    southkorea:"005930.KS=Samsung Electronics,000660.KS=SK Hynix,005380.KS=Hyundai Motor,035720.KS=Kakao,051910.KS=LG Chem",
    australia:"BHP.AX=BHP Group,CBA.AX=Commonwealth Bank,ANZ.AX=ANZ Bank,CSL.AX=CSL Limited,WES.AX=Wesfarmers",
    brazil:"PETR4.SA=Petrobras,VALE3.SA=Vale SA,ITUB4.SA=Itau Unibanco,BBDC4.SA=Bradesco,EMBR3.SA=Embraer",
    france:"MC.PA=LVMH,TTE.PA=TotalEnergies,SAN.PA=Sanofi,BNP.PA=BNP Paribas,AIR.PA=Airbus",
    canada:"SHOP.TO=Shopify,RY.TO=Royal Bank of Canada,TD.TO=TD Bank,ABX.TO=Barrick Gold,CNR.TO=CN Rail",
    uae:"EMAAR.DU=Emaar Properties,FAB.AD=First Abu Dhabi Bank,DPW.DU=DP World,ETISALAT.AD=Etisalat",
    saudiarabia:"2222.SR=Saudi Aramco,7010.SR=STC Telecom,1120.SR=Al Rajhi Bank,2010.SR=SABIC,1180.SR=NCB"};
  function getPRef(t){const tl=t.toLowerCase().replace(/\s+/g,"");return PKREF[tl]||Object.entries(PKREF).find(([k])=>tl.includes(k)||k.includes(tl))?.[1]||PKREF.usa;}
  const refRaw=getPRef(target);
  const ref=refRaw.split(",").map(r=>{const[sym,name]=r.split("=");return `${sym.trim()} → name is "${name.trim()}"`}).join(", ");
  const raw=await callClaudeJSON(
`Today is ${today}. Use ONLY the search results below for current prices and analyst data.

LIVE WEB SEARCH RESULTS FOR ${target} STOCKS:
${await searchWeb(`${target} ${exIdx} stocks analyst rating buy sell 2026`)}

Create investment analysis for ${target}'s ${ex} (${exIdx}) using search results above.
Use ONLY these exact tickers and company names — do not use any others: ${ref}

Return a JSON object with ALL fields filled — no placeholder text:
{"exchange":"${ex}","index":"${exIdx}","marketSentiment":"bullish","sentimentScore":68,"fearGreedIndex":55,"indexChange1d":"+0.85%","indexChange1w":"+2.1%","marketOutlook":"Two specific sentences about ${target} market right now.","macroFactors":["real factor 1","real factor 2","real factor 3"],"keyDrivers":["real driver 1","real driver 2"],"sectorRotation":{"leading":["sector1","sector2"],"lagging":["sector1","sector2"]},"picks":[{"rank":1,"symbol":"TICKER","name":"Full Company Name","sector":"sector","currentPrice":"${cur}NUM","targetPrice1m":"${cur}NUM","targetPrice6m":"${cur}NUM","targetPrice1y":"${cur}NUM","upside1m":"+8%","upside6m":"+15%","upside1y":"+25%","signal":"BUY","tradingSignal":"BUY","investmentSignal":"BUY","rsi":58,"maSignal":"BULLISH CROSSOVER","volumeTrend":"INCREASING","supportLevel":"${cur}NUM","resistanceLevel":"${cur}NUM","stopLoss":"${cur}NUM","riskReward":"1:2.5","volatility":"MEDIUM","beta":1.1,"pe":"25.4","epsGrowth":"+18%","revenueGrowth":"+12%","debtEquity":"0.32","dividendYield":"1.8%","institutionalOwnership":"72%","thesis":"Two specific sentences about why to buy this stock now.","tradingSetup":"One sentence trading setup.","catalysts":["real catalyst 1","real catalyst 2"],"risks":["real risk 1","real risk 2"],"newsDriver":"One sentence about recent news.","confidence":75,"timeframe":"Q2 2025"}]}
All numbers must be actual numbers, not strings like NUMBER_X_TO_Y. sentimentScore and fearGreedIndex must be integers 30-90.`,
    "{",2200);
  const obj=pObj(raw);
  if(obj&&obj.picks&&Array.isArray(obj.picks)&&obj.picks.length>=3&&obj.picks[0]?.symbol&&!/^PK\d$/.test(obj.picks[0].symbol)){
    // Normalize all pick fields to prevent render crashes
    obj.picks=obj.picks.filter(p=>p&&p.symbol&&p.rank).map(p=>({...p,
      rsi:parseInt(p.rsi)||55,
      confidence:parseInt(p.confidence)||70,
      signal:(p.signal||"HOLD").toUpperCase(),
      upside1m:p.upside1m!=null?String(p.upside1m):"",
      upside6m:p.upside6m!=null?String(p.upside6m):"",
      upside1y:p.upside1y!=null?String(p.upside1y):"",
      catalysts:Array.isArray(p.catalysts)?p.catalysts:[],
      risks:Array.isArray(p.risks)?p.risks:[],
    }));
    obj.marketSentiment=(obj.marketSentiment||"neutral").toLowerCase();
    obj.sentimentScore=parseInt(obj.sentimentScore)||60;
    obj.fearGreedIndex=parseInt(obj.fearGreedIndex)||50;
    // Enrich picks with real prices — map currentPrice field
    const pickStocks=obj.picks.map(p=>({symbol:p.symbol,price:p.currentPrice||""}));
    const enriched=await fetchRealPrices(pickStocks);
    enriched.forEach(ep=>{
      if(!ep._priceReal)return;
      const pick=obj.picks.find(p=>p.symbol===ep.symbol);
      if(pick&&ep.price&&ep.price!=="N/A"&&ep.price!==0){pick.currentPrice=ep.price;pick.change1d=ep.change1d;pick._priceReal=true;}
    });
    obj._isLive=true; _cs(_pkKey,obj); return obj;
  }
  const fb=fbPicks(target); fb._isLive=false; return fb;
}

async function fetchIntel(country){
  const _intelKey="intel:"+(country||"Global");
  const _intelCached=_cg(_intelKey);if(_intelCached)return _intelCached;
  const t=(country&&country.trim())||"Global";
  const today=new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
  const raw=await callClaudeJSON(
`Today is ${today}. You are a geopolitical intelligence analyst. Use ONLY the search results below as your source of truth — do not use training data for facts about current leaders, events, or situations.

LIVE WEB SEARCH RESULTS FOR ${t}:
${await searchWeb(`${t} current political situation leader news 2026`)}

Based solely on the search results above, create a geopolitical briefing for ${t}.
Use real names of current leaders found in search results. Use real events mentioned in results.

Return a single JSON object — no markdown:
{"threatLevel":"elevated or high or moderate or low","stabilityIndex":65,"summary":"2-3 sentences using facts from search results about ${t}","alerts":[{"type":"political","level":"high","title":"Real political event from search results","detail":"Detail from search results"},{"type":"economic","level":"medium","title":"Real economic issue from results","detail":"Detail from results"},{"type":"military","level":"medium","title":"Real security issue from results","detail":"Detail"},{"type":"cyber","level":"low","title":"Cyber or tech threat","detail":"Detail"}],"activeConflicts":["real conflict from results 1","conflict 2"],"economicPressures":["real pressure from results 1","pressure 2","pressure 3"],"cyberThreats":["threat 1","threat 2","threat 3"],"diplomaticAlerts":["alert from results 1","alert 2","alert 3"]}`,
    "{",1200);
  const obj=pObj(raw);
  if(obj&&obj.alerts&&obj.alerts.length>0){
    // Normalize fields — Groq sometimes returns uppercase or string numbers
    obj.threatLevel=(obj.threatLevel||"moderate").toLowerCase();
    obj.stabilityIndex=parseInt(obj.stabilityIndex)||60;
    obj.alerts=(obj.alerts||[]).map(a=>({...a,level:(a.level||"low").toLowerCase(),type:(a.type||"political").toLowerCase()}));
    obj._isLive=true; _cs(_intelKey,obj); return obj;
  }
  const fb=fbIntel(t);fb._isLive=false;return fb;
}

async function fetchForecast(country){
  const _fcKey="fc:"+(country||"USA");
  const _fcCached=_cg(_fcKey);if(_fcCached)return _fcCached;
  const t=(country&&country.trim())||"USA";
  const today=new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
  const raw=await callClaudeJSON(
`Today is ${today}. Use ONLY the search results below for all economic facts — do not use training data.

LIVE WEB SEARCH RESULTS FOR ${t} ECONOMY:
${await searchWeb(`${t} GDP inflation interest rate unemployment 2026`)}

Using the search results above, create an economic forecast for ${t}.
Extract real numbers (GDP%, inflation%, interest rate%) directly from search results.

Return a single JSON object — no markdown:
{"country":"${t}","stability":65,"geopoliticalScore":65,"confidenceScore":70,"economicOutlook":"positive or neutral or negative or critical","gdpGrowth":"+X.X%","inflation":"X.X%","unemployment":"X.X%","interestRate":"X.XX%","currencyStrength":"STRONG or STABLE or WEAK or VOLATILE","sixMonthPrediction":"3 sentences based on search results","workingClassForecast":"2 sentences about jobs and living costs in ${t}","marketOutlook":"2 sentences about ${t} markets","traderOpportunities":"2 sentences about opportunities in ${t}","keyRisks":["risk from results 1","risk 2","risk 3"],"opportunities":["opportunity 1","opportunity 2","opportunity 3"],"basedOn":"institutions mentioned in search results for ${t}"}`,
    "{",1200);
  const obj=pObj(raw);
  if(obj&&obj.country&&obj.gdpGrowth){obj._isLive=true; _cs(_fcKey,obj); return obj;}
  const fb=fbForecast(t);fb._isLive=false;return fb;
}

/* ── TERMS ── */
const TERMS_TEXT=`WORLD INTEL — TERMS OF SERVICE & DISCLAIMER
Last Updated: 2026 | Owner: Shubham Chatterjee | datanexusglobus@gmail.com

1. DATA ACCURACY & DISCLAIMER
All data, news, market information, stock prices, financial analysis, intelligence reports, and forecasts displayed on World Intel ("Platform") are AI-powered and sourced via real-time web search. While every effort is made to present accurate information, World Intel does NOT guarantee the accuracy, completeness, or timeliness of any data shown.

2. NO INVESTMENT ADVICE
NOTHING on this Platform constitutes professional financial, investment, legal or tax advice. All market data, stock picks, signals, and forecasts are for INFORMATIONAL AND EDUCATIONAL PURPOSES ONLY. Past performance is not indicative of future results. Always consult a qualified financial advisor before making investment decisions.

3. LIMITATION OF LIABILITY
World Intel, its owner Shubham Chatterjee, and affiliates shall NOT be liable for any investment losses, financial decisions, or damages made based on information shown on this Platform. You use this Platform entirely at your own risk.

4. AI-GENERATED CONTENT
The Platform uses Anthropic Claude AI to search and synthesize market and news data. AI analysis carries inherent uncertainty. Signals like BUY/SELL are AI-generated interpretations — NOT professional financial recommendations.

5. FINTECH CAPABILITIES NOTICE
Market data, investment analysis, and financial signals are generated using AI tools. These are analytical tools only and do not constitute a regulated financial service.

6. COOKIE & PRIVACY POLICY
We collect: email (authentication), timezone (display). We do NOT sell or share personal data. Cookies are used for session management only.

7. GEOPOLITICAL DATA
All geopolitical analysis and threat assessments are AI interpretations of public news. Not for use in security, military, or governmental decisions.

8. CHANGES
We reserve the right to update these Terms. Continued use constitutes acceptance.

Contact: datanexusglobus@gmail.com | Owner: Shubham Chatterjee`;

/* ═══════════════════════════════════════════════════════════
   THEME — DARK & LIGHT MODES
═══════════════════════════════════════════════════════════ */
const DARK = {
  bg:"#060a12", bg2:"#0a1020", bg3:"#0d1830",
  card:"#0d1422", cardB:"#111d2e",
  border:"rgba(32,90,160,0.22)", borderG:"rgba(0,220,130,0.2)", borderR:"rgba(255,60,90,0.2)",
  text:"#d0e4ff", textD:"#7090b0", textDD:"#3a5070",
  cyan:"#00ccf5", green:"#00dc82", red:"#ff3a5a",
  orange:"#ff8c00", yellow:"#f5c400", purple:"#a855f7",
  pink:"#e879f9", blue:"#3b82f6", accent:"#00ccf5",
  inputBg:"#0a1525", shadow:"rgba(0,0,0,0.4)",
  navBg:"rgba(8,14,24,0.97)", headerBg:"rgba(6,10,18,0.97)",
  sidebarBg:"rgba(8,14,24,0.95)",
};

const LIGHT = {
  bg:"#f0f4f8", bg2:"#e4ecf5", bg3:"#dce6f0",
  card:"#ffffff", cardB:"#f5f8fc",
  border:"rgba(100,140,200,0.28)", borderG:"rgba(0,160,90,0.3)", borderR:"rgba(200,40,60,0.25)",
  text:"#1a2a3a", textD:"#4a6080", textDD:"#8090a0",
  cyan:"#0099cc", green:"#008844", red:"#cc2244",
  orange:"#cc6600", yellow:"#aa8800", purple:"#7733cc",
  pink:"#cc44aa", blue:"#2255cc", accent:"#0099cc",
  inputBg:"#ffffff", shadow:"rgba(0,0,0,0.12)",
  navBg:"rgba(240,244,248,0.97)", headerBg:"rgba(255,255,255,0.97)",
  sidebarBg:"rgba(240,244,248,0.97)",
};

/* ─ CSS ─ */
function makeCSS(T,isDark){return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Orbitron:wght@500;700;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0;-webkit-font-smoothing:antialiased;}
html,body,#root,#__next{height:100%;background:${T.bg};}
body{font-family:'Inter',sans-serif;color:${T.text};font-size:15px;line-height:1.6;}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:${isDark?"rgba(0,204,245,0.18)":"rgba(0,100,200,0.2)"};border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:${isDark?"rgba(0,204,245,0.35)":"rgba(0,100,200,0.4)"}}
@keyframes pulse2{0%,100%{opacity:.35;transform:scale(1)}50%{opacity:1;transform:scale(1.2)}}
@keyframes blink{0%,80%,100%{opacity:.15;transform:scale(.6)}40%{opacity:1;transform:scale(1)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes shimmer{0%{left:-100%}100%{left:100%}}
@keyframes countUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.hov{transition:all .18s ease;cursor:pointer;}
.hov:hover{opacity:.8;transform:translateY(-1px);}
.card-hover{transition:all .2s ease;cursor:pointer;}
.card-hover:hover{border-color:${T.cyan}55!important;box-shadow:0 4px 20px ${T.shadow};}
.sk{position:relative;overflow:hidden;background:${isDark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.04)"};border:1px solid ${T.border};border-radius:8px;}
.sk::after{content:'';position:absolute;top:0;left:-100%;width:60%;height:100%;background:linear-gradient(90deg,transparent,${isDark?"rgba(0,204,245,0.04)":"rgba(0,100,200,0.04)"},transparent);animation:shimmer 1.8s infinite;}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.05em;cursor:pointer;transition:all .18s;border-radius:7px;white-space:nowrap;border:none;}
.btn:disabled{opacity:.45;cursor:not-allowed;}
.btn-primary{padding:9px 18px;background:${isDark?"rgba(0,204,245,0.1)":"rgba(0,150,200,0.1)"};border:1px solid ${T.cyan}55;color:${T.cyan};}
.btn-primary:hover:not(:disabled){background:${isDark?"rgba(0,204,245,0.18)":"rgba(0,150,200,0.2)"};box-shadow:0 0 14px ${T.cyan}22;}
.btn-danger{padding:5px 11px;background:${isDark?"rgba(255,58,90,0.08)":"rgba(200,40,60,0.08)"};border:1px solid ${T.red}44;color:${T.red};}
.btn-ghost{padding:6px 13px;background:transparent;border:1px solid ${T.border};color:${T.textD};}
.btn-ghost:hover:not(:disabled){border-color:${T.cyan}44;color:${T.text};}
.tag{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.1em;white-space:nowrap;}
.input-field{width:100%;padding:11px 14px;border-radius:8px;background:${T.inputBg};color:${T.text};font-family:'Inter',sans-serif;font-size:14px;outline:none;transition:border-color .2s;border:1px solid ${T.border};}
.input-field::placeholder{color:${T.textDD};}
.input-field:focus{border-color:${T.cyan}66!important;box-shadow:0 0 0 3px ${T.cyan}0d;}
.nav-link{display:flex;align-items:center;gap:9px;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;transition:all .18s;border:1px solid transparent;color:${T.textD};}
.nav-link:hover{background:${isDark?"rgba(0,204,245,0.06)":"rgba(0,100,200,0.06)"};color:${T.text};}
.nav-link.active{background:${isDark?"rgba(0,204,245,0.1)":"rgba(0,100,200,0.1)"};border-color:${T.cyan}33;color:${T.cyan};}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,${isDark?".82":".55"});z-index:900;display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .2s;backdrop-filter:blur(6px);}
.modal{background:${T.card};border:1px solid ${T.border};border-radius:14px;max-width:680px;width:100%;max-height:88vh;display:flex;flex-direction:column;animation:fadeUp .3s;box-shadow:0 24px 80px ${T.shadow};}
.page-enter{animation:fadeIn .3s ease;}
.signal-sbuy{color:#00ffaa;background:rgba(0,255,170,0.1);border:1px solid rgba(0,255,170,0.3);}
.signal-buy{color:#00dc82;background:rgba(0,220,130,0.1);border:1px solid rgba(0,220,130,0.25);}
.signal-hold{color:#f5c400;background:rgba(245,196,0,0.1);border:1px solid rgba(245,196,0,0.25);}
.signal-sell{color:#ff8c00;background:rgba(255,140,0,0.1);border:1px solid rgba(255,140,0,0.25);}
.signal-ssell{color:#ff3a5a;background:rgba(255,58,90,0.1);border:1px solid rgba(255,58,90,0.25);}

/* ── MOBILE RESPONSIVE ── */
@media(max-width:768px){
  /* Show hamburger */
  #mob-menu-btn{display:flex!important;align-items:center;justify-content:center;}
  /* Hide desktop-only items */
  .mob-hide{display:none!important;}
  /* Show mobile-only live dot */
  .mob-live{display:flex!important;}
  /* Sidebar: fixed overlay drawer */
  .sidebar{
    position:fixed!important;
    top:0;left:0;bottom:0;
    z-index:150;
    transform:translateX(-100%);
    transition:transform .28s cubic-bezier(.4,0,.2,1);
    width:220px!important;
    box-shadow:4px 0 24px rgba(0,0,0,.55);
  }
  .sidebar.open{transform:translateX(0);}
  .mob-overlay{display:block;}
  /* Header: no overflow */
  header{
    padding:0 8px!important;
    gap:6px!important;
    overflow:hidden!important;
    box-sizing:border-box!important;
    position:relative!important;
  }
  #header-logo{
    position:absolute!important;
    left:50%!important;
    transform:translateX(-50%)!important;
    pointer-events:none;
  }
  main{width:100%;overflow-x:hidden;}
  footer{padding:0 12px!important;}
  /* Auth page: full width card */
  .auth-card{padding:22px 18px!important;margin:0 4px!important;}
}
@media(min-width:769px){
  .mob-overlay{display:none!important;}
  #mob-menu-btn{display:none!important;}
  .mob-live{display:none!important;}
  .sidebar{
    transform:none!important;
    position:relative!important;
    width:190px!important;
  }
}
`;}

/* ═══════════════════════════════════════════════════════════
   SVG LOGO — Earth skeleton + Dollar sign
═══════════════════════════════════════════════════════════ */
function LogoSVG({size=32}){
  return(
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Earth — blue fill */}
      <circle cx="24" cy="24" r="19" fill="rgba(0,100,200,0.15)"/>
      {/* Earth — blue outline */}
      <circle cx="24" cy="24" r="19" stroke="#1a8cff" strokeWidth="1.6" fill="none" opacity=".9"/>
      {/* Latitude lines */}
      <ellipse cx="24" cy="24" rx="19" ry="8" stroke="#1a8cff" strokeWidth=".8" fill="none" opacity=".5"/>
      <line x1="5" y1="24" x2="43" y2="24" stroke="#1a8cff" strokeWidth=".8" opacity=".45"/>
      <line x1="5" y1="16" x2="43" y2="16" stroke="#1a8cff" strokeWidth=".5" opacity=".3"/>
      <line x1="5" y1="32" x2="43" y2="32" stroke="#1a8cff" strokeWidth=".5" opacity=".3"/>
      {/* Longitude curves */}
      <path d="M24 5 Q34 24 24 43" stroke="#1a8cff" strokeWidth=".8" fill="none" opacity=".4"/>
      <path d="M24 5 Q14 24 24 43" stroke="#1a8cff" strokeWidth=".8" fill="none" opacity=".4"/>
      {/* Dollar — golden vertical bar crossing full globe */}
      <line x1="24" y1="5" x2="24" y2="43" stroke="#f5c400" strokeWidth="2.2" opacity=".9"/>
      {/* Dollar $ sign — golden */}
      <text x="24" y="30" textAnchor="middle" fontSize="15" fontWeight="900" fill="#f5c400" fontFamily="Arial,sans-serif">$</text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   ATOMS
═══════════════════════════════════════════════════════════ */
function Pulse({c,s=7}){return <span style={{position:"relative",display:"inline-flex",alignItems:"center",justifyContent:"center",width:s,height:s}}><span style={{position:"absolute",inset:0,borderRadius:"50%",background:c,opacity:.3,animation:"pulse2 2s ease infinite"}}/><span style={{width:s*.5,height:s*.5,borderRadius:"50%",background:c}}/></span>;}
function Loader({c,n=3,sz=5}){return <span style={{display:"inline-flex",gap:4,alignItems:"center"}}>{Array.from({length:n}).map((_,i)=><span key={i} style={{width:sz,height:sz,borderRadius:"50%",background:c,animation:`blink 1.3s ${i*.18}s infinite`}}/>)}</span>;}
function SkRow({h=56,mb=6}){return <div className="sk" style={{height:h,marginBottom:mb}}/>;}
function SignalBadge({sig}){const s=(sig||"HOLD").toUpperCase();const cl=s==="STRONG BUY"?"signal-sbuy":s==="BUY"?"signal-buy":s==="HOLD"?"signal-hold":s==="SELL"?"signal-sell":"signal-ssell";return <span className={`tag ${cl}`}>{s}</span>;}
function ChangeChip({v,prefix="",T}){if(!v||v==="N/A")return <span style={{color:T.textDD,fontSize:12}}>—</span>;const n=parseFloat(v);const up=n>=0;return <span style={{color:up?T.green:T.red,fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700}}>{up?"▲":"▼"} {prefix}{v.replace(/[+-]/g,"")}</span>;}
function ScoreBar({val=0,color,T}){return <div style={{height:4,background:T?`rgba(${val>50?"0,0,0":"0,0,0"}`:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden",marginTop:4,backgroundColor:"rgba(128,128,128,0.12)"}}><div style={{width:`${Math.min(100,Math.max(0,val))}%`,height:"100%",background:color,borderRadius:2,transition:"width 1s ease"}}/></div>;}
function InfoCard({label,value,color,sub,T}){return <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px 16px"}}><div style={{fontSize:10,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:6}}>{label}</div><div style={{fontSize:18,fontWeight:700,color}}>{value||"—"}</div>{sub&&<div style={{marginTop:4}}>{sub}</div>}</div>;}

/* ── SEV META ── */
function getSevC(T){return{
  critical:{bg:T.bg,bgA:"rgba(255,58,90,.08)",bd:"rgba(255,58,90,.3)",c:T.red},
  high:{bg:T.bg,bgA:"rgba(255,140,0,.07)",bd:"rgba(255,140,0,.25)",c:T.orange},
  medium:{bg:T.bg,bgA:"rgba(245,196,0,.06)",bd:"rgba(245,196,0,.22)",c:T.yellow},
  low:{bg:T.bg,bgA:"rgba(0,220,130,.05)",bd:"rgba(0,220,130,.2)",c:T.green},
};}
const CAT_ICON={conflict:"⚔️",military:"✈️",cyber:"💻",unrest:"✊",infrastructure:"🔌",disaster:"🌊",economy:"📊",politics:"🏛️",trade:"🤝"};

/* ── ASYNC BLOCK — with error + retry ── */
function AsyncBlock({loadFn,color,skCount=4,successCheck,children,T}){
  const[data,setData]=useState(null);
  const[loading,setLoad]=useState(true);
  const[failed,setFail]=useState(false);
  const[errMsg,setErrMsg]=useState("");
  const mounted=useRef(true);
  const[isLive,setIsLive]=useState(false);
  const load=useCallback(async()=>{
    setLoad(true);setData(null);setFail(false);setErrMsg("");setIsLive(false);
    try{
      const d=await loadFn();
      if(!mounted.current)return;
      if(d&&(successCheck?successCheck(d):true)){
        // Use explicit _isLive flag set by each fetch function
        // true = came from Claude API, false = hardcoded fallback
        setIsLive(d._isLive===true);
        setData(d);setFail(false);
      }else{setFail(true);setErrMsg("No data returned. The AI may have had difficulty finding current market data.");}
    }catch(e){
      if(mounted.current){setFail(true);setErrMsg(e?.message||"Network error occurred.");}
    }
    if(mounted.current)setLoad(false);
  },[loadFn]);
  useEffect(()=>{mounted.current=true;load();return()=>{mounted.current=false;};},[load]);
  return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:10,marginBottom:14}}>
        {!loading&&data&&(
          <span style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".08em",
            padding:"3px 8px",borderRadius:4,
            background:isLive?"rgba(0,220,130,.1)":"rgba(245,196,0,.08)",
            border:`1px solid ${isLive?"rgba(0,220,130,.3)":"rgba(245,196,0,.25)"}`,
            color:isLive?"#00dc82":"#f5c400"}}>
            {isLive?"● LIVE DATA":"○ ESTIMATED DATA"}
          </span>
        )}
        <button className="btn btn-ghost" onClick={load} disabled={loading}>{loading?<Loader c={color} n={3}/>:"↻ REFRESH DATA"}</button>
      </div>
      {loading&&(
        <div>
          {Array.from({length:skCount}).map((_,i)=><SkRow key={i} h={i===0?88:58}/>)}
          <div style={{textAlign:"center",padding:"12px",fontSize:13,color:T.textD,display:"flex",justifyContent:"center",gap:10,alignItems:"center"}}>
            <Loader c={color}/> Fetching live data via web search…
          </div>
        </div>
      )}
      {!loading&&failed&&(
        <div style={{textAlign:"center",padding:"40px 24px",background:T.card,border:`1px solid ${T.borderR}`,borderRadius:12}}>
          <div style={{fontSize:32,marginBottom:12}}>⚠️</div>
          <div style={{fontSize:15,color:T.text,fontWeight:600,marginBottom:8}}>Data Fetch Failed</div>
          <div style={{fontSize:13,color:T.textD,marginBottom:20,maxWidth:400,margin:"0 auto 20px",lineHeight:1.6}}>{errMsg||"API may be busy. Please wait a moment and retry."}</div>
          <div style={{fontSize:12,color:T.textDD,marginBottom:20}}>💡 Tip: Try clicking REFRESH DATA or selecting a different country from the quick picks below.</div>
          <button className="btn btn-primary" onClick={load} style={{fontSize:12}}>↻ RETRY NOW</button>
        </div>
      )}
      {!loading&&!failed&&data&&children(data)}
    </div>
  );
}

/* ─ TERMS MODAL ─ */
function TermsModal({onClose,T}){
  return(
    <div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modal">
        <div style={{padding:"18px 22px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontFamily:"'Orbitron',monospace",fontSize:11,fontWeight:700,color:T.cyan,letterSpacing:".15em"}}>TERMS OF SERVICE & DISCLAIMER</div>
            <div style={{fontSize:12,color:T.textDD,marginTop:2}}>World Intel · Shubham Chatterjee</div>
          </div>
          <button className="btn btn-danger" onClick={onClose}>✕ CLOSE</button>
        </div>
        <div style={{overflowY:"auto",padding:"22px",flex:1}}>
          <pre style={{fontFamily:"'Inter',sans-serif",fontSize:13,color:T.textD,lineHeight:1.9,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{TERMS_TEXT}</pre>
        </div>
      </div>
    </div>
  );
}

/* ─ COOKIE BANNER ─ */
function CookieBanner({onAccept,T}){
  const[st,setSt]=useState(false);
  return(<>
    {st&&<TermsModal onClose={()=>setSt(false)} T={T}/>}
    <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:600,background:T.headerBg,borderTop:`1px solid ${T.border}`,padding:"14px 24px",display:"flex",gap:16,alignItems:"center",flexWrap:"wrap",backdropFilter:"blur(12px)"}}>
      <span style={{fontSize:22}}>🍪</span>
      <div style={{flex:1,minWidth:220}}>
        <div style={{fontSize:12,color:T.cyan,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,marginBottom:3}}>COOKIE NOTICE</div>
        <div style={{fontSize:13,color:T.textD,lineHeight:1.6}}>We use cookies for sessions & preferences. <span onClick={()=>setSt(true)} style={{color:T.cyan,cursor:"pointer",textDecoration:"underline"}}>Privacy Policy & Terms</span></div>
      </div>
      <button className="btn btn-primary" onClick={onAccept}>✓ ACCEPT</button>
    </div>
  </>);
}

/* ─ CONTACT MODAL ─ */
function ContactModal({onClose,T}){
  return(
    <div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modal" style={{maxWidth:480}}>
        <div style={{padding:"18px 22px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontFamily:"'Orbitron',monospace",fontSize:11,fontWeight:700,color:T.cyan,letterSpacing:".15em"}}>CONTACT US</div>
          <button className="btn btn-danger" onClick={onClose}>✕ CLOSE</button>
        </div>
        <div style={{padding:"28px 24px",display:"flex",flexDirection:"column",gap:20}}>
          <div style={{textAlign:"center"}}>
            <LogoSVG size={52}/>
            <div style={{fontFamily:"'Orbitron',monospace",fontSize:16,fontWeight:900,color:T.cyan,letterSpacing:".15em",marginTop:10}}>WORLD INTEL</div>
          </div>
          <div style={{padding:"18px 20px",background:T.bg2,border:`1px solid ${T.border}`,borderRadius:10}}>
            <div style={{fontSize:12,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:6}}>OWNER</div>
            <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:2}}>Shubham Chatterjee</div>
            <div style={{fontSize:13,color:T.textD}}>Creator & Developer, World Intel</div>
          </div>
          <div style={{padding:"18px 20px",background:T.bg2,border:`1px solid ${T.border}`,borderRadius:10}}>
            <div style={{fontSize:12,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:8}}>REACH OUT</div>
            <div style={{fontSize:13,color:T.textD,lineHeight:1.7,marginBottom:12}}>
              For queries, feedback, collaborations, or promotional partnerships, please contact us at:
            </div>
            <div style={{padding:"12px 16px",background:T.card,border:`1px solid ${T.cyan}33`,borderRadius:8,textAlign:"center"}}>
              <div style={{fontSize:14,fontWeight:700,color:T.cyan,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".05em"}}>
                datanexusglobus@gmail.com
              </div>
            </div>
          </div>
          <div style={{fontSize:12,color:T.textDD,textAlign:"center",lineHeight:1.6}}>
            We typically respond within 24–48 hours. For general questions, please review our{" "}
            <span style={{color:T.cyan,cursor:"pointer",textDecoration:"underline"}} onClick={onClose}>Terms & Conditions</span>.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   AUTH SCREEN
═══════════════════════════════════════════════════════════ */
function AuthScreen({onLogin,T,isDark}){
  const CSS=makeCSS(T,isDark);
  const[mode,setMode]=useState("login");
  const[name,setName]=useState("");
  const[email,setEmail]=useState("");
  const[pw,setPw]=useState("");
  const[pw2,setPw2]=useState("");
  const[show,setShow]=useState(false);
  const[err,setErr]=useState("");
  const[busy,setBusy]=useState(false);
  const[terms,setTerms]=useState(false);
  const[showT,setShowT]=useState(false);
  const[pws,setPws]=useState(0);
  useEffect(()=>{let s=0;if(pw.length>=8)s++;if(pw.length>=12)s++;if(/[A-Z]/.test(pw))s++;if(/[0-9]/.test(pw))s++;if(/[^a-zA-Z0-9]/.test(pw))s++;setPws(s);},[pw]);
  const emailOk=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const nameOk=name.trim().length>=2;
  const pwC=["","#ff3a5a","#ff8c00","#f5c400","#00dc82","#00ccf5"];
  const pwL=["","Weak","Fair","Good","Strong","Excellent"];

  async function submit(){
    setErr("");
    if(mode==="login"){
      if(!email||!pw)return setErr("Enter email and password");
      setBusy(true);
      try{const s=await loginUser(email,pw);onLogin(s);}catch(e){setErr(e.message||"Login failed");}
      setBusy(false);
    }else{
      if(!nameOk)return setErr("Name must be at least 2 characters");
      if(!emailOk)return setErr("Enter a valid email");
      if(pw.length<8)return setErr("Password: min 8 characters");
      if(pw!==pw2)return setErr("Passwords don't match");
      if(!terms)return setErr("Please accept the Terms & Conditions");
      setBusy(true);
      try{const s=await registerUser(email,pw,name.trim());onLogin(s);}catch(e){setErr(e.message||"Registration failed");}
      setBusy(false);
    }
  }

  return(<>
    {showT&&<TermsModal onClose={()=>setShowT(false)} T={T}/>}
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",position:"relative",overflow:"hidden"}}>
      <style>{CSS}</style>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",backgroundImage:`linear-gradient(${T.border} 1px,transparent 1px),linear-gradient(90deg,${T.border} 1px,transparent 1px)`,backgroundSize:"44px 44px",opacity:.4}}/>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",background:`radial-gradient(ellipse 60% 60% at 20% 80%,${isDark?"rgba(0,204,245,.04)":"rgba(0,100,200,.05)"} 0,transparent 60%),radial-gradient(ellipse 60% 60% at 80% 20%,${isDark?"rgba(168,85,247,.04)":"rgba(100,50,200,.04)"} 0,transparent 60%)`}}/>

      <div style={{width:"100%",maxWidth:440,position:"relative",zIndex:1,animation:"fadeUp .4s ease"}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:14,marginBottom:14}}>
            <LogoSVG size={48}/>
            <div>
              <div style={{fontFamily:"'Orbitron',monospace",fontSize:22,fontWeight:900,background:`linear-gradient(135deg,${T.cyan},${T.purple})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:".1em",lineHeight:1.1}}>WORLD INTEL</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:T.textDD,letterSpacing:".22em",marginTop:3}}>AI FINANCIAL & GEO-INTELLIGENCE</div>
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"center",gap:18,fontSize:12,color:T.textD,flexWrap:"wrap"}}>
            {["📡 Intel","📊 Markets","🎯 Signals","🌍 Map","🔮 Forecasts"].map(x=><span key={x}>{x}</span>)}
          </div>
        </div>

        <div className="auth-card" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:"30px",boxShadow:`0 20px 60px ${T.shadow}`}}>
          <div style={{display:"flex",background:T.bg,borderRadius:10,padding:3,marginBottom:24,border:`1px solid ${T.border}`}}>
            {[["login","🔐 Sign In"],["reg","✦ Register"]].map(([k,l])=>(
              <button key={k} className="btn" onClick={()=>{setMode(k);setErr("");setName("");setEmail("");setPw("");setPw2("");}} style={{flex:1,padding:"9px",borderRadius:8,border:"none",background:mode===k?`${isDark?"rgba(0,204,245,0.12)":"rgba(0,100,200,0.1)"}`:"transparent",color:mode===k?T.cyan:T.textDD,fontSize:12,letterSpacing:".04em"}}>{l}</button>
            ))}
          </div>

          <div key={mode} style={{display:"flex",flexDirection:"column",gap:16}}>
            {mode==="reg"&&(
              <div>
                <label style={{display:"block",fontSize:11,color:T.textD,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:7}}>DISPLAY NAME</label>
                <input className="input-field" style={{border:`1px solid ${name?(nameOk?"rgba(0,220,130,.4)":"rgba(255,58,90,.4)"):T.border}`}} defaultValue={name} onChange={e=>{setName(e.target.value);setErr("");}} onInput={e=>{setName(e.target.value);setErr("");}} onKeyUp={e=>setName(e.target.value)} placeholder="Your full name" maxLength={40}/>
              </div>
            )}
            <div>
              <label style={{display:"block",fontSize:11,color:T.textD,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:7}}>EMAIL ADDRESS</label>
              <input className="input-field" style={{border:`1px solid ${mode==="reg"&&email?(emailOk?"rgba(0,220,130,.4)":"rgba(255,58,90,.4)"):T.border}`}} type="email" defaultValue={email} onChange={e=>{setEmail(e.target.value.trim());setErr("");}} onInput={e=>{setEmail(e.target.value.trim());setErr("");}} onKeyUp={e=>setEmail(e.target.value.trim())} placeholder="you@example.com" autoComplete="email"/>
            </div>
            <div>
              <label style={{display:"block",fontSize:11,color:T.textD,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:7}}>PASSWORD</label>
              <div style={{position:"relative"}}>
                <input className="input-field" style={{border:`1px solid ${T.border}`,paddingRight:46}} type={show?"text":"password"} defaultValue={pw} onChange={e=>{setPw(e.target.value);setErr("");}} onInput={e=>{setPw(e.target.value);setErr("");}} onKeyUp={e=>setPw(e.target.value)} placeholder="min 8 characters" autoComplete={mode==="reg"?"new-password":"current-password"}/>
                <button onClick={()=>setShow(p=>!p)} style={{position:"absolute",right:13,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:T.textD,cursor:"pointer",fontSize:16,padding:0}}>{show?"🙈":"👁"}</button>
              </div>
              {mode==="reg"&&pw&&<div style={{marginTop:8}}><div style={{display:"flex",gap:3,marginBottom:4}}>{[1,2,3,4,5].map(i=><div key={i} style={{flex:1,height:3,borderRadius:2,background:i<=pws?pwC[pws]:"rgba(128,128,128,.15)",transition:"background .3s"}}/>)}</div><span style={{fontSize:11,color:pwC[pws]||T.textDD}}>{pwL[pws]}</span></div>}
            </div>
            {mode==="reg"&&(
              <>
                <div>
                  <label style={{display:"block",fontSize:11,color:T.textD,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:7}}>CONFIRM PASSWORD</label>
                  <input className="input-field" style={{border:`1px solid ${pw2?(pw2===pw?"rgba(0,220,130,.4)":"rgba(255,58,90,.4)"):T.border}`}} type={show?"text":"password"} defaultValue={pw2} onChange={e=>{setPw2(e.target.value);setErr("");}} onInput={e=>{setPw2(e.target.value);setErr("");}} onKeyUp={e=>setPw2(e.target.value)} placeholder="repeat password" autoComplete="new-password"/>
                </div>
                <div style={{padding:"12px 14px",borderRadius:9,background:`${isDark?"rgba(0,204,245,0.04)":"rgba(0,100,200,0.04)"}`,border:`1px solid ${terms?"rgba(0,220,130,.3)":T.border}`}}>
                  <label style={{display:"flex",gap:10,alignItems:"flex-start",cursor:"pointer"}} onClick={()=>setTerms(t=>!t)}>
                    <div style={{width:19,height:19,borderRadius:5,border:`2px solid ${terms?"#00dc82":T.border}`,background:terms?`rgba(0,220,130,.2)`:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1,transition:"all .2s"}}>
                      {terms&&<span style={{color:T.green,fontSize:11,fontWeight:900}}>✓</span>}
                    </div>
                    <div style={{fontSize:12,color:T.textD,lineHeight:1.65}}>I agree to the <span onClick={e=>{e.stopPropagation();setShowT(true);}} style={{color:T.cyan,cursor:"pointer",textDecoration:"underline"}}>Terms & Conditions</span>. Market data and signals are AI-generated for informational purposes only — NOT financial advice.</div>
                  </label>
                </div>
              </>
            )}
            {err&&<div style={{padding:"10px 14px",background:"rgba(255,58,90,.08)",border:"1px solid rgba(255,58,90,.28)",borderRadius:8,fontSize:13,color:T.red}}>⚠ {err}</div>}
            <button className="btn btn-primary" onClick={submit} disabled={busy} style={{padding:"13px",width:"100%",fontSize:13,letterSpacing:".1em"}}>
              {busy?<Loader c={T.cyan}/>:(mode==="login"?"⚡ SIGN IN":"✦ CREATE ACCOUNT")}
            </button>
          </div>
        </div>
        <div style={{textAlign:"center",marginTop:14,fontSize:12,color:T.textDD,fontFamily:"'JetBrains Mono',monospace"}}>{Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
      </div>
    </div>
  </>);
}

/* ═══════════════════════════════════════════════════════════
   PAGE: INTEL FEED
═══════════════════════════════════════════════════════════ */
function NewsCard({item,T}){
  const[open,setOpen]=useState(false);
  const SC=getSevC(T);
  const m=SC[item.severity]||SC.low;
  return(
    <div className="card-hover" onClick={()=>setOpen(o=>!o)} style={{padding:"16px 18px",borderRadius:11,background:open?m.bgA:T.card,border:`1px solid ${open?m.bd:T.border}`,marginBottom:10}}>
      <div style={{display:"flex",gap:13,alignItems:"flex-start"}}>
        <div style={{width:40,height:40,borderRadius:9,background:m.bgA,border:`1px solid ${m.c}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{CAT_ICON[item.category]||"📡"}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:7,flexWrap:"wrap"}}>
            <span className="tag" style={{background:m.bgA,color:m.c,border:`1px solid ${m.bd}`}}>{(item.severity||"low").toUpperCase()}</span>
            <span style={{fontSize:11,color:T.textD,fontFamily:"'JetBrains Mono',monospace"}}>{item.category}</span>
            {item.source&&<span style={{fontSize:11,color:T.textDD}}>· {item.source}</span>}
            {item.country&&<span style={{fontSize:11,color:T.textDD}}>· {item.country}</span>}
            <span style={{marginLeft:"auto",fontSize:11,color:T.textDD,flexShrink:0}}>{item.ago}</span>
          </div>
          <div style={{fontSize:15,color:T.text,fontWeight:600,lineHeight:1.55,marginBottom:open?0:6}}>{item.title}</div>
          {!open&&item.impact&&<div style={{fontSize:13,color:T.textD,marginTop:5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.impact}</div>}
          {open&&(
            <div style={{marginTop:13,display:"flex",flexDirection:"column",gap:8,borderTop:`1px solid ${m.bd}`,paddingTop:13,animation:"fadeIn .2s"}}>
              {item.impact&&<div style={{padding:"10px 13px",background:`${isDark?"rgba(0,204,245,.05)":"rgba(0,100,200,.04)"}`,borderRadius:7,borderLeft:`3px solid ${T.cyan}`}}><div style={{fontSize:10,color:T.cyan,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:4}}>🌐 GEOPOLITICAL IMPACT</div><div style={{fontSize:13,color:T.text,lineHeight:1.75}}>{item.impact}</div></div>}
              {item.tradeEffect&&<div style={{padding:"10px 13px",background:"rgba(0,220,130,.04)",borderRadius:7,borderLeft:`3px solid ${T.green}`}}><div style={{fontSize:10,color:T.green,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:4}}>📈 MARKET EFFECT</div><div style={{fontSize:13,color:T.text,lineHeight:1.75}}>{item.tradeEffect}</div></div>}
              {item.people&&<div style={{padding:"10px 13px",background:"rgba(168,85,247,.04)",borderRadius:7,borderLeft:`3px solid ${T.purple}`}}><div style={{fontSize:10,color:T.purple,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:4}}>👷 IMPACT ON WORKING CLASS</div><div style={{fontSize:13,color:T.text,lineHeight:1.75}}>{item.people}</div></div>}
            </div>
          )}
          <div style={{fontSize:10,color:T.textDD,marginTop:8,fontFamily:"'JetBrains Mono',monospace"}}>{open?"▲ collapse":"▼ expand full analysis"}</div>
        </div>
      </div>
    </div>
  );
}

let isDark=true; // module-level, updated by Dashboard

function PageNews({country,setCountry,T}){
  const[news,setNews]=useState([]);
  const[loading,setLoad]=useState(true);
  const[failed,setFail]=useState(false);
  const[sevF,setSevF]=useState("all");
  const[ticker,setTicker]=useState([]);
  const mounted=useRef(true);
  const SC=getSevC(T);
  const QR=["Global","South Asia","Europe","Americas","MENA","Southeast Asia","Africa","East Asia"];

  const load=useCallback(async()=>{
    setLoad(true);setNews([]);setFail(false);
    const q=country?`breaking news ${country} today`:"breaking world news top stories today";
    const d=await fetchNews(q);
    if(!mounted.current)return;
    if(d?.length){setNews(d);setTicker(d.filter(n=>n.severity==="critical"||n.severity==="high"));setFail(false);}
    else setFail(true);
    setLoad(false);
  },[country]);
  useEffect(()=>{mounted.current=true;load();return()=>{mounted.current=false;};},[load]);

  const filt=news.filter(n=>sevF==="all"||n.severity===sevF);
  const tickerTxt=ticker.map(x=>`◆ ${x.title} [${x.country||""}]`).join("     ");

  return(
    <div className="page-enter">
      {ticker.length>0&&<div style={{background:"rgba(255,58,90,.04)",borderBottom:"1px solid rgba(255,58,90,.1)",padding:"5px 22px",overflow:"hidden"}}><span style={{display:"inline-block",fontSize:11,color:T.red,fontFamily:"'JetBrains Mono',monospace",animation:"ticker 70s linear infinite",whiteSpace:"nowrap"}}>{tickerTxt}&nbsp;&nbsp;&nbsp;&nbsp;{tickerTxt}</span></div>}
      <div style={{padding:"22px 26px 14px",borderBottom:`1px solid ${T.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:13,flexWrap:"wrap",gap:8}}>
          <div>
            <h2 style={{fontSize:19,fontWeight:700,color:T.text}}>📡 Intel Feed</h2>
            <div style={{fontSize:13,color:T.textD,marginTop:3}}>Live AI intelligence {country&&`· ${country}`}</div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            {["all","critical","high","medium","low"].map(s=>{const m=SC[s];return(
              <button key={s} className="btn" onClick={()=>setSevF(s)} style={{padding:"5px 11px",borderRadius:6,border:`1px solid ${sevF===s?(m?.bd||T.border):T.border}`,background:sevF===s?(m?.bgA||`${isDark?"rgba(0,204,245,.08)":"rgba(0,100,200,.08)"}`):"transparent",color:sevF===s?(m?.c||T.cyan):T.textDD,fontSize:10}}>{s==="all"?"ALL":s.slice(0,4).toUpperCase()}</button>
            );})}
            <button className="btn btn-ghost" onClick={load} disabled={loading} style={{fontSize:11}}>{loading?<Loader c={T.red} n={3}/>:"↻"}</button>
          </div>
        </div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          {QR.map(r=><button key={r} className="btn" onClick={()=>setCountry(r===country?"":r)} style={{padding:"5px 11px",borderRadius:6,border:`1px solid ${country===r?"rgba(255,58,90,.3)":T.border}`,background:country===r?"rgba(255,58,90,.08)":"transparent",color:country===r?T.red:T.textDD,fontSize:11}}>{r}</button>)}
        </div>
      </div>
      <div style={{padding:"18px 26px"}}>
        {loading&&<div>{[1,2,3,4,5].map(i=><SkRow key={i} h={74} mb={10}/>)}<div style={{textAlign:"center",padding:"10px",fontSize:13,color:T.textD,display:"flex",justifyContent:"center",gap:10,alignItems:"center"}}><Loader c={T.red}/>Fetching intelligence…</div></div>}
        {!loading&&failed&&<div style={{textAlign:"center",padding:"44px",color:T.textD}}><div style={{fontSize:28,marginBottom:12}}>⚠️</div><div style={{fontSize:14,marginBottom:18}}>Failed to fetch intel. Click retry.</div><button className="btn btn-primary" onClick={load}>↻ RETRY</button></div>}
        {!loading&&!failed&&filt.map((item,i)=><NewsCard key={i} item={item} T={T}/>)}
        {!loading&&!failed&&filt.length===0&&<div style={{textAlign:"center",padding:"44px",color:T.textDD}}>No events for this filter.</div>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: MARKETS — TOP 5 STOCKS WITH SIGNALS
═══════════════════════════════════════════════════════════ */
function PageMarkets({country,setCountry,T}){
  const target=country||"USA";
  const{ex,idx}=getEx(target);
  const QC=["USA","India","China","UK","Japan","Germany","South Korea","Brazil","UAE","Australia","Canada","France"];
  const scoreC=v=>v>=75?T.green:v>=55?T.yellow:v>=35?T.orange:T.red;

  return(
    <div className="page-enter">
      <div style={{padding:"22px 26px 14px",borderBottom:`1px solid ${T.border}`}}>
        <div style={{marginBottom:13}}>
          <h2 style={{fontSize:19,fontWeight:700,color:T.text}}>📈 Markets</h2>
          <div style={{fontSize:13,color:T.textD,marginTop:3}}>{ex} · {idx} · Top 5 Market Movers with Signals</div>
        </div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          {QC.map(c=><button key={c} className="btn" onClick={()=>setCountry(c===country?"":c)} style={{padding:"5px 11px",borderRadius:6,border:`1px solid ${country===c?"rgba(0,220,130,.3)":T.border}`,background:country===c?"rgba(0,220,130,.08)":"transparent",color:country===c?T.green:T.textDD,fontSize:11}}>{c}</button>)}
        </div>
      </div>
      <div style={{padding:"18px 26px"}}>
        <AsyncBlock key={target} loadFn={useCallback(()=>fetchMarkets(target),[target])} color={T.green} skCount={5} successCheck={d=>Array.isArray(d)&&d.length>0} T={T}>
          {stocks=>(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {/* Signal summary row */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:4}}>
                {["STRONG BUY","BUY","HOLD","SELL","STRONG SELL"].map(sig=>{
                  const cnt=stocks.filter(s=>s.signal===sig).length;
                  const sigC=sig.includes("STRONG BUY")?"signal-sbuy":sig==="BUY"?"signal-buy":sig==="HOLD"?"signal-hold":sig==="SELL"?"signal-sell":"signal-ssell";
                  return <div key={sig} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px",textAlign:"center"}}><div style={{fontSize:20,fontWeight:900,color:sig.includes("BUY")?T.green:sig.includes("SELL")?T.red:T.yellow,fontFamily:"'JetBrains Mono',monospace"}}>{cnt}</div><span className={`tag ${sigC}`} style={{fontSize:8,marginTop:4}}>{sig}</span></div>;
                })}
              </div>

              {/* Stock cards */}
              {stocks.map((s,i)=>{
                const up=s.trend==="up"; const down=s.trend==="down";
                const ac=up?T.green:down?T.red:T.yellow;
                const chgN=parseFloat(s.change1d)||0;
                return(
                  <div key={i} className="card-hover" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"18px 20px",animation:`countUp ${.1+i*.08}s ease`}}>
                    {/* Header */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:10}}>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        <div style={{width:46,height:46,borderRadius:10,background:`${chgN>=0?"rgba(0,220,130,.08)":"rgba(255,58,90,.08)"}`,border:`1px solid ${ac}33`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                          <span style={{fontSize:11,fontWeight:900,color:ac,fontFamily:"'JetBrains Mono',monospace"}}>#{s.rank||i+1}</span>
                          <span style={{fontSize:16,color:ac}}>{up?"▲":down?"▼":"▶"}</span>
                        </div>
                        <div>
                          <div style={{fontSize:18,fontWeight:800,color:T.text,fontFamily:"'JetBrains Mono',monospace"}}>{s.symbol}</div>
                          <div style={{fontSize:12,color:T.textD,marginTop:2}}>{s.name} {s.sector&&<span style={{color:T.textDD}}>· {s.sector}</span>}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:20,fontWeight:800,color:T.text,fontFamily:"'JetBrains Mono',monospace"}}>{s.price}</div>
                          {s.pe&&<div style={{fontSize:11,color:T.textDD,marginTop:1}}>P/E {s.pe}</div>}
                        </div>
                        <SignalBadge sig={s.signal}/>
                      </div>
                    </div>
                    {/* Price changes grid */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
                      {[["24H Change",s.change1d],["1 Week",s.change1w],["1 Month",s.change1m]].map(([l,v])=>(
                        <div key={l} style={{background:`${isDark?"rgba(0,0,0,.2)":"rgba(0,0,0,.04)"}`,borderRadius:7,padding:"10px 12px",textAlign:"center"}}>
                          <div style={{fontSize:10,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>{l}</div>
                          <ChangeChip v={v} T={T}/>
                        </div>
                      ))}
                    </div>
                    {/* Target + Risk */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
                      {[["Target Price",s.targetPrice,T.green],["Upside",s.upside,T.cyan],["Risk Level",s.riskLevel,s.riskLevel==="LOW"?T.green:s.riskLevel==="HIGH"?T.red:T.yellow]].map(([l,v,c])=>(
                        <div key={l} style={{background:`${isDark?"rgba(0,0,0,.15)":"rgba(0,0,0,.04)"}`,borderRadius:7,padding:"9px 12px",textAlign:"center"}}>
                          <div style={{fontSize:10,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>{l}</div>
                          <div style={{fontSize:13,fontWeight:700,color:c,fontFamily:"'JetBrains Mono',monospace"}}>{v||"—"}</div>
                        </div>
                      ))}
                    </div>
                    {/* Outlook */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                      {[["SHORT-TERM",s.shortTerm],["LONG-TERM",s.longTerm],["VOLUME",s.volume]].map(([l,v])=>{
                        const c=v==="BULLISH"?T.green:v==="BEARISH"?T.red:T.yellow;
                        return <div key={l} style={{background:`${isDark?"rgba(0,0,0,.15)":"rgba(0,0,0,.04)"}`,borderRadius:7,padding:"8px 12px",textAlign:"center"}}><div style={{fontSize:9,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>{l}</div><div style={{fontSize:12,fontWeight:700,color:c||T.textD,fontFamily:"'JetBrains Mono',monospace"}}>{v||"—"}</div></div>;
                      })}
                    </div>
                    {/* Why now */}
                    {s.whyNow&&<div style={{padding:"10px 13px",background:`${isDark?"rgba(245,196,0,.04)":"rgba(180,140,0,.04)"}`,border:`1px solid ${T.yellow}22`,borderRadius:7,fontSize:13,color:T.text,lineHeight:1.65}}><span style={{color:T.yellow,fontWeight:700}}>📰 Today: </span>{s.whyNow}</div>}
                    {s.catalyst&&<div style={{marginTop:7,fontSize:12,color:T.textD,lineHeight:1.6}}><span style={{color:T.cyan}}>⚡ Catalyst: </span>{s.catalyst}</div>}
                    {(s.marketCap||s.signalStrength)&&<div style={{display:"flex",gap:14,marginTop:10,flexWrap:"wrap"}}>{s.marketCap&&<span style={{fontSize:11,color:T.textDD}}>Market Cap: <span style={{color:T.textD}}>{s.marketCap}</span></span>}{s.signalStrength&&<span style={{fontSize:11,color:T.textDD}}>Signal Strength: <span style={{color:scoreC(s.signalStrength)}}>{s.signalStrength}%</span></span>}</div>}
                  </div>
                );
              })}

            </div>
          )}
        </AsyncBlock>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: STOCK PICKS — INVESTMENT BANKING GRADE
═══════════════════════════════════════════════════════════ */
function PageStockPicks({country,setCountry,T}){
  const target=country||"USA";
  const{ex,idx}=getEx(target);
  const QC=["USA","India","China","UK","Japan","Germany","South Korea","Brazil","UAE","Australia","Canada","France"];
  const sentC=s=>s==="bullish"?T.green:s==="bearish"?T.red:T.yellow;
  const scoreC=v=>v>=75?T.green:v>=55?T.yellow:v>=35?T.orange:T.red;

  return(
    <div className="page-enter">
      <div style={{padding:"22px 26px 14px",borderBottom:`1px solid ${T.border}`}}>
        <div style={{marginBottom:13}}>
          <h2 style={{fontSize:19,fontWeight:700,color:T.text}}>🎯 Stock Picks</h2>
          <div style={{fontSize:13,color:T.textD,marginTop:3}}>AI Investment Banking Analysis · {ex} · {idx}</div>
        </div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          {QC.map(c=><button key={c} className="btn" onClick={()=>setCountry(c===country?"":c)} style={{padding:"5px 11px",borderRadius:6,border:`1px solid ${country===c?"rgba(232,121,249,.3)":T.border}`,background:country===c?"rgba(232,121,249,.08)":"transparent",color:country===c?T.pink:T.textDD,fontSize:11}}>{c}</button>)}
        </div>
      </div>
      <div style={{padding:"18px 26px"}}>
        <AsyncBlock key={target} loadFn={useCallback(()=>fetchStockPicks(target),[target])} color={T.pink} skCount={5} successCheck={d=>d?.picks?.filter(p=>p&&p.symbol).length>0} T={T}>
          {data=>(
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {/* Market overview */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                {[["SENTIMENT",data.marketSentiment?.toUpperCase(),sentC(data.marketSentiment)],["BULL SCORE",data.sentimentScore,scoreC(data.sentimentScore)],["FEAR/GREED",data.fearGreedIndex,scoreC(data.fearGreedIndex)],["INDEX",null,T.text]].map(([l,v,c],li)=>(
                  <div key={l} style={{background:T.card,border:`1px solid ${c}22`,borderRadius:10,padding:"13px 14px",textAlign:"center"}}>
                    <div style={{fontSize:10,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",marginBottom:5}}>{l}</div>
                    {li===3?<><div style={{fontSize:12,fontWeight:700,color:T.text}}>{data.index||idx}</div><div style={{display:"flex",gap:8,justifyContent:"center",marginTop:5,flexWrap:"wrap"}}><ChangeChip v={data.indexChange1d} prefix="1D " T={T}/><ChangeChip v={data.indexChange1w} prefix="1W " T={T}/></div></>:<><div style={{fontSize:li===0?14:24,fontWeight:li===0?700:900,color:c}}>{v||"—"}</div><ScoreBar val={typeof v==="number"?v:0} color={c} T={T}/></>}
                  </div>
                ))}
              </div>
              {/* Market outlook */}
              {data.marketOutlook&&<div style={{padding:"13px 16px",background:T.card,border:`1px solid ${T.border}`,borderRadius:10}}><div style={{fontSize:10,color:T.cyan,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:6}}>📊 MARKET OUTLOOK</div><div style={{fontSize:14,color:T.text,lineHeight:1.75}}>{data.marketOutlook}</div></div>}

              {/* Picks */}
              <div style={{fontSize:13,color:T.pink,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".08em",fontWeight:700,marginBottom:2}}>🎯 TOP 5 AI INVESTMENT PICKS</div>
              {(data.picks||[]).filter(p=>p&&p.symbol&&p.rank).map((p,i)=>{
                const sigC=p.signal?.includes("BUY")?T.green:p.signal?.includes("SELL")?T.red:T.yellow;
                return(
                  <div key={i} className="card-hover" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:13,padding:"18px 20px",animation:`countUp ${.2+i*.1}s ease`}}>
                    <div style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:14}}>
                      <div style={{width:46,height:46,borderRadius:10,background:`${sigC}12`,border:`1px solid ${sigC}30`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <span style={{fontSize:11,fontWeight:900,color:sigC,fontFamily:"'JetBrains Mono',monospace"}}>#{p.rank}</span>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:6}}>
                          <span style={{fontSize:17,fontWeight:800,color:T.text,fontFamily:"'JetBrains Mono',monospace"}}>{p.symbol}</span>
                          <span style={{fontSize:13,color:T.textD}}>{p.name}</span>
                          {p.sector&&<span className="tag" style={{background:`${isDark?"rgba(0,204,245,.08)":"rgba(0,100,200,.07)"}`,color:T.cyan,border:"none",fontSize:10}}>{p.sector}</span>}
                          <span style={{marginLeft:"auto"}}><SignalBadge sig={p.signal}/></span>
                        </div>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                          {p.riskLevel&&<span className="tag" style={{background:p.riskLevel==="LOW"?"rgba(0,220,130,.08)":p.riskLevel==="HIGH"?"rgba(255,58,90,.08)":"rgba(245,196,0,.08)",color:p.riskLevel==="LOW"?T.green:p.riskLevel==="HIGH"?T.red:T.yellow,border:"none",fontSize:10}}>RISK: {p.riskLevel}</span>}
                          {p.confidence&&<span style={{fontSize:12,color:T.textD}}>AI Confidence: <span style={{color:scoreC(p.confidence),fontWeight:700}}>{p.confidence}%</span></span>}
                          {p.timeframe&&<span className="tag" style={{background:"rgba(168,85,247,.08)",color:T.purple,border:"none",fontSize:10}}>{p.timeframe}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Price targets */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,marginBottom:13}}>
                      {[["Current",p.currentPrice,T.text,null],["1M Target",p.targetPrice1m,T.green,p.upside1m],["6M Target",p.targetPrice6m,T.cyan,p.upside6m],["1Y Target",p.targetPrice1y,T.purple,p.upside1y]].map(([l,v,c,u])=>{
                        const us=u!=null?String(u):"";
                        return(
                        <div key={l} style={{background:`${isDark?"rgba(0,0,0,.2)":"rgba(0,0,0,.04)"}`,borderRadius:8,padding:"10px 11px",textAlign:"center"}}>
                          <div style={{fontSize:10,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>{l}</div>
                          <div style={{fontSize:14,fontWeight:700,color:c,fontFamily:"'JetBrains Mono',monospace"}}>{v||"—"}</div>
                          {us&&<div style={{fontSize:11,color:us.startsWith("+")||us.startsWith("+")?T.green:us.startsWith("-")?T.red:T.green,marginTop:2,fontFamily:"'JetBrains Mono',monospace"}}>{us}</div>}
                        </div>
                      );})}
                    </div>

                    {/* Technical indicators */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginBottom:13}}>
                      {[["RSI",p.rsi?`${p.rsi}`:null,p.rsi>=70?"Overbought":p.rsi<=30?"Oversold":"Normal",p.rsi>=70?T.red:p.rsi<=30?T.green:T.yellow],["MA SIGNAL",null,p.maSignal,p.maSignal?.includes("BULL")?T.green:p.maSignal?.includes("BEAR")?T.red:T.yellow],["VOLUME TREND",null,p.volumeTrend,p.volumeTrend==="INCREASING"?T.green:p.volumeTrend==="DECREASING"?T.red:T.yellow]].map(([l,num,txt,c])=>(
                        <div key={l} style={{background:`${isDark?"rgba(0,0,0,.15)":"rgba(0,0,0,.04)"}`,borderRadius:7,padding:"9px 11px"}}>
                          <div style={{fontSize:10,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>{l}</div>
                          <div style={{fontSize:12,fontWeight:700,color:c,fontFamily:"'JetBrains Mono',monospace"}}>{num?`${num} · `:""}{txt||"—"}</div>
                        </div>
                      ))}
                    </div>

                    {/* Support / Resistance */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:7,marginBottom:13}}>
                      {[["Support",p.supportLevel,T.green],["Resistance",p.resistanceLevel,T.red],["Stop Loss",p.stopLoss,"#ff3a5a"],["Risk:Reward",p.riskReward,T.cyan]].map(([l,v,c])=>(
                        <div key={l} style={{background:`${isDark?"rgba(0,0,0,.15)":"rgba(0,0,0,.04)"}`,borderRadius:7,padding:"8px 11px",textAlign:"center"}}>
                          <div style={{fontSize:10,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>{l}</div>
                          <div style={{fontSize:13,fontWeight:700,color:c,fontFamily:"'JetBrains Mono',monospace"}}>{v||"—"}</div>
                        </div>
                      ))}
                    </div>

                    {p.thesis&&<div style={{padding:"11px 14px",background:`${isDark?"rgba(0,204,245,.04)":"rgba(0,100,200,.04)"}`,border:`1px solid ${T.cyan}22`,borderRadius:8,marginBottom:10}}><div style={{fontSize:10,color:T.cyan,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:5}}>💡 INVESTMENT THESIS</div><div style={{fontSize:13,color:T.text,lineHeight:1.8}}>{p.thesis}</div></div>}
                    {p.tradingSetup&&<div style={{padding:"11px 14px",background:"rgba(168,85,247,.04)",border:"1px solid rgba(168,85,247,.15)",borderRadius:8,marginBottom:10}}><div style={{fontSize:10,color:T.purple,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:5}}>⚡ TRADING SETUP</div><div style={{fontSize:13,color:T.text,lineHeight:1.8}}>{p.tradingSetup}</div></div>}
                    {p.newsDriver&&<div style={{padding:"10px 13px",background:`${isDark?"rgba(245,196,0,.04)":"rgba(180,140,0,.04)"}`,border:"1px solid rgba(245,196,0,.15)",borderRadius:7,marginBottom:10,fontSize:13,color:T.text,lineHeight:1.65}}><span style={{color:T.yellow}}>📰 </span>{p.newsDriver}</div>}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      {p.catalysts?.length>0&&<div><div style={{fontSize:10,color:T.green,fontFamily:"'JetBrains Mono',monospace",marginBottom:7}}>✅ CATALYSTS</div>{p.catalysts.map((c,j)=><div key={j} style={{fontSize:12,color:T.textD,marginBottom:5,display:"flex",gap:6,lineHeight:1.55}}><span style={{color:T.green,flexShrink:0}}>•</span>{c}</div>)}</div>}
                      {p.risks?.length>0&&<div><div style={{fontSize:10,color:T.red,fontFamily:"'JetBrains Mono',monospace",marginBottom:7}}>⚠️ RISKS</div>{p.risks.map((r,j)=><div key={j} style={{fontSize:12,color:T.textD,marginBottom:5,display:"flex",gap:6,lineHeight:1.55}}><span style={{color:T.red,flexShrink:0}}>•</span>{r}</div>)}</div>}
                    </div>
                    {(p.pe||p.epsGrowth)&&<div style={{marginTop:12,padding:"10px 13px",background:`${isDark?"rgba(0,0,0,.15)":"rgba(0,0,0,.04)"}`,borderRadius:8,display:"flex",gap:18,flexWrap:"wrap"}}>{[["P/E",p.pe],["EPS Growth",p.epsGrowth],["Revenue",p.revenueGrowth],["Beta",p.beta],["Dividend",p.dividendYield],["D/E Ratio",p.debtEquity],["Inst. Own",p.institutionalOwnership]].filter(([,v])=>v).map(([l,v])=><div key={l} style={{textAlign:"center"}}><div style={{fontSize:10,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",marginBottom:2}}>{l}</div><div style={{fontSize:13,fontWeight:600,color:T.textD,fontFamily:"'JetBrains Mono',monospace"}}>{v}</div></div>)}</div>}
                  </div>
                );
              })}
  
            </div>
          )}
        </AsyncBlock>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: GLOBAL MAP
═══════════════════════════════════════════════════════════ */
// MAP_DOTS: x/y = position %, n = country name, tl = default threat level
// tl drives color: critical=#ff3a5a high=#ff8c00 elevated=#f5c400 moderate=#4ade80 low=#00dc82
// Colors update dynamically via fetchIntel when user clicks a country
const MAP_DOTS=[
  {x:56,y:26,n:"Ukraine",tl:"critical"},   // active war zone
  {x:72,y:21,n:"Russia",tl:"critical"},    // war + sanctions
  {x:80,y:31,n:"China",tl:"elevated"},     // Taiwan tensions, trade war
  {x:65,y:35,n:"Iran",tl:"critical"},      // Israel-Iran conflict active
  {x:83,y:33,n:"Taiwan",tl:"high"},        // China pressure
  {x:84,y:26,n:"North Korea",tl:"critical"}, // nuclear + missile tests
  {x:81,y:40,n:"Myanmar",tl:"critical"},   // civil war ongoing
  {x:58,y:43,n:"Sudan",tl:"critical"},     // civil war ongoing
  {x:27,y:40,n:"Venezuela",tl:"high"},     // economic collapse + political
  {x:13,y:17,n:"USA",tl:"moderate"},       // stable
  {x:50,y:16,n:"UK",tl:"low"},            // stable
  {x:52,y:18,n:"Germany",tl:"moderate"},   // energy + economic pressure
  {x:70,y:36,n:"India",tl:"moderate"},     // stable, border tensions
  {x:45,y:38,n:"Saudi Arabia",tl:"elevated"}, // regional instability
  {x:86,y:36,n:"Japan",tl:"low"},         // stable
  {x:85,y:39,n:"South Korea",tl:"moderate"}, // NK threat
  {x:66,y:32,n:"Pakistan",tl:"high"},     // economic crisis + political
  {x:47,y:22,n:"France",tl:"moderate"},   // stable
  {x:17,y:35,n:"Brazil",tl:"moderate"},   // stable
  {x:88,y:42,n:"Australia",tl:"low"},     // stable
  {x:36,y:18,n:"Canada",tl:"low"},        // stable
  {x:57,y:20,n:"Israel",tl:"critical"},   // Gaza + Iran conflict active
  {x:62,y:29,n:"Iraq",tl:"high"},        // instability ongoing
  {x:75,y:37,n:"Bangladesh",tl:"elevated"}, // political transition
];

// Map threat level string to color
function mapThreatColor(tl,T){
  const m={critical:"#ff3a5a",high:"#ff8c00",elevated:"#f5c400",moderate:"#4ade80",low:"#00dc82"};
  return m[tl]||m.moderate;
}

function PageMap({onSelect,T}){
  const[hov,setHov]=useState(null);
  return(
    <div className="page-enter">
      <div style={{padding:"22px 26px 14px",borderBottom:`1px solid ${T.border}`}}>
        <h2 style={{fontSize:19,fontWeight:700,color:T.text}}>🌍 Global Intelligence Map</h2>
        <div style={{fontSize:13,color:T.textD,marginTop:3}}>Click any hotspot to load country intelligence</div>
      </div>
      <div style={{padding:"22px 26px"}}>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"18px",marginBottom:18}}>
          <svg viewBox="0 0 100 58" style={{width:"100%",display:"block"}}>
            {[15,30,45].map(y=><line key={y} x1="0" y1={y} x2="100" y2={y} stroke={`${isDark?"rgba(0,204,245,.05)":"rgba(0,100,200,.06)"}`} strokeWidth=".3"/>)}
            {[20,40,60,80].map(x=><line key={x} x1={x} y1="0" x2={x} y2="58" stroke={`${isDark?"rgba(0,204,245,.05)":"rgba(0,100,200,.06)"}`} strokeWidth=".3"/>)}
            {["M5,15 Q8,12 14,13 Q18,14 20,18 Q22,24 19,28 Q15,32 12,34 Q8,36 6,34 Q3,30 4,22 Z","M20,36 Q24,34 28,37 Q32,41 30,49 Q27,54 23,52 Q19,49 18,43 Z","M50,10 Q64,8 72,11 Q75,14 74,18 Q70,20 65,19 Q60,22 62,28 Q60,32 57,32 Q54,30 53,26 Q50,22 48,17 Z","M44,15 Q50,12 55,14 Q58,16 57,21 Q53,24 48,23 Q44,21 44,17 Z","M47,25 Q54,23 58,27 Q62,33 60,43 Q57,49 52,50 Q47,48 45,42 Q43,35 44,29 Z","M57,13 Q68,9 80,11 Q88,13 90,19 Q88,25 82,28 Q72,30 63,27 Q57,24 56,19 Z","M80,42 Q87,40 90,44 Q91,50 87,52 Q82,53 79,49 Q78,45 80,42 Z"].map((d,i)=><path key={i} d={d} fill={`${isDark?"rgba(0,204,245,.05)":"rgba(0,100,200,.06)"}`} stroke={`${isDark?"rgba(0,204,245,.14)":"rgba(0,100,200,.15)"}`} strokeWidth=".3"/>)}
            {MAP_DOTS.map((dot,i)=>(
              <g key={i} style={{cursor:"pointer"}} onClick={()=>onSelect(dot.n)} onMouseEnter={()=>setHov(dot.n)} onMouseLeave={()=>setHov(null)}>
                <circle cx={dot.x} cy={dot.y} r={hov===dot.n?4.5:2.5} fill={mapThreatColor(dot.tl,T)} opacity={hov===dot.n?1:.75} style={{transition:"r .15s"}}><animate attributeName="opacity" values=".75;.3;.75" dur={`${1.8+i*.13}s`} repeatCount="indefinite"/></circle>
                <circle cx={dot.x} cy={dot.y} r="1.3" fill={mapThreatColor(dot.tl,T)}/>
                <circle cx={dot.x} cy={dot.y} r="7" fill="transparent"/>
                {hov===dot.n&&<><rect x={dot.x-13} y={dot.y-11} width="26" height="8.5" rx="1.5" fill={isDark?"rgba(6,10,18,.95)":"rgba(255,255,255,.95)"} stroke={mapThreatColor(dot.tl,T)} strokeWidth=".4"/><text x={dot.x} y={dot.y-5} textAnchor="middle" fill={mapThreatColor(dot.tl,T)} fontSize="2.8" fontFamily="Inter" fontWeight="bold">{dot.n}</text></>}
              </g>
            ))}
          </svg>
        </div>
        <div style={{display:"flex",gap:18,marginBottom:18,flexWrap:"wrap"}}>
          {[["#ff3a5a","Critical"],["#ff8c00","High"],["#f5c400","Elevated"],["#00dc82","Stable"]].map(([c,l])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:7,fontSize:13,color:T.textD}}><div style={{width:10,height:10,borderRadius:"50%",background:c,boxShadow:`0 0 7px ${c}70`}}/>{l}</div>
          ))}
        </div>
        <div style={{fontSize:13,color:T.textDD,padding:"13px 16px",background:`${isDark?"rgba(0,204,245,.03)":"rgba(0,100,200,.03)"}`,border:`1px solid ${T.border}`,borderRadius:9}}>
          💡 Click any country dot to navigate to Intel Feed + Markets for that region.
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: LIVE INTEL
═══════════════════════════════════════════════════════════ */
function PageIntel({country,setCountry,T}){
  const target=country||"Global";
  const SC=getSevC(T);
  const THREAT_C={critical:"#ff3a5a",high:"#ff8c00",elevated:"#f5c400",moderate:"#4ade80",low:"#00dc82"};
  const TYPE_IC={military:"✈️",cyber:"💻",economic:"📉",political:"🏛️",disaster:"🌊"};
  const QC=["Global","India","USA","China","Russia","Middle East","Europe","South Asia"];

  return(
    <div className="page-enter">
      <div style={{padding:"22px 26px 14px",borderBottom:`1px solid ${T.border}`}}>
        <div style={{marginBottom:13}}>
          <h2 style={{fontSize:19,fontWeight:700,color:T.text}}>⚡ Live Intel</h2>
          <div style={{fontSize:13,color:T.textD,marginTop:3}}>Security & Geopolitical Intelligence · {target}</div>
        </div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          {QC.map(r=><button key={r} className="btn" onClick={()=>setCountry(r==="Global"?"":r===country?"":r)} style={{padding:"5px 11px",borderRadius:6,border:`1px solid ${(country||"Global")===r?"rgba(255,140,0,.3)":T.border}`,background:(country||"Global")===r?"rgba(255,140,0,.07)":"transparent",color:(country||"Global")===r?T.orange:T.textDD,fontSize:11}}>{r}</button>)}
        </div>
      </div>
      <div style={{padding:"18px 26px"}}>
        <AsyncBlock key={target} loadFn={useCallback(()=>fetchIntel(target),[target])} color={T.orange} successCheck={d=>d?.alerts} T={T}>
          {data=>{
            // Use live intel data if available, else fall back to dot's default tl
            const liveTl=data&&data.threatLevel?data.threatLevel:dot.tl;
            const tc=THREAT_C[liveTl]||mapThreatColor(dot.tl,T);
            return(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{padding:"16px 20px",borderRadius:11,background:`${tc}10`,border:`1px solid ${tc}33`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                  <div style={{display:"flex",gap:11,alignItems:"center"}}><Pulse c={tc} s={11}/><span style={{fontSize:15,color:tc,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".04em"}}>THREAT LEVEL: {(data.threatLevel||"").toUpperCase()}</span></div>
                  <div style={{display:"flex",gap:14,alignItems:"center"}}>
                    <span style={{fontSize:13,color:T.text}}>Stability: <strong style={{color:tc}}>{data.stabilityIndex||"—"}/100</strong></span>
                    <div style={{width:80}}><ScoreBar val={data.stabilityIndex} color={tc} T={T}/></div>
                  </div>
                </div>
                {data.summary&&<div style={{padding:"13px 17px",background:T.card,border:`1px solid ${T.border}`,borderRadius:10,fontSize:14,color:T.text,lineHeight:1.8}}>📋 {data.summary}</div>}
                {(data.alerts||[]).map((a,i)=>{const m=SC[a.level]||SC.low;return(
                  <div key={i} style={{padding:"13px 16px",borderRadius:10,background:m.bgA,border:`1px solid ${m.bd}`}}>
                    <div style={{display:"flex",gap:11,alignItems:"flex-start"}}>
                      <span style={{fontSize:20,flexShrink:0}}>{TYPE_IC[a.type]||"⚠️"}</span>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:5,flexWrap:"wrap"}}>
                          <span className="tag" style={{background:m.bgA,color:m.c,border:`1px solid ${m.bd}`}}>{(a.level||"low").toUpperCase()}</span>
                          <span style={{fontSize:11,color:m.c,fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>{a.type?.toUpperCase()}</span>
                        </div>
                        <div style={{fontSize:14,color:T.text,fontWeight:600,marginBottom:4}}>{a.title}</div>
                        {a.detail&&<div style={{fontSize:13,color:T.textD,lineHeight:1.7}}>{a.detail}</div>}
                      </div>
                    </div>
                  </div>
                );})}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {[["⚔️","ACTIVE CONFLICTS",T.red,data.activeConflicts],["💸","ECONOMIC THREATS",T.yellow,data.economicPressures],["💻","CYBER THREATS",T.cyan,data.cyberThreats],["🤝","DIPLOMATIC",T.purple,data.diplomaticAlerts]].map(([ic,lb,cl,items])=>items?.length>0&&(
                    <div key={lb} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:9,padding:"13px 15px"}}>
                      <div style={{fontSize:10,color:cl,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:9,fontWeight:700}}>{ic} {lb}</div>
                      {items.map((it,j)=><div key={j} style={{fontSize:13,color:T.textD,marginBottom:6,display:"flex",gap:7,lineHeight:1.55}}><span style={{color:cl,flexShrink:0}}>•</span>{it}</div>)}
                    </div>
                  ))}
                </div>
              </div>
            );
          }}
        </AsyncBlock>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE: FORECASTS
═══════════════════════════════════════════════════════════ */
function PageForecast({country,setCountry,T}){
  const target=country||"USA";
  const scoreC=v=>v>=75?T.green:v>=50?T.yellow:v>=30?T.orange:T.red;
  const QC=["USA","India","China","UK","EU","Japan","Brazil","UAE","Germany","Australia"];

  return(
    <div className="page-enter">
      <div style={{padding:"22px 26px 14px",borderBottom:`1px solid ${T.border}`}}>
        <div style={{marginBottom:13}}>
          <h2 style={{fontSize:19,fontWeight:700,color:T.text}}>🔮 Forecasts</h2>
          <div style={{fontSize:13,color:T.textD,marginTop:3}}>AI Macro-Economic & Geopolitical Outlook · {target}</div>
        </div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          {QC.map(c=><button key={c} className="btn" onClick={()=>setCountry(c===country?"":c)} style={{padding:"5px 11px",borderRadius:6,border:`1px solid ${country===c?"rgba(0,204,245,.3)":T.border}`,background:country===c?`${isDark?"rgba(0,204,245,.08)":"rgba(0,100,200,.07)"}`:"transparent",color:country===c?T.cyan:T.textDD,fontSize:11}}>{c}</button>)}
        </div>
      </div>
      <div style={{padding:"18px 26px"}}>
        <AsyncBlock key={target} loadFn={useCallback(()=>fetchForecast(target),[target])} color={T.cyan} successCheck={d=>d?.country} T={T}>
          {data=>{
            const outC={positive:T.green,negative:T.red,critical:T.red,neutral:T.yellow}[data.economicOutlook]||T.yellow;
            return(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                  {[["STABILITY",data.stability,"🏛️"],["GEOPOLITICAL",data.geopoliticalScore,"⚔️"],["AI CONFIDENCE",data.confidenceScore,"🎯"]].map(([l,v,ic])=>(
                    <InfoCard key={l} label={l} T={T} color={scoreC(v||50)} value={<><span style={{fontSize:26,fontWeight:900}}>{v||"—"}</span><span style={{fontSize:14,color:T.textDD}}>/100</span></>} sub={<ScoreBar val={v} color={scoreC(v||50)} T={T}/>}/>
                  ))}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7}}>
                  {[["GDP Growth",data.gdpGrowth,T.green],["Inflation",data.inflation,T.yellow],["Unemployment",data.unemployment,T.orange],["Interest Rate",data.interestRate,T.cyan]].map(([l,v,c])=>v&&(
                    <div key={l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"11px 13px",textAlign:"center"}}><div style={{fontSize:10,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",marginBottom:5}}>{l}</div><div style={{fontSize:15,fontWeight:700,color:c,fontFamily:"'JetBrains Mono',monospace"}}>{v}</div></div>
                  ))}
                </div>
                {[["📊 Economic Outlook",data.sixMonthPrediction,outC,data.economicOutlook?.toUpperCase()],["📈 Trader Opportunities",data.traderOpportunities,T.cyan,null],["👷 Working Class",data.workingClassForecast,T.green,null],["🏦 Market Direction",data.marketOutlook,T.purple,null]].map(([l,v,c,badge])=>v&&(
                  <div key={l} style={{padding:"13px 17px",background:T.card,border:`1px solid ${c}1a`,borderRadius:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontSize:11,color:c,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".09em",fontWeight:700}}>{l}</div>
                      {badge&&<span className="tag" style={{background:`${c}14`,color:c,border:"none"}}>{badge}</span>}
                    </div>
                    <div style={{fontSize:14,color:T.text,lineHeight:1.82}}>{v}</div>
                  </div>
                ))}
                {(data.keyRisks||data.opportunities)&&(
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div style={{background:T.card,border:`1px solid rgba(255,58,90,.15)`,borderRadius:10,padding:"13px 15px"}}><div style={{fontSize:10,color:T.red,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:9}}>⚠️ KEY RISKS</div>{(data.keyRisks||[]).map((r,i)=><div key={i} style={{fontSize:13,color:T.textD,marginBottom:7,display:"flex",gap:7,lineHeight:1.55}}><span style={{color:T.red,flexShrink:0}}>•</span>{r}</div>)}</div>
                    <div style={{background:T.card,border:`1px solid rgba(0,220,130,.15)`,borderRadius:10,padding:"13px 15px"}}><div style={{fontSize:10,color:T.green,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".1em",marginBottom:9}}>✅ OPPORTUNITIES</div>{(data.opportunities||[]).map((o,i)=><div key={i} style={{fontSize:13,color:T.textD,marginBottom:7,display:"flex",gap:7,lineHeight:1.55}}><span style={{color:T.green,flexShrink:0}}>•</span>{o}</div>)}</div>
                  </div>
                )}
                {data.basedOn&&<div style={{padding:"10px 14px",background:`${isDark?"rgba(0,0,0,.2)":"rgba(0,0,0,.04)"}`,border:`1px solid ${T.border}`,borderRadius:8,fontSize:12,color:T.textDD,lineHeight:1.65}}>📰 <strong>Based on:</strong> {data.basedOn}</div>}
              </div>
            );
          }}
        </AsyncBlock>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════ */
function Dashboard({session,onLogout,T,isDarkMode,onToggleTheme}){
  const[page,setPage]=useState("news");
  const[country,setCountry]=useState("");
  const[searchVal,setSearch]=useState("");
  const[clock,setClock]=useState(Date.now());
  const[showTerms,setShowTerms]=useState(false);
  const[showContact,setShowContact]=useState(false);
  const[sidebarOpen,setSidebarOpen]=useState(false);
  const CSS=makeCSS(T,isDarkMode);
  isDark=isDarkMode;

  // Touch swipe for mobile sidebar
  const touchStartX=useRef(null);
  function onTouchStart(e){touchStartX.current=e.touches[0].clientX;}
  function onTouchEnd(e){
    if(touchStartX.current===null)return;
    const dx=e.changedTouches[0].clientX-touchStartX.current;
    if(dx>60)setSidebarOpen(true);   // right swipe = open
    if(dx<-60)setSidebarOpen(false); // left swipe = close
    touchStartX.current=null;
  }

  useEffect(()=>{const id=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(id);},[]);

  // PRELOAD: warm cache for India + USA silently on mount
  // India first (majority of users are Indian), then USA
  // 3s gap between each call to avoid Groq rate limits
  // By the time user clicks any tab, data is already cached = instant load
  useEffect(()=>{
    const preload=async()=>{
      const jobs=[
        ()=>fetchNews("India"),
        ()=>fetchNews("Global"),
        ()=>fetchMarkets("India"),
        ()=>fetchIntel("India"),
        ()=>fetchForecast("India"),
        ()=>fetchStockPicks("India"),
        ()=>fetchNews("USA"),
        ()=>fetchMarkets("USA"),
        ()=>fetchIntel("USA"),
        ()=>fetchForecast("USA"),
        ()=>fetchStockPicks("USA"),
      ];
      for(let i=0;i<jobs.length;i++){
        try{await jobs[i]();}catch(e){}
        if(i<jobs.length-1)await new Promise(r=>setTimeout(r,3000));
      }
    };
    const t=setTimeout(preload,2000); // wait 2s for auth/UI to settle
    return()=>clearTimeout(t);
  },[]); // eslint-disable-line

  const tz=session.tz||Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeStr=new Intl.DateTimeFormat("en",{timeZone:tz,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(clock));
  const dateStr=new Intl.DateTimeFormat("en",{timeZone:tz,weekday:"short",month:"short",day:"numeric"}).format(new Date(clock));

  function applySearch(){const q=searchVal.trim();if(q)setCountry(q);}

  const NAV=[
    {id:"news",  icon:"📡",label:"Intel Feed"},
    {id:"markets",icon:"📈",label:"Markets"},
    {id:"picks", icon:"🎯",label:"Stock Picks"},
    {id:"map",   icon:"🌍",label:"Global Map"},
    {id:"intel", icon:"⚡",label:"Live Intel"},
    {id:"forecast",icon:"🔮",label:"Forecasts"},
  ];

  function goMap(c){setCountry(c);setSearch(c);setPage("news");}

  return(
    <>
      {showTerms&&<TermsModal onClose={()=>setShowTerms(false)} T={T}/>}
      {showContact&&<ContactModal onClose={()=>setShowContact(false)} T={T}/>}
      <style>{CSS}</style>
      <div style={{height:"100vh",background:T.bg,display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* TOP NAV */}
        <header style={{height:56,background:T.headerBg,borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",padding:"0 12px",gap:8,flexShrink:0,backdropFilter:"blur(14px)",zIndex:100,boxShadow:`0 1px 12px ${T.shadow}`,maxWidth:"100vw",boxSizing:"border-box",position:"relative"}}>

          {/* Mobile hamburger — CSS shows only on mobile */}
          <button id="mob-menu-btn" onClick={()=>setSidebarOpen(o=>!o)}
            style={{display:"none",background:"transparent",
              border:"1.5px solid rgba(245,196,0,0.85)",borderRadius:8,
              padding:"8px 10px",cursor:"pointer",flexShrink:0,lineHeight:1,
              boxShadow:"0 0 4px rgba(245,196,0,0.2)",
              zIndex:2,position:"relative"}}
            aria-label="Menu">
            <div style={{display:"flex",flexDirection:"column",gap:"5px",alignItems:"center",justifyContent:"center",width:20}}>
              <span style={{display:"block",width:20,height:2.5,background:"rgba(245,196,0,0.88)",borderRadius:2}}/>
              <span style={{display:"block",width:20,height:2.5,background:"rgba(245,196,0,0.88)",borderRadius:2}}/>
              <span style={{display:"block",width:20,height:2.5,background:"rgba(245,196,0,0.88)",borderRadius:2}}/>
            </div>
          </button>

          {/* Logo */}
          <div id="header-logo" style={{display:"flex",alignItems:"center",gap:8,flexShrink:0,minWidth:0,position:"absolute",left:"50%",transform:"translateX(-50%)"}}>
            <LogoSVG size={32}/>
            <div style={{minWidth:0}}>
              <div style={{fontFamily:"'Orbitron',monospace",fontSize:11,fontWeight:900,color:T.cyan,
                letterSpacing:".08em",lineHeight:1.1,whiteSpace:"nowrap"}}>DataNexusGlobus</div>
              <div style={{fontSize:7,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",
                letterSpacing:".1em",marginTop:1,whiteSpace:"nowrap"}}>AI FINANCIAL & GEO-INTEL</div>
            </div>
          </div>

          <div className="mob-hide" style={{width:1,height:28,background:T.border,flexShrink:0,marginLeft:4}}/>

          {/* Search — desktop only */}
          <div className="mob-hide" style={{flex:1,display:"flex",gap:6,maxWidth:400,minWidth:0}}>
            <input className="input-field"
              style={{border:`1px solid ${T.border}`,fontSize:12,padding:"6px 11px",minWidth:0,flex:1}}
              defaultValue={searchVal}
              onChange={e=>setSearch(e.target.value)}
              onInput={e=>setSearch(e.target.value)}
              onKeyUp={e=>{setSearch(e.target.value);if(e.key==="Enter")applySearch();}}
              placeholder="Search country, region… (Enter)"/>
            <button className="btn btn-primary" onClick={applySearch}
              style={{padding:"6px 11px",fontSize:13,flexShrink:0}}>🔍</button>
            {searchVal&&<button className="btn btn-ghost" onClick={()=>{setSearch("");setCountry("");}}
              style={{padding:"6px 9px",flexShrink:0,fontSize:12}}>✕</button>}
          </div>

          {/* Spacer */}
          <div style={{flex:1}}/>

          {/* Right controls */}
          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            <div className="mob-hide" style={{display:"flex",alignItems:"center",gap:5}}>
              <Pulse c={T.green} s={6}/>
              <span style={{fontSize:11,color:T.textDD,fontFamily:"'JetBrains Mono',monospace"}}>{timeStr}</span>
            </div>
            <span className="mob-hide" style={{fontSize:11,color:T.cyan,fontWeight:600,maxWidth:90,
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>@{session.username}</span>
            <div className="mob-live" style={{display:"none",alignItems:"center",gap:4}}>
              <Pulse c={T.green} s={6}/>
            </div>
            {/* Theme toggle */}
            <button onClick={onToggleTheme}
              style={{width:30,height:17,borderRadius:9,background:isDarkMode?"rgba(0,204,245,.18)":"rgba(255,200,0,.18)",
                border:`1px solid ${isDarkMode?T.cyan+"44":"rgba(200,150,0,.3)"}`,
                cursor:"pointer",position:"relative",flexShrink:0,transition:"all .2s"}}>
              <span style={{position:"absolute",top:2,left:isDarkMode?13:2,width:11,height:11,
                borderRadius:"50%",background:isDarkMode?T.cyan:"#f5c400",transition:"left .2s",
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:7}}>{isDarkMode?"🌙":"☀️"}</span>
            </button>
            <button className="btn btn-danger" onClick={onLogout}
              style={{padding:"4px 9px",fontSize:10,flexShrink:0}}>OUT</button>
          </div>
        </header>

        {/* BODY */}
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>
          {/* Mobile overlay backdrop */}
          {sidebarOpen&&<div onClick={()=>setSidebarOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:149,backdropFilter:"blur(2px)"}} className="mob-overlay"/>}

          {/* SIDEBAR */}
          <nav style={{width:190,background:T.sidebarBg,borderRight:`1px solid ${T.border}`,display:"flex",flexDirection:"column",padding:"18px 11px",flexShrink:0,overflowY:"auto"}} className={`sidebar${sidebarOpen?" open":""}`}>
            <div style={{fontSize:10,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",letterSpacing:".12em",marginBottom:12,paddingLeft:4}}>NAVIGATION</div>
            {NAV.map(n=>(
              <div key={n.id} className={`nav-link ${page===n.id?"active":""}`} onClick={()=>{setPage(n.id);setSidebarOpen(false);}} style={{marginBottom:5}}>
                <span style={{fontSize:16}}>{n.icon}</span>
                <span style={{fontSize:13,fontWeight:page===n.id?600:400}}>{n.label}</span>
              </div>
            ))}

            <div style={{marginTop:"auto",paddingTop:18,borderTop:`1px solid ${T.border}`}}>
              {country&&(
                <div style={{padding:"9px 11px",background:`${isDarkMode?"rgba(0,204,245,.06)":"rgba(0,100,200,.06)"}`,border:`1px solid ${T.cyan}22`,borderRadius:8,marginBottom:9}}>
                  <div style={{fontSize:10,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",marginBottom:3}}>FOCUS</div>
                  <div style={{fontSize:13,color:T.cyan,fontWeight:600}}>{country}</div>
                  <button onClick={()=>{setCountry("");setSearch("");}} style={{fontSize:10,color:T.red,background:"none",border:"none",cursor:"pointer",marginTop:3,padding:0}}>✕ clear</button>
                </div>
              )}
              <div style={{fontSize:11,color:T.textDD,fontFamily:"'JetBrains Mono',monospace",lineHeight:1.6}}>{dateStr}<br/><span style={{fontSize:10}}>{tz.replace(/_/g," ")}</span></div>
            </div>
          </nav>

          {/* PAGE */}
          <main style={{flex:1,overflowY:"auto",background:T.bg}} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {page==="news"    &&<PageNews     key={`news-${country}`}     country={country} setCountry={c=>{setCountry(c);setSearch(c);}} T={T}/>}
            {page==="markets" &&<PageMarkets  key={`mkts-${country}`}     country={country} setCountry={c=>{setCountry(c);setSearch(c);}} T={T}/>}
            {page==="picks"   &&<PageStockPicks key={`picks-${country}`}  country={country} setCountry={c=>{setCountry(c);setSearch(c);}} T={T}/>}
            {page==="map"     &&<PageMap       onSelect={goMap} T={T}/>}
            {page==="intel"   &&<PageIntel    key={`intel-${country}`}    country={country} setCountry={c=>{setCountry(c);setSearch(c);}} T={T}/>}
            {page==="forecast"&&<PageForecast key={`forecast-${country}`} country={country} setCountry={c=>{setCountry(c);setSearch(c);}} T={T}/>}
          </main>
        </div>

        {/* FOOTER */}
        <footer style={{height:38,background:T.headerBg,borderTop:`1px solid ${T.border}`,display:"flex",alignItems:"center",padding:"0 22px",gap:18,flexShrink:0}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:T.textDD,letterSpacing:".1em"}}>WORLD INTEL v9</div>
          <div style={{flex:1}}/>
          <div style={{display:"flex",gap:14,alignItems:"center",fontSize:11,color:T.textDD}}>
            <span className="hov" onClick={()=>setShowContact(true)} style={{color:T.cyan,cursor:"pointer",textDecoration:"underline"}}>Contact Us</span>
            <span>·</span>
            <span style={{color:T.textD}}>Shubham Chatterjee</span>
            <span>·</span>
            <span className="hov" onClick={()=>setShowTerms(true)} style={{color:T.cyan,cursor:"pointer",textDecoration:"underline"}}>Terms & Conditions</span>
          </div>
        </footer>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   ROOT
═══════════════════════════════════════════════════════════ */
export default function App(){
  const[session,setSess]=useState(undefined);
  const[cookie,setCookie]=useState(undefined);
  const[darkMode,setDarkMode]=useState(true);
  const T=darkMode?DARK:LIGHT;
  const CSS=makeCSS(T,darkMode);

  useEffect(()=>{
    // Load theme + cookie from localStorage (unchanged)
    dbG(KC).then(c=>setCookie(c||null));
    dbG(KTH).then(th=>{if(th!==null&&th!==undefined)setDarkMode(!!th);});

    // Check Supabase for existing session
    const fallback=setTimeout(()=>{
      setSess(s=>s===undefined?null:s);
      setCookie(c=>c===undefined?null:c);
    },3000);

    if(!supabase){
      // Supabase not configured — fall through to auth screen
      clearTimeout(fallback);
      setSess(null);
      setCookie(null);
      return;
    }

    // Get current session (persisted by Supabase automatically)
    supabase.auth.getSession().then(({data:{session:sb}})=>{
      clearTimeout(fallback);
      if(sb?.user){
        const meta=sb.user.user_metadata||{};
        setSess({
          username:meta.username||sb.user.email.split("@")[0],
          email:sb.user.email,
          tz:meta.tz||Intl.DateTimeFormat().resolvedOptions().timeZone,
          id:sb.user.id
        });
      }else{
        setSess(null);
      }
      // Ensure cookie is never left as undefined after session resolves
      setCookie(c=>c===undefined?null:c);
    }).catch(()=>{clearTimeout(fallback);setSess(null);setCookie(c=>c===undefined?null:c);});

    // Listen for auth state changes (login/logout/token refresh)
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_event,sb)=>{
      if(sb?.user){
        const meta=sb.user.user_metadata||{};
        setSess({
          username:meta.username||sb.user.email.split("@")[0],
          email:sb.user.email,
          tz:meta.tz||Intl.DateTimeFormat().resolvedOptions().timeZone,
          id:sb.user.id
        });
      }else{
        setSess(null);
      }
    });

    return()=>subscription?.unsubscribe();
  },[]);

  async function handleLogin(s){setSess(s);}
  async function handleLogout(){await logoutUser();setSess(null);}
  async function acceptCookie(){const c={accepted:true,at:Date.now()};await dbS(KC,c);setCookie(c);}
  async function toggleTheme(){const nd=!darkMode;setDarkMode(nd);await dbS(KTH,nd);}

  if(session===undefined||cookie===undefined){
    return(
      <><Head>
        <title>World Intel — AI Financial & Geo-Intelligence</title>
        <meta name="description" content="AI-powered financial markets, stock picks, geopolitical intelligence and economic forecasts for every country."/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><circle cx='24' cy='24' r='19' fill='%23001433'/><circle cx='24' cy='24' r='19' stroke='%231a8cff' stroke-width='1.6' fill='none'/><text x='24' y='30' text-anchor='middle' font-size='15' font-weight='900' fill='%23f5c400' font-family='Arial'>%24</text></svg>"/>
      </Head>
      <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <style>{CSS}</style>
        <div style={{textAlign:"center",animation:"fadeUp .4s ease"}}>
          <LogoSVG size={56}/>
          <div style={{fontFamily:"'Orbitron',monospace",fontSize:18,fontWeight:900,background:`linear-gradient(135deg,${T.cyan},${T.purple})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:".1em",marginTop:12,marginBottom:16}}>WORLD INTEL</div>
          <Loader c={T.cyan} sz={7}/>
        </div>
      </div>
      </>
    );
  }

  return(
    <><Head>
        <title>World Intel — AI Financial & Geo-Intelligence</title>
        <meta name="description" content="AI-powered financial markets, stock picks, geopolitical intelligence and economic forecasts for every country."/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><circle cx='24' cy='24' r='19' fill='%23001433'/><circle cx='24' cy='24' r='19' stroke='%231a8cff' stroke-width='1.6' fill='none'/><text x='24' y='30' text-anchor='middle' font-size='15' font-weight='900' fill='%23f5c400' font-family='Arial'>%24</text></svg>"/>
      </Head>
      {session
        ?<Dashboard session={session} onLogout={handleLogout} T={T} isDarkMode={darkMode} onToggleTheme={toggleTheme}/>
        :<AuthScreen onLogin={handleLogin} T={T} isDark={darkMode}/>
      }
      {!cookie?.accepted&&<CookieBanner onAccept={acceptCookie} T={T}/>}
    </>
  );
}
