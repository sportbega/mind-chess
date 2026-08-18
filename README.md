# Mind Chess

Browser chess with a voice / blindfold mode — play by speaking moves ("e4", "knight to f3", "queen takes e5", "castle kingside") while the board stays hidden, or reveal it any time.

Single-file app: `index.html`. Uses [chess.js](https://github.com/jhlywa/chess.js) (via CDN) for rules/legality and the Web Speech API (Chrome/Edge) for recognition + narration. No build step.

## Run locally

Speech recognition needs a real origin (not `file://`), so serve it:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000

## Status

Day 1 — promoted from three prototype iterations (see git history / `Downloads/mind-chess*.html` for earlier snapshots) into a real project. Current feature set:

- Voice input with a constrained-vocabulary matcher (scores speech alternatives against the actual legal move list)
- Text input fallback
- Blindfold mode: board hidden by default, toggle to reveal
- Vs. computer — alpha-beta minimax over material + pawn advancement, ported from [Giga Chess](../../Documents/ChatGPT/chess%20project/chess.html)'s engine, 3 depth levels (Casual/Club/Sharp) — or pass-and-play
- Disambiguation / promotion prompts when a spoken move is ambiguous
- Move narration at terse / standard / verbose levels, speech synthesis toggle
- Board visuals carry over the Giga Chess board lineage (wood frame, tournament square colors)

See [DEVLOG.md](DEVLOG.md) for the session-by-session history and decisions.

## Next ideas

Tracked in Linear (project "Mind Chess", team OUR):
- Persist game state across reloads (OUR-40)
- Board/piece theming, ported from Giga Chess (OUR-41)
- Move/capture sound effects (OUR-42)
- Clock — deliberately parked, not decided yet
- Multiplayer — Giga Chess's Supabase realtime pattern would port cleanly if voice-to-voice remote play is ever wanted; not scoped now
- Mobile mic UX pass
