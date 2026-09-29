#!/usr/bin/env bash
# Uploads screenshots for a PR and prints the Markdown to paste into its description.
#
#   scripts/pr-screenshots.sh <image>...
#
# GitHub has no API for attaching images to a PR, so the images are committed to the orphan
# branch `pr-screenshots` under a folder named after the current branch (omni/abc -> omni-abc),
# and linked with blob ?raw=true URLs, which render in a private repo for anyone who can see it.
# It uses a temporary index, so the working tree, the index and the current branch are untouched.
# A file with the same name in the same folder is replaced, so re-running after a fix updates the PR.
set -euo pipefail

[ $# -gt 0 ] || { echo "usage: scripts/pr-screenshots.sh <image>..." >&2; exit 2; }

BRANCH="pr-screenshots"
REMOTE="${PR_SCREENSHOTS_REMOTE:-origin}"
REPO="${PR_SCREENSHOTS_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
FOLDER="$(git rev-parse --abbrev-ref HEAD | tr '/' '-')"

for f in "$@"; do
  [ -f "$f" ] || { echo "not a file: $f" >&2; exit 2; }
done

INDEX="$(mktemp)"
trap 'rm -f "$INDEX"' EXIT

# Retry because other threads push to the same branch.
for attempt in 1 2 3 4 5; do
  rm -f "$INDEX"
  PARENT=()
  if git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null; then
    TIP="$(git rev-parse FETCH_HEAD)"
    PARENT=(-p "$TIP")
    GIT_INDEX_FILE="$INDEX" git read-tree "$TIP"
  else
    GIT_INDEX_FILE="$INDEX" git read-tree --empty
  fi

  for f in "$@"; do
    BLOB="$(git hash-object -w "$f")"
    GIT_INDEX_FILE="$INDEX" git update-index --add --cacheinfo "100644,$BLOB,$FOLDER/$(basename "$f")"
  done

  TREE="$(GIT_INDEX_FILE="$INDEX" git write-tree)"
  COMMIT="$(git commit-tree "$TREE" ${PARENT[@]+"${PARENT[@]}"} -m "Screenshots for $FOLDER")"
  if git push --quiet "$REMOTE" "$COMMIT:refs/heads/$BRANCH" 2>/dev/null; then
    break
  fi
  [ "$attempt" -lt 5 ] || { echo "push to $BRANCH failed after 5 attempts" >&2; exit 1; }
  sleep "$attempt"
done

for f in "$@"; do
  NAME="$(basename "$f")"
  ALT="${NAME%.*}"
  echo "![${ALT//-/ }](https://github.com/$REPO/blob/$BRANCH/$FOLDER/$NAME?raw=true)"
done
