#!/usr/bin/env node
//
// Is the difficulty ladder actually a ladder?
//
//   node tools/level-ladder.js [gamesPerPair]
//
// Writes _level-ladder.html, then open it at /_level-ladder.html and press
// Run. It plays the Level select's rungs against each other and prints the
// results.
//
// Why it exists: until Day 4.0 the rungs were two different engines —
// Casual/Club/Sharp were depths 1/2/3 of a hand-rolled alpha-beta, and only
// Master was Stockfish. So "harder" changed the opponent's *character*, not
// just its strength, and there was no way to say whether Sharp was actually
// harder than Club or merely different. Moving every rung onto Stockfish's
// Skill Level made the question answerable. OUR-105 finished the job: the
// hand-rolled engine is gone entirely and every one of the eleven rungs
// (1-10, plus "Capablanca Level") is Stockfish at a different skill/depth/
// movetime — so this bench no longer needs a baseline engine to lift out of
// index.html at all, just the LEVELS table.
//
// What it checks: monotonic — each rung beats the one below it. Otherwise
// the select is lying to the player about what it does.
//
// The LEVELS table is lifted out of index.html at build time rather than
// copied, so this cannot quietly measure something the app no longer ships.
// If the marker moves, it exits loudly.

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

const levelsSrc = between('// LEVELS-START', '// LEVELS-END', 'the LEVELS table');

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
<button id="run">Run ladder</button>
<button id="runElo">Run Elo anchoring</button>
<pre id="out"></pre>
<script src="chess-0.10.3.js"></script>
<script>
(function(){
"use strict";
const out=document.getElementById('out');
function say(s,cls){ const d=document.createElement('div'); if(cls)d.className=cls; d.textContent=s; out.appendChild(d); }

const LEVELS = ${levelsSrc.trim().replace(/^const LEVELS\s*=\s*/,'').replace(/;\s*$/,'')};

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
    // Options are worker state, so state all of them every time or a run
    // inherits the previous player's setting.
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
  const spec=def.spec;
  return { label:def.label, move:g=>sfMove(g.fen(),spec).then(uci=>
    (!uci||uci==='(none)')?null:{from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci.length>4?uci[4]:undefined}) };
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

// Each rung against the one directly below it, across all eleven — the
// only claim the Level select makes, and the only one worth checking.
const ORDER=['1','2','3','4','5','6','7','8','9','10','capablanca'];
const MATCHUPS=ORDER.slice(1).map((k,i)=>{
  const prev=ORDER[i];
  return [{label:LEVELS[k].name,spec:LEVELS[k]},{label:LEVELS[prev].name,spec:LEVELS[prev]}];
});

// ---- Elo anchoring ----
// Stockfish carries its own strength calibration (UCI_LimitStrength + UCI_Elo),
// which is the only Elo scale available here that wasn't invented by us. So:
// play a representative sample of rungs against a few of those settings and
// see where they sit. Not all eleven — that's eleven times four anchors times
// ELO_GAMES games, which stops being a quick bench — so this samples the
// bottom, middle, and top of the ladder.
//
// Read the caveat before believing a number. UCI_Elo is calibrated for normal
// time control, and these anchors get ANCHOR_MS a move so the whole thing
// finishes this century — which makes them weaker than their label. The
// honest reading of a result is therefore "plays about evenly with Stockfish's
// own Elo-N setting at ANCHOR_MS a move", not "is rated N". Treat it as an
// ordering with a rough scale attached, and if the brackets come out wide,
// that is the measurement telling you not to print a number in the UI.
const ANCHOR_MS=250;
const ANCHORS=[1320,1600,2000,2400];
const ELO_GAMES=2;
const SAMPLE_KEYS=['1','4','7','10','capablanca'];

function anchorPlayer(elo){
  return { label:'Elo'+elo, move:g=>sfInit().then(w=>new Promise(resolve=>{
    w.onmessage=e=>{
      const line=e.data;
      if(typeof line==='string'&&line.indexOf('bestmove')===0){ w.onmessage=null; resolve(line.split(' ')[1]); }
    };
    w.postMessage('setoption name UCI_LimitStrength value true');
    w.postMessage('setoption name UCI_Elo value '+elo);
    w.postMessage('setoption name Skill Level value 20');
    w.postMessage('position fen '+g.fen());
    w.postMessage('go movetime '+ANCHOR_MS);
  })).then(uci=>(!uci||uci==='(none)')?null:
      {from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci.length>4?uci[4]:undefined}) };
}

function anchorPairing(rung,elo,n){
  const A=player(rung), B=anchorPlayer(elo);
  const t={w:0,l:0,d:0};
  let i=0;
  function next(){
    if(i>=n) return Promise.resolve(t);
    const aWhite=(i%2===0);
    return playGame(aWhite?A:B, aWhite?B:A).then(r=>{
      const aWon=(r.result==='1-0'&&aWhite)||(r.result==='0-1'&&!aWhite);
      const bWon=(r.result==='1-0'&&!aWhite)||(r.result==='0-1'&&aWhite);
      if(aWon) t.w++; else if(bWon) t.l++; else t.d++;
      i++; return next();
    });
  }
  return next();
}

document.getElementById('runElo').addEventListener('click',function(){
  this.disabled=true; out.innerHTML='';
  say('Elo anchoring — '+ELO_GAMES+' game(s) per anchor, anchors at '+ANCHOR_MS+'ms a move.');
  say('Sampling levels '+SAMPLE_KEYS.join(', ')+' rather than all eleven.','dim');
  say('UCI_Elo is calibrated for normal time control; at '+ANCHOR_MS+'ms these anchors are','dim');
  say('weaker than their label. Read a result as "plays evenly with the Elo-N setting','dim');
  say('at this budget", not as a rating.','dim');
  say('');
  const rungs=SAMPLE_KEYS.map(k=>({label:LEVELS[k].name,spec:LEVELS[k]}));
  let ri=0, ai=0;
  const scores={};
  (function next(){
    if(ri>=rungs.length){
      say('');
      say('summary (score = points out of '+ELO_GAMES+' per anchor):');
      rungs.forEach(r=>say('  '+r.label.padEnd(16)+ANCHORS.map(e=>'Elo'+e+' '+scores[r.label+e]).join('   ')));
      return;
    }
    const rung=rungs[ri], elo=ANCHORS[ai];
    return anchorPairing(rung,elo,ELO_GAMES).then(t=>{
      const pts=(t.w+t.d/2).toFixed(1);
      scores[rung.label+elo]=pts+'/'+ELO_GAMES;
      say('  '+rung.label.padEnd(16)+'vs Elo '+elo+'  →  +'+t.w+' ='+t.d+' -'+t.l+'   ('+pts+'/'+ELO_GAMES+')',
          t.w>t.l?'ok':(t.w<t.l?'bad':'dim'));
      ai++; if(ai>=ANCHORS.length){ ai=0; ri++; say(''); }
      next();
    }).catch(e=>{ say('  FAILED: '+e.message,'bad'); ai++; if(ai>=ANCHORS.length){ai=0;ri++;} next(); });
  })();
});

document.getElementById('run').addEventListener('click',function(){
  this.disabled=true; out.innerHTML='';
  say('LEVELS as index.html ships them:');
  Object.keys(LEVELS).forEach(k=>say('  '+k.padEnd(12)+' '+JSON.stringify(LEVELS[k])));
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
