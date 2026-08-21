#!/usr/bin/env node
//
// Which words does the voice matcher hear as something else?
//
//   node tools/phon-collisions.js
//
// phon() is what makes spoken moves robust — it collapses "night", "nite" and
// "knight" onto one code. Run over short *function* words it does the same
// thing to words that mean completely different things: "can" and "queen" are
// both `kn`, "what" and "white" are both `wht`. On 2026-08-20 that answered
// every "what ...?" question about White regardless of who was asking, and it
// was invisible for a whole test round because the seat under test happened to
// be White. Three of the eight collisions below were unguessable.
//
// Run this after adding a word to PIECE_WORDS, Q_STOP, or the ownership lists.
// Anything it prints must either be matched literally instead of by sound, or
// be added to Q_STOP so piece detection skips it.
//
// Everything is lifted out of index.html at run time rather than copied, so
// this can't quietly drift out of date. If a marker moves, this exits loudly.

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function lift(startMarker, endMarker, label) {
  const i = src.indexOf(startMarker);
  if (i === -1) throw new Error('Could not find ' + label + ' in index.html (looked for: ' + startMarker + ')');
  const j = src.indexOf(endMarker, i);
  if (j === -1) throw new Error('Could not find the end of ' + label + ' in index.html');
  return src.slice(i, j + endMarker.length);
}

const scope = {};
new Function('scope',
  'const PHON_CACHE={};\n' +
  lift('function phon(w){', '\n  }', 'phon()') + '\n' +
  lift('const PIECE_WORDS = {', '\n  };', 'PIECE_WORDS') + '\n' +
  lift('const Q_STOP=new Set(', '.split(\' \'));', 'Q_STOP') + '\n' +
  'scope.phon=phon; scope.PIECE_WORDS=PIECE_WORDS; scope.Q_STOP=Q_STOP;'
)(scope);

const { phon: encode, PIECE_WORDS, Q_STOP } = scope;
const WORDS = [...Q_STOP];

// Ownership and colour words: these must never be reachable by sound, because
// getting one wrong silently swaps whose position is being described.
const OWNERSHIP = {
  white: 'colour', whites: 'colour', black: 'colour', blacks: 'colour',
  my: 'me', mine: 'me', me: 'me', i: 'me', im: 'me', our: 'me', ours: 'me', we: 'me', us: 'me',
  his: 'them', her: 'them', hers: 'them', their: 'them', theirs: 'them', them: 'them',
  they: 'them', he: 'them', she: 'them', him: 'them',
  opponent: 'them', opponents: 'them', enemy: 'them', computer: 'them'
};

function index(keys) {
  const by = {};
  keys.forEach(w => { (by[encode(w)] = by[encode(w)] || []).push(w); });
  return by;
}

const byPiece = index(Object.keys(PIECE_WORDS));
const byOwner = index(Object.keys(OWNERSHIP));

const report = (title, hits) => {
  console.log('\n' + title);
  console.log(hits.length ? hits.map(h => '  ' + h).join('\n') : '  none');
  return hits.length;
};

const pieceHits = [];
WORDS.forEach(w => {
  const k = encode(w), k2 = encode(w.replace(/s$/, ''));
  if (byPiece[k]) pieceHits.push(pad(w) + k + '  ->  ' + byPiece[k].join(' / '));
  else if (byPiece[k2]) pieceHits.push(pad(w) + k2 + '  ->  ' + byPiece[k2].join(' / ') + '  (singular)');
});

const ownerHits = [];
WORDS.forEach(w => {
  if (OWNERSHIP[w]) return;
  const k = encode(w);
  if (byOwner[k]) ownerHits.push(pad(w) + k + '  ->  ' + byOwner[k].join(' / '));
});

// ---------------------------------------------------------------
// Command vocabularies — the gap this tool had until Day 4.4
// ---------------------------------------------------------------
// Everything above tests Q_STOP, which is the *question* matcher's
// vocabulary. Command matchers ("coach full", "tips off") have their own word
// lists, written inline as hasSound(words,[...]) — and those were never
// checked against anything. That is precisely the Day 3.14 shape: a command
// word that happens to sound like a piece would swallow a move, and the tool
// whose job is to find that would have printed a clean report.
//
// Scoped to the command matchers only — functions named match<Something>Command.
// The *question* matcher also calls hasSound, but piece and ownership words
// belong in its vocabulary by design ("where is my king"), and sweeping those
// in buries the real signal under a page of self-matches. Found by pattern
// rather than by name, so a command matcher added later is covered without
// anyone remembering to come back here.
const COMMAND_WORDS = [];
const seenCmd = new Set();
const cmdFns = [...src.matchAll(/\n  function (match\w*Command)\(/g)];
if (!cmdFns.length) {
  throw new Error('Found no match*Command() functions in index.html — either they were renamed ' +
                  'or the indentation changed, and this check is now silently testing nothing.');
}
cmdFns.forEach(fn => {
  const from = fn.index;
  const nextFn = src.indexOf('\n  function ', from + 1);
  const body = src.slice(from, nextFn === -1 ? src.length : nextFn);
  body.replace(/hasSound\(\s*words\s*,\s*\[([^\]]*)\]/g, (_, list) => {
    list.split(',').forEach(part => {
      const m = part.match(/'([^']+)'|"([^"]+)"/);
      if (!m) return;
      const w = (m[1] || m[2]).toLowerCase();
      if (!seenCmd.has(w)) { seenCmd.add(w); COMMAND_WORDS.push(w); }
    });
    return _;
  });
});

const cmdHits = [];
COMMAND_WORDS.forEach(w => {
  const k = encode(w);
  // A word sounding like itself is not a collision. Only another word
  // arriving at the same code can steal a move.
  const piece = (byPiece[k] || []).filter(x => x !== w);
  const owner = (byOwner[k] || []).filter(x => x !== w);
  if (piece.length) cmdHits.push(pad(w) + k + '  ->  ' + piece.join(' / ') + '  [PIECE]');
  else if (owner.length) cmdHits.push(pad(w) + k + '  ->  ' + owner.join(' / ') + '  [OWNERSHIP]');
});

function pad(w) { return (w + '                ').slice(0, 16) + ''; }

console.log('Checked ' + WORDS.length + ' matcher words against ' +
  Object.keys(PIECE_WORDS).length + ' piece words and ' +
  Object.keys(OWNERSHIP).length + ' ownership words.');
const a = report('Sound like a PIECE (must be in Q_STOP — they are, or this list would be a bug):', pieceHits);
const b = report('Sound like a COLOUR or PRONOUN (must be matched literally, never by sound):', ownerHits);
console.log('\n' + (a + b) + ' collisions — all are neutralised by Q_STOP / literal matching in matchQuestion().');

console.log('\nAlso checked ' + COMMAND_WORDS.length + ' command words from hasSound(words,[...]): ' +
  COMMAND_WORDS.join(' '));
const c = report('Command words that sound like a PIECE or an OWNER (a move could be eaten by a command):', cmdHits);
if (c) {
  console.log('\n' + c + ' command collision(s). Each one needs the *command* rule to demand more than the ');
  console.log('sound — a length guard, a required second word, or literal matching — or a spoken move can');
  console.log('be swallowed. See Day 3.14: a guard has a direction, and this is the other one.');
  process.exitCode = 1;
} else {
  console.log('\nNo command word collides with a piece or an owner.');
}
