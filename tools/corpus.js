#!/usr/bin/env node
//
// What did people actually say, and what did the app do with it?
//
//   node tools/corpus.js                 summary of every report
//   node tools/corpus.js --list          one line per utterance
//   node tools/corpus.js --needs-label   the ambiguous ones, to ask about
//   node tools/corpus.js --margin        would "refuse on a narrow margin" work?
//   node tools/corpus.js --json out.json the structured corpus
//
// This exists because of one bug and one rule.
//
// The bug: "knight to f3" arrived as "to F3" and the app played the PAWN. The
// scoring was f3 9.5 against Nf3 9.2 — a margin of 0.3 on a 9.5 scale — while
// the app's own rule is to refuse when two readings are equally legal. The
// obvious fix is to refuse on a narrow margin. The obvious fix is also known
// to be dangerous: the same rule would have interrupted a correct bxc3 in the
// r30 game. So the question is not "is 0.3 narrow?" but "what does every
// margin ever observed look like, split by whether the app got it right?"
//
// The rule (Day 5.x, three times over): do not pick a number, measure it. And
// do not let a heuristic label the ambiguous sample — ask the player. That is
// why --needs-label exists: it does not guess what someone meant, it prints
// the utterances where knowing would change the answer.
//
// WHAT IT READS
//
// Problem reports (tools/reports/*.txt). Every report carries a
// "--- what was heard ---" block, which the app records unconditionally: the
// full ranked alternatives with confidences, the normalised form, the plan
// that won, the legal-move ranking with its margin, and — from v2-r37 — the
// FEN the utterance was spoken into. Earlier builds recorded everything but
// the position, which makes those utterances readable and not replayable.
//
// GROUND TRUTH
//
// A report cannot know what the player meant; only the player knows. So a
// report may carry a "--- verified labels ---" block, the same convention
// tools/echo-timing.js already uses for echoes:
//
//     --- verified labels ---
//     # Adni, asked directly: "i said knight to f3"
//       #4  MEANT Nf3
//       #7  MEANT none          (nothing was said — this was the app's echo)
//
// MEANT takes SAN, or "none" for an utterance that should never have been
// routed at all. Unlabelled utterances are counted and then left out of every
// verdict, loudly. A corpus that scores itself is not a corpus.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = n => args.indexOf(n) !== -1;
const valOf = n => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const dir = path.join(__dirname, 'reports');

let files = args.filter(a => !a.startsWith('-') && /\.txt$/.test(a));
if (!files.length) {
  if (!fs.existsSync(dir)) { console.error('no tools/reports/ and no files given'); process.exit(2); }
  files = fs.readdirSync(dir).filter(f => /\.txt$/.test(f)).sort().map(f => path.join(dir, f));
}
if (!files.length) { console.error('no reports found'); process.exit(2); }

// ---------------------------------------------------------------- parsing

// #4  [voice]  chose: "to F3"
const HEAD = /^#(\d+)\s+\[(\w+)\]\s+chose:\s+"([\s\S]*)"\s*$/;
const HEARD = /^\s+heard:\s+(.*)$/;
const NORM = /^\s+normalised:\s+"([\s\S]*)"\s*$/;
const RESULT = /^\s+result:\s+(\S+)(?:\s+→\s+(\S+))?\s+\(score\s+([-\d.]+)\)/;
const RANKED = /^\s+ranked:\s+(.*?)\s+margin\s+([-\d.]+)\s*$/;
const TURN = /^\s+turn:\s+(\w+)\s+legal:\s+(\d+)/;
const FEN = /^\s+fen:\s+(.*)$/;
const LABEL = /^\s*#(\d+)\s+MEANT\s+(\S+)/;
const SECTION = /^---\s+(.*?)\s+---\s*$/;

// "to F3" (0.94)  |  "F3" (0.90)
function parseHeard(s) {
  const out = [];
  const re = /"([^"]*)"(?:\s+\(([\d.]+)\))?/g;
  let m;
  while ((m = re.exec(s))) out.push({ text: m[1], confidence: m[2] ? +m[2] : null });
  return out;
}

// f3 9.5  |  Nf3 9.2*  |  e4 3.1
function parseRanked(s) {
  return s.split('|').map(p => p.trim()).filter(Boolean).map(p => {
    const m = p.match(/^(\S+)\s+([-\d.]+)(\*)?$/);
    return m ? { san: m[1], score: +m[2], exact: !!m[3] } : { san: p, score: null, exact: false };
  });
}

function buildRev(build) {
  const m = (build || '').match(/v(\d+)-r(\d+)/);
  return m ? +m[2] : null;
}

function parseReport(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const rep = {
    file: path.basename(file), build: null, when: null, url: null,
    settings: null, fen: null, pgn: null,
    utterances: [], labels: {}, labelNotes: [], truncated: false
  };
  let section = null, cur = null;

  const close = () => { if (cur) { rep.utterances.push(cur); cur = null; } };

  for (const line of lines) {
    const sec = line.match(SECTION);
    if (sec) {
      close();
      section = sec[1];
      const heardHdr = section.match(/^what was heard\s+\(last\s+(\d+)\s+of\s+(\d+)\)/);
      if (heardHdr) rep.truncated = { kept: +heardHdr[1], total: +heardHdr[2] };
      continue;
    }
    if (!section) {
      let m;
      if ((m = line.match(/^build:\s+(.*)$/))) rep.build = m[1].trim();
      else if ((m = line.match(/^when:\s+(.*)$/))) rep.when = m[1].trim();
      else if ((m = line.match(/^url:\s+(.*)$/))) rep.url = m[1].trim();
      continue;
    }
    if (/^settings$/.test(section)) { if (line.trim()) rep.settings = line.trim(); continue; }
    if (/^position$/.test(section)) {
      let m;
      if ((m = line.match(/^\s+fen:\s+(.*)$/))) rep.fen = m[1].trim();
      else if ((m = line.match(/^\s+pgn:\s+(.*)$/))) rep.pgn = m[1].trim();
      continue;
    }
    if (/^verified labels$/.test(section)) {
      const m = line.match(LABEL);
      if (m) rep.labels[+m[1]] = m[2];
      else if (line.trim().startsWith('#')) rep.labelNotes.push(line.trim());
      continue;
    }
    if (!/^what was heard/.test(section)) continue;

    let m;
    if ((m = line.match(HEAD))) {
      close();
      cur = { n: +m[1], source: m[2], chose: m[3], heard: [], normalised: null,
              type: null, san: null, score: null, ranked: null, margin: null,
              turn: null, legal: null, fen: null, report: rep.file, build: rep.build };
      continue;
    }
    if (!cur) continue;
    if ((m = line.match(HEARD))) cur.heard = parseHeard(m[1]);
    else if ((m = line.match(NORM))) cur.normalised = m[1];
    else if ((m = line.match(RESULT))) { cur.type = m[1]; cur.san = m[2] || null; cur.score = +m[3]; }
    else if ((m = line.match(RANKED))) { cur.ranked = parseRanked(m[1]); cur.margin = +m[2]; }
    else if ((m = line.match(TURN))) { cur.turn = m[1]; cur.legal = +m[2]; }
    else if ((m = line.match(FEN))) cur.fen = m[1].trim();
  }
  close();

  for (const u of rep.utterances) {
    u.meant = Object.prototype.hasOwnProperty.call(rep.labels, u.n) ? rep.labels[u.n] : null;
  }
  // A label naming an utterance that is not in the log is a typo, and a silent
  // one would quietly shrink the labelled set. Say so.
  const seen = new Set(rep.utterances.map(u => u.n));
  for (const k of Object.keys(rep.labels)) {
    if (!seen.has(+k)) rep.orphanLabels = (rep.orphanLabels || []).concat('#' + k);
  }
  return rep;
}

const reports = files.map(parseReport);
const useSynthetic = flag('--include-synthetic');
const counted = reports.filter(r => useSynthetic || !isSynthetic(r));
const all = [].concat(...counted.map(r => r.utterances));
const labelled = all.filter(u => u.meant);
const moves = all.filter(u => u.type === 'move');

// A report generated by driving the harness is not evidence about anybody's
// speech — every alternatives list in it was typed by me. It is still worth
// parsing (it is how the parser is tested), so it is read and then held apart
// unless asked for. A bench that quietly counts its own fixtures is the exact
// fault r36 found in echo-threshold.js, one directory over.
function isSynthetic(r) {
  return /_vad-harness|_look\.html|_stt-bench|_level-ladder/.test(r.url || '');
}

// THE SIGNATURE, and the reason this file exists.
//
// movePhrases() lists the bare destination square as a phrase for EVERY move
// that reaches it — `const out=[to, ...]`, regardless of piece. So a heard
// "f3" is an EXACT match for the pawn move f3 AND for Nf3 at the same time,
// and constrainedMove() separates them with nothing but its pawn preference:
//
//     piece = said ? (said===m.piece ? 1.2 : -1.2) : (m.piece==='p' ? 0.3 : 0)
//
// 8 + 1.2 + 0.3 = 9.5 for the pawn, 8 + 1.2 + 0 = 9.2 for the knight. The
// margin is 0.3 every single time, because 0.3 IS the pawn preference. It is
// not a measurement of how close the reading was; it is a constant.
//
// That matters for what can be concluded from a margin. "Refuse when the
// margin is narrow" reads, in this case, as "refuse every bare square that
// more than one piece can reach" — which is a rule about the position, not
// about the recognition, and would fire on a perfectly clear "f3" too.
//
// So this flags the shape rather than the number: two or more EXACT readings
// of one transcript. Whether the player meant the pawn is not knowable from
// here and is not guessed — that is what MEANT labels are for.
function pawnDefault(u) {
  if (u.type !== 'move' || !u.ranked) return false;
  return u.ranked.filter(r => r.exact).length >= 2;
}

// A transcript that carries words the normaliser threw away, ending in a bare
// square: "to F3" -> "f3". That is what a clipped "knight to f3" looks like
// from here — and also what a genuine, sloppily-recognised "f3" looks like.
// Reported as a co-occurrence, never as a diagnosis.
function clipped(u) {
  if (!u.normalised || !/^[a-h][1-8]$/.test(u.normalised)) return false;
  return u.chose.trim().split(/\s+/).length > 1;
}

// An utterance is a MISS when the app played something the player did not mean.
// "none" means the app should not have played anything at all — an echo it
// routed, or a fragment it should have questioned.
function outcome(u) {
  if (!u.meant) return null;
  // "none" is a miss whenever the app DID something, not only when it moved.
  // A fragment swallowed as a command is still an action nobody asked for —
  // the harness run had "night to wear" answered with an engine analysis. The
  // right response to a fragment is to ask, and asking is what "none" wants.
  if (u.meant === 'none') return (u.type === 'move' || u.type === 'command') ? 'miss' : 'hit';
  if (u.type !== 'move') return 'miss';
  return u.san === u.meant ? 'hit' : 'miss';
}

// ---------------------------------------------------------------- output

function short(u) {
  const alts = u.heard.length ? u.heard.length + ' alts' : u.source;
  const got = u.type === 'move' ? u.san : u.type;
  const mar = u.margin === null ? '   —  ' : ('m' + u.margin.toFixed(2)).padStart(6);
  const o = outcome(u);
  const tag = o === 'miss' ? ' MISS' : o === 'hit' ? ' hit ' : '  ?  ';
  return '  ' + (u.report.slice(0, 14)).padEnd(15)
    + ('#' + u.n).padStart(4) + '  ' + tag + '  ' + mar + '  '
    + ('"' + u.chose + '"').padEnd(28).slice(0, 28) + ' → ' + String(got).padEnd(10)
    + (u.meant ? ' meant ' + u.meant : '') + '  [' + alts + (u.fen ? '' : ', no fen') + ']';
}

if (flag('--json')) {
  const out = valOf('--json');
  const blob = JSON.stringify({ generated: new Date().toISOString(), reports: counted, utterances: all }, null, 2);
  if (out && !out.startsWith('-')) { fs.writeFileSync(out, blob); console.log('wrote ' + out + ' — ' + all.length + ' utterances'); }
  else console.log(blob);
  process.exit(0);
}

if (flag('--list')) {
  for (const u of all) console.log(short(u));
  process.exit(0);
}

// The utterances where a label would actually change an answer: the app played
// a move, and the ranking says the runner-up was close behind. Everything else
// is either unambiguous or already decided.
if (flag('--needs-label')) {
  const cut = +(valOf('--needs-label') || 1.5);
  const want = moves.filter(u => !u.meant && u.margin !== null && u.margin < cut)
                    .sort((a, b) => a.margin - b.margin);
  console.log('\nUnlabelled moves with a margin under ' + cut + ' — ask what was said:\n');
  if (!want.length) console.log('  (none)\n');
  for (const u of want) {
    console.log('  ' + u.report + '  #' + u.n + '   margin ' + u.margin);
    console.log('     heard   ' + u.heard.map(h => '"' + h.text + '"' + (h.confidence ? ' (' + h.confidence + ')' : '')).join('  |  '));
    console.log('     played  ' + u.san + '   over  ' + (u.ranked || []).slice(1, 3).map(r => r.san + ' ' + r.score).join(', '));
    console.log('     → add to the report:   #' + u.n + '  MEANT <san|none>\n');
  }
  process.exit(0);
}

// Would "refuse when the margin is narrow" have helped? Only labelled
// move-producing utterances can answer, because the cost of refusing a CORRECT
// move is the whole reason this is not obvious.
if (flag('--margin')) {
  const usable = moves.filter(u => u.meant && u.margin !== null);
  const noRank = moves.filter(u => u.meant && u.margin === null);
  console.log('\nMargin sweep — "refuse and ask when margin < T"\n');
  console.log('  labelled moves with a ranking: ' + usable.length
    + '   (labelled but unrankable: ' + noRank.length + ' — the rule cannot see these)');
  if (!usable.length) {
    console.log('\n  Nothing to sweep. This question needs labelled games; see --needs-label.\n');
    process.exit(0);
  }
  const wrong = usable.filter(u => outcome(u) === 'miss');
  const right = usable.filter(u => outcome(u) === 'hit');
  console.log('  of those: ' + wrong.length + ' wrong, ' + right.length + ' right\n');
  const cuts = Array.from(new Set(usable.map(u => u.margin))).sort((a, b) => a - b);
  console.log('      T     caught (of ' + wrong.length + ')   interrupted (of ' + right.length + ')');
  for (const c of cuts) {
    const T = +(c + 0.01).toFixed(2);
    const caught = wrong.filter(u => u.margin < T).length;
    const hurt = right.filter(u => u.margin < T).length;
    console.log('   ' + String(T).padStart(6) + '   ' + String(caught).padStart(6)
      + '          ' + String(hurt).padStart(6) + (hurt === 0 && caught > 0 ? '   <- free' : ''));
  }
  console.log('\n  A row with caught>0 and interrupted=0 is a threshold worth having.');
  console.log('  Every row costs something otherwise, and this corpus is ' + usable.length + ' utterances deep.');
  if (usable.length < 30) {
    console.log('\n  ⚠ ' + usable.length + ' is not enough to choose a threshold with. A corpus this small');
    console.log('    will show a free row for almost any rule, because the case that rule breaks');
    console.log('    has not been said into it yet. The r30 game held a correct bxc3 that the');
    console.log('    obvious margin rule would have interrupted; it is not in here.');
  }
  console.log('');
  process.exit(0);
}

// ---------------------------------------------------------------- summary

const held = reports.length - counted.length;
console.log('\n=== corpus: ' + all.length + ' utterances from ' + counted.length + ' report'
  + (counted.length === 1 ? '' : 's') + ' ==='
  + (held ? '   (' + held + ' synthetic, held apart — --include-synthetic to count)' : '') + '\n');
for (const r of counted) {
  const withFen = r.utterances.filter(u => u.fen).length;
  console.log('  ' + r.file);
  console.log('     ' + (r.build || '(no build line)') + '   ' + (r.when || ''));
  console.log('     ' + r.utterances.length + ' utterances · ' + Object.keys(r.labels).length + ' labelled · '
    + withFen + ' with a position'
    + (r.truncated ? '  ⚠ log rolled: kept ' + r.truncated.kept + ' of ' + r.truncated.total : ''));
  if (!r.utterances.length) {
    console.log('     ⚠ no "--- what was heard ---" block. This report was trimmed before it');
    console.log('       was saved, or came from a build without one. Nothing to learn here.');
  }
  if (r.orphanLabels) console.log('     ⚠ labels for utterances not in the log: ' + r.orphanLabels.join(', '));
  const rev = buildRev(r.build);
  if (rev !== null && rev < 37 && r.utterances.length) {
    console.log('     ⚠ pre-r37: no positions, and `ranked:` could belong to a DIFFERENT');
    console.log('       alternative than the one chosen. Read the margins here with suspicion.');
  }
  console.log('');
}

const bySource = {};
for (const u of all) bySource[u.source] = (bySource[u.source] || 0) + 1;
const byType = {};
for (const u of all) byType[u.type || '?'] = (byType[u.type || '?'] || 0) + 1;

console.log('  source:   ' + (Object.keys(bySource).map(k => k + ' ' + bySource[k]).join('  ·  ') || '—'));
console.log('  outcome:  ' + (Object.keys(byType).map(k => k + ' ' + byType[k]).join('  ·  ') || '—'));
console.log('  ranked:   ' + all.filter(u => u.margin !== null).length + ' carry a margin');
console.log('  position: ' + all.filter(u => u.fen).length + ' of ' + all.length + ' replayable');
const pd = moves.filter(pawnDefault);
console.log('  two exact readings of one transcript: ' + pd.length + ' of ' + moves.length + ' moves'
  + (pd.length ? '   ← the pawn default decided these' : ''));
console.log('  ' + pd.filter(clipped).length + ' of those also carried a word the normaliser dropped');
console.log('  labelled: ' + labelled.length + ' of ' + all.length
  + (labelled.length ? '   (' + labelled.filter(u => outcome(u) === 'miss').length + ' wrong, '
     + labelled.filter(u => outcome(u) === 'hit').length + ' right)' : ''));

if (labelled.filter(u => outcome(u) === 'miss').length) {
  console.log('\n  what went wrong:');
  for (const u of labelled.filter(u => outcome(u) === 'miss')) console.log(short(u));
}

console.log('\n  ' + (labelled.length
  ? 'Ready for --margin. Widen it with --needs-label before trusting a threshold.'
  : 'NOTHING IS LABELLED, so nothing here can say whether the app was right.\n  '
    + 'Run --needs-label, ask the player, and paste the answers back into the report.'));
console.log('');
