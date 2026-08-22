#!/usr/bin/env node
//
// Re-run recorded utterances through the real scorer, at the real positions.
//
//   node tools/corpus-replay.js [report.txt ...]
//   open http://localhost:8934/_corpus.html      then window.__runReplay()
//
// From v2-r37 every utterance in a problem report carries the FEN it was
// spoken into, which is the whole reason this can exist: the scorer's job is
// ranking a transcript against the legal moves, so a transcript without its
// position could be read but never re-run.
//
// WHAT IS REAL HERE AND WHAT IS NOT
//
// Real: index.html itself, unmodified except for one exported handle. The
// replay drives `expandAlternatives()` and `scoreAlternatives()` — the shipped
// functions, in the shipped file. Nothing is reimplemented, which is the fault
// r36 found in echo-threshold.js and Day 3 found in level-ladder.js.
//
// Not real: this replays the SCORER, not route(). An utterance that answered a
// pending question ("kingside or queenside?") took a different path in the
// game and will not reproduce here. And matchCommand()/matchQuestion() read
// app settings — coach, mode, verbosity — which the harness sets from the
// report where it can. Any utterance whose replay disagrees with what the game
// recorded is printed as a DRIFT rather than quietly swallowed: it means the
// harness is not modelling the game, and that is worth knowing on its own.
//
// The parser is not duplicated either — this shells out to tools/corpus.js
// --json and replays whatever that returns.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');

const files = process.argv.slice(2).filter(a => !a.startsWith('-'));
const corpus = JSON.parse(execFileSync('node',
  [path.join(__dirname, 'corpus.js'), ...files, '--json'], { encoding: 'utf8', maxBuffer: 64e6 }));

const usable = corpus.utterances.filter(u => u.fen && u.heard.length);
if (!usable.length) {
  console.error('nothing to replay: no utterance carries both a position and an alternatives list.');
  console.error('(reports from before v2-r37 have no positions — see tools/corpus.js)');
  process.exit(2);
}

const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// One handle, injected immediately before the app IIFE closes, so everything
// it names is the real closure binding rather than a copy.
const CLOSE = '\n})();';
if (page.split(CLOSE).length !== 2) {
  throw new Error('Could not find the single app-IIFE close in index.html — it moved or there are now several.');
}
const HOOK = `
  // ---- injected by tools/corpus-replay.js, never committed ----
  window.__replay = {
    game, expandAlternatives, scoreAlternatives, speechKey,
    settings(s){
      // Only the settings the scorer can see. Anything else is decoration and
      // pretending otherwise would make the harness look more faithful than
      // it is.
      if(s.mode) { mode = s.mode; }
      if(s.coach) { coach = s.coach; }
      if(s.narration) { verbosity = s.narration; }
    },
    score(fen, alts){
      game.load(fen);
      const list = expandAlternatives(alts.slice());
      const r = scoreAlternatives(list);
      const b = r.best;
      return {
        chose: r.bestText,
        type: b ? b.type : 'none',
        san: (b && b.type === 'move' && b.move) ? b.move.san : null,
        score: b ? Math.round(b.score * 100) / 100 : null
      };
    }
  };
`;

// The app shares localStorage with the real page on the same origin, and this
// harness loads arbitrary FENs into `game`. Keeping storage in memory means a
// replay can never leave a half-finished position behind for the real app to
// restore — a trap this project has already walked into once.
const SHIM = `<script>
(function(){
  const mem = Object.create(null);
  const fake = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
    clear: () => { for (const k in mem) delete mem[k]; },
    key: i => Object.keys(mem)[i] ?? null,
    get length(){ return Object.keys(mem).length; }
  };
  Object.defineProperty(window, 'localStorage', { get: () => fake, configurable: true });
})();
</script>
`;

const ANCHOR = '<script>\n(function(){\n  "use strict";';
if (page.indexOf(ANCHOR) === -1) throw new Error('Could not find the app script in index.html — has its opening changed?');

// Order matters, and got this wrong once: SHIM is itself an IIFE ending in
// "\n})();", so inserting it first makes the CLOSE replacement below land on
// the shim's own closer instead of the app's. Close the app first, then wrap.
let out = page.replace(CLOSE, HOOK + CLOSE).replace(ANCHOR, SHIM + ANCHOR);

const DRIVER = `
<script>
window.__corpus = ${JSON.stringify(usable)};
window.__runReplay = function(){
  const R = window.__replay;
  const rows = [];
  for (const u of window.__corpus) {
    let got;
    try { got = R.score(u.fen, u.heard.map(h => h.text)); }
    catch (e) { got = { type: 'THREW', san: null, chose: String(e && e.message || e) }; }
    const wasSan  = u.type === 'move' ? u.san : null;
    const nowSan  = got.type === 'move' ? got.san : null;
    rows.push({
      report: u.report, n: u.n,
      said: u.chose,
      recorded: wasSan || u.type,
      replayed: nowSan || got.type,
      drift: (wasSan || u.type) !== (nowSan || got.type),
      meant: u.meant || null,
      score: got.score
    });
  }
  return rows;
};
window.__replayText = function(){
  const rows = window.__runReplay();
  const w = rows.map(r => ['#' + r.n, JSON.stringify(r.said), r.recorded + ' -> ' + r.replayed
    + (r.drift ? '   DRIFT' : ''), r.meant ? 'meant ' + r.meant : ''].join('  ')).join('\\n');
  return w + '\\n\\n' + rows.filter(r => r.drift).length + ' of ' + rows.length + ' drifted.';
};
</script>
`;
out = out.replace('</body>', DRIVER + '</body>');

const dest = path.join(root, '_corpus.html');
fs.writeFileSync(dest, out);
console.log('wrote _corpus.html — ' + usable.length + ' utterances from '
  + new Set(usable.map(u => u.report)).size + ' report(s)');
console.log('open  http://localhost:8934/_corpus.html');
console.log('then  window.__replayText()');
