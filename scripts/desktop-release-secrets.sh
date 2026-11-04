#!/usr/bin/env bash
# Saves the desktop release's signing and notarization credentials as GitHub Actions secrets, once, from the Mac
# that holds them. Values go to `gh secret set` on stdin: never into argv, the shell history or a file.
#
#   scripts/desktop-release-secrets.sh --p12 <DeveloperID.p12> --api-key <AuthKey_XXXX.p8> --key-id <id> --issuer <uuid>
#   scripts/desktop-release-secrets.sh --p12 <DeveloperID.p12> --apple-id <you@example.com> --team-id <TEAMID>
#
#   --p12       the "Developer ID Application" certificate with its private key, exported from Keychain Access.
#               Asks for the password you gave the export.
#   --api-key   an App Store Connect API key (.p8) for notarization, with its --key-id and --issuer
#   --apple-id  or notarize with your Apple ID instead. Asks for an app-specific password (appleid.apple.com).
#   --repo      owner/name, by default this checkout's origin
#
# See apps/desktop/RELEASE.md.
set -euo pipefail

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "desktop-release-secrets: $*" >&2; exit 2; }

p12='' api_key='' key_id='' issuer='' apple_id='' team_id='' repo=''
while (($#)); do
  case "$1" in
    --p12) p12="${2:-}"; shift 2 ;;
    --api-key) api_key="${2:-}"; shift 2 ;;
    --key-id) key_id="${2:-}"; shift 2 ;;
    --issuer) issuer="${2:-}"; shift 2 ;;
    --apple-id) apple_id="${2:-}"; shift 2 ;;
    --team-id) team_id="${2:-}"; shift 2 ;;
    --repo) repo="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option $1" ;;
  esac
done

command -v gh >/dev/null || die 'needs gh, signed in (gh auth login)'
[[ -f "$p12" ]] || die '--p12 needs the exported Developer ID Application .p12'
if [[ -n "$api_key" ]]; then
  [[ -f "$api_key" && -n "$key_id" && -n "$issuer" ]] || die '--api-key needs the .p8 file, --key-id and --issuer'
elif [[ -n "$apple_id" ]]; then
  [[ -n "$team_id" ]] || die '--apple-id needs --team-id'
else
  die 'notarization needs --api-key (with --key-id, --issuer) or --apple-id (with --team-id)'
fi
repo="${repo:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

read -rsp "Password of $(basename "$p12"): " p12_password; echo
# Fails here, not in the release, when the password does not open the file or it holds no Developer ID identity.
if [[ "$(uname -s)" == Darwin ]]; then
  subjects="$(openssl pkcs12 -in "$p12" -nokeys -passin fd:3 3<<<"$p12_password" 2>/dev/null || openssl pkcs12 -legacy -in "$p12" -nokeys -passin fd:3 3<<<"$p12_password" 2>/dev/null)" \
    || die "the password does not open $p12"
  grep -q 'Developer ID Application' <<<"$subjects" || die "$p12 holds no Developer ID Application certificate"
fi

set_secret() { gh secret set "$1" -R "$repo" >/dev/null; echo "  $1"; }

echo "Saving to $repo:"
base64 < "$p12" | tr -d '\n' | set_secret MAC_CERTIFICATE_P12
printf '%s' "$p12_password" | set_secret MAC_CERTIFICATE_PASSWORD
if [[ -n "$api_key" ]]; then
  set_secret APPLE_API_KEY_P8 < "$api_key"
  printf '%s' "$key_id" | set_secret APPLE_API_KEY_ID
  printf '%s' "$issuer" | set_secret APPLE_API_ISSUER
else
  read -rsp "App-specific password for $apple_id: " app_password; echo
  printf '%s' "$apple_id" | set_secret APPLE_ID
  printf '%s' "$app_password" | set_secret APPLE_APP_SPECIFIC_PASSWORD
  printf '%s' "$team_id" | set_secret APPLE_TEAM_ID
fi
echo "Done. Release with: gh workflow run desktop-release.yml -R $repo -f bump=patch"
