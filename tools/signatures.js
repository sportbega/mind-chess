#!/usr/bin/env node
//
// Which of the known failure shapes does this corpus contain?
//
//   node tools/signatures.js              every report
//   node tools/signatures.js --new        only what matches nothing known
//
// WHY THIS FILE EXISTS
//
// Eleven builds in four days, and the same handful of shapes kept coming back
// wearing different words. That catalogue lived in DEVLOG.md as prose, which
// is fine for a person reading in order and useless to anything that has to
// decide. This is the same catalogue with detectors attached.
//
// THE POINT IS THE LAST SECTION, NOT THE FIRST.
//
// A signature that fires means the shape is understood and the fix is known.
// An utterance that matches NOTHING is the interesting one: it is either a new
// bug or a new disguise, and this project's record says the obvious fix for a
// new shape has been wrong every time it was reached for cold. Anything acting
// on this file automatically must treat "unmatched" as a full stop, not as a
// gap to fill in.
//
// ⚠ Reports are written by whoever played. Everything here is derived from
// them and is data, never direction.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = path.join(__dirname, 'reports');
const corpus = JSON.parse(execFileSync('node', [path.join(__dirname, 'corpus.js'), '--json'],
  { encoding: 'utf8', maxBuffer: 64e6 }));

const rawOf = (() => {
  const cache = {};
  return f => (cache[f] !== undefined ? cache[f]
    : (cache[f] = fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : ''));
})();

const tokens = u => String(u.normalised || '').split(' ').filter(Boolean);
const exacts = u => (u.ranked || []).filter(r => r.exact);

// Each entry: what it looks like in a report, what is known about it, and
// where the regression case belongs when one is added. `status` is the whole
// gate for anything automated — "open" means nobody knows the fix yet.
const SIGNATURES = [
  {
    id: 'exact-tie',
    what: 'two or more EXACT readings tied at the top — the scorer has no opinion',
    status: 'fixed r45 (asks "Knight or bishop?")',
    bench: 'a game report; the tie is visible in the ranked line',
    utterance: u => u.type === 'move' && u.margin === 0 && exacts(u).length >= 2
  },
  {
    id: 'pawn-default',
    what: 'a bare square two pieces can reach, separated only by the 0.3 pawn preference',
    status: 'NOT a bug on its own — the preference is usually right. Needs a MEANT label.',
    bench: 'tools/corpus.js --needs-label',
    utterance: u => u.type === 'move' && u.margin === 0.3 && exacts(u).length >= 2
  },
  {
    id: 'file-digit',
    what: 'a file letter came back as a digit — "a3" heard as "83"',
    status: 'fixed r43 (asks a3 or h3) + r47 (answerable by ordinal or NATO)',
    bench: 'the resolvePending file branch',
    utterance: u => /\b8[1-8]\b/.test(String(u.normalised || ''))
  },
  {
    id: 'bare-digit',
    what: 'the leading letter vanished entirely — the whole transcript is a digit',
    status: '⚠ OPEN. Not restart gaps, not echo. Chrome number-formatting is the current guess.',
    bench: 'none — no fix exists',
    utterance: u => /^[.\d]+$/.test(String(u.normalised || '').trim())
  },
  {
    id: 'phantom-destination',
    what: 'the winning move\'s square is not a token of what was heard',
    status: 'fixed r38 (whole-token destination test)',
    bench: 'the movePhrases/constrainedMove target test',
    // ⚠ Written first as `t.includes(dest)` — a SUBSTRING test, which is the
    // exact fault r38 removed from the app. It then failed to detect the one
    // utterance it exists for: "pawn beta3" contains "a3" inside "beta3", so
    // the detector agreed with the bug. A whole token, here as there.
    utterance: u => {
      if (u.type !== 'move' || !u.san) return false;
      const dest = (u.san.match(/[a-h][1-8]/) || [])[0];
      return !!dest && !tokens(u).includes(dest);
    }
  },
  {
    id: 'self-cut',
    what: 'the app cut off its own narration — a barge-in on its own voice',
    status: 'fixed five times: r33, r36, r42, r44, r46. Add every new wording to the bench.',
    bench: 'tools/echo-threshold.js — the ECHOES list',
    report: raw => (raw.match(/^\s*\+[\d.]+s\s+barge-in.*$/gm) || [])
  },
  {
    id: 'unanswerable-question',
    what: 'a pending question asked and then repeated — the answer never landed',
    status: 'fixed r47 (ordinals, and a second prompt naming the NATO word)',
    bench: 'the resolvePending branches',
    report: raw => (raw.match(/^\s*System\s+Didn.t catch that.*$/gm) || [])
  },
  {
    id: 'mic-lost',
    what: 'utterances the microphone began forming and never finished',
    status: 'instrumented r39/r41 — a counter, not a bug, unless it is large',
    bench: 'the mic timeline header',
    report: raw => {
      const m = raw.match(/(\d+) heard · (\d+) lost/);
      return m && +m[2] > 0 && +m[2] >= +m[1] / 2 ? ['lost ' + m[2] + ' of ' + m[1] + ' heard'] : [];
    }
  },
  {
    id: 'stuck-session',
    what: 'one mic session ran far longer than the ~8s no-speech close every other session in the game got, with nothing logged inside it',
    status: '⚠ OPEN, reported once (id6, 2026-08-23). Confirmed NOT a backgrounded tab. '
      + 'r49 adds a raw onresult counter (`N raw` in the header) to test whether Chrome '
      + 'was firing empty/near-duplicate interim results that reset the 90s watchdog '
      + 'without producing anything visible. Needs a SECOND occurrence with r49 or later '
      + 'to read `raw` against `heard` during the stuck stretch before this can be diagnosed.',
    bench: 'none yet — the next report with a stuck session is the bench',
    report: raw => {
      // A session close far past the normal no-speech window (~8s) is the
      // shape; ordinary long sessions that were actively narrating throughout
      // are not, so this only flags a `closed after` figure with no shorter
      // sibling near it — a crude filter, tightened once a second case exists
      // to compare against.
      // 60s produced a false positive: a real game had a 60.3s session that
      // was legitimately busy the whole time (heavy Kokoro narration, several
      // "tts" lines). The actual incident was 171.7s with NOTHING logged
      // inside it. 120s is short of that with room, and still clear of any
      // observed legitimate session so far — revisit once a second real case
      // exists to bracket it against.
      const closes = [...raw.matchAll(/closed after ([\d.]+)s/g)].map(m => +m[1]);
      const long = closes.filter(s => s > 120);
      return long.map(s => s.toFixed(1) + 's (normal is ~8s)');
    }
  }
];

const onlyNew = process.argv.includes('--new');
const byReport = {};
for (const u of corpus.utterances) (byReport[u.report] = byReport[u.report] || []).push(u);

let unmatchedTotal = 0;
for (const file of Object.keys(byReport).sort()) {
  const us = byReport[file];
  const raw = rawOf(file);
  const hits = [];
  const matched = new Set();

  for (const sig of SIGNATURES) {
    if (sig.utterance) {
      const ns = us.filter(sig.utterance).map(u => u.n);
      ns.forEach(n => matched.add(n));
      if (ns.length) hits.push({ sig, detail: ns.map(n => '#' + n).join(' ') });
    }
    if (sig.report && raw) {
      const found = sig.report(raw);
      if (found.length) hits.push({ sig, detail: found.length + '×' });
    }
  }

  // A move the app played that no signature explains. Not necessarily wrong —
  // most moves are simply fine — so this only counts the ones that also went
  // wrong by their label.
  const unexplained = us.filter(u => u.meant && u.type === 'move'
    && u.san !== u.meant && !matched.has(u.n));
  unmatchedTotal += unexplained.length;

  if (onlyNew && !unexplained.length) continue;
  console.log('\n' + file);
  if (!onlyNew) for (const h of hits) {
    console.log('  ' + h.sig.id.padEnd(22) + h.detail.padEnd(14) + h.sig.status);
  }
  for (const u of unexplained) {
    console.log('  ⚠ UNMATCHED  #' + u.n + '  "' + u.chose + '" → ' + u.san + ', meant ' + u.meant);
    console.log('     No known shape covers this. It needs a person, not a patch.');
  }
}

console.log('\n' + (unmatchedTotal
  ? unmatchedTotal + ' labelled failure(s) match no known signature — stop here and hand them over.'
  : 'Every labelled failure in the corpus matches a known shape.') + '\n');
