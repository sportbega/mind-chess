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

// --index lets a corpus be replayed against a DIFFERENT build of the app:
//
//   git show 8e05ea1:index.html > /tmp/r37.html
//   node tools/corpus-replay.js --index /tmp/r37.html --out _corpus-r37.html
//
// Which turns this into a regression harness. "Did my change alter what the
// app would have done on every game we have ever recorded?" is answerable in
// one diff instead of an argument, and the answer is the shipped scorer's,
// not mine. Added the moment Adni reported a regression I could not otherwise
// have ruled in or out.
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
const indexPath = argOf('--index', path.join(root, 'index.html'));
const outPath = argOf('--out', path.join(root, '_corpus.html'));
// --against <git-ref> builds the comparison page too and wires window.__diff()
// to it, so the whole two-build comparison is ONE browser call instead of
// four. It was four for eleven builds running, and four round-trips is exactly
// the kind of cost that stops a check from being run.
const against = argOf('--against', null);
const files = process.argv.slice(2)
  .filter((a, i, all) => !a.startsWith('-')
    && all[i - 1] !== '--index' && all[i - 1] !== '--out' && all[i - 1] !== '--against');
const corpus = JSON.parse(execFileSync('node',
  [path.join(__dirname, 'corpus.js'), ...files, '--json'], { encoding: 'utf8', maxBuffer: 64e6 }));

const usable = corpus.utterances.filter(u => u.fen && u.heard.length);
if (!usable.length) {
  console.error('nothing to replay: no utterance carries both a position and an alternatives list.');
  console.error('(reports from before v2-r37 have no positions — see tools/corpus.js)');
  process.exit(2);
}

const page = fs.readFileSync(indexPath, 'utf8');
const buildOf = (page.match(/const BUILD='([^']*)'/) || [, '(unknown build)'])[1];

// One handle, injected immediately before the app IIFE closes, so everything
// it names is the real closure binding rather than a copy.
const CLOSE = '\n})();';
if (page.split(CLOSE).length !== 2) {
  throw new Error('Could not find the single app-IIFE close in ' + indexPath + ' — it moved or there are now several.');
}
const HOOK = `
  // ---- injected by tools/corpus-replay.js, never committed ----
  // OLDER BUILDS ARE THE POINT of --against, so nothing here may assume a
  // function that a past index.html did not have. Naming exactTie directly
  // threw a ReferenceError on every build before r45, which took the whole
  // app IIFE down with it and left no __replay at all — the comparison then
  // reported "the previous build never exposed __replay", which is true and
  // says nothing about why.
  const __opt = n => { try { return eval(n); } catch (e) { return null; } };
  window.__replay = {
    game, expandAlternatives, scoreAlternatives, speechKey,
    exactTie: __opt('exactTie'),
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
      // r45 asks instead of moving when two exact readings tie. That decision
      // lives in route(), not the scorer, so a replay that only scored would
      // report a move the app no longer makes. Read it here so the corpus can
      // say how much friction the rule actually adds across every game.
      const tie = (b && b.type === 'move' && window.__replay.exactTie)
        ? window.__replay.exactTie(r.bestText) : null;
      return {
        chose: r.bestText,
        type: tie ? 'asks' : (b ? b.type : 'none'),
        san: (!tie && b && b.type === 'move' && b.move) ? b.move.san : null,
        asks: tie ? [...new Set(tie.map(m => m.piece))].join('/') : null,
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
if (page.indexOf(ANCHOR) === -1) throw new Error('Could not find the app script in ' + indexPath + ' — has its opening changed?');

// Order matters, and got this wrong once: SHIM is itself an IIFE ending in
// "\n})();", so inserting it first makes the CLOSE replacement below land on
// the shim's own closer instead of the app's. Close the app first, then wrap.
let out = page.replace(CLOSE, HOOK + CLOSE).replace(ANCHOR, SHIM + ANCHOR);

// Built first, so the page that iframes it already exists when it loads.
let prevPage = null;
if (against) {
  const { execFileSync: run } = require('child_process');
  const tmp = path.join(root, '_corpus-prev-index.html');
  fs.writeFileSync(tmp, run('git', ['show', against + ':index.html'], { encoding: 'utf8', maxBuffer: 64e6 }));
  run('node', [__filename, ...files, '--index', tmp, '--out', path.join(root, '_corpus-prev.html')],
      { encoding: 'utf8', stdio: 'ignore' });
  fs.unlinkSync(tmp);
  prevPage = '_corpus-prev.html';
}

const DRIVER = `
<script>
window.__BUILD_LABEL = ${JSON.stringify(buildOf)};
// If the app IIFE threw on the way past the hook, say so out loud rather than
// leaving the comparison to guess from an absent handle.
window.addEventListener('error', e => { window.__replayBootError = String(e.message || e); });
window.__PREV_PAGE = ${JSON.stringify(prevPage)};
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
      replayed: nowSan || (got.asks ? 'asks ' + got.asks : got.type),
      drift: (wasSan || u.type) !== (nowSan || got.type),
      meant: u.meant || null,
      score: got.score
    });
  }
  return rows;
};
// Same four classes tools/corpus.js grades with, so a replay and a report can
// be compared without translating between two vocabularies.
window.__grade = function(played, meant){
  if (!meant) return null;
  const moved = /^[A-Za-z][^ ]*$/.test(played) && played !== 'none' && played !== 'command';
  if (meant === 'none') return moved || played === 'command' ? 'intrusion' : 'hit';
  if (!moved) return 'refused';
  return played === meant ? 'hit' : 'wrong';
};
// The comparison, run inside one page: the previous build is loaded in a
// hidden same-origin iframe and driven through its own __replay handle. Both
// scorers are the real ones, in the real files, neither reimplemented.
window.__diff = function(){
  return new Promise(resolve => {
    if (!window.__PREV_PAGE) { resolve({ error: 'built without --against' }); return; }
    const S = { mode: 'computer', coach: 'hints', narration: 'verbose' };
    const f = document.createElement('iframe');
    f.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px';
    f.src = window.__PREV_PAGE;
    f.onload = () => {
      const w = f.contentWindow;
      let tries = 0;
      (function wait(){
        if (w.__replay && w.__runReplay) {
          w.__replay.settings(S);
          const prev = w.__runReplay();
          window.__replay.settings(S);
          const now = window.__runReplay();
          const diffs = [];
          for (let i = 0; i < now.length; i++) {
            const a = prev[i], b = now[i];
            if (!a || a.replayed !== b.replayed) diffs.push({
              report: b.report, n: b.n, said: b.said,
              was: a ? a.replayed : '(not in previous run)', now: b.replayed, meant: b.meant || null
            });
          }
          const label = w.__BUILD_LABEL;
          f.remove();
          resolve({ compared: now.length, from: label, to: window.__BUILD_LABEL, diffs });
          return;
        }
        // The pane clamps timers to about a second, so this is ~20s of grace,
        // not two.
        if (++tries > 20) {
          const why = w.__replayBootError || 'no error was recorded — check the iframe console';
          f.remove();
          resolve({ error: 'the previous build never exposed __replay', because: why });
          return;
        }
        setTimeout(wait, 100);
      })();
    };
    document.body.appendChild(f);
  });
};
window.__replayText = function(){
  const rows = window.__runReplay();
  const w = rows.map(r => {
    const was = window.__grade(r.recorded, r.meant), now = window.__grade(r.replayed, r.meant);
    return ['#' + r.n, JSON.stringify(r.said), r.recorded + ' -> ' + r.replayed
      + (r.drift ? '   DRIFT' : ''), r.meant ? 'meant ' + r.meant + '  [' + was + ' -> ' + now + ']' : ''].join('  ');
  }).join('\\n');
  const tally = which => {
    const c = {};
    for (const r of rows) {
      const g = window.__grade(which === 'before' ? r.recorded : r.replayed, r.meant);
      if (g) c[g] = (c[g] || 0) + 1;
    }
    return Object.keys(c).sort().map(k => k + ' ' + c[k]).join('  ');
  };
  return w
    + '\\n\\n' + rows.filter(r => r.drift).length + ' of ' + rows.length + ' drifted.'
    + '\\n  as played:  ' + (tally('before') || '(nothing labelled)')
    + '\\n  as replayed:' + (tally('after') || '(nothing labelled)');
};
</script>
`;
out = out.replace('</body>', DRIVER + '</body>');

fs.writeFileSync(outPath, out);
const base = path.basename(outPath);
console.log('wrote ' + base + ' — ' + usable.length + ' utterances from '
  + new Set(usable.map(u => u.report)).size + ' report(s)');
console.log('  app:  ' + buildOf);
console.log('open  http://localhost:8934/' + base);
console.log(against
  ? 'then  await window.__diff()      (vs ' + against + ', one call)'
  : 'then  window.__replayText()');
