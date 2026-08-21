#!/usr/bin/env bash
# Kept as the name every devlog entry and note refers to.
# The real script is publish.sh, which also handles the release target.
exec "$(dirname "$0")/publish.sh" preview
