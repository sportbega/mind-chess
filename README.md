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
- Vs. computer (naive move picker: prefers mate, then captures) or pass-and-play
- Disambiguation / promotion prompts when a spoken move is ambiguous
- Move narration at terse / standard / verbose levels, speech synthesis toggle
- Board visuals carry over the Giga Chess board lineage (wood frame, tournament square colors)

## Next ideas

- Smarter computer opponent (current one is random/greedy, no search)
- Persist game state across reloads
- Mobile mic UX pass
