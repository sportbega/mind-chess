#!/usr/bin/env node
//
// Build the puzzle set:  node tools/make-puzzles.js [count] [seed]
// Re-check the shipped set:  node tools/make-puzzles.js --audit
//
// Writes puzzles.json, which ships with the app.
//
// Why generate instead of using the Lichess database (CC0, free, and the
// obvious answer): Lichess puzzles are positions from real games, which means
// twenty-odd pieces on the board. That is fine when you can see it and close
// to useless when you cannot — a blindfold player has to *hold* the position,
// and a 24-piece middlegame is a memory test rather than a chess one. The
// binding constraint here isn't licensing or size, it's how much position a
// person can keep in their head. So: sparse positions, four to seven pieces,
// which is the shape blindfold play can actually use.
//
// Generating them also removes the runtime engine. Mate in one and mate in two
// are decidable by brute force over chess.js — no Stockfish, no download, and
// the answer is *proved* rather than trusted to a search depth:
//
//   mate in 1  exactly one legal move gives checkmate
//   mate in 2  no mate in 1 exists, and exactly one move m1 is such that every
//              black reply allows a mate in 1
//
// "Exactly one" matters more than it looks. If two different moves mate, then
// rejecting the player's answer because it isn't the one we stored would be
// the app being wrong, not the player. Uniqueness is what earns the right to
// say "no, not that one".
//
// And because every black defence is enumerated at build time, the solution is
// a small tree rather than a line, so the app can answer any defence correctly
// without an engine at runtime.

const fs = require('fs');
const path = require('path');
const { Chess } = require('../chess-0.10.3.js');

const want = Math.max(1, parseInt(process.argv[2], 10) || 120);
let seed = (parseInt(process.argv[3], 10) || 20260821) >>> 0;
// Seeded so a rebuild reproduces the same set. A puzzle file that changed
// every build would make "puzzle 14" mean nothing between versions.
function rnd() {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return seed / 4294967296;
}
const pick = a => a[Math.floor(rnd() * a.length)];

const FILES = 'abcdefgh';
const sq = (f, r) => FILES[f] + (r + 1);

function randomPosition() {
  const board = {};                 // square -> {type,color}
  const used = new Set();
  const place = (type, color, allowBackRank) => {
    for (let tries = 0; tries < 60; tries++) {
      const f = Math.floor(rnd() * 8), r = Math.floor(rnd() * 8);
      if (type === 'p' && (r === 0 || r === 7)) continue;      // pawns can't live there
      if (!allowBackRank && false) continue;
      const s = sq(f, r);
      if (used.has(s)) continue;
      used.add(s); board[s] = { type, color, f, r };
      return true;
    }
    return false;
  };

  if (!place('k', 'w')) return null;
  if (!place('k', 'b')) return null;
  const wk = Object.values(board).find(p => p.type === 'k' && p.color === 'w');
  const bk = Object.values(board).find(p => p.type === 'k' && p.color === 'b');
  // Kings cannot stand next to each other; cheaper to reject here than to let
  // chess.js reject the whole FEN afterwards.
  if (Math.abs(wk.f - bk.f) <= 1 && Math.abs(wk.r - bk.r) <= 1) return null;

  // The attacker needs enough to force mate; the defender needs little enough
  // that the position stays holdable. Both are deliberately small.
  const attackers = 1 + Math.floor(rnd() * 3);          // 1..3
  const defenders = Math.floor(rnd() * 2);              // 0..1
  for (let i = 0; i < attackers; i++) if (!place(pick(['q','r','r','b','n','p']), 'w')) return null;
  for (let i = 0; i < defenders; i++) if (!place(pick(['r','b','n','p','p']), 'b')) return null;

  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[sq(f, r)];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p.color === 'w' ? p.type.toUpperCase() : p.type;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/') + ' w - - 0 1';
}

const uci = m => m.from + m.to + (m.promotion || '');

// Brute force, and exhaustive on purpose — see the header.
// chess.js load() accepts a FEN where the side NOT to move is already in
// check. That position cannot occur in a game — the previous move would have
// been illegal — and it produces nonsense puzzles: the very first generated
// set opened with a "mate in 1" whose black king was in check before White
// had moved. Checking in_check() only ever asks about the side to move, so
// the illegal half is invisible unless you flip the board and ask again.
function opponentInCheck(fen) {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  const probe = new Chess();
  if (!probe.load(parts.join(' '))) return true;      // can't prove it legal; reject
  return probe.in_check();
}

function classify(fen) {
  const g = new Chess();
  if (!g.load(fen)) return null;
  if (g.in_check()) return null;              // "you to play and mate" reads wrong from check
  if (opponentInCheck(fen)) return null;      // illegal position, see above
  if (g.game_over()) return null;

  const legal = g.moves({ verbose: true });
  if (!legal.length) return null;

  // --- mate in 1 ---
  const mates1 = legal.filter(m => { g.move(m); const done = g.in_checkmate(); g.undo(); return done; });
  if (mates1.length > 1) return null;         // ambiguous: not a puzzle, just a position
  if (mates1.length === 1) {
    return { fen, mateIn: 1, key: uci(mates1[0]),
             quiet: false, pieces: countPieces(fen) };
  }

  // --- mate in 2 ---
  const keys = [];
  for (const m1 of legal) {
    g.move(m1);
    if (g.game_over()) { g.undo(); continue; }             // stalemate or already over
    const replies = g.moves({ verbose: true });
    const tree = {};
    let forced = replies.length > 0;
    for (const d of replies) {
      g.move(d);
      const mating = g.moves({ verbose: true })
        .filter(m2 => { g.move(m2); const done = g.in_checkmate(); g.undo(); return done; });
      g.undo();
      if (!mating.length) { forced = false; break; }
      // If several moves mate here the player still cannot be wrong, so any
      // is fine to store — the choice is only used to *show* a solution.
      tree[uci(d)] = uci(mating[0]);
    }
    const wasCheck = g.in_check();
    g.undo();
    if (forced) keys.push({ m1, tree, wasCheck });
  }
  if (keys.length !== 1) return null;         // must be exactly one key move
  const k = keys[0];
  return { fen, mateIn: 2, key: uci(k.m1), replies: k.tree,
           quiet: !k.wasCheck, pieces: countPieces(fen) };
}

function countPieces(fen) {
  return fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
}

// Colour-mirrored twin: same puzzle with Black to move. Costs nothing and
// stops every puzzle in the app being "White to play", which would let a
// player lean on one orientation.
function mirror(p) {
  const [board] = p.fen.split(' ');
  const rows = board.split('/').reverse().map(row =>
    row.replace(/[a-zA-Z]/g, c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
  const flipSq = s => s[0] + (9 - (+s[1]));
  const flipUci = u => flipSq(u.slice(0, 2)) + flipSq(u.slice(2, 4)) + (u.length > 4 ? u[4] : '');
  const out = { fen: rows.join('/') + ' b - - 0 1', mateIn: p.mateIn,
                key: flipUci(p.key), quiet: p.quiet, pieces: p.pieces };
  if (p.replies) {
    out.replies = {};
    Object.keys(p.replies).forEach(d => { out.replies[flipUci(d)] = flipUci(p.replies[d]); });
  }
  return out;
}

// A mirrored twin must be re-verified, not assumed: a flip that quietly
// produced an illegal or differently-solved position would ship a puzzle with
// a wrong answer, which is the one defect a blindfold player cannot catch.
function verify(p) {
  const g = new Chess();
  if (!g.load(p.fen)) return false;
  if (g.in_check() || opponentInCheck(p.fen)) return false;
  const legal = g.moves({ verbose: true });
  if (!legal.some(m => uci(m) === p.key)) return false;
  g.move({ from: p.key.slice(0, 2), to: p.key.slice(2, 4), promotion: p.key[4] });
  if (p.mateIn === 1) return g.in_checkmate();
  if (g.game_over()) return false;
  const replies = g.moves({ verbose: true });
  if (!replies.length) return false;
  for (const d of replies) {
    const answer = p.replies[uci(d)];
    if (!answer) return false;
    g.move(d);
    const ok = g.moves({ verbose: true }).some(m2 => {
      if (uci(m2) !== answer) return false;
      g.move(m2); const done = g.in_checkmate(); g.undo(); return done;
    });
    g.undo();
    if (!ok) return false;
  }
  return true;
}

// --audit re-checks an existing puzzles.json *without* generating anything,
// deriving every claim from the FEN alone. The generator's own verify() runs
// on data it just built and shares its assumptions; this re-proves uniqueness
// from scratch, which is the property the app leans on when it tells a player
// "no, not that one". Run it after any change to the generator, and before
// shipping a regenerated file.
if (process.argv.includes('--audit')) {
  const file = path.join(__dirname, '..', 'puzzles.json');
  const ps = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bad = [];
  ps.forEach(p => {
    const g = new Chess();
    if (!g.load(p.fen)) return bad.push([p.id, 'bad fen']);
    if (g.in_check()) return bad.push([p.id, 'mover already in check']);
    if (opponentInCheck(p.fen)) return bad.push([p.id, 'ILLEGAL: opponent in check']);
    const legal = g.moves({ verbose: true });
    const mates1 = legal.filter(m => { g.move(m); const d = g.in_checkmate(); g.undo(); return d; });
    if (p.mateIn === 1) {
      if (mates1.length !== 1) return bad.push([p.id, 'mate-in-1 is not unique (' + mates1.length + ')']);
      if (uci(mates1[0]) !== p.key) return bad.push([p.id, 'stored key is not the mate']);
      return;
    }
    if (mates1.length) return bad.push([p.id, 'claims mate in 2 but a mate in 1 exists']);
    const keys = [];
    for (const m1 of legal) {
      g.move(m1);
      if (g.game_over()) { g.undo(); continue; }
      const reps = g.moves({ verbose: true });
      let forced = reps.length > 0;
      for (const d of reps) {
        g.move(d);
        const has = g.moves({ verbose: true }).some(m2 => { g.move(m2); const c = g.in_checkmate(); g.undo(); return c; });
        g.undo();
        if (!has) { forced = false; break; }
      }
      g.undo();
      if (forced) keys.push(uci(m1));
    }
    if (keys.length !== 1) return bad.push([p.id, 'mate-in-2 key is not unique (' + keys.length + ')']);
    if (keys[0] !== p.key) return bad.push([p.id, 'stored key is not the key move']);
    g.move({ from: p.key.slice(0, 2), to: p.key.slice(2, 4), promotion: p.key[4] });
    for (const d of g.moves({ verbose: true })) {
      const ans = p.replies && p.replies[uci(d)];
      if (!ans) return bad.push([p.id, 'no answer stored for defence ' + uci(d)]);
      g.move(d);
      const ok = g.moves({ verbose: true }).some(m2 => {
        if (uci(m2) !== ans) return false;
        g.move(m2); const c = g.in_checkmate(); g.undo(); return c;
      });
      g.undo();
      if (!ok) return bad.push([p.id, 'stored answer ' + ans + ' does not mate after ' + uci(d)]);
    }
  });
  console.log('audited ' + ps.length + ' puzzles from ' + file);
  if (bad.length) {
    console.log('PROBLEMS (' + bad.length + '):');
    bad.slice(0, 20).forEach(b => console.log('  #' + b[0] + '  ' + b[1]));
    process.exit(1);
  }
  console.log('clean: every position legal, every key unique, every defence answered by a real mate.');
  process.exit(0);
}

const out = [];
const seen = new Set();
let tried = 0;
const started = Date.now();
while (out.length < want && tried < 4000000) {
  tried++;
  const fen = randomPosition();
  if (!fen || seen.has(fen)) continue;
  seen.add(fen);
  const p = classify(fen);
  if (!p) continue;
  if (!verify(p)) continue;
  out.push(p);
  if (out.length < want) {
    const tw = mirror(p);
    if (verify(tw)) out.push(tw);
  }
}

// Easiest first: fewer pieces and a checking key are what a newcomer to
// blindfold puzzles can actually hold and see.
out.sort((a, b) => (a.mateIn - b.mateIn) || (a.quiet - b.quiet) || (a.pieces - b.pieces));
out.forEach((p, i) => { p.id = i + 1; });

fs.writeFileSync(path.join(__dirname, '..', 'puzzles.json'), JSON.stringify(out));
const by = k => out.filter(k).length;
console.log('wrote puzzles.json  ' + out.length + ' puzzles from ' + tried + ' positions in ' +
            Math.round((Date.now() - started) / 1000) + 's');
console.log('  mate in 1: ' + by(p => p.mateIn === 1) + '   mate in 2: ' + by(p => p.mateIn === 2) +
            '   (quiet keys: ' + by(p => p.quiet) + ')');
console.log('  pieces: min ' + Math.min(...out.map(p => p.pieces)) +
            ', max ' + Math.max(...out.map(p => p.pieces)));
console.log('  every puzzle re-verified from its own FEN before writing.');
