# Mind Chess — Devlog

Lightweight milestone log, not a full diary. One entry per session/decision, appended — not rewritten.

## 2026-08-18 — Day 1: promoted to a real project

- Three prior artifact prototypes existed in `~/Downloads` (`mind-chess.html`, `_1`, `_2`). Promoted the latest (`_2`) into `~/mind-chess/index.html`, git-initialized.
- Created the Linear project "Mind Chess" (team OUR), status In Progress.
- Opened OUR-39 (smarter computer opponent) and OUR-40 (persist game state across reloads) as the two known gaps from the prototype phase.

## 2026-08-18 — Reviewed Giga Chess for reusable patterns

Read through `~/Documents/ChatGPT/chess project/chess.html` (Giga Chess — the sibling public chess project, Codex-managed workspace) since Mind Chess's board CSS was already derived from it. Findings:

- Giga Chess has a working alpha-beta minimax (`search()`) over a material + pawn-advancement eval (`value()`), exposed as 3 depth levels (Casual/Club/Sharp). Directly reusable for OUR-39.
- Giga Chess does **not** persist mid-game state across reloads either (only theme/radio preferences) — no shortcut available for OUR-40, that one needs to be built from scratch.
- Giga Chess's board/piece theme system (`data-board`/`data-pieces` CSS + localStorage) is a near copy-paste fit given the shared CSS variable names.
- Giga Chess has a proven Supabase realtime multiplayer pattern (anon auth, `chess_games` table, invite links) — noted as a future option, not scoped.
- Giga Chess has move/capture sound effects with a synthesized WebAudio fallback — noted as a cheap, isolated addition.

Decisions:
- Opened OUR-41 (board/piece theming) and OUR-42 (move/capture sound effects).
- Parked clock support (5) — blindfold play changes meaningfully under time pressure, worth a deliberate call later, not a default port.
- Parked multiplayer (6) — good future direction, not now.
- Kept Mind Chess standalone at `~/mind-chess` rather than folding it into the Codex-managed `chess project` workspace (different tooling/agent, already working as-is).

## 2026-08-18 — OUR-39: alpha-beta computer opponent

Replaced the random/greedy `computerMove()` with alpha-beta minimax (`searchScore()`) over a material + pawn-advancement `evaluate()`, ported from Giga Chess's algorithm onto chess.js. Added a Level select (Casual/Club/Sharp → search depth 1/2/3) next to the Opponent select.

Verified in-browser at all three depths: legal, sensible replies (e.g. `1. e4 Nc6 2. Nf3 Nb4`), no lag even at Sharp/depth 3, no console errors. Closed OUR-39.

## 2026-08-18 — OUR-40, OUR-41, OUR-42: persistence, theming, sound

Three more in one sitting, all built and verified before closing:

- **OUR-41 (theming):** ported Giga Chess's `data-board`/`data-pieces` CSS system, translated onto Mind Chess's own variable names (`--sq-light/dark` vs Giga's `--light/dark`, etc). Added Board/Pieces selects, persisted to localStorage. Verified: switched to Midnight board + Gold pieces, confirmed the board actually re-rendered with the new colors and survived a reload.
- **OUR-42 (sound):** ported `sound()`/`woodFallback()` from Giga Chess unchanged in approach — hosted click/thud sample, synthesized WebAudio fallback if it fails to load. Wired into `applyMove()` ahead of the narration call.
- **OUR-40 (persistence):** no existing pattern in Giga Chess to copy (it only persists preferences, not game state), so built from scratch: `game.pgn()` → localStorage on every `renderAll()`/`setBoardHidden()`/settings change, restored via `game.load_pgn()` on boot with a "Game restored" message in place of "New game." Verified: played `1. e4 Nc6`, reloaded, move strip and turn state came back intact.

All three closed. Gotcha worth remembering: `index.html` writes a couple of apostrophes as a JS unicode escape sequence in the source rather than as the literal character — a find/replace edit that pastes in the rendered apostrophe glyph will silently fail to match. Isolate the surrounding line into its own edit rather than fighting the escape.

## 2026-08-18 — Day 1 wrap

Closing the session here — clean stopping point, not a forced cutoff: all 4 issues opened today (OUR-39 through OUR-42) are closed, working tree is clean (`git status` empty), nothing mid-implementation.

Day 1 summary: three artifact prototypes → a real git-tracked project → Linear-tracked → a real search-based opponent, theming, sound, and reload persistence, all ported/adapted from Giga Chess where a pattern already existed there, built fresh where it didn't (persistence had no Giga precedent).

State for next session: nothing open in Linear for Mind Chess. Parked, not forgotten: clock (deliberately undecided), multiplayer (viable later via Giga's Supabase pattern, not scoped). Otherwise open-ended — next session picks a direction fresh.

## 2026-08-18 — Day 2: mobile mic UX pass + online multiplayer

Picked two directions: OUR-43 (mobile mic UX) and OUR-44 (multiplayer), both from Day 1's parked list.

**OUR-43:** iOS runs every browser (Safari, Chrome, Edge) on WebKit, which has no `SpeechRecognition` at all — the old fallback message ("needs Chrome or Edge") told iOS users to switch browsers when nothing on iOS would work. Added iOS detection (UA sniff + the `MacIntel`+multitouch check for modern iPad, which reports as Mac) with accurate messaging instead. Also fixed the text input: `font-size:14px` triggers iOS Safari's auto-zoom on focus (bumped to 16px), and added `autocorrect="off"`/`autocapitalize="off"`/`spellcheck="false"` so mobile keyboards stop mangling notation like "knight f3". Verified the iOS detection logic against real UA strings and confirmed the CSS/attribute fixes in-browser; couldn't verify end-to-end on a real iOS Safari since this Mac only has Xcode command-line tools, not the full Xcode install the Simulator needs — said so rather than silently faking it.

**OUR-44:** Ported Giga Chess's Supabase realtime multiplayer pattern (`~/Documents/ChatGPT/chess project/chess.html`) — anonymous auth, a games table, realtime `postgres_changes` + 2s poll fallback, invite links via `location.hash`. Decision: reuse Giga Chess's existing Supabase project (`lqwssctnvgpxnerahnkc`) rather than spin up a new one — negligible load for two hobby chess apps, and a new `mind_chess_games` table with its own RLS policies and join RPC keeps it fully isolated from Giga's `chess_games` table. Migration only ever added objects, never touched anything existing; confirmed via `list_tables`/`get_advisors` afterward (the new warnings on `mind_chess_games` mirror the same categories already present on `chess_games` — nothing new in kind). This ran against a live, shared project, so the migration itself needed explicit user confirmation before applying, on top of the earlier project-choice call.

Schema: `mind_chess_games` stores PGN (not Giga's custom board array, since Mind Chess is already chess.js/PGN-based) plus white_id/black_id/timestamps. Added a "Play online" mode, an invite-link panel (create/copy), turn-gating so you can't move out of turn or take back a shared game, and reconnect-on-reload (persists the online game id/color in the existing localStorage save so a refresh mid-game resumes the connection instead of losing it).

Tested end-to-end with two browser tabs acting as both players — hit a real gotcha along the way: Supabase anonymous-auth sessions live in localStorage, which is shared across tabs of the same origin/browser profile, so a second tab in the *same* browser rejoins as the *same* anonymous user instead of a distinct opponent. Not a bug in the app — same limitation would hit Giga Chess's identical pattern — but worth remembering for future testing (need a second browser/incognito window, or manually clear `localStorage` + force a real reload, same-URL same-hash navigations don't always reload the page). Once tested with genuinely separate identities: create/join, realtime sync in both directions, turn-gating, and reconnect-on-reload all verified with no console errors. Cleaned up the test game row afterward.

Both issues closed. Working tree clean.

## 2026-08-18 — Day 2.1: bug/polish pass

No new feature this time — played through single-player, settings, reload persistence, and an online-mode smoke test looking for rough edges instead.

Found and fixed two real issues:
- **Typed algebraic notation was silently rejected.** The text/voice parser only understood spoken-style phrases ("knight f3") or bare pawn squares ("e4") — standard SAN like "Bc4", "Nf3", "Qxe5" all failed with "I didn't catch a move," even though it's the first thing any chess-literate typist reaches for. Fixed by trying chess.js's own SAN parser (`game.move(text,{sloppy:true})`) as an exact-match fast path before falling through to the fuzzy speech-phrase scorer — move+undo keeps it side-effect-free, the same idiom `computerMove()`'s search already uses. Verified: "Bc4"/"Nf3"-style input now applies correctly and shows proper notation in the move strip; gibberish is still correctly rejected, no regression.
- **Stale filename in the file:// mic-permission banner.** Told users opening the page directly to visit `http://localhost:8000/mind-chess_2.html` — a leftover from before Day 1's promotion to `index.html`. Fixed the reference.

Also re-verified with no regressions: reload persistence (game state + theme both restore correctly), board/piece theming, and online mode's create-game flow (smoke-tested only — no console errors — since OUR-44 already covered a full two-identity sync test and re-establishing two distinct anonymous sessions in this session's browser tooling is expensive to redo for a recheck).

Gotcha for future sessions: the in-session preview/browser tool renders local `file://` pages as opaque `data:` URL snapshots — localStorage and the file://-triggered mic banner can't be exercised there. Serving over `python3 -m http.server` (a real `http://` origin) is required to test persistence or Supabase auth.

Also ruled out a red herring: Enter-to-submit on the move input appeared broken during testing, but a throwaway injected test form proved it's the browser-automation tool's synthetic key events not being treated as trusted for native form-submit — not an app bug. Left alone.

One loose end: the online-mode smoke test created a real row in the shared Supabase `mind_chess_games` table; deleting it was correctly blocked as a destructive action on shared infrastructure by this session's guardrails, so it's still sitting there — low-priority cleanup for later.

Working tree clean.
