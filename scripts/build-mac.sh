#!/usr/bin/env bash
# Builds the Mac app in Release, installs it to ~/Applications/Omni.app and opens it.
#
#   scripts/build-mac.sh [--no-open] [-- app arguments]
#
#   --no-open   install, but do not open the app
#   --          the rest goes to the app, like: -- -serverPort 4759
#
# It stamps the commit into Info.plist as OmniGitCommit (Settings shows it) and a build number as
# CFBundleVersion, and signs with the "Apple Development" identity when the keychain has one, ad hoc
# otherwise. A running copy of the installed app is quit first, and the old copy goes to the Trash
# and out of LaunchServices. The server is left alone.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DERIVED="$ROOT/mac/.xcode"
BUILT="$DERIVED/Build/Products/Release/Omni.app"
DEST="$HOME/Applications/Omni.app"
BUNDLE_ID="com.omni-os.mac"
PLISTBUDDY=/usr/libexec/PlistBuddy
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

open_app=1
app_args=()
usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; }
while (($#)); do
  case "$1" in
    --no-open) open_app=0; shift ;;
    --) shift; app_args=("$@"); break ;;
    -h|--help) usage; exit 0 ;;
    *) echo "build-mac: unknown option $1" >&2; usage >&2; exit 2 ;;
  esac
done

say() { printf '==> %s\n' "$*"; }

# 1. Build.
say "Building Omni (Release)"
log="$DERIVED/build-release.log"
mkdir -p "$DERIVED"
if ! xcodebuild -project "$ROOT/mac/Omni.xcodeproj" -scheme Omni -configuration Release \
  -derivedDataPath "$DERIVED" build >"$log" 2>&1; then
  grep -E "error:|BUILD FAILED" "$log" >&2 || tail -n 40 "$log" >&2
  echo "build-mac: the build failed. Full log: $log" >&2
  exit 1
fi
[[ -d "$BUILT" ]] || { echo "build-mac: no app at $BUILT" >&2; exit 1; }

# 2. Stamp the commit. This changes Info.plist, so the app is signed again below.
commit="$(git -C "$ROOT" rev-parse HEAD)"
plist="$BUILT/Contents/Info.plist"
"$PLISTBUDDY" -c "Set :OmniGitCommit $commit" "$plist" 2>/dev/null \
  || "$PLISTBUDDY" -c "Add :OmniGitCommit string $commit" "$plist"
# Every build of the app shares one bundle id, and Xcode registers each Debug build, worktree and
# temp folder with LaunchServices. With the same CFBundleVersion everywhere, the Dock can take its
# icon from any of them, including old ones with no icon, and shows a blank tile. A build number
# that only goes up makes this copy the newest one, and changes the key the icon cache uses.
build="$(date +%Y%m%d.%H%M%S)"
"$PLISTBUDDY" -c "Set :CFBundleVersion $build" "$plist"
say "Stamped OmniGitCommit ${commit:0:12}, build $build"

# 3. Sign.
identity="$(security find-identity -v -p codesigning 2>/dev/null \
  | awk '/"Apple Development/ { print $2; exit }')"
if [[ -n "$identity" ]]; then
  label="Apple Development"
else
  identity="-"
  label="ad hoc"
fi
say "Signing ($label)"
codesign --force --sign "$identity" --timestamp=none "$BUILT"
codesign --verify --strict "$BUILT"

# 4. Quit the installed copy if it runs. Only that copy: a Debug build or the server keeps running.
# -a: pgrep skips its own ancestors by default, and the app is one when its Rebuild button runs this.
exe="$DEST/Contents/MacOS/Omni"
if pids="$(pgrep -af "^$exe( |$)")"; then
  say "Quitting the running Omni"
  kill -TERM $pids 2>/dev/null || true
  for _ in $(seq 1 50); do
    pgrep -af "^$exe( |$)" >/dev/null || break
    sleep 0.1
  done
  if pids="$(pgrep -af "^$exe( |$)")"; then
    kill -KILL $pids 2>/dev/null || true
    sleep 0.2
  fi
fi

# 5. Install. The old copy goes to the Trash, and anything that is not this app is left alone.
if [[ -e "$DEST" ]]; then
  old_id="$("$PLISTBUDDY" -c "Print :CFBundleIdentifier" "$DEST/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$old_id" != "$BUNDLE_ID" ]]; then
    echo "build-mac: $DEST is not this app (bundle id '${old_id:-none}'). Move it away first." >&2
    exit 1
  fi
  stamp="$(date +%Y-%m-%d\ %H.%M.%S)"
  # Some terminals may not write to the Trash. The build folder is the fallback.
  old="$HOME/.Trash/Omni $stamp.app"
  if ! mv "$DEST" "$old" 2>/dev/null; then
    mkdir -p "$DERIVED/replaced"
    old="$DERIVED/replaced/Omni $stamp.app"
    mv "$DEST" "$old"
    say "Moved the old copy to $DERIVED/replaced"
  fi
  # LaunchServices follows the moved bundle, so it would stay registered under this bundle id.
  "$LSREGISTER" -u "$old" 2>/dev/null || true
fi
mkdir -p "$(dirname "$DEST")"
ditto "$BUILT" "$DEST"
codesign --verify --strict "$DEST"
# ditto keeps the build folder's date, which the icon cache also reads. Register the installed copy
# fresh, and drop the build product's record so only one Release copy is known.
touch "$DEST"
"$LSREGISTER" -f "$DEST" 2>/dev/null || true
"$LSREGISTER" -u "$BUILT" 2>/dev/null || true
say "Installed $DEST"
echo "$DEST"

# 6. Open.
if ((open_app)); then
  if ((${#app_args[@]})); then
    open "$DEST" --args "${app_args[@]}"
  else
    open "$DEST"
  fi
  say "Opened Omni"
fi
