#!/usr/bin/env bash
# Two sync-linked throwaway Omni servers ("QA Mac A" and "QA Mac B") and a local relay between them, for checking a
# handoff, Take over or Run on from a client. Each server is a scripts/qa-stack.sh stack: its own data dir, secret file
# store, HOME, device name, fake CLIs and fake Tailscale status. Nothing touches :4747, a Keychain or the real ~/.claude.
#
#   scripts/qa-handoff-stack.sh up          start the relay and both servers, turn sync on, wait until each lists the other
#   scripts/qa-handoff-stack.sh down        stop what up started (PID files) and delete the rig's dir
#   scripts/qa-handoff-stack.sh status      ports, state and token locations
#   scripts/qa-handoff-stack.sh logs [a|b|relay]
#   scripts/qa-handoff-stack.sh env A|B     the exports that point the iOS app's dev build at that server (prints its token)
#   scripts/qa-handoff-stack.sh offline A|B Tailscale on the other server reports that one asleep; waits until it shows
#   scripts/qa-handoff-stack.sh online A|B  the reverse
#   scripts/qa-handoff-stack.sh thread A|B [prompt...]
#                                           start a thread in the shared channel on that server, print its id. A prompt
#                                           with TOOL:600000 keeps the turn running for ten minutes (fake-claude.mjs)
#
# QA_HANDOFF_PORT sets the relay's port (default 47300); A is that +1 and B +2. QA_HANDOFF_DIR moves the rig's dir
# (default $TMPDIR/omni-qa-handoff). The channel "qa-shared" (folder $QA_HANDOFF_DIR/shared on both) is made on A and
# syncs to B. Bash 3.2 and macOS safe.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
BASE="${QA_HANDOFF_PORT:-47300}"
DIR="${QA_HANDOFF_DIR:-${TMPDIR:-/tmp}/omni-qa-handoff}"
DIR="${DIR%/}"
FX="$ROOT/packages/test-fixtures"
RELAY_PORT="$BASE"
CHANNEL=qa-shared

die() { echo "qa-handoff-stack: $*" >&2; exit 1; }
# A failed up tears the rig down, unless QA_HANDOFF_KEEP=1 leaves it to read the logs.
abort() { [ "${QA_HANDOFF_KEEP:-0}" = 1 ] || down >/dev/null 2>&1; die "$*"; }
[ "$BASE" -ge 47300 ] && [ "$BASE" -le 47397 ] || die "QA_HANDOFF_PORT must be in 47300-47397, got $BASE"

lower() { echo "$1" | tr 'A-Z' 'a-z'; }
side() { case "$1" in A | a) echo a ;; B | b) echo b ;; *) die "name a server: A or B (got '${1:-}')" ;; esac; }
other() { [ "$(side "$1")" = a ] && echo b || echo a; }
upper() { echo "$1" | tr 'a-z' 'A-Z'; }
port_of() { [ "$(side "$1")" = a ] && echo $((BASE + 1)) || echo $((BASE + 2)); }
dir_of() { echo "$DIR/$(side "$1")"; }
token_of() { tr -d '[:space:]' <"$(dir_of "$1")/data/api-token" 2>/dev/null || true; }
api() { local s="$1" p="$2"; shift 2; curl -fsS -H "Authorization: Bearer $(token_of "$s")" "$@" "http://127.0.0.1:$(port_of "$s")/api$p"; }
# Runs a JavaScript expression over the JSON on stdin as `j`.
jx() { node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { const j = JSON.parse(s); const v = eval(process.argv[1]); if (v !== undefined) console.log(v); });' "$1"; }
# curl exits 7 when nothing listens there.
port_free() { local rc=0; curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$1/" || rc=$?; [ "$rc" = 7 ]; }
detach() { if command -v setsid >/dev/null; then setsid "$@"; else perl -e 'setpgrp(0, 0); exec @ARGV or die "exec: $!"' "$@"; fi; }
alive() { [ -f "$DIR/$1.pid" ] && kill -0 "$(cat "$DIR/$1.pid")" 2>/dev/null; }
cwd_of() { if command -v lsof >/dev/null; then lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'; else readlink "/proc/$1/cwd" 2>/dev/null; fi; }

# What `tailscale status --json` prints on one server: itself, and the other as a peer that is up or not.
ts_write() { # <server> <peer online: true|false>
  local s="$(side "$1")" file; file="$(dir_of "$1")/tailscale.json"
  node -e '
    const [self, up, file] = process.argv.slice(1);
    const node = (l) => ({ ID: `qa-node-${l}`, HostName: `QA Mac ${l.toUpperCase()}`, DNSName: `qa-mac-${l}.qa.ts.net.`, OS: "macOS" });
    const peer = self === "a" ? "b" : "a";
    const out = { Version: "1.88.1", BackendState: "Running", Self: { ...node(self), Online: true },
      Peer: { [`nodekey:qa-node-${peer}`]: { ...node(peer), Online: up === "true", LastSeen: up === "true" ? "0001-01-01T00:00:00Z" : new Date().toISOString() } } };
    require("node:fs").writeFileSync(file + ".tmp", JSON.stringify(out));
    require("node:fs").renameSync(file + ".tmp", file);' "$s" "$2" "$file"
}

# One qa-stack.sh call for one server, with the environment that makes it a separate "device".
stack() { # <server> <qa-stack args...>
  local s="$1"; shift
  local l; l="$(side "$s")"
  local real_home="$HOME"
  HOME="$(dir_of "$s")/home" npm_config_cache="${npm_config_cache:-$real_home/.npm}" \
    QA_DIR="$(dir_of "$s")" QA_SERVER_PORT="$(port_of "$s")" QA_NO_WEB=1 \
    OMNI_SECRET_STORE=file OMNI_DEVICE_NAME="QA Mac $(upper "$l")" OMNI_HARDWARE_ID="qa-handoff-$l" \
    OMNI_TAILSCALE_BIN="$FX/fake-tailscale.mjs" FAKE_TAILSCALE_STATUS="$(dir_of "$s")/tailscale.json" \
    scripts/qa-stack.sh "$@"
}

# Stops one process this script started: the PID file's process and its group, only when it runs from this checkout.
stop_pid() { # <name>
  alive "$1" || return 0
  local pid c pg; pid="$(cat "$DIR/$1.pid")"
  [ "$(cwd_of "$pid")" = "$(pwd -P)" ] || { echo "$1 pid $pid does not run from $(pwd -P); not ours, leaving it" >&2; return 0; }
  for c in "$pid" $(pgrep -P "$pid"); do
    pg="$(ps -o pgid= -p "$c" | tr -d ' ')"
    [ "$pg" = "$c" ] && kill -- -"$pg" 2>/dev/null || true
  done
  kill "$pid" 2>/dev/null || true
}

up() {
  if alive relay; then echo "already up"; status; return; fi
  for p in $BASE $((BASE + 1)) $((BASE + 2)); do port_free "$p" || die "port $p is in use (QA_HANDOFF_PORT moves all three)"; done
  mkdir -p "$DIR/shared"
  : >"$DIR/.qa-handoff"
  local token; token="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
  (umask 077 && printf %s "$token" >"$DIR/relay-token")

  detach node scripts/qa-relay.mjs "$RELAY_PORT" "$token" >"$DIR/relay.log" 2>&1 &
  echo $! >"$DIR/relay.pid"
  local i
  for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$RELAY_PORT/v1/info" >/dev/null 2>&1 && break; sleep 0.25; done
  curl -fsS "http://127.0.0.1:$RELAY_PORT/v1/info" >/dev/null 2>&1 || { tail -5 "$DIR/relay.log" >&2; abort "relay did not start"; }

  local s
  for s in A B; do
    mkdir -p "$(dir_of "$s")/home"
    ts_write "$s" true
    stack "$s" up --seed 0 >"$DIR/up-$(side "$s").log" 2>&1 || { tail -20 "$DIR/up-$(side "$s").log" >&2; abort "server $s did not start"; }
  done

  for s in A B; do
    # The relay's URL and token as the sync secrets, then sync on: what Settings does after a sign-in.
    printf '{"scope":"global","name":"OMNI_RELAY_URL","value":"http://127.0.0.1:%s"}' "$RELAY_PORT" | api "$s" /secrets -X POST -H 'content-type: application/json' --data-binary @- >/dev/null
    printf '{"scope":"global","name":"OMNI_RELAY_TOKEN","value":"%s"}' "$token" | api "$s" /secrets -X POST -H 'content-type: application/json' --data-binary @- >/dev/null
    api "$s" /sync/enable -X POST -H 'content-type: application/json' -d '{}' >/dev/null || { abort "could not turn sync on for $s"; }
  done
  api A /channels -X POST -H 'content-type: application/json' \
    -d "{\"id\":\"$CHANNEL\",\"name\":\"QA Shared\",\"kind\":\"client\",\"use_worktree\":0,\"base_dir\":\"$DIR/shared\"}" >/dev/null \
    || { abort "could not make the shared channel"; }

  # Linked: each lists the other (its record synced) and B has the channel.
  for i in $(seq 1 80); do
    [ "$(api A /devices 2>/dev/null | jx 'j.length')" = 1 ] && [ "$(api B /devices 2>/dev/null | jx 'j.length')" = 1 ] \
      && api B "/channels/$CHANNEL" >/dev/null 2>&1 && break
    sleep 0.5
  done
  [ "$(api A /devices | jx 'j.length')" = 1 ] && [ "$(api B /devices | jx 'j.length')" = 1 ] && api B "/channels/$CHANNEL" >/dev/null 2>&1 \
    || { echo "--- A sync:"; api A /sync/status; echo; echo "--- B sync:"; api B /sync/status; echo; abort "the servers did not link in 40s"; }
  status
}

down() {
  local s
  for s in A B; do
    [ -d "$(dir_of "$s")" ] || continue
    # qa-stack down needs the port and refuses a stack it did not start.
    stack "$s" down 2>&1 || true
  done
  stop_pid relay
  sleep 0.5
  # Only a dir up made: QA_HANDOFF_DIR can point anywhere.
  if [ -f "$DIR/.qa-handoff" ]; then rm -rf "$DIR"; echo "down, $DIR removed"; else echo "down, nothing to remove at $DIR"; fi
}

status() {
  local s
  echo "relay   http://127.0.0.1:$RELAY_PORT  $(alive relay && echo up || echo down)"
  for s in A B; do
    echo "server $s  http://127.0.0.1:$(port_of "$s")  $(alive_server "$s")  \"QA Mac $s\"  token file $(dir_of "$s")/data/api-token"
  done
  echo "data    $DIR"
  echo "channel $CHANNEL  folder $DIR/shared"
  echo "ios     scripts/qa-handoff-stack.sh env A    (or B)"
}
alive_server() { [ -f "$(dir_of "$1")/server.pid" ] && kill -0 "$(cat "$(dir_of "$1")/server.pid")" 2>/dev/null && echo up || echo down; }

flip() { # <server> <online: true|false>
  local s="$1" other_side; other_side="$(upper "$(other "$s")")"
  ts_write "$other_side" "$2"
  local want=offline; [ "$2" = true ] && want=online
  # The server caches Tailscale for 5s.
  local i
  for i in $(seq 1 40); do
    [ "$(api "$other_side" /devices | jx "j.find((d) => d.name === 'QA Mac $(upper "$(side "$s")")')?.reachability")" = "$want" ] && { echo "QA Mac $(upper "$(side "$s")") is $want on $other_side"; return; }
    sleep 0.5
  done
  die "$other_side still does not show QA Mac $(upper "$(side "$s")") $want after 20s"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  logs)
    case "${2:-}" in
      relay) tail -n 50 -f "$DIR/relay.log" ;;
      a | b | A | B) tail -n 50 -f "$(dir_of "$2")/server.log" ;;
      *) tail -n 50 -f "$DIR/relay.log" "$DIR/a/server.log" "$DIR/b/server.log" ;;
    esac ;;
  env)
    s="${2:?env needs A or B}"
    [ -s "$(dir_of "$s")/data/api-token" ] || die "server $s is not up"
    echo "export EXPO_PUBLIC_OMNI_DEV_URL=http://127.0.0.1:$(port_of "$s")"
    echo "export EXPO_PUBLIC_OMNI_DEV_TOKEN=$(token_of "$s")" ;;
  offline) flip "${2:?offline needs A or B}" false ;;
  online) flip "${2:?online needs A or B}" true ;;
  thread)
    s="${2:?thread needs A or B}"; shift 2
    prompt="${*:-Sample handoff thread}"
    node -e 'process.stdout.write(JSON.stringify({ channel: process.argv[1], prompt: process.argv[2] }))' "$CHANNEL" "$prompt" \
      | api "$s" /threads -X POST -H 'content-type: application/json' --data-binary @- | jx 'j.id' ;;
  *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
