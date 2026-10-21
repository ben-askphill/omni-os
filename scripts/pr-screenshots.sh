#!/usr/bin/env bash
# Uploads screenshots for a PR and prints the Markdown to paste into its description.
#
#   scripts/pr-screenshots.sh <image>...
#
# GitHub has no API for attaching images to a PR, so the images are committed under a folder named
# after the current branch (omni/abc -> omni-abc) to the hidden ref `refs/screenshots/pr-screenshots`,
# and linked with blob ?raw=true URLs pinned to that commit, which render in a private repo for
# anyone who can see it. A ref outside refs/heads keeps GitHub's "had recent pushes, Compare & pull
# request" banner off the repo page. The first run seeds it from the old `pr-screenshots` branch,
# which stays so links in older PRs keep working.
# It uses a temporary index, so the working tree, the index and the current branch are untouched.
# A file with the same name in the same folder is replaced; re-running prints new links to paste.
set -euo pipefail

[ $# -gt 0 ] || { echo "usage: scripts/pr-screenshots.sh <image>..." >&2; exit 2; }

REF="refs/screenshots/pr-screenshots"
LEGACY_BRANCH="refs/heads/pr-screenshots"
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
  if git fetch --quiet "$REMOTE" "$REF" 2>/dev/null || git fetch --quiet "$REMOTE" "$LEGACY_BRANCH" 2>/dev/null; then
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
  if git push --quiet "$REMOTE" "$COMMIT:$REF" 2>/dev/null; then
    break
  fi
  [ "$attempt" -lt 5 ] || { echo "push to $REF failed after 5 attempts" >&2; exit 1; }
  sleep "$attempt"
done

for f in "$@"; do
  NAME="$(basename "$f")"
  ALT="${NAME%.*}"
  echo "![${ALT//-/ }](https://github.com/$REPO/blob/$COMMIT/$FOLDER/$NAME?raw=true)"
done
