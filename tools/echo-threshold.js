#!/usr/bin/env node
//
// Does the echo threshold still tell our voice from yours?
//
//   node tools/echo-threshold.js
//
// With "Talk over it" on, the mic stays open while the app talks, so every
// narration comes back in through the microphone. considerBargeIn() decides
// whether a heard phrase is our own voice (ignore it) or the player cutting in
// (stop talking). Getting that wrong in either direction is bad in a different
// way:
//
//   too eager to call it echo  -> a real interruption is swallowed
//   too eager to call it you   -> the app cuts itself off mid-sentence, and
//                                 the tail is then routed as though you said
//                                 it. That is OUR-58 by another door.
//
// Both were observed. On 2026-08-21 a real voice game hit the second: the app
// read "Puzzle 4. Black to play and mate in one. White: king a3." and cut
// itself off on hearing its own "black to play and mate in", then answered it.
// The rule at the time compared only against the chunk *currently* playing,
// and recognition lag means an echo usually arrives a chunk late.
//
// The fix widened the comparison to the recent narration — which raises the
// odds a genuine phrase overlaps ours, so the threshold had to be re-chosen
// rather than kept. This is what chooses it. ECHO_MIN is read out of
// index.html, so the check cannot drift from what ships.
//
// Re-run whenever narration wording changes, or a new spoken phrase is added.

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// The normaliser, lifted whole rather than reimplemented: tables, preprocess(),
// normalize(), speechKey() and phon().
const scope = {};
const from = src.indexOf('  const NATO={');
const to = src.indexOf('\n  }', src.indexOf('function phon(w){')) + 4;
if (from === -1 || to < from) {
  throw new Error('Could not slice the normaliser out of index.html — phon()/NATO moved.');
}
new Function('scope', src.slice(from, to) + '\nscope.phon=phon; scope.speechKey=speechKey;')(scope);
const { phon, speechKey } = scope;

const m = src.match(/const ECHO_MIN\s*=\s*([\d.]+)/);
if (!m) throw new Error('Could not find ECHO_MIN in index.html.');
const SHIPPED = parseFloat(m[1]);

// echoOverlapRaw() is LIFTED from index.html, not reimplemented here.
//
// It used to be a copy, and the copy went stale the moment r36 taught the real
// one to match a truncated square ("d" against our "d4"). A bench that
// reimplements what it measures reports on a version of the app that does not
// exist — the devlog has that lesson from tools/level-ladder.js already, and
// this file had quietly acquired the same fault.
const fromO = src.indexOf('  function echoOverlapRaw(');
const toO = src.indexOf('\n  }', fromO) + 4;
if (fromO === -1 || toO < fromO) throw new Error('Could not slice echoOverlapRaw() out of index.html.');
const makeOverlap = new Function('speechKey', 'phon', 'echoRecent', 'speakingText',
  src.slice(fromO, toO) + '\nreturn echoOverlapRaw;');

function overlap(heard, mineTexts) {
  // Built the way rememberSpoken() builds it, so the shape the real function
  // reads is the shape it gets.
  const echoRecent = mineTexts.map(t => {
    const words = speechKey(t).split(' ').filter(Boolean);
    const codes = {};
    words.forEach(w => { codes[phon(w)] = 1; });
    return { codes, words };
  });
  const h = speechKey(heard).split(' ').filter(Boolean);
  if (h.length < 2) return 0;                 // a syllable of echo is not an interruption
  return makeOverlap(speechKey, phon, echoRecent, '')(heard);
}

// Real narrations the app produces, as the echo window would hold them.
const PUZZLE = ['Puzzle 4. Black to play and mate in one. White: king a3. Black: king c4 and pawn a2.'];
const SOLVED = ['That’s mate. Solved.'];
const MOVES  = ['Pawn to e4.', 'Knight to f3. Check.'];
const BOARD  = ['White: king e1, queen d1, rooks a1 and h1, bishops c1 and f1, knights b1 and g1, pawns a2 b2 c2 d2 e2 f2 g2 and h2.'];
const TIPS   = ['Bishop takes e7. Both queens are off the board now.', 'Rook to f8. 40 moves now with no capture and no pawn move.'];
// Self-triggering messages: saying this while it is still the computer's turn
// is answered by saying it again, so an echo that reaches route() becomes an
// infinite loop. Observed six times in one real game on r26.
const SELF   = ['The computer is thinking.'];
// Added after the r31 release game, where the app cut off its OWN castling
// narration twice. Verbose castling says "king from e1 to g1"; what came back
// was "King for" and "King for me". phon("for") and phon("from") differ, so a
// two-word fragment scores 1/2 = 0.5 — under the shipped 0.6, which reads as
// an interruption. The player never heard the rook.
// r33 dropped the word "from" from verbose narration precisely because of the
// three entries below: no threshold separated them from real interruptions, so
// the phrase changed instead of the number. Kept here with the OLD wording as a
// regression witness — if "from" ever creeps back, this fails again.
const CASTLE_OLD = ['White castles kingside: king from e1 to g1, rook from h1 to f1.'];
const CASTLE = ['White castles kingside: king e1 to g1, rook h1 to f1.'];
const MOVES_D  = ['White plays pawn d2 to d4.'];
const KNIGHT_G = ['Black plays knight g8 to f6.'];

// Things the app said, heard back through the microphone. Must read as echo.
const ECHOES = [
  ['black to play and mate in', PUZZLE],
  ['black to play and mate in one', PUZZLE],
  ['white king a3', PUZZLE],
  ['black king c4 and pawn a2', PUZZLE],
  ['that’s made', SOLVED],
  ['that’s mate solved', SOLVED],
  ['pawn to e4', MOVES],
  ['knight to f3 check', MOVES],
  ['rooks a1 and h1', BOARD],
  ['both queens are off the board now', TIPS],
  ['no capture and no pawn move', TIPS],
  ['the computer is thinking', SELF],
  ['computer is thinking', SELF],
  ['is thinking', SELF],
  ['the computer is stinking', SELF],
  ['king e1 to g1', CASTLE],
  ['rook h1 to f1', CASTLE],
  ['castles kingside king e1 to g1', CASTLE],
  // Truncated echoes: the recogniser cuts the square in half. All three were
  // observed cutting the app off mid-sentence before r36.
  ['pawn to d', MOVES_D],
  ['night g', KNIGHT_G],
  ['plays night g', KNIGHT_G],
];

// Things a player says while the app is talking. Must read as an interruption.
const REAL = [
  ['stop stop stop', PUZZLE],
  ['rook to a8', PUZZLE],
  ['what is on e4', PUZZLE],
  ['no not that', PUZZLE],
  ['next puzzle', PUZZLE],
  ['show me the solution', PUZZLE],
  ['what can I take', BOARD],
  ['how am I doing', BOARD],
  ['queen takes f7', MOVES],
  ['take back', MOVES],
  ['anything hanging', BOARD],
  ['knight to c6', MOVES],
  ['is my king safe', BOARD],
  ['coach off', TIPS],
  ['tips off', TIPS],
];

const caught = th => ECHOES.filter(([t, n]) => overlap(t, n) >= th).length;
const kept   = th => REAL.filter(([t, n]) => overlap(t, n) < th).length;

console.log('ECHO_MIN in index.html: ' + SHIPPED + '\n');
console.log('threshold   echo caught   interruptions kept');
const good = [];
for (let th = 0.40; th <= 0.85001; th += 0.05) {
  const r = Math.round(th * 100) / 100;
  const e = caught(r), k = kept(r);
  const clean = (e === ECHOES.length && k === REAL.length);
  if (clean) good.push(r);
  console.log('  ' + r.toFixed(2) + '        ' + String(e).padStart(2) + '/' + ECHOES.length +
              '          ' + String(k).padStart(2) + '/' + REAL.length + (clean ? '   <- clean' : '') +
              (Math.abs(r - SHIPPED) < 1e-9 ? '   <== shipped' : ''));
}

const missedEcho = ECHOES.filter(([t, n]) => overlap(t, n) < SHIPPED);
const swallowed  = REAL.filter(([t, n]) => overlap(t, n) >= SHIPPED);

if (missedEcho.length) {
  console.log('\nOur own voice NOT recognised as echo at ' + SHIPPED + ' (app will cut itself off, then route it):');
  missedEcho.forEach(([t, n]) => console.log('  ' + Math.round(overlap(t, n) * 100) + '%  "' + t + '"'));
}
if (swallowed.length) {
  console.log('\nReal interruptions swallowed as echo at ' + SHIPPED + ' (player cannot cut in by voice):');
  swallowed.forEach(([t, n]) => console.log('  ' + Math.round(overlap(t, n) * 100) + '%  "' + t + '"'));
}

if (!missedEcho.length && !swallowed.length) {
  console.log('\nClean at the shipped threshold: every echo caught, every interruption preserved.');
  if (good.length) console.log('Range that works: ' + good[0] + ' to ' + good[good.length - 1] + '.');
} else {
  console.log('\nThe shipped threshold does not separate the two classes.');
  if (good.length) console.log('These would: ' + good.join(', ') + '.');
  else console.log('No threshold separates them — the phrases themselves need attention, not the number.');
  process.exit(1);
}
