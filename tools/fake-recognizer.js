//
// A scriptable stand-in for SpeechRecognition and speechSynthesis.
//
// Injected into a throwaway copy of index.html by tools/voice-harness.js —
// never loaded by the real page. Phase B is all about what happens when the
// mic is open while the app is talking, and none of it can be exercised by
// clicking: there is no microphone in the agent's browser, and real speech
// recognition needs live audio, a user gesture and a network service.
//
// So: fake the recognizer and drive the pipeline directly.
//
//   __fakeSR.hear(['knight to f3'], true)   deliver a final result
//   __fakeSR.hear(['no no stop'], false)    deliver an interim result
//   __fakeSR.fail('network')                deliver an error + onend
//   __fakeSR.endSession()                   Chrome closing the session on us
//   __fakeSR.autoEndMs = 7000               silence timeout; 0 disables it
//   __fakeSR._started                       is the mic actually open?
//   __srLog                                 every start/stop/abort/result
//   __spoken                                every utterance and cancel
//
// Utterances resolve at ~55ms/word instead of real time, so a 34-second
// roster answer takes under two seconds to test.
//
// This found four real bugs the first time it ran: a sticky network backoff
// that slowed every restart for the rest of a game, two restart paths racing
// each other, a lost `onend` leaving the app permanently deaf with every
// recovery mechanism gated on the event that went missing, and my own unsound
// test assertion (say() calls speechSynthesis.cancel() itself, so every
// narration looked like a barge-in).
//
// Caveat worth knowing before trusting a timing result here: the agent's
// browser pane clamps timers to ~1s whether or not the tab is fronted. Any
// test that depends on sub-second scheduling will lie to you.
(function(){
  function Result(alts,isFinal){
    const r={length:alts.length,isFinal:isFinal};
    alts.forEach((t,i)=>{ r[i]={transcript:t,confidence:0.9-i*0.05}; });
    return r;
  }

  // How long a session sits in silence before the browser closes it.
  //
  // This is the single most important thing the fake got wrong, and it is why
  // end-to-end checks kept parking the app in a state a real browser never
  // sustains. A real session ENDS ON ITS OWN — the app says so itself, twice:
  // "Chrome ends the session with `no-speech` after any quiet stretch. That is
  // normal operation between moves", and "staying always on means restarting
  // it repeatedly". The whole restart machine — onend, scheduleRestart(), the
  // backoff, shortSessions, STALE_SESSION_MS — exists to service an event the
  // old fake never delivered.
  //
  // The visible symptom was mic state stuck at `speaking` after every
  // narration with "Talk over it" on: endSpeaking() hands the repaint to
  // startListening(), which returns early while `listening` is still true, and
  // in a real browser the session closing a moment later is what rescues it.
  //
  // 7s is roughly Chrome's window, and deliberately well clear of the 1200ms
  // below which the app counts a session as "short" and starts backing off.
  const AUTO_END_MS=7000;

  function FakeSR(){
    this.lang='en-US'; this.interimResults=false; this.maxAlternatives=1; this.continuous=false;
    this.onstart=this.onspeechstart=this.onresult=this.onerror=this.onend=null;
    this._started=false;
    this._silence=null;
    this._speaking=false;          // mid-utterance, for onspeechstart
    this.autoEndMs=AUTO_END_MS;    // set to 0 to hold a session open by hand
    window.__fakeSR=this;
  }
  FakeSR.prototype._armSilence=function(){
    clearTimeout(this._silence);
    if(!this._started||!this.autoEndMs) return;
    this._silence=setTimeout(()=>{ this.endSession('no-speech'); },this.autoEndMs);
  };
  FakeSR.prototype.start=function(){
    // Deliberately a synchronous throw, and deliberately not an async method:
    // Web Speech throws right here when a session is already open, and
    // startListening() catches exactly that. An async function would turn the
    // same throw into a rejected promise that sails straight past the catch.
    if(this._started) throw new Error('already started');
    this._started=true;
    this._speaking=false;
    window.__srLog.push({t:Date.now(),ev:'start'});
    if(this.onstart) this.onstart();
    this._armSilence();
  };
  FakeSR.prototype.stop=function(){ this._end('stop'); };
  FakeSR.prototype.abort=function(){ this._end('abort'); };
  FakeSR.prototype._end=function(how){
    clearTimeout(this._silence); this._silence=null;
    if(!this._started) return;
    this._started=false;
    this._speaking=false;
    window.__srLog.push({t:Date.now(),ev:how});
    if(this.onend) this.onend();
  };
  // ---- control surface
  FakeSR.prototype.hear=function(alts,isFinal){
    if(!this._started){ window.__srLog.push({t:Date.now(),ev:'DROPPED (mic closed): '+alts[0]}); return false; }
    window.__srLog.push({t:Date.now(),ev:(isFinal?'final':'interim')+': '+alts[0]});
    // Real recognition announces that it has heard *something* before it has
    // decided what. The app hangs lastMicActivity and the "Hearing you…" note
    // off that event, and the stale-session watchdog reads lastMicActivity.
    if(!this._speaking){ this._speaking=true; if(this.onspeechstart) this.onspeechstart(); }
    if(this.onresult) this.onresult({resultIndex:0,results:[Result(alts,isFinal)]});
    if(isFinal){
      this._speaking=false;
      // continuous=false ends the session on a final result. The app sets
      // continuous=true, so this is fidelity rather than a path under test —
      // but a flag the fake ignores is a flag that quietly stops meaning
      // anything, which is how the last round of harness rot started.
      if(!this.continuous){ this._end('ended (not continuous)'); return true; }
    }
    this._armSilence();               // speech resets the silence timer
    return true;
  };
  // The browser closing the session on us, as distinct from the app calling
  // stop() or abort(). Chrome reports the quiet-stretch case as an error
  // first and then ends; the app treats that pair as normal operation.
  FakeSR.prototype.endSession=function(err){
    if(!this._started) return false;
    clearTimeout(this._silence); this._silence=null;
    this._started=false;
    this._speaking=false;
    const why=err||'no-speech';
    window.__srLog.push({t:Date.now(),ev:'session ended by browser ('+why+')'});
    if(this.onerror) this.onerror({error:why});
    if(this.onend) this.onend();
    return true;
  };
  FakeSR.prototype.fail=function(err){
    clearTimeout(this._silence); this._silence=null;
    window.__srLog.push({t:Date.now(),ev:'error '+err});
    this._started=false;
    this._speaking=false;
    if(this.onerror) this.onerror({error:err});
    if(this.onend) this.onend();
  };
  window.__srLog=[];
  window.SpeechRecognition=FakeSR;
  window.webkitSpeechRecognition=FakeSR;

  // Silence real TTS audio but keep the event contract, so narration timing
  // is exercised without 40 seconds of a robot voice in the test.
  //
  // speechSynthesis is a SERIAL QUEUE, and modelling it as a counter plus one
  // shared timer handle was wrong in two ways that both corrupt results.
  // Anything speaking out of band — unlockSpeech() spends the page's first
  // gesture on a silent utterance — used to run in parallel with a narration
  // chunk and orphan its timer, and one cancel() later the counter could go
  // NEGATIVE. `speaking` then reads false while the app is still talking, at
  // which point the chunk watchdog advances early and whenSpeechIdle() fires
  // straight through. A harness that lies in that direction is worse than no
  // harness: it makes r21's "wait for narration to end" look untested-but-fine.
  window.__spoken=[];
  const queue=[];                 // utterances waiting behind the current one
  let current=null, timer=null;
  function startNext(){
    if(current||!queue.length) return;
    const u=current=queue.shift();
    // Fire onstart. The old fake never did, and the app hangs lastAudioStartAt
    // off exactly this event — which is what r20's "Test voice" button polls,
    // because speak() returning cleanly is precisely what Day 3.13's mute
    // phone looked like. So the one instrument built to prove audio reached a
    // speaker could only ever FAIL under the harness. An instrument that
    // reports a false alarm is worse than one that reports nothing.
    try{ if(u.onstart) u.onstart(); }catch(e){}
    // ~55ms per word stands in for real speech at rate 0.7 without the wait
    const ms=Math.max(120,String(u.text).split(/\s+/).length*55);
    timer=setTimeout(()=>{
      timer=null; current=null;
      try{ if(u.onend) u.onend(); }catch(e){}
      startNext();
    },ms);
  }
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
    get speaking(){ return !!current; },
    get pending(){ return queue.length>0; },
    getVoices(){ return []; },
    // Day 3.9 gave the app a voice picker, which listens for 'voiceschanged'.
    // This stand-in predates that and had no addEventListener, so loading the
    // harness threw before setupRecognition() ever ran — the whole page dead,
    // and quietly, because nothing re-ran the harness between Day 3.9 and
    // Day 3.12. A fake has to keep up with the interface it is faking.
    addEventListener(){}, removeEventListener(){},
    // No onend on cancel, on purpose. The spec says an end event fires; Chrome
    // routinely drops it, the app is written against Chrome ("Cancelling
    // mid-utterance means onend never fires, so release the speaking gate by
    // hand"), and its chunk watchdog exists for that. Model the browser the
    // app ships against, not the paragraph it was supposed to implement.
    cancel(){
      queue.length=0;
      if(timer){ clearTimeout(timer); timer=null; }
      current=null;
      window.__spoken.push({cancelled:true,t:Date.now()});
    },
    speak(u){
      window.__spoken.push({text:u.text,t:Date.now()});
      queue.push(u);
      startNext();
    }
  }});
})();
