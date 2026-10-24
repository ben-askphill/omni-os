#!/usr/bin/env bash
# Starts a throwaway Omni stack for an agent to check its own work: the server on a spare port with its own data
# dir and the fake CLIs, vite in front of it, and a few seeded threads. It never touches :4747 or data/.
#
#   scripts/qa-stack.sh up [--seed N]   start, wait until healthy, seed N sample threads (default 3), print URLs
#   QA_SERVER_PORT=N scripts/qa-stack.sh down
#                                       stop the stack on port N and delete its data dir. The port is required, and it
#                                       only stops processes this checkout started (their PID file and working dir)
#   scripts/qa-stack.sh status          print the URLs, the API token, and whether each process is alive
#   scripts/qa-stack.sh logs            tail the server and vite logs
#
# QA_SERVER_PORT (default 4757) and QA_WEB_PORT (default 4768) move the ports, QA_DIR the state dir
# (default $TMPDIR/omni-qa-<server port>). QA_CLAUDE_BIN, QA_CODEX_BIN and QA_CURSOR_BIN swap a fake CLI for a real one
# (a live turn spends that plan). Otherwise threads run on fake-claude, so a prompt with directives such as
# RICH, TOOL:<ms> or LIMIT drives a turn without spending a plan (see packages/test-fixtures/fake-claude.mjs).
# Cursor Cloud threads talk to a fake Cursor API (packages/test-fixtures/fake-cursor-api.mjs) with a stand-in key, so
# the real CURSOR_API_KEY is never read; they need a channel with a GitHub repo set.
# The stack has its own API token in its data dir: curl it with -H "Authorization: Bearer $(cat <data>/data/api-token)",
# and open the printed web URLs, which pair the browser.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
SERVER_PORT="${QA_SERVER_PORT:-4757}"
WEB_PORT="${QA_WEB_PORT:-4768}"
DIR="${QA_DIR:-${TMPDIR:-/tmp}/omni-qa-$SERVER_PORT}"
API="http://127.0.0.1:$SERVER_PORT/api"
WEB="http://localhost:$WEB_PORT"

die() { echo "qa-stack: $*" >&2; [ "${STARTING:-0}" = 1 ] && down >/dev/null; exit 1; }
# Runs a command in its own process group, so down can stop it and its children together. macOS has no setsid.
detach() {
  if command -v setsid >/dev/null; then setsid "$@"; else perl -e 'setpgrp(0, 0); exec @ARGV or die "exec: $!"' "$@"; fi
}
alive() { [ -f "$DIR/$1.pid" ] && kill -0 "$(cat "$DIR/$1.pid")" 2>/dev/null; }
# The server makes its token on boot. curl with it: api /channels.
tok() { tr -d '[:space:]' <"$DIR/data/api-token" 2>/dev/null || true; }
api() { local p="$1"; shift; curl -fsS -H "Authorization: Bearer $(tok)" "$@" "$API$p"; }
# up starts every process from $ROOT, so a recorded PID whose working dir is elsewhere belongs to another checkout's
# stack on the same port (or is a reused PID), and down must leave it alone.
cwd_of() { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'; }

[ "$SERVER_PORT" != 4747 ] || die "refusing port 4747, that is the live server"

up() {
  local seed=3
  [ "${1:-}" = "--seed" ] && seed="${2:?--seed needs a number}"
  alive server && { echo "already up"; status; return; }
  # The scheduler watches the automations dir and crashes the server when it is missing.
  mkdir -p "$DIR/data" "$DIR/brain" "$DIR/automations"
  STARTING=1
  local fx="$ROOT/packages/test-fixtures"
  # A `security` that answers the global CURSOR_API_KEY with a stand-in and passes every other call to the real one.
  mkdir -p "$DIR/bin"
  cat >"$DIR/bin/security" <<'SH'
#!/bin/sh
[ "$1" = find-generic-password ] && case "$*" in *" -a global/CURSOR_API_KEY "*) echo qa-fake-cursor-key; exit 0 ;; esac
exec /usr/bin/security "$@"
SH
  chmod +x "$DIR/bin/security"
  detach node "$fx/fake-cursor-api.mjs" 0 >"$DIR/cursor-api.log" 2>&1 &
  echo $! >"$DIR/cursor-api.pid"
  local cursor_api=""
  for _ in $(seq 1 20); do
    cursor_api="$(head -1 "$DIR/cursor-api.log" 2>/dev/null)"
    [ -n "$cursor_api" ] && break
    sleep 0.25
  done
  [ -n "$cursor_api" ] || die "fake Cursor API did not start"
  # OMNI_TOKEN cleared: an agent's shell carries the live server's, and this stack makes its own.
  OMNI_TOKEN= OMNI_PORT="$SERVER_PORT" OMNI_DATA_DIR="$DIR/data" OMNI_BRAIN_DIR="$DIR/brain" \
    OMNI_CLAUDE_BIN="${QA_CLAUDE_BIN:-$fx/fake-claude.mjs}" OMNI_CODEX_BIN="${QA_CODEX_BIN:-$fx/fake-codex.mjs}" OMNI_CURSOR_BIN="${QA_CURSOR_BIN:-$fx/fake-cursor.mjs}" \
    OMNI_BROWSER=0 OMNI_SUGGESTIONS=0 OMNI_HERMES_URL= OMNI_AUTOMATIONS_DIR="$DIR/automations" \
    OMNI_CURSOR_API_URL="$cursor_api" OMNI_CURSOR_CLOUD_POLL_MS=1500 PATH="$DIR/bin:$PATH" \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    detach npx tsx apps/server/index.ts >"$DIR/server.log" 2>&1 &
  echo $! >"$DIR/server.pid"
  OMNI_PORT="$SERVER_PORT" detach npx vite --config apps/web/vite.config.ts --port "$WEB_PORT" --strictPort >"$DIR/web.log" 2>&1 &
  echo $! >"$DIR/web.pid"

  for _ in $(seq 1 60); do
    api /channels >/dev/null 2>&1 && curl -fsS "$WEB" >/dev/null 2>&1 && break
    alive server || { tail -20 "$DIR/server.log" >&2; die "server exited, log above"; }
    sleep 0.5
  done
  api /channels >/dev/null 2>&1 || { tail -20 "$DIR/server.log" >&2; die "server not healthy after 30s"; }
  curl -fsS "$WEB" >/dev/null 2>&1 || { tail -20 "$DIR/web.log" >&2; die "vite not up after 30s"; }

  for ((i = 1; i <= seed; i++)); do
    local prompt="Sample thread $i"
    [ "$i" = 1 ] && prompt="Sample thread 1 RICH"
    api /threads -X POST -H 'content-type: application/json' \
      -d "{\"channel\":\"inbox\",\"title\":\"Sample thread $i\",\"prompt\":\"$prompt\"}" >/dev/null \
      || die "seeding thread $i failed"
  done
  STARTING=0
  status
}

down() {
  local p pid cwd
  for p in web server cursor-api; do
    alive "$p" || continue
    pid="$(cat "$DIR/$p.pid")"
    cwd="$(cwd_of "$pid")"
    if [ "$cwd" != "$(pwd -P)" ]; then
      STARTING=0 die "$p pid $pid in $DIR runs from ${cwd:-an unknown dir}, not $(pwd -P); not ours, leaving the stack alone"
    fi
  done
  # The recorded PID is the subshell that ran detach, so the process group to stop is led by it or by its child.
  # Only kill groups led by one of those two, never the group this script or its caller runs in.
  local c pg
  for p in web server cursor-api; do
    alive "$p" || continue
    pid="$(cat "$DIR/$p.pid")"
    for c in "$pid" $(pgrep -P "$pid"); do
      pg="$(ps -o pgid= -p "$c" | tr -d ' ')"
      [ "$pg" = "$c" ] && kill -- -"$pg" 2>/dev/null || true
    done
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
  rm -rf "$DIR"
  echo "down, $DIR removed"
}

status() {
  echo "server  $API  $(alive server && echo up || echo down)"
  echo "web     $WEB  $(alive web && echo up || echo down)"
  echo "data    $DIR"
  if alive server; then
    echo "token   $(tok)"
    echo "pair    $WEB/#/?pair=$(tok)"
    api /threads 2>/dev/null | node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        for (const t of JSON.parse(s)) console.log(`thread  ${process.argv[1]}/#/t/${t.id}?pair=${process.argv[2]}  ${t.status}  ${t.title ?? ""}`);
      });' "$WEB" "$(tok)" || true
  fi
}

case "${1:-}" in
  up) shift; up "$@" ;;
  down)
    # Without a port, down would pick the default stack, which may be another thread's.
    [ -n "${QA_SERVER_PORT:-}" ] || { echo "qa-stack: down needs QA_SERVER_PORT, the port you started the stack on" >&2; exit 2; }
    down ;;
  status) status ;;
  logs) tail -n 50 -f "$DIR/server.log" "$DIR/web.log" ;;
  *) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
