// Paste the Project URL and publishable/anon key from your Supabase project here.
// The publishable/anon key is safe to use in a browser; never put a service-role key here.
//
// OUR-124 Phase A: Mind Chess's own project, split off from the one shared
// with Giga Chess (lqwssctnvgpxnerahnkc, which held mind_chess_games/chat/
// reports/results through r117 — the OUR-44 decision this superseded). The
// split happened because Phase B/C's real accounts would have meant a
// shared auth.users pool across both apps, a much bigger commitment than
// sharing a few anonymous session rows ever was. Nothing in the old
// project was deleted; its rows just stopped being read once this file
// changed.
//
// IMPORTANT — one manual step still outstanding on this new project:
// Authentication > Sign In / Providers > enable "Allow anonymous sign-ins".
// It's off by default and there's no API/MCP path to flip it (dashboard
// only). Until it's on, signInAnonymously() fails for online/Lichess mode
// specifically — computer/two-player play and their stats are entirely
// unaffected either way, by design (see onGameEnd()/tryGetExistingUser()
// in index.html): every Supabase touch this app makes now degrades to
// local-only on failure rather than erroring.
window.MIND_CHESS_SUPABASE_URL = 'https://qkchrdzgkcvowwttxtqu.supabase.co';
window.MIND_CHESS_SUPABASE_ANON_KEY = 'sb_publishable_rpUCB8oVL0nanyWnsjboeQ_prm-coV6';
