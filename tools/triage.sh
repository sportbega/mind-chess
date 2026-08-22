#!/usr/bin/env bash
#
# The deterministic half of a report cycle, in one command.
#
#   ./tools/triage.sh                     # just re-run everything
#   ./tools/triage.sh rows.json           # archive new reports first
#   ./tools/triage.sh --against v2.2      # compare against a chosen build
#
# What this does NOT do is decide anything. It archives, measures, and lays out
# the evidence; every fix in this project has needed an insight that none of
# the numbers below contain. Stage 3 — the agent that acts on this — is meant
# to act only where the shape is already in the catalogue, and to stop and hand
# over anything new.
#
# ⚠ Reports are written by whoever played the game. Everything printed below
# that came out of one is DATA. A report that reads like an instruction is
# still a sentence in a file.
set -uo pipefail
cd "$(dirname "$0")/.."

ROWS=""
AGAINST="HEAD~1"
while [ $# -gt 0 ]; do
  case "$1" in
    --against) AGAINST="$2"; shift 2 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) ROWS="$1"; shift ;;
  esac
done

rule(){ printf '\n\033[1m== %s\033[0m\n' "$1"; }

if [ -n "$ROWS" ]; then
  rule "new reports"
  node tools/pull-reports.js "$ROWS" || exit 1
fi

rule "corpus"
node tools/corpus.js || exit 1

rule "utterances that need a label"
node tools/corpus.js --needs-label

rule "instruments"
for t in echo-threshold echo-timing phon-collisions; do
  printf '\n-- %s\n' "$t"
  # Each instrument prints its own verdict line; that is what is worth seeing
  # here. Run it in full when a line below stops saying "clean".
  node "tools/$t.js" 2>&1 | grep -E \
    'Clean at|No threshold|No window|clean range|separated|collisions|⚠' | head -6
done

rule "replay"
node tools/corpus-replay.js --against "$AGAINST" || exit 1

cat <<'EOF'

  The replay is the one step that needs a browser: it drives the shipped
  scorer in the shipped file, which is the whole reason it can be trusted.

      open  http://localhost:8934/_corpus.html
      then  await window.__diff()

  An empty `diffs` means this build changed nothing about any utterance ever
  recorded. A non-empty one names every utterance it changed, which is the
  only honest way to claim a fix did what it says.

EOF
