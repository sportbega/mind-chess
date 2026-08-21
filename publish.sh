#!/usr/bin/env bash
#
# Publish the v2 branch to the live site.
#
#   ./publish.sh preview    -> /v2/   the rolling preview, refreshed every session
#   ./publish.sh release    -> /      the released version, only when you mean it
#
# GitHub Pages only serves the default branch, so work on `v2` is invisible
# until it is copied onto `main`. That gives three permanent URLs:
#
#   /      the current release
#   /v1/   v1.0, frozen, byte-identical to the v1.0 tag
#   /v2/   the 2.0 preview, which may run ahead of the release
#
# Both targets copy the same file list from the same branch, from one place —
# a release that shipped a different set of files from the preview it was
# tested against would be the worst possible version of the bug this list has
# already caused once.
#
# Run from main after pushing to v2, then commit and push main.
set -euo pipefail
cd "$(dirname "$0")"

TARGET="${1:-}"
case "$TARGET" in
  preview) DEST="v2" ;;
  release) DEST="."  ;;
  *) echo "usage: $0 preview|release" >&2; exit 2 ;;
esac

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "run this on main"; exit 1; }

FILES="index.html chess-0.10.3.js stockfish-18-lite-single.js stockfish-18-lite-single.wasm supabase-config.js stt-worker.js puzzles.json"

# Forgetting to add a new file here ships a build that is broken live and
# perfect locally, and it has caught us before. The list stays explicit — we
# do not want every stray file at the root published — but anything v2 tracks
# at its root and this list does not mention is now a loud failure rather than
# a silent one.
missing=""
for f in $(git ls-tree --name-only v2 -- . | grep -E '\.(js|wasm|css|html|json)$'); do
  case " $FILES " in *" $f "*) ;; *) missing="$missing $f";; esac
done
if [ -n "$missing" ]; then
  echo "v2 has root files this script does not copy:$missing" >&2
  echo "add them to FILES (or ignore deliberately) before publishing." >&2
  exit 1
fi

mkdir -p "$DEST"
for f in $FILES; do
  git show "v2:$f" > "$DEST/$f"
done
chmod +x "$DEST/stockfish-18-lite-single.wasm"

echo "published $TARGET -> ${DEST}/ from branch v2 @ $(git rev-parse --short v2)"
grep -o "const BUILD='[^']*'" "$DEST/index.html" || true
