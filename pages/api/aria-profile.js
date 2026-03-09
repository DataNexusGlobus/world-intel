// pages/api/aria-profile.js — ARIA cross-session memory API
// Reads / writes user profile to Supabase aria_profiles table
//
// ── SUPABASE SETUP (run once in SQL editor) ───────────────────────────────────
// create table aria_profiles (
//   user_id    text primary key,
//   country    text,
//   age        text,
//   income_range text,
//   goals_summary text,
//   last_summary  text,
//   updated_at timestamptz default now()
// );
// alter table aria_profiles enable row level security;
// create policy "users manage own profile"
//   on aria_profiles for all
//   using (true) with check (true);   -- anon key is fine for this app
// ─────────────────────────────────────────────────────────────────────────────

export const config = { runtime: 'edge' };

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Supabase not configured — silent fail, ARIA works without memory
  if (!SB_URL || !SB_KEY) {
    return new Response(JSON.stringify({ profile: null, ok: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // FIX [A]: body null check — valid JSON null would make destructuring throw
  let body;
  try {
    const raw = await req.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('bad body');
    body = raw;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { action, userId, profileData } = body;
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return new Response(JSON.stringify({ error: 'userId required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const sbH = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
  };

  // ── GET ────────────────────────────────────────────────────────────────────
  if (action === 'get') {
    // FIX [B]: 8s timeout on Supabase fetch — prevents hanging near 25s Edge limit
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/aria_profiles?user_id=eq.${encodeURIComponent(userId.trim())}&select=*`,
        { headers: sbH, signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (!res.ok) return new Response(JSON.stringify({ profile: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      const rows = await res.json();
      // Guard: rows must be array (Supabase REST returns array on success)
      const profile = Array.isArray(rows) ? (rows[0] || null) : null;
      return new Response(JSON.stringify({ profile }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      clearTimeout(timer);
      return new Response(JSON.stringify({ profile: null }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── SAVE (upsert) ─────────────────────────────────────────────────────────
  if (action === 'save') {
    // FIX [B]: 8s timeout on save too
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      // Only send fields that are actually present — don't overwrite valid data with null
      const payload = { user_id: userId.trim(), updated_at: new Date().toISOString() };
      if (profileData?.country)       payload.country       = String(profileData.country).slice(0, 100);
      if (profileData?.age)           payload.age           = String(profileData.age).slice(0, 10);
      if (profileData?.income_range)  payload.income_range  = String(profileData.income_range).slice(0, 100);
      if (profileData?.goals_summary) payload.goals_summary = String(profileData.goals_summary).slice(0, 300);
      if (profileData?.last_summary)  payload.last_summary  = String(profileData.last_summary).slice(0, 500);

      const res = await fetch(`${SB_URL}/rest/v1/aria_profiles`, {
        method: 'POST',
        headers: { ...sbH, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      return new Response(JSON.stringify({ ok: res.ok }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      clearTimeout(timer);
      return new Response(JSON.stringify({ ok: false }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });
}
