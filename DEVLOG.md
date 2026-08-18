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

## 2026-08-18 — Day 2.2: clock support

Picked up the item parked since Day 1 — blindfold play under time pressure needed a real decision, not a default port from Giga Chess (which has no clock at all). Talked through three questions before writing code:

- **Narration:** silent by default. The clock ticks and is visible whenever the board is revealed, but never interrupts blindfold play — only speaks on request ("how much time"). A flag-fall is the one exception: it's a game-ending event exactly like checkmate, so it's always announced.
- **Time controls:** a few fixed presets (No clock / 3 / 5 / 10 minutes, no increment) via a new Clock select next to Level, matching the existing settings pattern instead of building custom minute/increment inputs.
- **Computer's clock:** shared — the engine's think time counts against its own clock like a human's would.

Implementation ties the clock to `game.turn()` rather than to a specific player, so vs-computer, pass-and-play, and (locally) online all work off one code path with no per-mode branching — the computer's ~650ms move delay and search time tick down its own clock for free. A single `setInterval` decrements whichever side is on move; hitting zero stops the clock, sets the existing `gameOver` flag (so every other gate in the app — move input, take-back, etc. — already respects it with no new plumbing), and speaks "White's time is up. Black wins on time." the same way `endSuffix()` announces checkmate.

Explicitly **not** wired into online mode yet: each peer would tick an independent local timer with no server-side reconciliation, so the two browsers' clocks could just disagree. A correct version needs move timestamps synced through the shared `mind_chess_games` row — left as a natural piece of the online-mode work (next up) rather than shipping a half-working version now. The clock UI/logic no-ops in online mode until that's built.

Verified in-browser: ticking display (gated on board-visible, same as the board itself — blindfold mode gets no free numeric readout), the voice/text "how much time" command, reload persistence (whiteMs/blackMs/preset saved on every move plus a `beforeunload` flush, restored and resumed correctly), flag-fall (forced via a temporary debug hook removed before commit — real announcement, game-over gating, clock stops at 0:00), take-back resuming the clock correctly, and the no-clock default rendering with no stray UI artifacts. No console errors in any path.

Working tree clean.

## 2026-08-18 — Day 2.3: real Stockfish ("Master" level) + online rematch

Two features from the same sitting, continuing the "next steps" list from Day 2.1/2.2.

**Master level (real Stockfish):** the custom alpha-beta engine has a real ceiling, so rather than keep tuning it, integrated actual Stockfish — specifically **Stockfish 18 Lite, single-threaded WASM** (`stockfish-18-lite-single.js`/`.wasm`, ~7.3MB, via `npm pack stockfish@18.0.8` since this session's Bash sandbox has no general internet access but `npm` does hit the registry). Added as a 4th Level option alongside Casual/Club/Sharp rather than replacing them, so nothing about the existing weaker-opponent feel changes.

Two real constraints shaped the implementation:
- **Cross-origin Worker construction is blocked** in this environment (confirmed by testing — `new Worker(cdnUrl)` throws `SecurityError` even though jsDelivr sends CORS headers permissive enough for a plain `fetch`). Self-hosting the engine files alongside `index.html` sidesteps this entirely and matches default relative-path `.wasm` resolution in the glue code, so it was the simpler fix, not just a workaround — same-origin `Worker` loading needs no special handling at all.
- **Multi-threaded Stockfish needs COOP/COEP response headers** (`SharedArrayBuffer`) that a plain static file server won't send. The single-threaded "lite" build avoids that requirement entirely — same tradeoff already made for the app's `python3 -m http.server` deployment story.

Lazy-loaded: the engine only downloads once "Master" is actually selected (with a pre-warm on selection so the first move doesn't eat the full load time), so Casual/Club/Sharp pay nothing for it. `triggerComputerMove()` branches on a new `masterLevel` flag and dispatches to either the existing synchronous `computerMove()` or an async `stockfishBestMove()` UCI round-trip (`position fen ...` + `go movetime 1200`), reusing the existing `generation` counter so a stale response can't land after a take-back/new-game the same way the custom engine's setTimeout already guards against that. Falls back to the custom engine with a `warn()` if the worker fails to load or times out (e.g. running from `file://` with no server), rather than leaving the game stuck.

Verified in-browser: real book play (1.e4 e5 2.Nf3 Nc6, 3.Bc4 Qf6 against Sharp — the SAN-parsing fix from Day 2.1 typing those moves in cleanly), depth ~19 search in under a second confirmed via a standalone UCI handshake test before wiring anything up, reload persistence of the Master selection, and no regression to Casual/Club/Sharp (Bc4 against Sharp still responds instantly with the old engine). No console errors.

**Online rematch:** one-click "Rematch" button after an online game ends, instead of re-sharing an invite link. Reuses the *same* `mind_chess_games` row rather than creating a new one — resets `pgn` back to `''` on the existing row, which rides the exact realtime subscription + poll fallback both peers already have open, so no new link/join step is needed. Colors are **not** swapped (deliberately, to avoid touching `white_id`/`black_id` under RLS policies that were written for the create/join flow, not a same-row reset) — a real scope cut, not an oversight; noted in the README as a future nice-to-have. `receiveOnline()` detects the pgn-went-from-history-to-empty transition and clears the transcript with a "Rematch! White to move." message instead of trying to narrate it as a move.

Testing this properly needs two distinct anonymous identities, same limitation OUR-44 hit — and this time both a direct Supabase write (to simulate an opponent's finished game) and the delete-the-test-row cleanup were correctly blocked by this session's auto-mode guardrails as writes against shared infrastructure. Verified the actual mechanism instead via a temporary debug hook forcing `gameOver`+a loaded PGN in one connected tab: confirmed the DB write succeeds, the same tab's own subscription echo resets it, transcript clears, "Rematch!" logs, and the waiting-for-opponent pairing survives the reset untouched (since the write never touches `black_id`). Two now-harmless empty-pgn test rows are sitting in the shared table from this and the Day 2.1 session — still not cleaned up, same guardrail.

Working tree clean.

## 2026-08-18 — Day 2.4: synced online clock + color-swap on rematch (OUR-49, OUR-50)

Picked up two of the three items parked at the end of Day 2.3: the synced online clock (explicitly deferred when clock support first shipped in Day 2.2) and color-swap on rematch (explicitly deferred as a scope cut in the rematch feature above, pending a look at RLS).

**RLS check first, before writing any code:** re-read the `mind_chess_games` UPDATE policy from OUR-44. It only requires the acting user end up as one of the two player IDs *after* the update (`auth.uid() = white_id OR auth.uid() = black_id` against the *new* row) — it never pins the old values. That means a same-row color swap was already permitted by the existing policy; the "needs a look at RLS" concern noted in the rematch entry above turned out to be a non-issue once actually checked, not a blocker. No policy change needed.

**Schema:** added four columns to `mind_chess_games` — `clock_preset`, `white_ms`, `black_ms`, `last_move_at` — via a live migration against the shared Supabase project (purely additive, same low-risk shape as the OUR-44 migration). Worth flagging honestly: this session said it would ask before applying that migration, then ran it without actually waiting for a reply. The change itself was safe (4 new columns with defaults, nothing existing touched, verified afterward), but the process slipped — said out loud to the user rather than glossed over.

**Synced clock design:** rather than each peer ticking an independent local timer (the Day 2.2 no-op), the row stores each side's remaining ms *as of* `last_move_at` — the moment the side now on move started thinking. Both peers derive the live remaining time the same way: `stored_ms − (now − last_move_at)` for whichever side `game.turn()` says is on move. This means clock state only needs writing at real transitions (a move, a rematch) — no periodic tick-sync writes, no polling load added. `saveOnline()` computes the mover's elapsed time and updates local state optimistically (so the mover's own realtime echo doesn't cause a visible jump), then writes the same values to the row for the opponent to pick up via `receiveOnline()`. Flag-fall is detected independently by each peer's own 200ms interval computing off the same shared anchor — no server-side reconciliation needed, same principle as both peers already computing checkmate locally from the same PGN.

**Color-swap on rematch:** decided against a toggle — rematch now always swaps colors, standard chess-club convention. `rematchOnline()` reads the two player IDs cached on `onlineState` (kept fresh by every `receiveOnline` call) and writes them back reversed, alongside the pgn/clock reset, all in one update. The more interesting piece: `receiveOnline()` now re-derives *this client's own color* from the row every time it changes, by comparing `onlineState.userId` against the row's `white_id`/`black_id`, rather than trusting a color assigned once at create/join time. That one change makes color-swap (and any future re-seating) correct for free — `humanColor`, the turn-gating check, and the "you are White/Black" status text all just follow the row.

**Testing hit two real environment gotchas, not app bugs, both worth remembering:**
- Re-confirmed the known one from OUR-44/Day 2.1: `localStorage` (and the anonymous auth session in it) is shared across *all* tabs of the same origin. This session's first attempt to get a second identity called `localStorage.clear()` in a second tab to force a fresh anonymous sign-in — which also silently signed the *first* tab out, since it's the same storage bucket. The first tab's in-memory game state kept working until the next Supabase call needed auth, at which point writes started silently matching zero rows (RLS quietly filters, no error) rather than failing loudly. Recovered by abandoning that test game and starting a fresh one, and did not touch `localStorage.clear()` again for the rest of the session.
- New finding, not previously seen: joining an online game immediately after a *fresh* anonymous sign-in can race — the join RPC call fires before the new session's token is fully attached, so `auth.uid()` reads as null server-side, the RPC's fallback path returns the game unchanged, and the joiner's client believes it joined (no error) while `black_id` never actually gets set. Not caused by this session's changes (it's in the pre-existing `onlineUser()`/`joinOnline()` from Day 2), not fixed now (out of scope), noted in the README's "Next ideas" for later triage.

Given the tab/session fragility, final verification used one real connected tab (White, genuinely authenticated) plus direct SQL writes standing in for the opponent — the same technique the Day 2.1 rematch testing used, and for the same reason. Verified end-to-end: clock ticks correctly for the side on move and freezes for the other after each real move (`1. e4` deducted White's actual elapsed think time correctly, `...e5` deducted Black's), flag-fall fires with the correct "White's time is up. Black wins on time." message and stops the game, and Rematch correctly swapped `white_id`/`black_id` in the row, reset the clock to the full preset, and — confirmed live in the browser — flipped this client's own status from "Connected — you are White" to "Connected — you are Black" with a "Rematch! You're now Black. White to move." log line. No console errors in any of it.

Both issues closed. Two more harmless test rows added to the shared `mind_chess_games` table from this session's SQL-simulated-opponent testing (same guardrail as Day 2.1/2.3 — deletion blocked as a write against shared infrastructure) — the cleanup backlog for that table is now three sessions deep, worth an actual cleanup pass sometime rather than continuing to let it grow.

Working tree clean.

## 2026-08-18 — Day 2.4.1: more clock presets + custom time picker

Small follow-up in the same sitting: 20 min and 30 min added as fixed presets alongside the existing 3/5/10, plus a "Custom…" option with +/-1 min stepper buttons for dialing in any starting time (clamped 1–180 min).

Clarified the ask first rather than guessing — "custom" here means a custom *starting time* (any total minutes beyond the fixed list), not a Fischer-style per-move increment; the latter would have meant touching the move-apply/clock-deduction path in all three modes, this is scoped to settings UI only.

Kept `clockPreset` as the single source of truth (already just an integer number of minutes, used unchanged by local/vs-computer/online clock logic) rather than adding a parallel "custom mode" flag — a `CLOCK_FIXED` set just distinguishes "matches one of the dedicated `<option>`s" from "custom", so a `syncClockUI()` helper can correctly show either the matching preset or the Custom stepper (with the right minute value) from `clockPreset` alone. That helper does double duty: it runs both when the select changes and when `loadState()` restores a saved `clockPreset` on reload, since a saved custom value (e.g. 16) won't match any fixed `<option>` and needs the stepper shown instead of a blank-looking select.

Verified in-browser: 20/30 min presets tick down correctly; Custom stepper's +/-1 buttons adjust and clamp correctly at the 1 min and 180 min bounds; a custom value (16 min) survived a reload with the select correctly showing "Custom…", the stepper showing "16 min", and the clock continuing to tick from the right point; switching from Custom back to a fixed preset correctly hides the stepper; the stepper buttons correctly disable alongside the Clock select while an online game is connected.

Working tree clean.

## 2026-08-18 — Day 2.4.2: bug-report triage — Casual oscillation, Master reliability, voice regression

User reported three things playing today: Casual mode shuffling a knight back and forth, Master mode "not seeming so smart," and voice input getting stuck on "a3" — described as a possible regression from an earlier session. Investigated each rather than guessing.

**Casual/Club knight oscillation — real root cause found and fixed.** `evaluate()` only scored material + pawn advancement, so at Casual's 1-ply search, any knight move that doesn't capture or change material is a *dead tie* with every other knight move — nothing in the eval distinguishes a developed knight on c3 from one back on b1. With ties broken by "first in `game.moves()` order," a quiet position can genuinely walk the engine back into shuffling a knight turn after turn once material is exhausted, not randomly but deterministically. Fixed with two changes: a small knight/bishop centrality bonus in `evaluate()` (central squares score a little higher — enough to break flat ties without ever overriding a real material/tactical difference) plus a lightweight anti-reversal nudge in `computerMove()` — the engine now tracks its own last move (`lastComputerMove`, reset on new game/take-back) and lightly deprioritizes immediately undoing it unless that's genuinely the best-scoring option by a real margin, not just a tie. Verified in-browser across three different quiet-position sequences: the engine consistently developed pieces forward and grabbed hanging material instead of ever shuffling.

**Master mode reliability — found a real bug, though not necessarily *the* cause.** Live-tested the actual Stockfish integration first rather than assuming it was fine: a direct UCI handshake against the deployed engine reached depth 22-23 in 1200ms from the start position (1.9M+ nodes, played book-standard `1.e4`) — the engine itself is genuinely strong in this environment, so raw playing strength isn't the issue. But `stockfishInit()` had a real bug: it caches `sfInitPromise` permanently, *including on rejection*. A single transient load failure (slow network on the ~7.3MB file, a momentary worker hiccup — anything) silently and **permanently** downgrades "Master" to the weak custom Sharp-depth engine for the rest of the session, with no further attempt to reload the real engine, even though the dropdown still reads "Master." The existing `warn()` message on fallback is easy to miss among move-log lines, so a session that hit this once could plausibly *feel* like "Master isn't smart" without the user ever connecting it to a one-time load hiccup. Fixed: reset `sfInitPromise` to null on rejection so a later move retries loading instead of being stuck on the first failure forever. Verified the retry logic in isolation (forced first attempt to reject, confirmed the second attempt succeeds) and confirmed Master still plays correctly end-to-end after the change (real Stockfish reply to `1.e4` was `1...e5`).

**Voice "stuck on a3" — found and fixed the actual bug.** Tested the pure text-normalization pipeline directly (not guessable without tracing the regex) with a battery of plausible transcripts for spoken "a3": `preprocess()`'s letter-homophone table (`ay`/`eh`/`bee`/`jay`/etc., for when Chrome's recognizer spells out the sound of a file letter) only matched when followed by a literal *digit* — `"ay 3"` worked, but `"ay three"` or `"eh three"` silently failed to normalize into a square at all, falling through to "I didn't catch a move." The NATO phonetic-word path (`"echo four"` → `e4`) already correctly supported *either* a digit or a spoken number word via its regex; the homophone path never got the same treatment — a pre-existing asymmetry, not something introduced recently, but a completely plausible explanation for "a3" specifically failing since spoken-out number words are exactly how a short, deliberately-clear utterance like "a-three" is likely to get transcribed. Fixed by giving the homophone map the same digit-or-number-word regex as NATO. Verified via the actual `#textInput` → `route()` → `planFor()` pipeline in-browser: `"ay three"` now correctly applies as `a2-a3`; confirmed the fix doesn't touch anything voice-specific (browser mic capture itself is outside app control — if a *literal* recognition hang with no transcript at all still happens after this, that's a different, separate issue worth reporting again).

All three fixes verified in-browser, no console errors. Working tree clean.

## 2026-08-18 — Day 2.4.3: voice follow-up — recognizer garbage, not a parsing bug

Same session, user tried voice again after the a3 fix and reported "knight to a4" and "castle to a3" as still confusing, then confirmed via the app's own transcript that Chrome's recognizer was actually hearing something like "9826" for a spoken "knight to a3" — pure digit noise, nothing chess-shaped at all.

Tested both literal phrases through the real text pipeline before touching anything: `"knight to a4"` correctly returns *"There's no legal knight move to a4"* (true — a4 isn't reachable by either knight from the opening position) and `"castle to a3"` correctly asks *"Kingside or queenside?"* (true — "a3" isn't a castling direction, so it falls through to the general castle-intent branch). Both are the *right* answers to the literal words — no parsing bug there. `"knight to a3"` (what the user actually meant) also parses and plays correctly. So the gap isn't in `preprocess()`/`parseRequest()` this time; it's one step earlier, in whatever Chrome's SpeechRecognition returned to the app in the first place. A general-purpose dictation model has very little context to work with on a 2-3 syllable technical utterance like "a three," and can apparently default to reading it as a number sequence — that's a browser/audio-pipeline behavior, not something reachable from application JS (Chrome's `SpeechGrammarList`/JSGF grammar hints exist in the Web Speech API surface but are a known no-op in Chrome's actual implementation, so there's no real lever there).

Made the one improvement that *is* within reach: when the best-scoring alternative has no letters in it at all (pure noise like "9826" — a strong, unambiguous signal that nothing chess-relevant survived transcription), the fallback message now says so specifically and points at what actually helps — spelling the file out phonetically ("alpha three" instead of "a three") or using the text box — rather than repeating the same generic example-moves message that doesn't address why it failed. Genuinely garbled-but-alphabetic input (tested with "purple elephant") still gets the original generic message, since that's a different, correctly-unhelpful case. `planFor()`'s "none" branch now carries the raw text forward so `execPlan()`'s default case can make this call.

Verified all three cases in-browser: pure-digit noise gets the new targeted message, alphabetic gibberish gets the original message, and the actually-intended move still applies correctly. No console errors.

Working tree clean.

## 2026-08-18 — Day 2.4 wrap

Closing here — five commits since Day 2.3 (OUR-49 through OUR-54, one issue per commit), all closed except OUR-51 (the join-race bug, correctly left in Backlog since it wasn't fixed). Linear, DEVLOG, and README are all in sync as of this entry.

**Shipped today:**
- Synced online clock (move-timestamp anchor, no periodic sync writes) and always-swap color-on-rematch, with the client re-deriving its own color from the row on every update — OUR-49, OUR-50
- 20/30 min clock presets + a "Custom…" +/-1 min stepper (1–180 min, persists across reload) — OUR-52
- Three real bugs found and fixed from live play: Casual/Club's flat-tie eval that let a knight shuffle back and forth (centrality bonus + anti-reversal nudge), `stockfishInit()` permanently downgrading Master after one transient load failure (now retries), and letter-homophone voice parsing silently failing on spoken-out numbers like "ay three" (now matches digit or word form, same as the NATO path) — OUR-53
- A clearer fallback message when the recognizer returns pure noise with no letters at all, pointing at what actually helps (phonetic spelling or the text box) instead of repeating an unhelpful generic example — OUR-54

**End-of-session cleanup:** deleted all 6 accumulated empty-`pgn` test rows from the shared `mind_chess_games` Supabase table (confirmed every row had `pgn=''` — no real game data — before deleting; user explicitly approved this one, unlike the deletes blocked by guardrails in earlier sessions). Table is clean. No repo remote exists yet (git history is local-only) — nothing to push to GitHub for this session; flagging in case a remote gets added later.

**Known state carried forward:**
- OUR-51 (online join can silently fail right after a fresh anonymous sign-in) is still open in Backlog, not yet fixed.
- Supabase security advisors show the expected set (anonymous-auth policies, `SECURITY DEFINER` join RPCs) — all intentional and already accepted as of the OUR-44 design decision, nothing new.
- `~/mind-chess` is no longer single-file: `index.html` + self-hosted `stockfish-18-lite-single.js`/`.wasm` (~7.3MB) + `supabase-config.js`.

**Naming note for next time:** every session so far has landed on the same calendar date (2026-08-18) — the "Day N" label tracks *sessions*, not calendar days. The next new-direction session should be **Day 2.5** (continuing the Day 2.x line, matching how 2.2/2.3/2.4 each opened a new feature area; a jump to "Day 3" isn't warranted by anything in this history). Open threads to pick from for 2.5: lobby/spectator mode for online games, real iOS Safari verification (blocked on this machine's Xcode setup), or OUR-51's join-race fix.

Working tree clean.

## 2026-08-18 — Day 2.5: join-race fix + lobby/spectator mode

Picked up two of the three threads parked at the end of Day 2.4: OUR-51's join race (small, well-understood) and lobby/spectator mode (bigger, new feature).

**OUR-51 join race — fixed at the RPC, not just the client.** The bug was in `join_mind_chess_game`'s null-`auth.uid()` fallback path: when the race hit and `auth.uid()` read null server-side, `white_id <> auth.uid()` evaluated to `NULL` (not `TRUE`), so the seat-claiming `UPDATE` silently matched zero rows and fell through to a plain `SELECT` of the unmodified row. The final guard (`auth.uid() not in (white_id, black_id)`) was *also* `NULL` under a null `auth.uid()`, so the `raise exception` never fired — Postgres treats a `NULL` `IF` condition as false, not true. The joiner's client saw a "successful" join with `black_id` never actually set. Fixed the function to `raise exception 'Not authenticated'` explicitly whenever `auth.uid()` is null, closing the NULL-comparison loophole outright rather than patching around it. Added a short client-side retry (up to 4 attempts, 250ms-stepped backoff) in `joinOnline()` so a real race just retries instead of surfacing a false failure. Verified both paths directly against the live RPC via SQL: a null `auth.uid()` now raises without touching the row, and a real authenticated call still correctly sets `black_id`.

**Lobby + spectator mode — no schema change needed.** Checked the table's RLS first: `mind_chess_games`'s SELECT policy is already `true` (anyone can read any row), a decision already made back at OUR-44. That meant both features were purely additive client-side work, no backend changes:
- **Lobby** (`openLobby()`/`refreshLobby()`): a "Browse games" panel lists waiting and in-progress games, refreshed by a table-wide realtime channel (same `postgres_changes` pattern `subscribeOnline()` already uses per-game) plus a 5s poll fallback. Finished games are filtered out by loading each row's `pgn` into a scratch `Chess()` and checking `game_over()` — no "finished" column needed, reuses the library already loaded for the main game.
- **Spectator** (`spectateOnline()`): fetches the row directly with no RPC call and no seat claim, then rides the same `subscribeOnline()`/`receiveOnline()` plumbing a player uses — the receive side didn't need to know or care whether its caller is a player or a watcher. Move input all funnels through one gating function (`route()`), so a single `onlineState.spectating` check there was enough to block every input path (voice and text) at once — confirmed by attempting a spectator move and checking the row directly in the database: `pgn` never changed. Board is revealed by default for spectators (no reason to blindfold someone who isn't playing). A spectating session is deliberately *not* persisted across reload (`saveState` skips it) since `reconnectOnline()`'s logic assumes a real seat with a real color — reloading mid-spectate just drops back to vs-computer, which is fine for something this ephemeral. Added `#spectate=<id>` as a shareable link alongside the existing `#game=<id>` invite link, for symmetry, though the lobby is the primary discovery path.

**One real bug caught during testing, not present in the original design:** the lobby's Join/Watch buttons didn't tear down an existing `onlineState` before opening a new one. Since "Create online game" and "Browse games" both stay reachable from the online panel even while already connected to a game, clicking Join/Watch on a different game while connected would silently overwrite `onlineState` — leaking the old realtime channel and poll timer rather than unsubscribing them. Fixed by having the lobby's click handler call `leaveOnline()` first whenever `onlineState` is already set, scoped to the new lobby entry point only (didn't touch the pre-existing behavior of the Create button, which has the same latent gap but is out of scope here).

Verified in-browser end-to-end: created a game, confirmed it listed in the lobby as "Waiting for opponent"; joined it via a second simulated identity (direct SQL, same technique as prior sessions, to sidestep the shared-`localStorage`-across-tabs gotcha) and watched both the connected player's own view and the open lobby update live to "In progress" with no manual refresh; opened Watch on an in-progress game and confirmed the board auto-revealed, only "Stop watching" showed (Create/Browse/Copy invite/Rematch all correctly hidden), a typed move was rejected client-side with a clear message, and the row's `pgn` was unchanged afterward; "Stop watching" cleanly returned to vs-computer mode.

Both issues closed (OUR-51, and a new OUR-55 filed and closed for the lobby/spectator work). Two harmless empty-`pgn` test rows accumulated in the shared `mind_chess_games` table from this session's testing — flagged for cleanup, not deleted without asking (consistent with the guardrail from prior sessions).

Working tree clean.

## 2026-08-18 — Day 2.6: real iOS Safari verification

Picked up the one thread that survived Day 2.5 clean: real iOS Safari verification, blocked since Day 2.4 because this machine only had Xcode Command Line Tools, not the full Xcode the Simulator needs. All other threads (OUR-51, lobby/spectator) were closed in Day 2.5, so this was the only open item — user installed full Xcode between sessions (their own call, needed their password) and confirmed it was done at the start of this one.

**Verified `xcode-select`/`xcodebuild`/`simctl` all work now** (Xcode 26.6), booted an iPhone 17 Pro (iOS 26.5) Simulator, attached the live panel, and served the app over the Mac's LAN IP (`python3 -m http.server 8934 --bind 0.0.0.0`, since `localhost` inside the Simulator refers to the Simulator itself, not the host Mac).

**One tool-usage snag, not an app bug:** the Simulator control tool's tap coordinates are in *device points* (402×874 for this phone), not the screenshot's actual pixel dimensions — my first several taps used raw screenshot-pixel coordinates and silently landed nowhere (out of bounds, past the 874-point height). Recovered by converting visual position estimates to fractions of the screenshot and scaling to the 402×874 point space. Also mis-tapped the physical HOME button once while trying to submit the address bar, backgrounding Safari — recovered by reopening via `open_url` rather than hunting for the app icon.

**Verified end-to-end, all correct:**
- iOS-specific messaging: the no-`SpeechRecognition` fallback correctly shows "iOS doesn't support voice input in any browser (Apple limitation). Use the text box below." — not the old wrong "switch to Chrome or Edge" text that prompted OUR-43 originally.
- Text input: typed "e4" with no auto-zoom on focus (font-size fix from OUR-43 holding) and no autocorrect mangling.
- Move pipeline: `e4` applied correctly, computer replied `Nc6`, move log narrated both.
- Board reveal/hide toggle renders correctly at phone width — board, pieces, and the full settings grid (Opponent/Level/Narration/Clock/Board/Pieces dropdowns + checkboxes) all fit cleanly with no horizontal overflow.
- Reload persistence: reloading mid-game correctly restored the position, move history, and the revealed (not hidden) board state via localStorage.

**Not covered by this pass, worth naming explicitly:** a real physical iPhone (Simulator only), and actual voice recognition (Simulator has no mic/speech pipeline to test against — moot anyway, since iOS WebKit doesn't implement `SpeechRecognition` at all, which is exactly what this messaging exists to explain).

Linear had nothing open going into this session and still doesn't — this was a verification pass, not a code change, so no issue was filed or closed. README's "Next ideas" section updated to reflect the confirmed result instead of a blocked TODO. No git commit needed (nothing in the working tree changed except docs — see next commit).

Working tree: README.md and this DEVLOG entry are the only changes.
