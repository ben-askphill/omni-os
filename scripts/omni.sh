#!/usr/bin/env bash
# The omni command (apps/cli, docs/user/cli.md) run from this checkout, for a machine without the desktop app or a
# dev server started with npm run dev. The desktop app installs its own `omni`; use that one where it runs.
#
#   scripts/omni.sh new "check the volero feed import" -c volero
#   scripts/omni.sh --help
#
# It talks to OMNI_URL (default http://127.0.0.1:4747) with OMNI_TOKEN, else this checkout's data/api-token
# (OMNI_DATA_DIR moves it). Needs npm install --include=dev here first.
set -euo pipefail

self="$0"
while [[ -L "$self" ]]; do
  link="$(readlink "$self")"
  [[ "$link" == /* ]] && self="$link" || self="$(dirname "$self")/$link"
done
REPO="$(cd "$(dirname "$self")/.." && pwd)"
TSX="$REPO/node_modules/.bin/tsx"
[[ -x "$TSX" ]] || { printf 'omni: %s has no node_modules. Run npm install --include=dev there.\n' "$REPO" >&2; exit 3; }

export OMNI_INSTALL_DATA_DIR="${OMNI_INSTALL_DATA_DIR:-$REPO/data}"
exec "$TSX" "$REPO/apps/cli/src/main.ts" "$@"
