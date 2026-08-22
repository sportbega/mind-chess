#!/usr/bin/env node
//
// How long after the app stops talking does its own voice come back?
//
//   node tools/echo-timing.js [report.txt ...]     (defaults to tools/reports/*)
//
// tools/echo-threshold.js answers "how much overlap means echo". This answers
// the other half, and it exists because of a bug that overlap alone cannot
// reach: a ONE-WORD echo. echoOverlap() opens with
//
//     if(heard.length<2) return 0;   // a syllable of echo is not an interruption
//
// which means "don't cut the sentence" to considerBargeIn() and "not echo" to
// isTrailingEcho() — so a single word sails through to route(). Every reply the
// app speaks starts "Black plays…" or "White plays…", so the single most likely
// one-word echo in the whole app is exactly the word it says first.
//
// The naive fix — drop the length guard — swallows a legitimate one-word
// recapture, which is one of the most common things in chess. So the separator
// has to be TIME, and time has to be measured rather than picked.
//
// The measurement is already sitting in every problem report: the mic timeline
// timestamps both "narration ended" and each "routing" event, so the gap
// between them is a real observation from a real game, on real hardware, with
// the real recognizer. This reads them back out.
//
// Labelling rule, stated so it can be argued with: a routed transcript counts
// as ECHO if it OPENS with a colour word. Every reply the app speaks starts
// "Black plays…" or "White plays…", and a player never begins a turn that way.
// Everything else is treated as human.
//
// That rule is a heuristic and it has already been wrong once. In the r31 game
// a bare "King" at 1500ms was labelled human; Adni confirmed he never said it —
// it was the app's own castling line coming back. Relabelling it moved the
// answer from 1000ms to 2000ms, so the label matters more than the arithmetic.
//
// Hence: a report may carry a "--- verified labels ---" block naming a
// timestamp and the truth, and a human label always beats the heuristic. Add
// one whenever the player tells you what they did or did not say — that is the
// only source here that actually knows.
// Widened after the r31 release game: the app's own voice does not always come
// back as one word. "black plays Bishop" and "black Place Pawn" were both
// routed there — three-word fragments of "Black plays bishop from …". What is
// constant is the OPENING: every reply the app speaks starts with a colour, and
// a player never begins an utterance that way. So the rule is the first word,
// not the length.
const ECHO_OPENERS = ['black', 'white'];

const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'reports');

let files = process.argv.slice(2).filter(a => !a.startsWith('-'));
if (!files.length) {
  if (!fs.existsSync(dir)) { console.error('no tools/reports/ and no files given'); process.exit(2); }
  files = fs.readdirSync(dir).filter(f => /\.txt$/.test(f)).map(f => path.join(dir, f));
}
if (!files.length) { console.error('no reports found'); process.exit(2); }

const ENDED  = /^\s*\+([\d.]+)s\s+state\s+.*\(narration ended\)/;
const ROUTING = /^\s*\+([\d.]+)s\s+state\s+.*\(routing "(.*)"\)/;

const samples = [];
for (const file of files) {
  const body = fs.readFileSync(file, 'utf8');
  const lines = body.split('\n');
  // Human-confirmed labels, e.g.  "+142.7s  ECHO   # Adni: I didn't say this"
  const verified = {};
  const block = body.split('--- verified labels ---')[1];
  if (block) block.split('\n').forEach(l => {
    const v = /^\s*\+([\d.]+)s\s+(ECHO|HUMAN)\b/.exec(l);
    if (v) verified[v[1]] = v[2];
  });
  let lastEnd = null;
  for (const line of lines) {
    const e = ENDED.exec(line);
    if (e) { lastEnd = parseFloat(e[1]); continue; }
    const r = ROUTING.exec(line);
    if (!r) continue;
    if (lastEnd === null) continue;                 // nothing spoken before it
    const gapMs = Math.round((parseFloat(r[1]) - lastEnd) * 1000);
    if (gapMs < 0) continue;
    const text = r[2];
    const words = text.trim().split(/\s+/).filter(Boolean);
    let isEcho = words.length > 0 && ECHO_OPENERS.includes(words[0].toLowerCase());
    const verdict = verified[r[1]];               // keyed by the "+NNN.Ns" stamp
    if (verdict) isEcho = verdict === 'ECHO';
    samples.push({ file: path.basename(file), gapMs, text, words: words.length,
                   isEcho, confirmed: !!verdict });
  }
}

const echoes = samples.filter(s => s.isEcho);
const humans = samples.filter(s => !s.isEcho);

console.log('=== echo timing ===');
console.log(files.length + ' report(s), ' + samples.length + ' routed utterances after a narration\n');

console.log('  gap      words  kind    transcript          (* = human-confirmed)');
samples.sort((a, b) => a.gapMs - b.gapMs).forEach(s => {
  console.log('  ' + String(s.gapMs + 'ms').padEnd(9) + String(s.words).padEnd(6) +
    ' ' + (s.isEcho ? 'ECHO  ' : 'human ') + (s.confirmed ? '*' : ' ') + ' "' + s.text.slice(0, 44) + '"');
});

if (!echoes.length || !humans.length) {
  console.log('\nNeed at least one of each to say anything about a window.');
  process.exit(0);
}

const slowestEcho = Math.max(...echoes.map(s => s.gapMs));
const fastestHuman = Math.min(...humans.map(s => s.gapMs));
console.log('\nslowest echo   ' + slowestEcho + 'ms');
console.log('fastest human  ' + fastestHuman + 'ms');
console.log('separation     ' + (fastestHuman - slowestEcho) + 'ms\n');

// The window only ever applies to SINGLE-WORD transcripts — a multi-word echo
// is already caught by overlap, and this must not touch anything longer.
console.log('A single-word trailing window would behave like this:\n');
console.log('  window     echoes caught   human replies kept');
const candidates = [500, 800, 1000, 1200, 1500, 1800, 2000, 2500, 3000];
const clean = [];
for (const w of candidates) {
  const caught = echoes.filter(s => s.gapMs <= w).length;
  const kept = humans.filter(s => !(s.words === 1 && s.gapMs <= w)).length;
  const ok = caught === echoes.length && kept === humans.length;
  if (ok) clean.push(w);
  console.log('  ' + String(w + 'ms').padEnd(11) +
    String(caught + '/' + echoes.length).padEnd(16) +
    String(kept + '/' + humans.length).padEnd(8) + (ok ? '  <- clean' : ''));
}

if (clean.length) {
  const mid = clean[Math.floor(clean.length / 2)];
  console.log('\nclean range: ' + clean[0] + '–' + clean[clean.length - 1] + 'ms');
  console.log('midpoint:    ' + mid + 'ms');
  console.log('\n⚠ ' + echoes.length + ' echo sample(s) and ' + humans.length + ' human sample(s).');
  console.log('  A range this wide means the data is thin, not that the choice is safe.');
  console.log('  Add reports to tools/reports/ and re-run before treating it as settled.');
} else {
  console.log('\nNo window separates them. Timing alone is not the answer here.');
}
