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
  const listeners={};
  function Result(alts,isFinal){
    const r={length:alts.length,isFinal:isFinal};
    alts.forEach((t,i)=>{ r[i]={transcript:t,confidence:0.9-i*0.05}; });
    return r;
  }
  function FakeSR(){
    this.lang='en-US'; this.interimResults=false; this.maxAlternatives=1; this.continuous=false;
    this.onstart=this.onspeechstart=this.onresult=this.onerror=this.onend=null;
    this._started=false;
    window.__fakeSR=this;
  }
  FakeSR.prototype.start=function(){
    if(this._started) throw new Error('already started');
    this._started=true;
    window.__srLog.push({t:Date.now(),ev:'start'});
    if(this.onstart) this.onstart();
  };
  FakeSR.prototype.stop=function(){ this._end('stop'); };
  FakeSR.prototype.abort=function(){ this._end('abort'); };
  FakeSR.prototype._end=function(how){
    if(!this._started) return;
    this._started=false;
    window.__srLog.push({t:Date.now(),ev:how});
    if(this.onend) this.onend();
  };
  // ---- control surface
  FakeSR.prototype.hear=function(alts,isFinal){
    if(!this._started){ window.__srLog.push({t:Date.now(),ev:'DROPPED (mic closed): '+alts[0]}); return false; }
    window.__srLog.push({t:Date.now(),ev:(isFinal?'final':'interim')+': '+alts[0]});
    if(this.onresult) this.onresult({resultIndex:0,results:[Result(alts,isFinal)]});
    return true;
  };
  FakeSR.prototype.fail=function(err){
    window.__srLog.push({t:Date.now(),ev:'error '+err});
    this._started=false;
    if(this.onerror) this.onerror({error:err});
    if(this.onend) this.onend();
  };
  window.__srLog=[];
  window.SpeechRecognition=FakeSR;
  window.webkitSpeechRecognition=FakeSR;

  // Silence real TTS audio but keep the event contract, so narration timing
  // is exercised without 40 seconds of a robot voice in the test.
  const realSpeak=window.speechSynthesis.speak.bind(window.speechSynthesis);
  window.__spoken=[];
  let queue=0, timer=null;
  const ss=window.speechSynthesis;
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
    get speaking(){ return queue>0; },
    get pending(){ return false; },
    getVoices(){ return []; },
    cancel(){ queue=0; if(timer){clearTimeout(timer);timer=null;} window.__spoken.push({cancelled:true,t:Date.now()}); },
    speak(u){
      queue++;
      window.__spoken.push({text:u.text,t:Date.now()});
      // ~55ms per word stands in for real speech at rate 0.7 without the wait
      const ms=Math.max(120,u.text.split(/\s+/).length*55);
      timer=setTimeout(()=>{ queue--; timer=null; if(u.onend) u.onend(); },ms);
    }
  }});
})();
