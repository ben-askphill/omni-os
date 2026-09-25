#!/usr/bin/env bash
# Installs Omni OS as a per-user LaunchAgent (com.omni-os.server) so it starts at login and restarts if it dies.
#
#   scripts/install-launchd.sh              build the UI, write the plist, (re)load the agent
#   scripts/install-launchd.sh --uninstall  stop the agent and remove the plist
#
# The agent runs `node_modules/.bin/tsx server/index.ts` with NODE_ENV=production under
# `/usr/bin/caffeinate -i`, so the Mac does not idle-sleep while Omni is up.
# PATH is captured from the shell that runs this script, so `claude`, `gh`, `npx` and nvm's node resolve.
# Re-run it after changing node versions or moving the repo.
set -euo pipefail

LABEL="com.omni-os.server"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$REPO/data/logs"
DOMAIN="gui/$(id -u)"
PORT="${OMNI_PORT:-4747}"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

unload() {
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || launchctl bootout "$DOMAIN" "$PLIST" 2>/dev/null || true
    # bootout returns before the job is fully gone; give launchd a moment.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
      sleep 0.5
    done
  fi
}

case "${1:-}" in
  --uninstall|uninstall)
    unload
    rm -f "$PLIST"
    say "Removed $LABEL. Logs are kept in $LOG_DIR."
    exit 0
    ;;
  ""|--install|install) ;;
  -h|--help)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *) die "unknown argument: $1 (use --uninstall)" ;;
esac

[[ "$(uname)" == "Darwin" ]] || die "LaunchAgents are macOS only"
command -v node >/dev/null || die "node not found in PATH (load nvm first)"
command -v npm >/dev/null || die "npm not found in PATH"
[[ -x "$REPO/node_modules/.bin/tsx" ]] || die "missing $REPO/node_modules/.bin/tsx (run npm install)"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 24 )); then
  die "node $(node -v) is too old; Omni needs node >= 24 (node:sqlite)"
fi
command -v claude >/dev/null || say "warning: \`claude\` is not in PATH; threads will fail to start until it is"
command -v gh >/dev/null || say "warning: \`gh\` is not in PATH; PR views will not work"

say "Building the web UI..."
(cd "$REPO" && npm run build)

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

xml_escape() {
  local s="$1"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  s="${s//\"/&quot;}"
  printf '%s' "$s"
}

R="$(xml_escape "$REPO")"
P="$(xml_escape "$PATH")"
H="$(xml_escape "$HOME")"
L="$(xml_escape "$LOG_DIR")"

unload

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-i</string>
    <string>$R/node_modules/.bin/tsx</string>
    <string>server/index.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$R</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$P</string>
    <key>HOME</key>
    <string>$H</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$L/server.out.log</string>
  <key>StandardErrorPath</key>
  <string>$L/server.err.log</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST" >/dev/null || die "generated plist is invalid: $PLIST"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  say "warning: something is already listening on port $PORT (a dev server?)."
  say "         The agent will keep retrying every 10s until that port is free."
fi

launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL" >/dev/null 2>&1 || true

say ""
say "Installed $LABEL"
say "  plist:  $PLIST"
say "  logs:   $LOG_DIR/server.out.log, server.err.log"
say "  status: launchctl print $DOMAIN/$LABEL | head -20"
say "  stop:   $0 --uninstall"
say "  open:   http://127.0.0.1:$PORT"
say ""
say "Phone access over Tailscale:"
say "  tailscale serve --bg $PORT"
say "  then open https://<this-mac>.<tailnet>.ts.net on your phone"
