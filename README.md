# Mind Chess

**Live (public beta):** https://sportbega.github.io/mind-chess/ — no install needed, hosted on GitHub Pages. **This is the link to share.**

⚠️ Share `/`, not `/v2/`. They are identical the moment a release ships, but `/v2/` is the rolling preview and drifts ahead into half-finished work as soon as the next session starts. `/` only moves when `./publish.sh release` is run deliberately.

Browser chess with a voice / blindfold mode — play by speaking moves ("e4", "knight to f3", "queen takes e5", "castle kingside") while the board stays hidden, or reveal it any time.

No build step, and it still opens as a plain page. `index.html` carries the app; [chess.js](https://github.com/jhlywa/chess.js) 0.10.3 is vendored as `chess-0.10.3.js` rather than fetched from a CDN, so **a game against the computer needs no network at all**. The "Master" level self-hosts real [Stockfish](https://github.com/nmrugg/stockfish.js) (18 Lite, single-threaded WASM, ~7.3 MB), lazy-loaded so the other levels pay nothing for it. `stt-worker.js` runs on-device speech recognition when you ask for it.

Speech in and out both have two engines, and **the app is fully playable before any optional download begins**:

| | default (free, instant) | optional upgrade |
|---|---|---|
| **Hearing** | Web Speech API (Chrome/Edge) | Moonshine base in the page — 247 MB once, works offline after |
| **Voice** | the system voice | [Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) — 326 MB once, markedly better |

## Run locally

Speech recognition needs a real origin (not `file://`), so serve it:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000

## Status

**2.0 is the current release — the official public beta.** The whole voice plan shipped — recognition rebuilt around a constrained matcher, always-on listening, an engine-backed assistant you can ask about the position, a natural voice, and on-device recognition — at zero running cost, which was the binding constraint throughout. See [VOICE-2.0-PLAYBOOK.md](VOICE-2.0-PLAYBOOK.md) for the plan and what measurement changed about it.

What 2.0 added on top of v1.0:

- **Voice input that survives being misheard.** Spoken moves are scored against the actual legal move list rather than pattern-matched, so "Pond to e4" still plays the pawn. Where two readings are equally legal it refuses instead of guessing — a rejection costs one repeat, a wrong move costs the game
- **Always-on listening** — the mic stays open through narration ("Talk over it", ships off), and Escape, the mic button or typing always interrupt. Nothing heard while the app is speaking can ever play a move
- **Ask the board anything** — thirteen computed answers: where a piece is, what it can reach, what's on a square, what attacks or defends it, what's loose, castling rights, material, available captures. All computed by chess.js, never recalled by a model
- **A coach**, off by default — Stockfish answers "how am I doing", "what should I worry about", "is my king safe". `hints` never names a number or a move; `full` does
- **A natural voice** — optional Kokoro, and a voice/speed picker for the system voice
- **On-device recognition** — optional Moonshine, no network round-trip, and the only route to voice on iOS
- Voice diagnostics at `?debug=1` — the full mic timeline, what was heard, and how the matcher ranked it

v1.0's feature set, all still here:

- Voice input with a constrained-vocabulary matcher (scores speech alternatives against the actual legal move list)
- Text input fallback
- Blindfold mode: board hidden by default, toggle to reveal
- Vs. computer — alpha-beta minimax over material + pawn advancement + a small knight/bishop centrality bonus, ported from [Giga Chess](../../Documents/ChatGPT/chess%20project/chess.html)'s engine, 3 depth levels (Casual/Club/Sharp), plus a "Master" level backed by real Stockfish — or pass-and-play
- Clock — optional per-side time control (3/5/10/20/30 min presets, or "Custom…" with +/-1 min stepper buttons for any starting time from 1–180 min), silent by default in blindfold mode except for the flag-fall announcement; works vs-computer, pass-and-play, and online. Online clocks are synced through the shared game row (remaining ms + a `last_move_at` anchor) rather than each peer ticking an independent local timer, so both sides agree without any periodic sync write.
- Disambiguation / promotion prompts when a spoken move is ambiguous
- Move narration at terse / standard / verbose levels, speech synthesis toggle
- Board/piece theming, ported from Giga Chess — 5 board themes, 4 piece themes, persisted to localStorage
- Move/capture sound effects, with a synthesized WebAudio fallback if the sample fails to load
- Game state (position, history, settings) persists across reloads via localStorage
- Mobile: no auto-zoom on the text input, no autocorrect mangling notation. v1.0 could only apologise on iOS, which has no `SpeechRecognition` in any browser; 2.0 offers on-device recognition there instead, and selects it automatically when there is no system recogniser at all
- Play online — realtime multiplayer via Supabase, ported from [Giga Chess](../../Documents/ChatGPT/chess%20project/chess.html)'s pattern (its own project, own `mind_chess_games` table). "Play online" in the Opponent select, then "Create online game" and send the invite link. Reconnects automatically on reload, one-click "Rematch" after a game ends (reuses the same game row/link, same opponent, colors always swap — chess-club style). Note: opening the invite link in a second tab of the *same* browser where you're already signed in anonymously rejoins you as yourself, not as an opponent — test with two different browsers/devices, or an incognito window. Also note: `localStorage` (and the anonymous auth session it holds) is shared across *all* tabs of the same browser/origin, not just the invite-link tab — clearing it in one online-mode tab signs every other tab out too.

Requires `supabase-config.js` (committed — it only holds the publishable/anon key, which is safe for the browser, same as Giga Chess's own config file) for online play; everything else works without it.

See [DEVLOG.md](DEVLOG.md) for the session-by-session history and decisions.

## Versions

Both versions stay online, permanently:

| | URL | What it is |
|---|---|---|
| **Current** | https://sportbega.github.io/mind-chess/ | The release. **This is 2.0.** |
| **v1.0 (frozen)** | https://sportbega.github.io/mind-chess/v1/ | A permanent, byte-identical copy of the `v1.0` tag. Never changes. |
| **Preview** | https://sportbega.github.io/mind-chess/v2/ | The `v2` branch, refreshed every session. May run ahead of the release. |

`v1/` is a frozen snapshot kept for reference and comparison — extracted directly from the `v1.0` git tag and verified byte-for-byte. Don't edit it. If it ever needs to change, re-extract it from the tag.

GitHub Pages only serves the default branch, so work on `v2` is invisible until it is copied onto `main`:

```bash
./publish.sh preview    # -> /v2/   after every session
./publish.sh release    # -> /      only when you mean it
```

Both targets copy the same file list from one place, and the script refuses to run if `v2` has a root file the list doesn't mention — shipping a release built from a different set of files than the preview it was tested against is the one mistake this list has already made once.

### ⚠️ Two things 2.0 had to not break — both held

Both versions are served from the **same origin**, so they share browser storage and the same Supabase table. Shipping 2.0 to `/` means someone with a v1.0 game saved there now loads 2.0 — their old game is untouched under the v1.0 key and still opens at `/v1/`.

1. **2.0 namespaces *all* its `localStorage` keys** (`mind-chess-v2-*`). Verified live on `/v1/`, v1.0 writes three: `mind-chess-save-v1`, `mind-chess-board-theme`, `mind-chess-piece-theme`. If 2.0 writes a newer shape to any of them, playing 2.0 and then v1.0 corrupts v1.0 — and vice versa. Give 2.0 its own prefix (e.g. `mind-chess-v2-*`) for every key, not just the save.
2. **Keep the `mind_chess_games` schema backward-compatible**, or v1.0's online mode breaks. Add columns, don't repurpose or remove them.

## Next ideas

Tracked in Linear (project "Mind Chess", team OUR). The 2.0 playbook is complete — A, B, C1/C2, D1 and D2 all shipped; C3 was dropped (C2 covered it) and Phase E ruled out (metered, and it wanted to be the assistant).

Known and open:

- **On-device recognition has never run on an iPhone.** It exists precisely because iOS WebKit has no `SpeechRecognition` at all, and the whole path (`getUserMedia`, `AudioWorklet`, WASM/WebGPU) is available there — but nobody has played a move on a real device.
- **D1's chunk prefetch covers most chunks, not all** — measured 1076 / 46 / 972 / 39 ms, and the alternation isn't explained by the code. Worst case is already a third of what it was, so this is polish.

Real iOS Safari verification (Day 2.6, Simulator via iPhone 17 Pro / iOS 26.5): text input has no auto-zoom or autocorrect mangling, moves apply and the computer opponent replies correctly, board reveal/hide and theming render cleanly at phone width, and game state survives a reload. Not covered: a real physical device, and voice input itself — the Simulator has no mic. That last gap is the one 2.0's on-device recogniser exists to close, and it is still open.
