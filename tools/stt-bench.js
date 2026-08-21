#!/usr/bin/env node
//
// Build the speech-recognition bench:  node tools/stt-bench.js [dtype...]
//
// Writes _stt-bench.html, then open it at /_stt-bench.html and press Run.
// Generated, never committed (see .gitignore), rebuilt from index.html every
// time so it cannot drift from what the app actually ships.
//
// The problem it solves: there is no microphone in the agent's browser, so
// D2's recogniser was unmeasurable the same way Phase B's mic pipeline was.
// Phase B's answer was to fake the input; this is the same move one layer
// down. Kokoro *speaks* a chess command, the clip is resampled to 16 kHz and
// handed to the same stt-worker.js the app uses, and we see what came back.
//
// Synthetic audio is optimistic — no room, no accent, no clipping, no rustle
// — so treat a failure here as real and a success here as "not yet disproved".
// It is still the only way to compare two dtypes on identical input.
//
// What it has already found:
//   - q8 will not load at all in Transformers.js 4.2.0 (MatMulNBits missing
//     scale), for Moonshine *and* Whisper. Not a Moonshine quirk.
//   - fp32 is about twice as fast as q4 on WASM, despite being twice the
//     download — the same inversion D1 measured for Kokoro.
//   - padding an utterance with silence makes accuracy worse, not better.
//   - a bug in stt-worker.js: a transcribe message was starting its own
//     load() and asking for model `undefined`.

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Read the shipping model out of the app rather than restating it here, so
// benching something the app no longer uses is not possible.
const grab = re => { const m = page.match(re); return m ? m[1] : null; };
const MODEL = grab(/let sttModel\s*=\s*'([^']+)'/);
const DTYPE = grab(/let sttDtype\s*=\s*'([^']+)'/);
if (!MODEL) throw new Error('Could not find sttModel in index.html — has it been renamed?');

const dtypes = process.argv.slice(2);
if (!dtypes.length) dtypes.push(DTYPE || 'fp32');

const PHRASES = [
  'knight to f3', 'bishop takes c4', 'castle kingside', 'queen h5 checkmate',
  'pawn to e4', 'rook a1', 'e7 e5', 'knight takes d5 check',
  'what is on the board', 'how am I doing', 'where is my queen', 'resign'
];

const html = `<!doctype html>
<meta charset="utf-8">
<title>Mind Chess — STT bench</title>
<style>
 body{font:14px/1.5 ui-monospace,Menlo,monospace;margin:2rem;max-width:70rem}
 td,th{padding:.2rem .6rem;border-bottom:1px solid #ddd;vertical-align:top}
 .ok{color:#0a0}.bad{color:#c00}.empty{color:#c60}
 button{font:inherit;padding:.4rem 1rem}
</style>
<h1>STT bench — ${MODEL}</h1>
<p>dtypes: <b>${dtypes.join(', ')}</b> · ${PHRASES.length} phrases spoken by Kokoro, heard back by the app's own worker.</p>
<button id="run">Run</button> <span id="stage"></span>
<table id="out"><thead><tr><th>dtype<th>ms<th>said<th>heard</tr></thead><tbody></tbody></table>
<script type="module">
const MODEL=${JSON.stringify(MODEL)}, DTYPES=${JSON.stringify(dtypes)}, PHRASES=${JSON.stringify(PHRASES)};
const tbody=document.querySelector('#out tbody'), stage=document.getElementById('stage');
const row=(...c)=>{const tr=document.createElement('tr');c.forEach(x=>{const td=document.createElement('td');
  if(x&&x.cls){td.className=x.cls;td.textContent=x.t;}else td.textContent=x;tr.appendChild(td);});tbody.appendChild(tr);};

document.getElementById('run').onclick=async()=>{
  document.getElementById('run').disabled=true;
  stage.textContent=' loading Kokoro…';
  const {KokoroTTS}=await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm');
  const tts=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'q8',device:'wasm'});
  await tts.generate('warm up',{voice:'af_heart'});   // D1: the first generation is a cold start

  stage.textContent=' generating clips…';
  const clips=[];
  for(const p of PHRASES){
    const a=await tts.generate(p,{voice:'af_heart'});
    const off=new OfflineAudioContext(1,Math.ceil(a.audio.length*16000/a.sampling_rate),16000);
    const b=off.createBuffer(1,a.audio.length,a.sampling_rate); b.copyToChannel(a.audio,0);
    const s=off.createBufferSource(); s.buffer=b; s.connect(off.destination); s.start();
    clips.push({text:p,pcm:(await off.startRendering()).getChannelData(0).slice()});
  }

  for(const dt of DTYPES){
    stage.textContent=' loading '+dt+'…';
    await new Promise(res=>{
      const w=new Worker('stt-worker.js',{type:'module'});
      let i=0;
      const next=()=>{
        if(i>=clips.length){ w.terminate(); res(); return; }
        const cp=clips[i].pcm.slice();
        w.postMessage({type:'transcribe',id:i,pcm:cp.buffer,rate:16000},[cp.buffer]);
      };
      w.onmessage=e=>{
        const m=e.data;
        if(m.type==='ready'){ stage.textContent=' transcribing '+dt+'…'; next(); return; }
        if(m.type==='result'){
          const want=clips[m.id].text;
          const norm=t=>t.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\\s+/g,' ').trim();
          const cls=!m.text?'empty':(norm(m.text)===norm(want)?'ok':'bad');
          row(dt,m.ms,want,{cls:cls,t:m.text||'(nothing)'});
          i++; next(); return;
        }
        if(m.type==='error'){ row(dt,'—','(load)',{cls:'bad',t:m.message}); w.terminate(); res(); }
      };
      w.onerror=()=>{ row(dt,'—','(worker)',{cls:'bad',t:'failed to start'}); res(); };
      w.postMessage({type:'load',model:MODEL,device:'wasm',dtype:dt,remote:true});
    });
  }
  stage.textContent=' done';
};
</script>
`;

const out = path.join(root, '_stt-bench.html');
fs.writeFileSync(out, html);
console.log('wrote ' + path.relative(root, out) + '  model=' + MODEL + '  dtypes=' + dtypes.join(','));
console.log('open /_stt-bench.html and press Run');
