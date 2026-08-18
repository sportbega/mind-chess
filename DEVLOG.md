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
