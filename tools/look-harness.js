#!/usr/bin/env node
//
// Build the visual preview:  node tools/look-harness.js
//
// Writes _look.html — index.html with its <style> block swapped for
// tools/look.css, so the (d)chess visual language can be judged on a real
// screen without touching the release candidate.
//
// The swap is wholesale rather than an override sheet on purpose: what you
// judge here is exactly the block that would be pasted into index.html if you
// like it. An override would mean approving one thing and landing another.
//
// Generated, never committed, rebuilt from the current index.html every time —
// same contract as tools/voice-harness.js, for the same reason.

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const look = fs.readFileSync(path.join(__dirname, 'look.css'), 'utf8').trim();

const open = page.indexOf('<style>');
const close = page.indexOf('</style>', open);
if (open === -1 || close === -1) throw new Error('Could not find the <style> block in index.html');

// Guard against the silent half of this: if index.html grows a selector the
// new sheet has never heard of, the preview would quietly render it unstyled
// and look like a design decision. Report it instead.
const old = page.slice(open, close + 8);
const classesIn = css => new Set((css.match(/\.[a-zA-Z][\w-]*/g) || []));
const missing = [...classesIn(old)].filter(c => !classesIn(look).has(c)).sort();

const out = page.slice(0, open) + look + page.slice(close + 8);
fs.writeFileSync(path.join(root, '_look.html'), out);

console.log('wrote _look.html  (' + old.split('\n').length + ' style lines -> ' + look.split('\n').length + ')');
if (missing.length) {
  console.log('\nselectors the old sheet styled and the new one does not:');
  missing.forEach(c => console.log('  ' + c));
  console.log('\nthese will render unstyled in the preview.');
} else {
  console.log('every selector the old sheet styled is covered.');
}
console.log('\nopen  http://localhost:8934/_look.html');
