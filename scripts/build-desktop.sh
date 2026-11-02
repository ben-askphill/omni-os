#!/usr/bin/env bash
# Builds the desktop app (apps/desktop) for this Mac's arch, installs it to ~/Applications/Omni.app and opens it.
#
#   scripts/build-desktop.sh [--no-open] [--no-sync] [-- app arguments]
#
#   --no-open   install, but do not open the app
#   --no-sync   build the checkout as it is, without scripts/sync-main.sh first
#   --          the rest goes to the app, like: -- --port 4759 --data-dir /tmp/omni-qa
#
# In the main checkout it first runs scripts/sync-main.sh, so the app is built from main, level with
# origin. A worktree builds its own branch.
# Signing: a "Developer ID Application" identity in the keychain, found by electron-builder itself; else an
# "Apple Development" one, so each build keeps one signature and macOS keeps its permissions; else ad hoc.
# Local builds are never notarized. The commit goes into Info.plist as OmniGitCommit, a build number that only
# goes up into CFBundleVersion.
# It only replaces the app bundle, and never while anything runs from it: the app, or a server it started and kept
# running, runs its files from inside the bundle. It never quits or stops them itself. The old copy goes to the
# Trash and out of LaunchServices.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/apps/desktop"
DEST="$HOME/Applications/Omni.app"
BUNDLE_ID="com.omni-os.desktop"
PLISTBUDDY=/usr/libexec/PlistBuddy
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

open_app=1
sync=1
args=("$@")
app_args=()
usage() { sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; }
while (($#)); do
  case "$1" in
    --no-open) open_app=0; shift ;;
    --no-sync) sync=0; shift ;;
    --) shift; app_args=("$@"); break ;;
    -h|--help) usage; exit 0 ;;
    *) echo "build-desktop: unknown option $1" >&2; usage >&2; exit 2 ;;
  esac
done

say() { printf '==> %s\n' "$*"; }

# Everything that runs the installed bundle's binary: the app, and the server it starts as `Omni .../index.mjs`.
exe="$DEST/Contents/MacOS/Omni"
refuse_if_running() {
  local procs
  procs="$(pgrep -lf "^$exe( |$)" || true)"
  [[ -z "$procs" ]] && return 0
  {
    echo "build-desktop: Omni runs from $DEST, so it cannot be replaced now:"
    sed 's/^/  /' <<<"$procs"
    echo "Quit Omni. If it kept its server running for turns (Keep Server Running), that server still runs from the"
    echo "bundle: stop it once its turns finish (the index.mjs process above). Then run this again."
  } >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || { echo "build-desktop: this is the Mac path. On Linux run: npm run dist:linux -w @omni/desktop" >&2; exit 2; }

# 0. Put the checkout on main. Bash reads this file as it runs and the switch may change it, so the
# rest runs from a fresh read of the new copy.
if ((sync)); then
  say "Updating the checkout to main"
  "$ROOT/scripts/sync-main.sh"
  exec "$ROOT/scripts/build-desktop.sh" --no-sync ${args[@]+"${args[@]}"}
fi

refuse_if_running

case "$(uname -m)" in
  arm64) arch=arm64; out="mac-arm64" ;;
  x86_64) arch=x64; out="mac" ;;
  *) echo "build-desktop: unknown arch $(uname -m)" >&2; exit 1 ;;
esac

# 1. Pick the signing identity.
identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
builder_args=()
if grep -q '"Developer ID Application' <<<"$identities"; then
  label="Developer ID Application, from the keychain"
elif apple_dev="$(awk -F'"' '/"Apple Development/ { print $2; exit }' <<<"$identities")" && [[ -n "$apple_dev" ]]; then
  label="$apple_dev"
  export OMNI_MAC_IDENTITY="$apple_dev"
else
  label="ad hoc"
  builder_args+=("-c.mac.identity=-")
fi
commit="$(git -C "$ROOT" rev-parse HEAD)"
build="$(date +%Y%m%d.%H%M%S)"
builder_args+=("-c.buildVersion=$build" "-c.mac.extendInfo.OmniGitCommit=$commit")

# 2. Build, stage and package the unpacked app.
say "Building Omni for $arch, signed with $label"
rm -rf "$DESKTOP/release/$out"
env -u APPLE_ID -u APPLE_APP_SPECIFIC_PASSWORD -u APPLE_TEAM_ID -u APPLE_API_KEY -u APPLE_API_KEY_ID -u APPLE_API_ISSUER \
  -u APPLE_KEYCHAIN -u APPLE_KEYCHAIN_PROFILE \
  npx --no-install tsx "$DESKTOP/scripts/dist.ts" --platform mac --arch "$arch" --dir -- "${builder_args[@]}"
BUILT="$DESKTOP/release/$out/Omni.app"
[[ -d "$BUILT" ]] || { echo "build-desktop: no app at $BUILT" >&2; exit 1; }
codesign --verify --deep --strict "$BUILT"
say "Built $BUILT (commit ${commit:0:12}, build $build)"

# 3. Install. The old copy goes to the Trash, and anything that is not this app is left alone. Omni may have
# started during the build.
refuse_if_running
if [[ -e "$DEST" ]]; then
  old_id="$("$PLISTBUDDY" -c "Print :CFBundleIdentifier" "$DEST/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$old_id" != "$BUNDLE_ID" ]]; then
    echo "build-desktop: $DEST is not this app (bundle id '${old_id:-none}'). Move it away first." >&2
    exit 1
  fi
  stamp="$(date +%Y-%m-%d\ %H.%M.%S)"
  # Some terminals may not write to the Trash. The release folder is the fallback.
  old="$HOME/.Trash/Omni $stamp.app"
  if ! mv "$DEST" "$old" 2>/dev/null; then
    mkdir -p "$DESKTOP/release/replaced"
    old="$DESKTOP/release/replaced/Omni $stamp.app"
    mv "$DEST" "$old"
    say "Moved the old copy to $DESKTOP/release/replaced"
  fi
  # LaunchServices follows the moved bundle, so it would stay registered under this bundle id.
  "$LSREGISTER" -u "$old" 2>/dev/null || true
fi
mkdir -p "$(dirname "$DEST")"
ditto "$BUILT" "$DEST"
codesign --verify --deep --strict "$DEST"
touch "$DEST"
"$LSREGISTER" -f "$DEST" 2>/dev/null || true
"$LSREGISTER" -u "$BUILT" 2>/dev/null || true
say "Installed $DEST"
echo "$DEST"

# 4. Open.
if ((open_app)); then
  if ((${#app_args[@]})); then
    open "$DEST" --args "${app_args[@]}"
  else
    open "$DEST"
  fi
  say "Opened Omni"
fi
