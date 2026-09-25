#!/usr/bin/env bash
# Quick capture into Omni OS from any terminal.
#
#   omni "check the volero feed import" [-c channel] [-r role] [-m model] [-o]
#   echo "long brief" | omni -c volero
#
#   -c, --channel  channel id (default: inbox, or the role's channel)
#   -r, --role     crew role id (builder, researcher, ...)
#   -m, --model    model override (opus, sonnet, haiku)
#   -o, --open     open the new thread in the browser
#
# OMNI_URL overrides the server (default http://127.0.0.1:4747).
# Install: ln -s "$PWD/scripts/omni.sh" /usr/local/bin/omni   (or any dir on your PATH)
set -euo pipefail

BASE="${OMNI_URL:-http://127.0.0.1:4747}"
BASE="${BASE%/}"
channel=""
role=""
model=""
open_it=0
prompt_parts=()

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; }

while (($#)); do
  case "$1" in
    -c|--channel) channel="${2:?missing channel}"; shift 2 ;;
    -r|--role) role="${2:?missing role}"; shift 2 ;;
    -m|--model) model="${2:?missing model}"; shift 2 ;;
    -o|--open) open_it=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; prompt_parts+=("$@"); break ;;
    -*) printf 'omni: unknown option %s\n' "$1" >&2; usage >&2; exit 2 ;;
    *) prompt_parts+=("$1"); shift ;;
  esac
done

prompt="${prompt_parts[*]:-}"
if [[ -z "$prompt" && ! -t 0 ]]; then
  prompt="$(cat)"
fi
if [[ -z "${prompt//[[:space:]]/}" ]]; then
  usage >&2
  exit 2
fi

# JSON via node (python3 as a fallback); values travel through env so nothing needs shell quoting.
if command -v node >/dev/null 2>&1; then
  JSON_RUNNER=node
elif command -v python3 >/dev/null 2>&1; then
  JSON_RUNNER=python3
else
  printf 'omni: need node or python3 to encode JSON\n' >&2
  exit 1
fi

encode() {
  if [[ "$JSON_RUNNER" == node ]]; then
    node -e '
      const e = process.env, b = { prompt: e.OMNI_PROMPT, source: "capture" };
      if (e.OMNI_CH) b.channel = e.OMNI_CH;
      if (e.OMNI_ROLE) b.role = e.OMNI_ROLE;
      if (e.OMNI_MODEL) b.model = e.OMNI_MODEL;
      process.stdout.write(JSON.stringify(b));'
  else
    python3 -c '
import json, os
e = os.environ
b = {"prompt": e["OMNI_PROMPT"], "source": "capture"}
for k, env in (("channel", "OMNI_CH"), ("role", "OMNI_ROLE"), ("model", "OMNI_MODEL")):
    if e.get(env):
        b[k] = e[env]
print(json.dumps(b), end="")'
  fi
}

# Prints the thread id, or the server error on stderr with a non-zero exit.
read_id() {
  if [[ "$JSON_RUNNER" == node ]]; then
    node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        let j; try { j = JSON.parse(s); } catch { console.error("omni: unexpected response: " + s.slice(0, 300)); process.exit(1); }
        if (!j.id) { console.error("omni: " + (j.error || s.slice(0, 300))); process.exit(1); }
        process.stdout.write(j.id);
      });'
  else
    python3 -c '
import json, sys
s = sys.stdin.read()
try:
    j = json.loads(s)
except Exception:
    sys.exit("omni: unexpected response: " + s[:300])
if not isinstance(j, dict) or not j.get("id"):
    sys.exit("omni: " + str((j.get("error") if isinstance(j, dict) else None) or s[:300]))
print(j["id"], end="")'
  fi
}

body="$(OMNI_PROMPT="$prompt" OMNI_CH="$channel" OMNI_ROLE="$role" OMNI_MODEL="$model" encode)"

if ! resp="$(printf '%s' "$body" | curl -sS --max-time 30 -X POST -H 'Content-Type: application/json' --data-binary @- "$BASE/api/threads")"; then
  printf 'omni: could not reach %s (is the server running?)\n' "$BASE" >&2
  exit 1
fi

id="$(printf '%s' "$resp" | read_id)"
url="$BASE/#/t/$id"
printf '%s\n' "$url"
if ((open_it)); then
  open "$url" 2>/dev/null || true
fi
