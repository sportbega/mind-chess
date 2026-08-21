#!/usr/bin/env node
//
// Build the voice test harness:  node tools/voice-harness.js [--fast]
//
// Writes _vad-harness.html — index.html with tools/fake-recognizer.js injected
// ahead of the app, so the voice pipeline can be driven without a microphone.
// Open it at /_vad-harness.html?debug=1 and drive window.__fakeSR.
//
// The output is generated, never committed (see .gitignore) and never drifts,
// because it is rebuilt from the current index.html every time.
//
// --fast shrinks the stale-session threshold from 90s to 3s so the "onend was
// never delivered" recovery can be tested without waiting a minute and a half.
// Leave it off when testing the restart/give-up logic, or the watchdog will
// keep forcing sessions and you will be measuring the harness, not the app.
//
// --no-gpu hides navigator.gpu, which is the only way to exercise D1's
// fallback on a machine that has WebGPU: the natural voice must refuse to
// load, say so, revert the Speech setting, and leave the game talking.

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const fake = fs.readFileSync(path.join(__dirname, 'fake-recognizer.js'), 'utf8');

const ANCHOR = '<script>\n(function(){\n  "use strict";';
const at = page.indexOf(ANCHOR);
if (at === -1) throw new Error('Could not find the app script in index.html — has its opening changed?');

let out = page.slice(0, at) + '<script>\n' + fake + '\n</script>\n' + page.slice(at);

if (process.argv.includes('--fast')) {
  const before = out;
  out = out.replace('const STALE_SESSION_MS=90000;', 'const STALE_SESSION_MS=3000;   // HARNESS --fast');
  if (out === before) throw new Error('--fast could not find STALE_SESSION_MS; it was renamed or removed');
}

if (process.argv.includes('--no-gpu')) {
  out = out.replace('<script>\n(function(){\n  "use strict";',
    '<script>\n// HARNESS --no-gpu: pretend WebGPU is absent, to exercise the D1 fallback.\n'
    + 'Object.defineProperty(navigator, "gpu", { get(){ return undefined; }, configurable: true });\n'
    + '</script>\n<script>\n(function(){\n  "use strict";');
}

// --fake-kokoro stands in for the 326 MB natural voice with a generator that
// costs a realistic amount of time and returns real, playable silence.
//
// The Kokoro paths — rendering ahead, the reserved reply, barge-in through an
// <audio> element — are the ones that only run when the natural voice is
// selected, which means they were only ever exercisable by downloading a
// third of a gigabyte first. That is the same problem Phase B had with the
// microphone, and it gets the same answer: fake the input, keep every line of
// app code real. Only the model is replaced; kokoroClipFor(), the ahead
// buffer, the reserve and the playback path all run exactly as they ship.
if (process.argv.includes('--fake-kokoro')) {
  const genMs = (()=>{ const a=process.argv.find(x=>x.startsWith('--gen-ms=')); return a?+a.slice(9):1300; })();
  const ANCHOR_GPU = "      if(!await hasWebGPU()) throw new Error('this browser has no WebGPU');";
  if (out.indexOf(ANCHOR_GPU) === -1) throw new Error('--fake-kokoro could not find the WebGPU check in loadKokoro(); it moved or was reworded');
  out = out.replace(ANCHOR_GPU,
    '      // HARNESS --fake-kokoro\n'
    + '      if(window.__fakeKokoro){ kokoro=window.__fakeKokoro; note(\'\'); micEvent(\'tts\',\'kokoro ready (FAKE)\'); return kokoro; }\n'
    + ANCHOR_GPU);

  const fakeKokoro = `
// A generator with Kokoro's shape and Kokoro's latency, and none of its bytes.
// Cost is deliberately length-dependent, the way the real one is, so a short
// first chunk still looks cheaper than a long one.
(function(){
  "use strict";
  function silentWav(seconds){
    const rate=8000, n=Math.max(1,Math.round(rate*seconds));
    const buf=new ArrayBuffer(44+n*2), v=new DataView(buf);
    const tag=(off,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(off+i,s.charCodeAt(i)); };
    tag(0,'RIFF'); v.setUint32(4,36+n*2,true); tag(8,'WAVE'); tag(12,'fmt ');
    v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
    v.setUint32(24,rate,true); v.setUint32(28,rate*2,true); v.setUint16(32,2,true);
    v.setUint16(34,16,true); tag(36,'data'); v.setUint32(40,n*2,true);
    return new Blob([buf],{type:'audio/wav'});
  }
  window.__fakeKokoro={
    generate:function(text,opts){
      const chars=String(text).length;
      const cost=${genMs}*(0.45+chars/90);          // roughly what the real one charges
      const speech=Math.max(0.4,chars/14);          // and roughly how long it speaks for
      return new Promise(function(resolve){
        setTimeout(function(){ resolve({ toBlob:function(){ return silentWav(speech); } }); },cost);
      });
    }
  };
  console.log('[harness] fake Kokoro installed, base gen cost ${genMs}ms');
})();
`;
  out = out.replace('<script>\n(function(){\n  "use strict";',
    '<script>\n' + fakeKokoro + '\n</script>\n<script>\n(function(){\n  "use strict";');
}

fs.writeFileSync(path.join(root, '_vad-harness.html'), out);
console.log('wrote _vad-harness.html'
  + (process.argv.includes('--fast') ? '  (stale threshold 3s)' : '')
  + (process.argv.includes('--no-gpu') ? '  (no WebGPU)' : '')
  + (process.argv.includes('--fake-kokoro') ? '  (fake Kokoro)' : ''));
console.log('open  http://localhost:8934/_vad-harness.html?debug=1');
