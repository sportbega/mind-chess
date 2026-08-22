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
// as ECHO if it is a single word the app says in its own narration but a player
// would never utter alone as a whole turn — the colour words. Everything else
// is treated as a human utterance. If that rule is ever wrong for a new report,
// change it here rather than quietly reclassifying by hand.
const ECHO_WORDS = ['black', 'white'];

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
  const lines = fs.readFileSync(file, 'utf8').split('\n');
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
    const isEcho = words.length === 1 && ECHO_WORDS.includes(words[0].toLowerCase());
    samples.push({ file: path.basename(file), gapMs, text, words: words.length, isEcho });
  }
}

const echoes = samples.filter(s => s.isEcho);
const humans = samples.filter(s => !s.isEcho);

console.log('=== echo timing ===');
console.log(files.length + ' report(s), ' + samples.length + ' routed utterances after a narration\n');

console.log('  gap      words  kind    transcript');
samples.sort((a, b) => a.gapMs - b.gapMs).forEach(s => {
  console.log('  ' + String(s.gapMs + 'ms').padEnd(9) + String(s.words).padEnd(6) +
    ' ' + (s.isEcho ? 'ECHO  ' : 'human ') + '  "' + s.text.slice(0, 44) + '"');
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
