# Mind Chess

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
- Vs. computer — alpha-beta minimax over material + pawn advancement, ported from [Giga Chess](../../Documents/ChatGPT/chess%20project/chess.html)'s engine, 3 depth levels (Casual/Club/Sharp), plus a "Master" level backed by real Stockfish — or pass-and-play
- Clock — optional per-side time control (3/5/10 min presets), silent by default in blindfold mode except for the flag-fall announcement; vs-computer and pass-and-play only for now (not synced for online games yet)
- Disambiguation / promotion prompts when a spoken move is ambiguous
- Move narration at terse / standard / verbose levels, speech synthesis toggle
- Board/piece theming, ported from Giga Chess — 5 board themes, 4 piece themes, persisted to localStorage
- Move/capture sound effects, with a synthesized WebAudio fallback if the sample fails to load
- Game state (position, history, settings) persists across reloads via localStorage
- Mobile: accurate messaging when voice input isn't available (iOS has no `SpeechRecognition` in any browser), no auto-zoom on the text input, no autocorrect mangling notation
- Play online — realtime multiplayer via Supabase, ported from [Giga Chess](../../Documents/ChatGPT/chess%20project/chess.html)'s pattern (its own project, own `mind_chess_games` table). "Play online" in the Opponent select, then "Create online game" and send the invite link. Reconnects automatically on reload, one-click "Rematch" after a game ends (reuses the same game row/link, same opponent, colors unchanged). Note: opening the invite link in a second tab of the *same* browser where you're already signed in anonymously rejoins you as yourself, not as an opponent — test with two different browsers/devices, or an incognito window.

Requires `supabase-config.js` (committed — it only holds the publishable/anon key, which is safe for the browser, same as Giga Chess's own config file) for online play; everything else works without it.

See [DEVLOG.md](DEVLOG.md) for the session-by-session history and decisions.

## Next ideas

Tracked in Linear (project "Mind Chess", team OUR):
- Color-swap on rematch (needs a look at the `mind_chess_games` RLS policies, which were written for create/join, not a same-row reset)
- Lobby / open-games list, spectator mode for online games
- Synced clock for online games (needs move-timestamp sync through the shared game row)
- Real iOS Safari verification (blocked on this machine only having Xcode Command Line Tools, not the full Xcode the Simulator needs)
