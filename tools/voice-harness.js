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

fs.writeFileSync(path.join(root, '_vad-harness.html'), out);
console.log('wrote _vad-harness.html' + (process.argv.includes('--fast') ? '  (stale threshold 3s)' : ''));
console.log('open  http://localhost:8934/_vad-harness.html?debug=1');
