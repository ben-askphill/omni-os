#!/usr/bin/env bash
# Puts the main checkout on main, level with origin, before the server's Update or scripts/build-desktop.sh.
#
#   scripts/sync-main.sh
#
# Only the main checkout moves. A linked worktree (a thread's, or one built for QA) is left as it is.
# It refuses, and changes nothing, when tracked files have changes: commit or stash them first.
# Untracked files stay. A branch it leaves stays as it is, its commits included.
# When origin can't be reached it says so and goes on with the local main.
# When package-lock.json changed it runs npm install --include=dev.
# Lines start with "sync-main:". Update shows the last one when it fails.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
say() { printf 'sync-main: %s\n' "$*"; }
fail() { printf 'sync-main: %s\n' "$*" >&2; exit 1; }
git() { command git -C "$ROOT" "$@"; }

git_dir="$(cd "$ROOT" && cd "$(command git rev-parse --git-dir)" && pwd)"
common_dir="$(cd "$ROOT" && cd "$(command git rev-parse --git-common-dir)" && pwd)"
if [[ "$git_dir" != "$common_dir" ]]; then
  say "$ROOT is a worktree, left on $(git branch --show-current || echo 'a detached HEAD')"
  exit 0
fi

branch="$(git branch --show-current)"
before="$(git rev-parse HEAD)"

if ! git diff --quiet HEAD -- || ! git diff --cached --quiet --; then
  fail "the checkout has uncommitted changes on ${branch:-a detached HEAD}. Commit or stash them, then try again."
fi

if ! git fetch --quiet origin main 2>/dev/null; then
  say "could not reach origin, using the local main"
  fetched=0
else
  fetched=1
fi

if [[ "$branch" != "main" ]]; then
  base=main; ((fetched)) && base=origin/main
  ahead="$(git rev-list --count "$base..HEAD" 2>/dev/null || echo 0)"
  git switch --quiet main || fail "could not switch from ${branch:-a detached HEAD} to main."
  if [[ -n "$branch" && "$ahead" != 0 ]]; then
    noun=commits; [[ "$ahead" == 1 ]] && noun=commit
    say "switched from $branch to main ($branch keeps its $ahead $noun that main does not have)"
  else
    say "switched from ${branch:-a detached HEAD} to main"
  fi
fi

if ((fetched)); then
  git merge --quiet --ff-only origin/main 2>/dev/null \
    || fail "local main has commits origin/main does not, so it can't fast-forward. Push or reset main first."
fi

after="$(git rev-parse HEAD)"
if [[ "$before" == "$after" ]]; then
  say "main is at ${after:0:8}"
  exit 0
fi
say "main is at ${after:0:8} (was ${before:0:8})"

if ! git diff --quiet "$before" "$after" -- package-lock.json; then
  say "package-lock.json changed, running npm install"
  (cd "$ROOT" && npm install --include=dev --no-audit --no-fund) || fail "npm install failed."
fi
