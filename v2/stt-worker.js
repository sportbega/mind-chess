// D2. Local speech recognition, off the UI thread.
//
// Same-origin on purpose. `new Worker(<cross-origin URL>)` is blocked in some
// browsers and in the agent's browser pane (Day 2.3), which is exactly why
// Stockfish is self-hosted next to index.html. This file follows that pattern:
// the *worker* is local, and it pulls Transformers.js in with a dynamic import
// from inside, where a cross-origin ESM import is allowed.
//
// It must be a worker rather than a main-thread call. A Moonshine run on a
// short utterance is on the order of a few hundred milliseconds, and the main
// thread is simultaneously driving the board, the audio graph and the mic
// meter. Blocking it would drop capture frames — the recogniser would degrade
// the very audio it is transcribing.
//
// Protocol (main thread → worker):
//   {type:'load', model, device, remote}   fetch weights and warm the model
//   {type:'transcribe', id, pcm, rate}     pcm = Float32Array, mono
// Worker → main thread:
//   {type:'ready'|'progress'|'error'|'result'}
//
// The audio arrives as a transferred ArrayBuffer, so nothing is copied.

let asr = null;
let loading = null;
let genOpts = {};     // what to pass at generation time, decided once at load

// Transformers.js ships its own ONNX runtime. Pinned, like every other
// dependency here: an ASR model that silently changes its tokenizer between
// versions would show up as "voice got worse" with nothing in the diff.
const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

async function load(msg) {
  if (asr) return asr;
  if (loading) return loading;

  loading = (async () => {
    const t0 = Date.now();
    const lib = await import(TJS);
    const { pipeline, env } = lib;

    // When the weights are served from our own origin, say so — otherwise
    // Transformers.js goes to the Hugging Face CDN regardless of what is
    // sitting in the folder next to us.
    if (!msg.remote) {
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      // Resolved against the page, not against this worker.
      env.localModelPath = new URL('models/', self.location.href).href;
    }

    // Pinning the language stops a *multilingual* model deciding a clipped
    // English word is Welsh — the same reason the narration language is
    // pinned. An English-only build has no such choice to make and throws
    // outright if you try to pin it, so ask which kind this is rather than
    // passing the option to everything and hoping.
    genOpts = /(^|\/)(moonshine|.*\.en)(-|$)/i.test(msg.model) ? {} : { language: 'en' };

    const asrPipe = await pipeline('automatic-speech-recognition', msg.model, {
      device: msg.device,          // 'webgpu' | 'wasm'
      dtype: msg.dtype,
      progress_callback: p => {
        // Only the byte-level events carry a total; the rest are status
        // strings that would make the progress bar jump backwards.
        if (p && p.status === 'progress' && p.total) {
          self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
        }
      }
    });

    // Warm the graph on a scrap of silence. D1 measured the first Kokoro
    // generation at ~1.9s against ~400ms warm; the same shape applies here,
    // and without this the cost lands on the user's first spoken move —
    // the single worst moment to be slow, because they have no idea yet
    // whether the feature works at all.
    try {
      await asrPipe(new Float32Array(16000 * 0.5), genOpts);
    } catch (e) { /* a failed warm-up is not a failed load */ }

    asr = asrPipe;
    self.postMessage({ type: 'ready', ms: Date.now() - t0, device: msg.device });
    return asrPipe;
  })();

  loading.catch(err => {
    loading = null;
    self.postMessage({ type: 'error', where: 'load', message: String(err && err.message || err) });
  });
  return loading;
}

self.onmessage = async e => {
  const msg = e.data;

  if (msg.type === 'load') { load(msg); return; }

  if (msg.type === 'transcribe') {
    try {
      // Wait for the load that is already configured — never start one from
      // *this* message. A transcribe carries no model/device/remote fields, so
      // load(msg) would quietly ask for model `undefined` with remote fetching
      // disabled. That only stays hidden while the real load succeeds; the
      // moment it fails, every utterance reports a baffling "file not found
      // locally" instead of the actual load error.
      if (!asr && !loading) {
        self.postMessage({ type: 'error', where: 'transcribe', id: msg.id,
                           message: 'model not loaded' });
        return;
      }
      const pipe = await (asr || loading);
      if (!pipe) return;
      const pcm = new Float32Array(msg.pcm);
      const t0 = Date.now();

      const out = await pipe(pcm, genOpts);

      self.postMessage({
        type: 'result',
        id: msg.id,
        text: (out && out.text || '').trim(),
        ms: Date.now() - t0,
        audioMs: Math.round(pcm.length / (msg.rate || 16000) * 1000)
      });
    } catch (err) {
      self.postMessage({
        type: 'error', where: 'transcribe', id: msg.id,
        message: String(err && err.message || err)
      });
    }
  }
};
