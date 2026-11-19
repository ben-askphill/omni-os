#!/bin/sh
# Pair a Hermes Agent server with Omni, so Omni can run threads on it without anyone pasting its key.
#
# Run it on the machine Hermes runs on, as the user that runs Hermes:
#
#   curl -fsSL https://raw.githubusercontent.com/ben-askphill/omni-os/<release tag>/scripts/omni-pair.sh | sh
#   curl -fsSL .../omni-pair.sh | sh -s -- --url https://hermes.example.com     (flags go after `sh -s --`)
#
# It reads Hermes's API server settings from $HERMES_HOME/.env (default ~/.hermes/.env), makes API_SERVER_KEY there
# when it has none, and prints three things: an omni://connect-agent link, the same link as a terminal QR code (when
# `qrencode` is installed), and a one-time pairing code. Click or paste the link in Omni (Settings > Models >
# Connect an agent), or type the pairing address and the code there. Omni then calls POST /v1/omni/pair here with the
# code and gets the key back, server to server, and this helper exits. Nothing else is served.
#
# The code is single use, lives at most 10 minutes, carries 140 bits, is held only as a hash and is checked in constant
# time. Ten wrong codes from one address, or a hundred in all, close the pairing. The protocol is in
# docs/internals/remote-harness-protocol.md (Pairing).
#
# Hermes's Runs API takes one key per profile, so every machine that pairs gets the same key, and Omni says so: to cut
# a machine off, rotate API_SERVER_KEY. Flags (all optional):
#
#   --url URL          the address Omni reaches Hermes's API server at. Default: this machine's Tailscale name, or its
#                      host name, and the API server's port, over http (Omni allows plain http only on the tailnet)
#   --pair-url URL     the address Omni reaches this helper at. Default: --url's host with --port, over http
#   --port N           the port this helper listens on. Default: the API server's port plus one; 0 picks a free one
#   --bind ADDR        the address it listens on. Default: 127.0.0.1 for a --url on this machine, else 0.0.0.0
#   --hermes-home DIR  the Hermes home whose .env to read. Default: $HERMES_HOME, else ~/.hermes
#   --profile NAME     a Hermes profile: the same as --hermes-home ~/.hermes/profiles/NAME
#   --name NAME        what Omni calls it. Default: Hermes on <host>
#   --ttl SECONDS      how long the code lives, up to 600. Default 600
#   --no-qr            print no QR code
#   --json             print one JSON line with the link, the code and the addresses on stdout; the rest goes to stderr
set -eu

PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
    PY=$candidate
    break
  fi
done
if [ -z "$PY" ]; then
  echo "omni-pair needs Python 3.8 or newer, which Hermes Agent runs on. Install python3, or run this where Hermes runs." >&2
  exit 1
fi

exec "$PY" - "$@" <<'OMNI_PAIR_PY'
import argparse
import hashlib
import hmac
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

PROTOCOL = 1
MAX_TTL = 600
MAX_FAILS_PER_SOURCE = 10
MAX_FAILS = 100
MAX_BODY = 4096
# Crockford's base32: no I, L, O or U, so a code read aloud or retyped is hard to get wrong.
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_CHARS = 28  # 140 bits


def say(*parts):
    print(*parts, file=OUT, flush=True)


def plain(text, limit):
    """Printable text only, and short: a name ends up in Omni's pickers and prompts."""
    cleaned = "".join(ch if ch.isprintable() else " " for ch in str(text))
    return " ".join(cleaned.split())[:limit]


def make_code():
    n = int.from_bytes(secrets.token_bytes(18), "big")
    chars = []
    for _ in range(CODE_CHARS):
        chars.append(ALPHABET[n & 31])
        n >>= 5
    return "".join(chars)


def normalize(code):
    """What a person may type for a code: any case, dashes or spaces, O for 0 and I or L for 1."""
    out = str(code).upper().translate(str.maketrans({"O": "0", "I": "1", "L": "1"}))
    return "".join(ch for ch in out if ch in ALPHABET)


def grouped(code):
    return "-".join(code[i : i + 4] for i in range(0, len(code), 4))


def read_env(path):
    values = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                if key.startswith("export "):
                    key = key[len("export ") :].strip()
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                    value = value[1:-1]
                values[key] = value
    except FileNotFoundError:
        pass
    return values


def add_env(path, pairs):
    """Append keys to the .env, creating it owner-only. Existing lines stay as they are."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    existed = os.path.exists(path)
    needs_newline = False
    if existed:
        with open(path, "rb") as f:
            data = f.read()
        needs_newline = bool(data) and not data.endswith(b"\n")
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as f:
        if needs_newline:
            f.write("\n")
        f.write("# Added by omni-pair\n")
        for key, value in pairs:
            f.write(f"{key}={value}\n")
    if not existed:
        os.chmod(path, 0o600)


def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def tailscale_name():
    if not shutil.which("tailscale"):
        return ""
    try:
        status = json.loads(run(["tailscale", "status", "--json"]) or "{}")
    except ValueError:
        return ""
    return str((status.get("Self") or {}).get("DNSName") or "").rstrip(".")


def loopback(host):
    h = host.strip("[]").lower()
    return h in ("localhost", "::1") or h.endswith(".localhost") or h.startswith("127.")


def api_answers(host, port, key):
    """Whether Hermes's API server takes the key, asked on this machine."""
    target = "127.0.0.1" if host in ("0.0.0.0", "", "::") else host
    if ":" in target and not target.startswith("["):
        target = f"[{target}]"
    req = urllib.request.Request(f"http://{target}:{port}/v1/capabilities", headers={"Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=3) as res:
            return res.status == 200
    except (urllib.error.URLError, OSError, ValueError):
        return False


def qr(text):
    if not shutil.which("qrencode"):
        return ""
    try:
        return subprocess.run(["qrencode", "-t", "ANSIUTF8", "-m", "2", text], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def parse_args(argv):
    p = argparse.ArgumentParser(prog="omni-pair", description="Pair this Hermes Agent server with Omni.")
    p.add_argument("--url")
    p.add_argument("--pair-url")
    p.add_argument("--port", type=int)
    p.add_argument("--bind")
    p.add_argument("--hermes-home")
    p.add_argument("--profile")
    p.add_argument("--name")
    p.add_argument("--ttl", type=int, default=MAX_TTL)
    p.add_argument("--no-qr", action="store_true")
    p.add_argument("--json", action="store_true")
    return p.parse_args(argv)


def main(argv):
    global OUT
    args = parse_args(argv)
    OUT = sys.stderr if args.json else sys.stdout

    home = args.hermes_home or os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
    if args.profile:
        if not all(ch.isalnum() or ch in "-_" for ch in args.profile):
            say("A profile name is letters, digits, dashes and underscores.")
            return 1
        home = os.path.join(os.path.expanduser("~/.hermes"), "profiles", args.profile)
    env_path = os.path.join(home, ".env")
    env = read_env(env_path)
    api_host = env.get("API_SERVER_HOST") or "127.0.0.1"
    try:
        api_port = int(env.get("API_SERVER_PORT") or 8642)
    except ValueError:
        say(f"API_SERVER_PORT in {env_path} is not a port number.")
        return 1

    key = env.get("API_SERVER_KEY", "")
    restart = []
    if not key:
        key = secrets.token_urlsafe(32)
        added = [("API_SERVER_KEY", key)]
        if env.get("API_SERVER_ENABLED", "").lower() != "true":
            added.insert(0, ("API_SERVER_ENABLED", "true"))
        add_env(env_path, added)
        restart.append(f"Added {' and '.join(k for k, _ in added)} to {env_path}.")
    elif env.get("API_SERVER_ENABLED", "").lower() != "true":
        say(f"Hermes's API server is off: set API_SERVER_ENABLED=true in {env_path}, restart Hermes, then run this again.")
        return 1
    if restart:
        command = f"hermes -p {args.profile} gateway restart" if args.profile else "hermes gateway restart"
        restart.append(f"Restart Hermes so its API server uses the key: {command}")

    host_name = tailscale_name() or socket.getfqdn() or socket.gethostname()
    url = (args.url or f"http://{host_name}:{api_port}").rstrip("/")
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        say(f"--url must be an http:// or https:// address, not {url}.")
        return 1
    if not args.url and loopback(api_host) and not loopback(parsed.hostname):
        restart.append(
            f"Hermes's API server listens on {api_host} only, so Omni on another machine cannot reach {url}. "
            "Set API_SERVER_HOST in the .env to this machine's Tailscale address, restart Hermes, and run this again, "
            "or pass --url with the address of a proxy in front of it."
        )

    port = args.port if args.port is not None else api_port + 1
    bind = args.bind or ("127.0.0.1" if loopback(parsed.hostname) else "0.0.0.0")
    ttl = max(1, min(args.ttl, MAX_TTL))
    name = plain(args.name or f"Hermes on {plain(host_name.split('.')[0], 60)}", 80)

    code = make_code()
    digest = hashlib.sha256(code.encode()).digest()
    state = {"done": False, "fails": {}, "total": 0, "client": ""}

    class Handler(BaseHTTPRequestHandler):
        timeout = 10
        server_version = "omni-pair"
        sys_version = ""

        def log_message(self, *a):
            pass

        def answer(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/v1/omni/pair":
                return self.answer(405, {"error": "POST a pairing code"})
            self.answer(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/v1/omni/pair":
                return self.answer(404, {"error": "not found"})
            source = self.client_address[0]
            if state["fails"].get(source, 0) >= MAX_FAILS_PER_SOURCE:
                return self.answer(429, {"error": "too many wrong codes from this address"})
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length < 0 or length > MAX_BODY:
                return self.answer(400, {"error": "body too large"})
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                return self.answer(400, {"error": "body is not JSON"})
            given = normalize(body.get("code", "")) if isinstance(body, dict) else ""
            if state["done"] or not hmac.compare_digest(hashlib.sha256(given.encode()).digest(), digest):
                state["fails"][source] = state["fails"].get(source, 0) + 1
                state["total"] += 1
                return self.answer(404, {"error": "unknown or used code"})
            state["done"] = True
            state["client"] = plain(body.get("client_name") or body.get("client_id") or "Omni", 80)
            self.answer(
                200,
                {
                    "protocol": PROTOCOL,
                    "kind": "runs-api",
                    "name": name,
                    "url": url,
                    "key": key,
                    "key_id": "api-server-key",
                    # One key per Hermes profile: every machine that pairs gets this same key, and it cannot be revoked
                    # for one machine alone. Omni shows that, and sends it sealed to another machine instead of pairing again.
                    "shared_key": True,
                    "revoke": False,
                },
            )

    try:
        server = HTTPServer((bind, port), Handler)
    except OSError as e:
        say(f"Could not listen on {bind}:{port}: {e.strerror or e}. Pass --port with a free port.")
        return 1
    server.timeout = 0.5
    port = server.server_address[1]
    pair_url = (args.pair_url or f"http://{parsed.hostname if ':' not in parsed.hostname else '[' + parsed.hostname + ']'}:{port}").rstrip("/")
    query = {"url": url, "code": grouped(code), "name": name}
    if pair_url != url:
        query["pair"] = pair_url
    link = "omni://connect-agent?" + urllib.parse.urlencode(query, quote_via=urllib.parse.quote)
    expires = time.time() + ttl

    for line in restart:
        say(line)
    if not restart and not api_answers(api_host, api_port, key):
        say(f"Hermes's API server does not answer on {api_host}:{api_port} with this key yet. Start it (hermes gateway restart) before Omni's test turn.")
    say("")
    say(f"Pair {name} with Omni. In Omni, open this link, or paste it in Settings > Models > Connect an agent:")
    say("")
    say(f"  {link}")
    say("")
    if not args.no_qr and not args.json:
        code_image = qr(link)
        if code_image:
            say(code_image)
    say("Or type these in Connect an agent:")
    say(f"  Address  {pair_url}")
    say(f"  Code     {grouped(code)}")
    say("")
    lasts = f"{ttl} seconds" if ttl < 60 else f"{ttl // 60} minute{'s' if ttl >= 120 else ''}"
    say(f"The code works once, for {lasts}. Keep this running until Omni says it is paired.")
    if args.json:
        print(json.dumps({"link": link, "code": grouped(code), "url": url, "pair": pair_url, "name": name, "expires_at": int(expires)}), flush=True)

    try:
        while not state["done"] and time.time() < expires and state["total"] < MAX_FAILS:
            server.handle_request()
    except KeyboardInterrupt:
        say("Stopped. The code no longer works.")
        return 130
    finally:
        server.server_close()
    if state["done"]:
        say(f"Paired with {state['client']}. Omni has the key now; this helper is done.")
        return 0
    if state["total"] >= MAX_FAILS:
        say("Too many wrong codes, so pairing closed. Run this again for a new code.")
        return 3
    say("The code expired. Run this again for a new one.")
    return 2


OUT = sys.stdout
sys.exit(main(sys.argv[1:]))
OMNI_PAIR_PY
