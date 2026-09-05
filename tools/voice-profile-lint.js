#!/usr/bin/env node
//
// Does a saved voice-calibration profile introduce a collision?
//
//   node tools/voice-profile-lint.js <profile.json>
//   node tools/voice-profile-lint.js --self-test
//
// A calibration profile (what index.html saves to
// localStorage['mind-chess-v2-voice-profile']) maps each of the 22
// calibration words — 8 files, 8 digits, 6 piece words, see
// voiceProfileWordList() — to the raw phrases one specific speaker was
// confirmed saying for it. voiceProfileSounds() in tokenDistance() only ever
// consults samples[candTok] when scoring a candidate token EQUAL to candTok
// — a keyed lookup, not a shared phonetic hash — so unlike phon(), a profile
// entry cannot by construction bias scoring toward the WRONG candidate
// through this mechanism alone: a sample stored under "knight" is never
// consulted while scoring a "bishop" candidate.
//
// What a profile CAN still do is encode bad data, and that is what this
// checks for, mirroring tools/phon-collisions.js's role for the shared
// phon() encoder:
//
//   1. Same-profile duplicates — a confirmed sample recorded for two
//      DIFFERENT calibration words (a confused calibration turn: the
//      speaker or the recognizer got two different steps confused, and the
//      yes/no confirm didn't catch it). This is a real problem — the
//      profile now claims the same sound means two different things — and
//      fails the run.
//   2. Reserved-word shadowing — a confirmed sample that, once run through
//      the app's own speechKey(), exactly matches a word Q_STOP or
//      PIECE_WORDS already reserves for something else. Printed as
//      advisory, not a failure: voiceProfileSounds()'s per-key scoping
//      means this can't leak into unrelated matching the way a phon()
//      collision could, but it's still worth a human's attention — it
//      usually means the calibration sample is noise, not signal.
//
// Everything semantic is lifted straight out of index.html, the same
// convention tools/phon-collisions.js already established — this checks
// what index.html actually does, not a description of it that can drift.

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
  // NATO/NUMWORD/NATO_RE/HOMO/HOMO_RE/preprocess() are one contiguous block.
  lift('const NATO={', '\n  }', 'NATO..preprocess()') + '\n' +
  lift('const FILE_WORDS={', '};', 'FILE_WORDS') + '\n' +
  lift('function speechKey(raw){', '\n  }', 'speechKey()') + '\n' +
  lift('const PIECE_WORDS = {', '\n  };', 'PIECE_WORDS') + '\n' +
  lift('const Q_STOP=new Set(', '.split(\' \'));', 'Q_STOP') + '\n' +
  lift('function voiceProfileWordList(){', '\n  }', 'voiceProfileWordList()') + '\n' +
  'scope.speechKey=speechKey; scope.PIECE_WORDS=PIECE_WORDS; scope.Q_STOP=Q_STOP; ' +
  'scope.voiceProfileWordList=voiceProfileWordList;'
)(scope);

const { speechKey, PIECE_WORDS, Q_STOP, voiceProfileWordList } = scope;
const CALIB_WORDS = voiceProfileWordList();

function loadProfile(argPath) {
  if (argPath === '--self-test') {
    // A synthetic profile exercising both failure modes at once, the same
    // role WORDS plays in phon-collisions.js: this tool must be able to
    // prove it catches something before it can be trusted to say nothing
    // was found in a real one.
    return {
      version: 1,
      samples: {
        b: ['bee'],
        bishop: ['bee'],                 // duplicate of "b" — same-profile collision
        knight: ['nite', 'can'],         // "can" also happens to be Q_STOP's "can" — shadowing
        e: ['ee'],
        f: ['eff']
      }
    };
  }
  if (!argPath) {
    console.error('usage: node tools/voice-profile-lint.js <profile.json>');
    console.error('       node tools/voice-profile-lint.js --self-test');
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(argPath, 'utf8'));
  return raw;
}

const profile = loadProfile(process.argv[2]);
const samples = profile.samples || {};

const unknownKeys = Object.keys(samples).filter(k => !CALIB_WORDS.includes(k));
if (unknownKeys.length) {
  console.error('Profile has keys voiceProfileWordList() does not recognise — index.html\'s ' +
    'calibration vocabulary moved, or this profile is stale: ' + unknownKeys.join(', '));
  process.exit(2);
}

// ---- 1. same-profile duplicates ----
// Every sample, normalised through the real speechKey(), against every
// OTHER token's samples. A profile is small (<=22 keys, a handful of
// samples each) so the naive all-pairs scan costs nothing.
const dupHits = [];
const tokens = Object.keys(samples);
for (let i = 0; i < tokens.length; i++) {
  for (let j = i + 1; j < tokens.length; j++) {
    const a = tokens[i], b = tokens[j];
    (samples[a] || []).forEach(sa => {
      const ka = speechKey(sa).trim();
      (samples[b] || []).forEach(sb => {
        if (ka && ka === speechKey(sb).trim()) {
          dupHits.push('"' + sa + '" (recorded for "' + a + '") == "' + sb + '" (recorded for "' + b + '")  ->  ' + ka);
        }
      });
    });
  }
}

// ---- 2. reserved-word shadowing ----
const shadowHits = [];
tokens.forEach(tok => {
  (samples[tok] || []).forEach(s => {
    const k = speechKey(s).trim();
    // A sample that correctly normalises back to its own token (file letters
    // and digits legitimately collide with common short words — "a" is both
    // the file and an English article Q_STOP has to strip) is a GOOD
    // calibration entry, not shadowing. Only a sample landing on some OTHER
    // reserved word is the case worth a look.
    if (!k || k === tok) return;
    if (Q_STOP.has(k)) shadowHits.push(pad('"' + s + '" (' + tok + ')') + k + '  ->  Q_STOP (question vocabulary)');
    else if (PIECE_WORDS[k] && PIECE_WORDS[k] !== PIECE_WORDS[tok] && !/^[a-h1-8]$/.test(tok))
      shadowHits.push(pad('"' + s + '" (' + tok + ')') + k + '  ->  PIECE_WORDS says ' + PIECE_WORDS[k] + ', not ' + (PIECE_WORDS[tok] || tok));
  });
});

function pad(w) { return (w + '                                        ').slice(0, 40); }
function report(title, hits) {
  console.log('\n' + title);
  console.log(hits.length ? hits.map(h => '  ' + h).join('\n') : '  none');
  return hits.length;
}

console.log('Checked ' + tokens.length + ' calibrated word(s), ' +
  Object.values(samples).reduce((n, v) => n + v.length, 0) + ' sample(s) total, against ' +
  Q_STOP.size + ' Q_STOP words and ' + Object.keys(PIECE_WORDS).length + ' PIECE_WORDS.');

const d = report('Same-profile duplicates (two calibration words claiming the same sound):', dupHits);
const s = report('Reserved-word shadowing (advisory — cannot leak into unrelated matching, but likely noise):', shadowHits);

if (d) {
  console.log('\n' + d + ' duplicate(s). Each pair means the profile now claims one sound means two ' +
    'different things — reset the profile and recalibrate the affected words rather than editing the ' +
    'JSON by hand.');
  process.exitCode = 1;
} else {
  console.log('\nNo same-profile duplicates.' + (s ? ' Shadowing above is worth a look but does not fail this check.' : ''));
}
