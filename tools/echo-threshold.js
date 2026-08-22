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

// heardTokens() is LIFTED too, along with the NOISE_SQUARE it reads. r44 moved
// part of the scoring into it — the filter that drops a square come back with
// an impossible file ("V8" for our "b8") — and a bench that kept its own copy
// of that filter would be measuring a denominator the app does not use. Same
// fault r36 found here; the answer is the same: take the real one.
const fromT = src.indexOf('  const NOISE_SQUARE=');
const toT = src.indexOf('\n  }', src.indexOf('  function heardTokens(', fromT)) + 4;
if (fromT === -1 || toT < fromT) throw new Error('Could not slice heardTokens()/NOISE_SQUARE out of index.html.');
const makeTokens = new Function('speechKey', src.slice(fromT, toT) + '\nreturn heardTokens;');
const heardTokens = makeTokens(speechKey);

const makeOverlap = new Function('speechKey', 'phon', 'echoRecent', 'speakingText', 'heardTokens',
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
  // The app's own filter, not a copy of it.
  const h = heardTokens(heard);
  if (h.length < 2) return 0;                 // a syllable of echo is not an interruption
  return makeOverlap(speechKey, phon, echoRecent, '', heardTokens)(heard);
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
// The one that got through. Observed on r40: the app cut its own castling
// announcement, Chrome spent six seconds revising the audio, and the finished
// transcript arrived at +6.2s — past ECHO_TAIL_MS — and was routed, so the app
// answered itself with "Castling isn't legal right now."
const CASTLE_BLACK = ['Black castles kingside: king e8 to g8, rook h8 to f8.'];
const MOVES_D  = ['White plays pawn d2 to d4.'];
const KNIGHT_G = ['Black plays knight g8 to f6.'];
// r43, live: the app cut its own sentence on "night V8". The square came back
// with a file that does not exist, so the fragment scored 1/2 = 0.5. The r36
// rule covers a square cut SHORT ("d" for "d4"); this is a square come back
// WRONG, and it needs the noise token out of the denominator.
const KNIGHT_B = ['Black plays knight b8 to c6.'];
// r45, live: "black boys" for our "Black plays" cut off the word "Check."
// Neither a truncation nor an impossible square — two ordinary words that
// simply differ. The colour opener is what separates it.
const BISHOP_CHECK = ['Black plays bishop a1 to c3. Captures the knight. Check.'];

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
  ['black castles kingside king', CASTLE_BLACK],
  ['night V8', KNIGHT_B],
  ['black boys', BISHOP_CHECK],
  ['black plays the night', BISHOP_CHECK],
  ['black plays night V8 to C6', KNIGHT_B],
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

// ---------------------------------------------------------------- late echo
//
// ECHO_TAIL_MS bounds how long after we stop speaking an echo may still
// arrive. In a real game on r40, Chrome spent SIX SECONDS revising a single
// utterance before finalising it, so the app's own castling announcement came
// back at +6.2s, sailed past the window, reached route(), and was answered
// with "Castling isn't legal right now."
//
// Widening the window is not available: tools/echo-timing.js reports "No
// window separates them" on the same data, because genuine replies start
// arriving around 2.5s.
//
// So the separator has to be something other than time. The claim under test:
// a LONG phrase that is ENTIRELY ours is not something a player says. If that
// holds, a late arrival can be judged on content alone, and the corpora below
// are exactly the population to check it against.
const LONG_WORDS = 4;
const wordsOf = t => heardTokens(t).length;

function lateReport() {
  const longEcho = ECHOES.filter(([t]) => wordsOf(t) >= LONG_WORDS).map(([t, n]) => ({ t, o: overlap(t, n) }));
  const longReal = REAL.filter(([t]) => wordsOf(t) >= LONG_WORDS).map(([t, n]) => ({ t, o: overlap(t, n) }));
  console.log('\n--- late-echo rule: >= ' + LONG_WORDS + ' words, judged on overlap alone ---');
  console.log('  our own voice, long phrases:   ' + longEcho.length + ' of ' + ECHOES.length);
  console.log('  real interruptions, long:      ' + longReal.length + ' of ' + REAL.length);
  if (!longEcho.length || !longReal.length) { console.log('  not enough long phrases to choose a threshold.'); return; }
  const lo = Math.min(...longEcho.map(x => x.o)), hi = Math.max(...longReal.map(x => x.o));
  console.log('  lowest scoring long ECHO:      ' + lo.toFixed(2) + '  "' + longEcho.find(x => x.o === lo).t + '"');
  console.log('  highest scoring long INTERRUPT:' + hi.toFixed(2) + '  "' + longReal.find(x => x.o === hi).t + '"');
  if (lo > hi) {
    console.log('  → separated. Any threshold in (' + hi.toFixed(2) + ', ' + lo.toFixed(2) + '] works;');
    console.log('    the shipped ECHO_LATE_MIN should sit near the top of that band, because');
    console.log('    the cost of being wrong here is swallowing a move, not a sentence.');
  } else {
    console.log('  → NOT separated. Length plus overlap is not enough either; do not ship this rule.');
  }
}

// What the app actually decides, not the raw number it decides with.
//
// considerBargeIn() has TWO steps, and r44 made the difference matter: a
// transcript that filters down to fewer than two meaningful tokens is dropped
// outright and never reaches the threshold at all. "night V8" is exactly that
// — the noise token goes, "night" is left, and the sentence survives no matter
// what ECHO_MIN is. Scoring it as raw overlap reported 0% and called it a
// missed echo, which is the bench describing a decision the app does not make.
//
// Mirrored rather than lifted because the real function ends in cancelSpeech()
// and micEvent(). It is two lines; if considerBargeIn() changes shape, change
// this with it.
const cuts = (th, t, n) => {
  const o = overlap(t, n);
  if (o === 0 && heardTokens(t).length < 2) return false;   // dropped, never an interruption
  return o < th;
};
const caught = th => ECHOES.filter(([t, n]) => !cuts(th, t, n)).length;
const kept   = th => REAL.filter(([t, n]) => cuts(th, t, n)).length;

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

const missedEcho = ECHOES.filter(([t, n]) => cuts(SHIPPED, t, n));
const swallowed  = REAL.filter(([t, n]) => !cuts(SHIPPED, t, n));

if (missedEcho.length) {
  console.log('\nOur own voice NOT recognised as echo at ' + SHIPPED + ' (app will cut itself off, then route it):');
  missedEcho.forEach(([t, n]) => console.log('  ' + Math.round(overlap(t, n) * 100) + '%  "' + t + '"'));
}
if (swallowed.length) {
  console.log('\nReal interruptions swallowed as echo at ' + SHIPPED + ' (player cannot cut in by voice):');
  swallowed.forEach(([t, n]) => console.log('  ' + Math.round(overlap(t, n) * 100) + '%  "' + t + '"'));
}

lateReport();

if (!missedEcho.length && !swallowed.length) {
  console.log('\nClean at the shipped threshold: every echo caught, every interruption preserved.');
  if (good.length) console.log('Range that works: ' + good[0] + ' to ' + good[good.length - 1] + '.');
} else {
  console.log('\nThe shipped threshold does not separate the two classes.');
  if (good.length) console.log('These would: ' + good.join(', ') + '.');
  else console.log('No threshold separates them — the phrases themselves need attention, not the number.');
  process.exit(1);
}
