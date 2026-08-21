#!/usr/bin/env node
//
// Is the difficulty ladder actually a ladder?
//
//   node tools/level-ladder.js [gamesPerPair]
//
// Writes _level-ladder.html, then open it at /_level-ladder.html and press
// Run. It plays the Level select's rungs against each other and against the
// engine they replaced, and prints the results.
//
// Why it exists: until Day 4.0 the rungs were two different engines —
// Casual/Club/Sharp were depths 1/2/3 of a hand-rolled alpha-beta, and only
// Master was Stockfish. So "harder" changed the opponent's *character*, not
// just its strength, and there was no way to say whether Sharp was actually
// harder than Club or merely different. Moving every rung onto Stockfish's
// Skill Level makes the question answerable, and this is what answers it.
//
// Two things it has to check, and they pull in opposite directions:
//   1. Monotonic — each rung beats the one below it. Otherwise the select is
//      lying to the player about what it does.
//   2. The bottom rung is still forgiving. Stockfish at Skill Level 0 is a
//      real chess engine having an off day; the old depth-1 alpha-beta hung
//      pieces constantly. If the new Casual is much stronger than the old
//      one, the ladder got honest by making the app harder to start playing,
//      which for a *blindfold* opponent is the wrong trade.
//
// Both the LEVELS table and the baseline engine are lifted out of index.html
// at build time rather than copied, so this cannot quietly measure something
// the app no longer ships. If a marker moves, it exits loudly.

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function between(startMark, endMark, what){
  const a = page.indexOf(startMark);
  const b = page.indexOf(endMark);
  if(a === -1 || b === -1 || b < a){
    throw new Error('Could not find '+what+' in index.html ('+startMark+' … '+endMark+
                    ') — has the marker moved? Fix the marker, do not copy the code here.');
  }
  // Start at the end of the marker's *line*, not the end of the marker: the
  // markers carry a sentence explaining themselves, and slicing at the token
  // drags that prose into the extracted source as a syntax error.
  const from = page.indexOf('\n', a);
  const to   = page.lastIndexOf('\n', b);
  return page.slice(from + 1, to + 1);
}

const levelsSrc   = between('// LEVELS-START', '// LEVELS-END', 'the LEVELS table');
const baselineSrc = between('// BENCH-BASELINE-START', '// BENCH-BASELINE-END', 'the fallback engine');

// PIECE_VALUE lives outside the marked block; take it the same way.
const pvMatch = page.match(/const PIECE_VALUE\s*=\s*\{[^}]*\}\s*;/);
if(!pvMatch) throw new Error('Could not find PIECE_VALUE in index.html.');

const games = Math.max(1, parseInt(process.argv[2], 10) || 6);

const html = `<!doctype html>
<meta charset="utf-8">
<title>Mind Chess — level ladder bench</title>
<style>
 body{background:#0e1117;color:#d9e2ec;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;margin:24px}
 h1{font:600 16px/1.4 system-ui,sans-serif;margin:0 0 4px}
 p.sub{color:#7d8ea0;margin:0 0 16px}
 button{font:inherit;padding:6px 14px;cursor:pointer;background:#1b2230;color:#e8e4da;border:1px solid #3a4658;border-radius:6px}
 pre{white-space:pre-wrap;margin:16px 0 0}
 .ok{color:#6ee7a8}.bad{color:#ff8f8f}.dim{color:#7d8ea0}
</style>
<h1>Level ladder bench</h1>
<p class="sub">Generated from index.html — ${games} game(s) per pairing, colours alternate.</p>
<button id="run">Run</button>
<pre id="out"></pre>
<script src="chess-0.10.3.js"></script>
<script>
(function(){
"use strict";
const out=document.getElementById('out');
function say(s,cls){ const d=document.createElement('div'); if(cls)d.className=cls; d.textContent=s; out.appendChild(d); }

${pvMatch[0]}
${baselineSrc}
const LEVELS = ${levelsSrc.trim().replace(/^const LEVELS\s*=\s*/,'').replace(/;\s*$/,'')};

// ---- the baseline opponent, the engine the ladder replaced ----
// computerMove() itself isn't lifted: it reads app state (lastComputerMove,
// applyMove). The *search* is what defines the strength, and that is.
function baselineMove(g,depth){
  const moves=g.moves({verbose:true});
  if(!moves.length) return null;
  const white=g.turn()==='w';
  let best=null,bestScore=white?-Infinity:Infinity;
  for(const m of moves){
    g.move(m.san);
    const score=searchScore(g,depth-1,-Infinity,Infinity,!white);
    g.undo();
    if(white?score>bestScore:score<bestScore){ bestScore=score; best=m; }
  }
  return best?{from:best.from,to:best.to,promotion:best.promotion}:null;
}

// ---- Stockfish, driven exactly the way index.html drives it ----
let worker=null;
function sfInit(){
  if(worker) return Promise.resolve(worker);
  return new Promise((resolve,reject)=>{
    const w=new Worker('stockfish-18-lite-single.js');
    const timer=setTimeout(()=>reject(new Error('timed out starting')),30000);
    w.onerror=()=>{ clearTimeout(timer); reject(new Error('failed to load')); };
    w.onmessage=e=>{
      if(e.data==='uciok') w.postMessage('isready');
      else if(e.data==='readyok'){ clearTimeout(timer); worker=w; resolve(w); }
    };
    w.postMessage('uci');
  });
}
function sfMove(fen,spec){
  return sfInit().then(w=>new Promise(resolve=>{
    w.onmessage=e=>{
      const line=e.data;
      if(typeof line==='string'&&line.indexOf('bestmove')===0){ w.onmessage=null; resolve(line.split(' ')[1]); }
    };
    // Same as applyStrength()/goCommand(): options are worker state, so state
    // all of them every time or a run inherits the previous player's setting.
    w.postMessage('setoption name UCI_LimitStrength value false');
    w.postMessage('setoption name Skill Level value '+(typeof spec.skill==='number'?spec.skill:20));
    w.postMessage('position fen '+fen);
    let go='go';
    if(spec.depth) go+=' depth '+spec.depth;
    if(spec.movetime) go+=' movetime '+spec.movetime;
    w.postMessage(go==='go'?'go movetime 1000':go);
  }));
}

function player(def){
  if(def.kind==='sf') return { label:def.label, move:g=>sfMove(g.fen(),def.spec).then(uci=>
    (!uci||uci==='(none)')?null:{from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci.length>4?uci[4]:undefined}) };
  return { label:def.label, move:g=>Promise.resolve(baselineMove(g,def.depth)) };
}

const MAX_PLIES=200;   // adjudicated a draw past here; a real result is rare beyond it
function playGame(white,black){
  const g=new Chess();
  let plies=0;
  function step(){
    if(g.game_over()||plies>=MAX_PLIES){
      let result;
      if(g.in_checkmate()) result=(g.turn()==='w')?'0-1':'1-0';
      else if(plies>=MAX_PLIES) result='½-½ (adjudicated)';
      else result='½-½';
      return Promise.resolve({result,plies,fen:g.fen()});
    }
    const side=g.turn()==='w'?white:black;
    return side.move(g).then(mv=>{
      if(!mv) return {result:'½-½ (no move)',plies,fen:g.fen()};
      if(!g.move(mv)) return {result:'½-½ (illegal '+JSON.stringify(mv)+')',plies,fen:g.fen()};
      plies++;
      return step();
    });
  }
  return step();
}

function pairing(a,b,n){
  const A=player(a), B=player(b);
  const tally={aWin:0,bWin:0,draw:0,plies:0};
  let i=0;
  function next(){
    if(i>=n) return Promise.resolve(tally);
    const aIsWhite=(i%2===0);
    const t0=Date.now();
    return playGame(aIsWhite?A:B, aIsWhite?B:A).then(r=>{
      const aWon=(r.result==='1-0'&&aIsWhite)||(r.result==='0-1'&&!aIsWhite);
      const bWon=(r.result==='1-0'&&!aIsWhite)||(r.result==='0-1'&&aIsWhite);
      if(aWon) tally.aWin++; else if(bWon) tally.bWin++; else tally.draw++;
      tally.plies+=r.plies;
      say('    game '+(i+1)+': '+(aIsWhite?A.label+' (W) vs '+B.label+' (B)':B.label+' (W) vs '+A.label+' (B)')
          +'  →  '+r.result+'   '+r.plies+' plies, '+Math.round((Date.now()-t0)/1000)+'s','dim');
      i++;
      return next();
    });
  }
  return next();
}

const MATCHUPS=[
  // The ladder itself: each rung against the one below it.
  [{kind:'sf',label:'Club',  spec:LEVELS['2']},      {kind:'sf',label:'Casual',spec:LEVELS['1']}],
  [{kind:'sf',label:'Sharp', spec:LEVELS['3']},      {kind:'sf',label:'Club',  spec:LEVELS['2']}],
  [{kind:'sf',label:'Master',spec:LEVELS['master']}, {kind:'sf',label:'Sharp', spec:LEVELS['3']}],
  // And against what each rung used to be, so "honest" doesn't quietly mean
  // "harder". The old ladder was depth 1/2/3 of the alpha-beta.
  [{kind:'sf',label:'Casual(new)',spec:LEVELS['1']}, {kind:'base',label:'Casual(old d1)',depth:1}],
  [{kind:'sf',label:'Sharp(new)', spec:LEVELS['3']}, {kind:'base',label:'Sharp(old d3)', depth:3}]
];

document.getElementById('run').addEventListener('click',function(){
  this.disabled=true; out.innerHTML='';
  say('LEVELS as index.html ships them:');
  Object.keys(LEVELS).forEach(k=>say('  '+k.padEnd(7)+' '+JSON.stringify(LEVELS[k])));
  say('');
  let i=0;
  const started=Date.now();
  (function next(){
    if(i>=MATCHUPS.length){
      say('');
      say('done in '+Math.round((Date.now()-started)/1000)+'s');
      return;
    }
    const [a,b]=MATCHUPS[i];
    say(a.label+'  vs  '+b.label);
    pairing(a,b,${games}).then(t=>{
      const verdict=t.aWin>t.bWin?'ok':(t.aWin<t.bWin?'bad':'dim');
      say('  = '+a.label+' '+t.aWin+'  ·  '+b.label+' '+t.bWin+'  ·  drawn '+t.draw
          +'   (avg '+Math.round(t.plies/${games})+' plies)',verdict);
      say('');
      i++; next();
    }).catch(e=>{ say('  FAILED: '+e.message,'bad'); i++; next(); });
  })();
});
})();
</script>
`;

fs.writeFileSync(path.join(root, '_level-ladder.html'), html);
console.log('wrote _level-ladder.html   levels=' + levelsSrc.trim().split('\n').length + ' lines, ' + games + ' game(s) per pairing');
console.log('open /_level-ladder.html and press Run');
