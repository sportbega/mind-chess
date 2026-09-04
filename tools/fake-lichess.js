//
// A scriptable stand-in for the Lichess Board API — every endpoint
// lichessFetch() in index.html actually calls, faked at the fetch() layer.
//
// Injected into a throwaway copy of index.html by tools/lichess-harness.js —
// never loaded by the real page. Milestone 4 (reconnect/backoff, FEN
// reconciliation, resign/abort) has so far only ever been exercised by
// playing a real game and hoping the wifi does something interesting at the
// right moment — which is exactly what happened (a lucky drop, a deliberate
// wifi cut). This lets a drop, a rejected move, or a malformed event be
// produced on demand instead of waited for.
//
//   __fakeLichess.setUsername('adni')                 what /api/account returns
//   __fakeLichess.setPlaying([{gameId:'g1', fen:...}]) what /api/account/playing returns
//   __fakeLichess.gameFull('g1', {color:'w', moves:''})   push a gameFull event
//   __fakeLichess.gameState('g1', {moves:'e2e4', wtime:590000, btime:600000})
//   __fakeLichess.dropStream('g1')                     the stream errors out from under the app
//   __fakeLichess.endStream('g1')                      the stream closes cleanly (game over, or a drop with no error)
//   __fakeLichess.failNext('/api/challenge/ai', 403, {error:'Missing scope...'})
//   __fakeLichess.log                                  every intercepted request, in order
//   __fakeLichess.reset()                               clear all state between scenarios
//
// WHAT IS REAL HERE AND WHAT IS NOT
//
// Real: index.html itself, unmodified. Every reconnect/backoff/reconciliation/
// resign/abort code path in the app runs exactly as shipped — only the
// network is fake.
//
// Not real: timing. A real dropped stream takes as long as the network takes
// to notice; here it is instant, the moment dropStream() is called. The
// backoff DELAYS in scheduleLichessReconnect() are real setTimeout calls
// though, so a test watching for a reconnect attempt still has to wait for
// them (or the harness's clock) — this fakes the network, not the clock.
//
// Anything not under https://lichess.org passes straight through to the
// real fetch(), so puzzles.json and Supabase calls are unaffected.
(function(){
  const REAL_FETCH = window.fetch.bind(window);
  const state = {
    username: 'harness-user',
    playing: [],           // what /api/account/playing returns
    streams: {},           // gameId -> {push,end,error} for the MOST RECENT stream opened for it
    failures: [],          // [{match, status, body, once}] consumed in order, first match wins
    log: []
  };
  window.__fakeLichess = {
    log: state.log,
    setUsername(name){ state.username = name; },
    setPlaying(arr){ state.playing = arr; },
    addPlaying(game){ state.playing.push(game); },
    removePlaying(gameId){ state.playing = state.playing.filter(g => g.gameId !== gameId); },
    // One-shot failure injection for a non-streaming endpoint. `match` is
    // matched against the request path (e.g. '/api/challenge/ai', or a
    // RegExp). Consumed the next time a matching request is made.
    failNext(match, status, body){
      state.failures.push({ match, status, body: body || {}, once: true });
    },
    stream(gameId){
      const s = state.streams[gameId];
      if (!s) throw new Error('no open stream for game ' + gameId + ' — open one first (the app calls fetch on watch/seek-match/AI-challenge/reconnect)');
      return s;
    },
    // gameFull/gameState push convenience — mirrors the real event shape
    // closely enough for handleLichessEvent() to accept it as-is.
    gameFull(gameId, opts){
      opts = opts || {};
      const color = opts.color || 'w';
      this.stream(gameId).push({
        type: 'gameFull',
        id: gameId,
        white: { id: color === 'w' ? state.username : (opts.opponent || 'opponent'), name: opts.whiteName },
        black: { id: color === 'b' ? state.username : (opts.opponent || 'opponent'), name: opts.blackName },
        state: {
          moves: opts.moves || '',
          wtime: opts.wtime != null ? opts.wtime : 600000,
          btime: opts.btime != null ? opts.btime : 600000,
          status: opts.status || 'started'
        }
      });
    },
    gameState(gameId, opts){
      opts = opts || {};
      this.stream(gameId).push({
        type: 'gameState',
        moves: opts.moves || '',
        wtime: opts.wtime != null ? opts.wtime : 600000,
        btime: opts.btime != null ? opts.btime : 600000,
        status: opts.status || 'started'
      });
    },
    // The stream erroring out from under the app — a dropped connection, a
    // backgrounded-tab throttle, a Lichess hiccup. This is the case
    // scheduleLichessReconnect() exists for.
    dropStream(gameId, err){
      this.stream(gameId).error(err || new TypeError('Failed to fetch'));
    },
    // The stream closing cleanly with no error — either a real game-over
    // (the app should NOT reconnect if gameOver is already true) or a plain
    // drop the browser reported as a clean close rather than an error (the
    // app should still reconnect if the game isn't over).
    endStream(gameId){
      this.stream(gameId).end();
    },
    reset(){
      state.username = 'harness-user';
      state.playing = [];
      state.streams = {};
      state.failures.length = 0;
      state.log.length = 0;
    }
  };

  function pathOf(url){
    return url.replace(/^https:\/\/lichess\.org/, '');
  }
  function takeFailure(path){
    const i = state.failures.findIndex(f =>
      f.match instanceof RegExp ? f.match.test(path) : path.indexOf(f.match) !== -1);
    if (i === -1) return null;
    return state.failures.splice(i, 1)[0];
  }
  function errorResponse(status, body){
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }
  function jsonResponse(body){
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  // A stream response backed by a REAL ReadableStream, so res.body.getReader()
  // behaves exactly as it does against the genuine Lichess API — no hand-
  // rolled reader object to keep in sync with the fetch spec.
  // Wiring the AbortSignal to the stream is not optional: leaveLichess()'s
  // whole cleanup path is streamController.abort(), and the app tells a
  // deliberate abort apart from a real drop by checking err.name==='AbortError'
  // in the reader loop's catch. A fake that let the old stream keep
  // delivering events after abort() would give a false pass on exactly the
  // bug this exists to catch — found live: a second "Play the Lichess
  // computer" click while already connected left the first game's stream
  // able to overwrite lichessState until this was added.
  function streamResponse(gameId, signal){
    let controller;
    const body = new ReadableStream({ start(c){
      controller = c;
      if (signal) {
        const abort = () => { try{ c.error(new DOMException('The operation was aborted.', 'AbortError')); }catch(e){} };
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort);
      }
    }});
    const encoder = new TextEncoder();
    state.streams[gameId] = {
      push(evt){ controller.enqueue(encoder.encode(JSON.stringify(evt) + '\n')); },
      end(){ try{ controller.close(); }catch(e){} },
      error(err){ try{ controller.error(err); }catch(e){} }
    };
    return new Response(body, { status: 200 });
  }

  window.fetch = function(url, opts){
    const u = String(url);
    if (!u.startsWith('https://lichess.org')) return REAL_FETCH(url, opts);
    const path = pathOf(u);
    const method = (opts && opts.method) || 'GET';
    state.log.push({ method, path, at: Date.now() });

    const failure = takeFailure(path);
    if (failure) return Promise.resolve(errorResponse(failure.status, failure.body));

    if (path === '/api/account') return Promise.resolve(jsonResponse({ username: state.username }));
    if (path === '/api/account/playing') return Promise.resolve(jsonResponse({ nowPlaying: state.playing }));

    let m;
    if ((m = path.match(/^\/api\/board\/game\/stream\/([^/]+)$/))) {
      return Promise.resolve(streamResponse(m[1], opts && opts.signal));
    }
    if (path === '/api/board/seek') {
      // Real behaviour: holds the connection open until matched or it times
      // out. The app only drains this body, never reads it — so an
      // open-forever stream (closed only by the app's own abort() when the
      // seek is cancelled) is a faithful fake with no extra bookkeeping.
      return Promise.resolve(streamResponse('seek:' + Date.now(), opts && opts.signal));
    }
    if (path === '/api/challenge/ai') {
      const gameId = 'ai-' + Date.now();
      return Promise.resolve(jsonResponse({ id: gameId }));
    }
    if (/^\/api\/board\/game\/[^/]+\/move\/[^/]+$/.test(path)) return Promise.resolve(jsonResponse({ ok: true }));
    if (/^\/api\/board\/game\/[^/]+\/resign$/.test(path)) return Promise.resolve(jsonResponse({ ok: true }));
    if (/^\/api\/board\/game\/[^/]+\/abort$/.test(path)) return Promise.resolve(jsonResponse({ ok: true }));

    return Promise.resolve(errorResponse(404, { error: 'fake-lichess.js: unhandled path ' + path }));
  };
})();
