#!/usr/bin/env bash
# Starts a throwaway Omni stack for an agent to check its own work: the server on a spare port with its own data
# dir and the fake CLIs, vite in front of it, and a few seeded threads. It never touches :4747 or data/.
#
#   scripts/qa-stack.sh up [--seed N]   start, wait until healthy, seed N sample threads (default 3), print URLs
#   scripts/qa-stack.sh down            stop it and delete its data dir
#   scripts/qa-stack.sh status          print the URLs and whether each process is alive
#   scripts/qa-stack.sh logs            tail the server and vite logs
#
# QA_SERVER_PORT (default 4757) and QA_WEB_PORT (default 4768) move the ports, QA_DIR the state dir
# (default $TMPDIR/omni-qa-<server port>). Threads run on fake-claude, so a prompt with directives such as
# RICH, TOOL:<ms> or LIMIT drives a turn without spending a plan (see packages/test-fixtures/fake-claude.mjs).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
SERVER_PORT="${QA_SERVER_PORT:-4757}"
WEB_PORT="${QA_WEB_PORT:-4768}"
DIR="${QA_DIR:-${TMPDIR:-/tmp}/omni-qa-$SERVER_PORT}"
API="http://127.0.0.1:$SERVER_PORT/api"
WEB="http://localhost:$WEB_PORT"

die() { echo "qa-stack: $*" >&2; [ "${STARTING:-0}" = 1 ] && down >/dev/null; exit 1; }
alive() { [ -f "$DIR/$1.pid" ] && kill -0 "$(cat "$DIR/$1.pid")" 2>/dev/null; }

[ "$SERVER_PORT" != 4747 ] || die "refusing port 4747, that is the live server"

# macOS has no setsid(1). Perl's POSIX::setsid does the same: a new session and process group, so down can kill it whole.
command -v setsid >/dev/null 2>&1 || setsid() { perl -MPOSIX=setsid -e 'setsid() or die "setsid: $!"; exec @ARGV or die "exec: $!"' "$@"; }

up() {
  local seed=3
  [ "${1:-}" = "--seed" ] && seed="${2:?--seed needs a number}"
  alive server && { echo "already up"; status; return; }
  # The scheduler watches the automations dir and crashes the server when it is missing.
  mkdir -p "$DIR/data" "$DIR/brain" "$DIR/automations"
  STARTING=1
  local fx="$ROOT/packages/test-fixtures"
  # setsid puts each in its own process group, so down can stop tsx/vite and their children together.
  OMNI_PORT="$SERVER_PORT" OMNI_DATA_DIR="$DIR/data" OMNI_BRAIN_DIR="$DIR/brain" \
    OMNI_CLAUDE_BIN="$fx/fake-claude.mjs" OMNI_CODEX_BIN="$fx/fake-codex.mjs" OMNI_CURSOR_BIN="$fx/fake-cursor.mjs" \
    OMNI_BROWSER=0 OMNI_SUGGESTIONS=0 OMNI_HERMES_URL= OMNI_AUTOMATIONS_DIR="$DIR/automations" \
    OMNI_CLOUD_ENVIRONMENT="${OMNI_CLOUD_ENVIRONMENT:-env_qa}" OMNI_CLOUD_ROUTINE_URL= \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    setsid npx tsx apps/server/index.ts >"$DIR/server.log" 2>&1 &
  echo $! >"$DIR/server.pid"
  OMNI_PORT="$SERVER_PORT" setsid npx vite --config apps/web/vite.config.ts --port "$WEB_PORT" --strictPort >"$DIR/web.log" 2>&1 &
  echo $! >"$DIR/web.pid"

  for _ in $(seq 1 60); do
    curl -fsS "$API/channels" >/dev/null 2>&1 && curl -fsS "$WEB" >/dev/null 2>&1 && break
    alive server || { tail -20 "$DIR/server.log" >&2; die "server exited, log above"; }
    sleep 0.5
  done
  curl -fsS "$API/channels" >/dev/null 2>&1 || { tail -20 "$DIR/server.log" >&2; die "server not healthy after 30s"; }
  curl -fsS "$WEB" >/dev/null 2>&1 || { tail -20 "$DIR/web.log" >&2; die "vite not up after 30s"; }

  for i in $(seq 1 "$seed"); do
    local prompt="Sample thread $i"
    [ "$i" = 1 ] && prompt="Sample thread 1 RICH"
    curl -fsS -X POST "$API/threads" -H 'content-type: application/json' \
      -d "{\"channel\":\"inbox\",\"title\":\"Sample thread $i\",\"prompt\":\"$prompt\"}" >/dev/null \
      || die "seeding thread $i failed"
  done
  STARTING=0
  status
}

down() {
  for p in web server; do
    if alive "$p"; then kill -- -"$(cat "$DIR/$p.pid")" 2>/dev/null || kill "$(cat "$DIR/$p.pid")" 2>/dev/null || true; fi
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
    curl -fsS "$API/threads" 2>/dev/null | node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        for (const t of JSON.parse(s)) console.log(`thread  ${process.argv[1]}/#/t/${t.id}  ${t.status}  ${t.title ?? ""}`);
      });' "$WEB" || true
  fi
}

case "${1:-}" in
  up) shift; up "$@" ;;
  down) down ;;
  status) status ;;
  logs) tail -n 50 -f "$DIR/server.log" "$DIR/web.log" ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
