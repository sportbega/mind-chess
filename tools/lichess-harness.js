#!/usr/bin/env node
//
// Build the Lichess test harness:  node tools/lichess-harness.js
//
// Writes _lichess-harness.html — index.html with tools/fake-lichess.js
// injected ahead of the app, so milestone 4's reconnect/backoff, FEN
// reconciliation, and resign/abort can be driven and dropped on demand
// instead of waited for during a real game.
//
// The output is generated, never committed (see .gitignore) and never
// drifts, because it is rebuilt from the current index.html every time.
//
// Usage: serve the repo root (e.g. `python3 -m http.server 8934`), open
//   http://localhost:8934/_lichess-harness.html
// then drive it from the console:
//   modeSelect.value='lichess'; modeSelect.dispatchEvent(new Event('change'));
//   lichessTokenInput.value='x'; lichessSaveTokenBtn.click();
//   lichessWatchBtn.click();                    // triggers /api/account/playing
//   __fakeLichess.setPlaying([{gameId:'g1', fen: new Chess().fen()}]);
//   // now click Resume again, or re-trigger watchLichessGame() by hand —
//   // it will open the stream, at which point:
//   __fakeLichess.gameFull('g1', {color:'w'});
//   __fakeLichess.gameState('g1', {moves:'e2e4', status:'started'});
//   __fakeLichess.dropStream('g1');             // watch it reconnect
//
// No mic fake is layered in here on purpose — the app's typed-move box
// (textInput/textForm) exercises applyMove()/sendLichessMove() exactly the
// way a voice command does, without needing a fake recognizer at all. Pair
// with tools/voice-harness.js's fake-recognizer.js by hand if a scenario
// specifically needs both at once.

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const fake = fs.readFileSync(path.join(__dirname, 'fake-lichess.js'), 'utf8');

const ANCHOR = '<script>\n(function(){\n  "use strict";';
const at = page.indexOf(ANCHOR);
if (at === -1) throw new Error('Could not find the app script in index.html — has its opening changed?');

const out = page.slice(0, at) + '<script>\n' + fake + '\n</script>\n' + page.slice(at);

fs.writeFileSync(path.join(root, '_lichess-harness.html'), out);
console.log('wrote _lichess-harness.html');
console.log('open  http://localhost:8934/_lichess-harness.html');
