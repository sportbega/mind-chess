#!/usr/bin/env node
//
// Pull new rows out of mind_chess_reports and print them as JSON, ready to
// pipe into pull-reports.js.
//
//   node tools/fetch-reports.js | node tools/pull-reports.js
//   node tools/fetch-reports.js --all | node tools/pull-reports.js
//
// Needs tools/.supabase-read-key — the project's service_role key, pasted in
// with nothing else, no quotes. Gitignored; never leaves this machine.
//
// WHY service_role AND NOT THE ANON KEY
//
// mind_chess_reports has no SELECT policy for anon — see
// supabase/migrations/20260822_create_mind_chess_reports.sql. That is
// deliberate: a report carries whatever a player typed into the description
// box, and a public read policy would put that in front of the next visitor.
// Reading it back needs a key that bypasses RLS, which is what service_role
// is. It grants full read/write on the whole project, not just this table —
// normal for a service key, and exactly why it lives only in this one
// gitignored file and is never sent to a browser.
//
// WHAT "NEW" MEANS
//
// tools/.last-report-id remembers the highest id already fetched, so re-runs
// only bring back rows that arrived since. --all ignores it and fetches
// everything, for a first run or a rebuild from scratch. The marker is
// advanced only after the rows are printed, not before — a crash mid-run
// re-fetches rather than silently drops a report.

const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const keyPath = path.join(__dirname, '.supabase-read-key');
const markerPath = path.join(__dirname, '.last-report-id');
const PROJECT_URL = 'https://lqwssctnvgpxnerahnkc.supabase.co';

if (!fs.existsSync(keyPath)) {
  console.error('missing ' + keyPath);
  console.error('paste the project\'s service_role key into that file (nothing else) and re-run.');
  console.error('Project Settings -> API Keys, in the Supabase dashboard.');
  process.exit(2);
}
const key = fs.readFileSync(keyPath, 'utf8').trim();
if (!key) { console.error(keyPath + ' is empty.'); process.exit(2); }

const all = process.argv.includes('--all');
const since = all ? 0 : (fs.existsSync(markerPath) ? +fs.readFileSync(markerPath, 'utf8').trim() || 0 : 0);

const url = new URL('/rest/v1/mind_chess_reports', PROJECT_URL);
url.searchParams.set('select', '*');
url.searchParams.set('order', 'id.asc');
if (since) url.searchParams.set('id', 'gt.' + since);

https.get(url, {
  headers: { apikey: key, Authorization: 'Bearer ' + key }
}, res => {
  let body = '';
  res.on('data', c => { body += c; });
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error('fetch failed: HTTP ' + res.statusCode);
      console.error(body.slice(0, 500));
      process.exit(1);
    }
    let rows;
    try { rows = JSON.parse(body); } catch (e) {
      console.error('response was not JSON: ' + e.message);
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(rows));
    if (rows.length) {
      const maxId = Math.max(...rows.map(r => +r.id || 0));
      fs.writeFileSync(markerPath, String(maxId));
    }
    console.error('\n' + rows.length + ' row' + (rows.length === 1 ? '' : 's')
      + (since ? ' since id ' + since : ' (all)') + '\n');
  });
}).on('error', e => { console.error('request failed: ' + e.message); process.exit(1); });
