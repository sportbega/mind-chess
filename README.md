# Mind Chess

**Live:** https://sportbega.github.io/mind-chess/ — public, hosted on GitHub Pages (same setup as Giga Chess), no install needed. Share this link with testers.

Browser chess with a voice / blindfold mode — play by speaking moves ("e4", "knight to f3", "queen takes e5", "castle kingside") while the board stays hidden, or reveal it any time.

Mostly single-file: `index.html`. Uses [chess.js](https://github.com/jhlywa/chess.js) (via CDN) for rules/legality and the Web Speech API (Chrome/Edge) for recognition + narration. No build step. The "Master" level self-hosts real [Stockfish](https://github.com/nmrugg/stockfish.js) (18 Lite, single-threaded WASM, ~7.3MB) alongside `index.html` as `stockfish-18-lite-single.js`/`.wasm` — lazy-loaded, so it only downloads once "Master" is actually selected.

## Run locally

Speech recognition needs a real origin (not `file://`), so serve it:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000

## Status

Day 2 — promoted from three prototype iterations (see git history / `Downloads/mind-chess*.html` for earlier snapshots) into a real project. Current feature set:

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
- Mobile: accurate messaging when voice input isn't available (iOS has no `SpeechRecognition` in any browser), no auto-zoom on the text input, no autocorrect mangling notation
- Play online — realtime multiplayer via Supabase, ported from [Giga Chess](../../Documents/ChatGPT/chess%20project/chess.html)'s pattern (its own project, own `mind_chess_games` table). "Play online" in the Opponent select, then "Create online game" and send the invite link. Reconnects automatically on reload, one-click "Rematch" after a game ends (reuses the same game row/link, same opponent, colors always swap — chess-club style). Note: opening the invite link in a second tab of the *same* browser where you're already signed in anonymously rejoins you as yourself, not as an opponent — test with two different browsers/devices, or an incognito window. Also note: `localStorage` (and the anonymous auth session it holds) is shared across *all* tabs of the same browser/origin, not just the invite-link tab — clearing it in one online-mode tab signs every other tab out too.

Requires `supabase-config.js` (committed — it only holds the publishable/anon key, which is safe for the browser, same as Giga Chess's own config file) for online play; everything else works without it.

See [DEVLOG.md](DEVLOG.md) for the session-by-session history and decisions.

## Versions

Both versions stay online, permanently:

| | URL | What it is |
|---|---|---|
| **Current** | https://sportbega.github.io/mind-chess/ | The latest version. Right now that's v1.0; it becomes 2.0 when 2.0 ships. |
| **v1.0 (frozen)** | https://sportbega.github.io/mind-chess/v1/ | A permanent, byte-identical copy of the `v1.0` tag. Never changes. |

`v1/` is a frozen snapshot kept for reference and comparison — extracted directly from the `v1.0` git tag and verified byte-for-byte. Don't edit it. If it ever needs to change, re-extract it from the tag.

**2.0** targets the voice layer: recognition accuracy, continuous listening, natural speech, and an engine-backed board assistant you can ask about the position — all at zero running cost. See [VOICE-2.0-PLAYBOOK.md](VOICE-2.0-PLAYBOOK.md) for the full plan.

### ⚠️ Two things 2.0 must not break

Both versions are served from the **same origin**, so they share browser storage and the same Supabase table:

1. **2.0 must use a different `localStorage` key.** v1.0 saves to `mind-chess-save-v1`. If 2.0 writes a newer shape to that same key, opening 2.0 and then v1.0 corrupts v1.0's saved game — and vice versa. 2.0 gets its own key.
2. **Keep the `mind_chess_games` schema backward-compatible**, or v1.0's online mode breaks. Add columns, don't repurpose or remove them.

## Next ideas

Tracked in Linear (project "Mind Chess", team OUR) — currently empty; nothing open as of Day 2.6.

Real iOS Safari verification (Day 2.6, Simulator via iPhone 17 Pro / iOS 26.5): confirmed working — the iOS-specific no-`SpeechRecognition` message shows correctly (rather than the old wrong "switch to Chrome/Edge" text), text input has no auto-zoom or autocorrect mangling, moves apply and the computer opponent replies correctly, board reveal/hide and theming render cleanly at phone width, and game state (position + revealed/hidden state) survives a reload. Not covered: a real physical device, and voice input itself (Simulator has no mic/speech pipeline — Apple's WebKit limitation on iOS means this was never expected to work there anyway).
