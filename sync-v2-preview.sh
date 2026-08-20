#!/usr/bin/env bash
# Publish the current v2 branch to /v2/ on the live site.
#
# GitHub Pages only serves the default branch, so work on `v2` is invisible
# until it is copied onto `main`. This keeps three builds side by side:
#   /      current release (v1.0 until 2.0 ships)
#   /v1/   v1.0, frozen, byte-identical to the v1.0 tag
#   /v2/   2.0 preview, refreshed by running this script
#
# Run from main after pushing to v2, then commit and push main.
set -euo pipefail
cd "$(dirname "$0")"
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "run this on main"; exit 1; }
mkdir -p v2
for f in index.html stockfish-18-lite-single.js stockfish-18-lite-single.wasm supabase-config.js; do
  git show "v2:$f" > "v2/$f"
done
chmod +x v2/stockfish-18-lite-single.wasm
echo "synced /v2/ from branch v2 @ $(git rev-parse --short v2)"
grep -o "const BUILD='[^']*'" v2/index.html || true
