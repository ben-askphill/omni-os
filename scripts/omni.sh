#!/usr/bin/env bash
# The omni command (crates/omni-cli, docs/user/cli.md) run from this checkout, for a machine without the desktop app
# or a dev server started with npm run dev. The desktop app installs its own `omni`; use that one where it runs.
#
#   scripts/omni.sh new "check the volero feed import" -c volero
#   scripts/omni.sh --help
#
# It talks to OMNI_URL (default http://127.0.0.1:4747) with OMNI_TOKEN, else this checkout's data/api-token
# (OMNI_DATA_DIR moves it). It builds the command into target/debug first, which needs cargo (https://rustup.rs)
# and a C compiler. Cargo does nothing when the build is current.
set -euo pipefail

self="$0"
while [[ -L "$self" ]]; do
  link="$(readlink "$self")"
  [[ "$link" == /* ]] && self="$link" || self="$(dirname "$self")/$link"
done
REPO="$(cd "$(dirname "$self")/.." && pwd)"
command -v cargo >/dev/null || { printf 'omni: running it from a checkout needs cargo. Install Rust from https://rustup.rs.\n' >&2; exit 3; }
# From the repo root, where rust-toolchain.toml pins the toolchain. Its output goes to stderr, so a caller reading
# stdout gets only the command's.
(cd "$REPO" && cargo build --locked --quiet -p omni-cli --target-dir "$REPO/target") >&2 ||
  { printf 'omni: cargo could not build the omni command in %s.\n' "$REPO" >&2; exit 3; }

export OMNI_INSTALL_DATA_DIR="${OMNI_INSTALL_DATA_DIR:-$REPO/data}"
exec "$REPO/target/debug/omni" "$@"
