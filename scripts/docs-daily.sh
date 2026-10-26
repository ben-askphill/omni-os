#!/usr/bin/env bash
# Daily docs automation helpers (see automations/docs-daily.yaml).
# State: $OMNI_ROOT/data/docs-daily/last-sha
# Log:   $OMNI_ROOT/data/logs/docs-daily.log
set -euo pipefail

REPO_SLUG_DEFAULT="ben-askphill/omni-os"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  printf '%s\n' "$msg" >&2
  if [[ -n "${LOG_FILE:-}" ]]; then
    printf '%s\n' "$msg" >>"$LOG_FILE"
  fi
}

die() {
  log "ERROR: $*"
  exit 1
}

omni_root() {
  if [[ -n "${OMNI_ROOT:-}" ]]; then
    printf '%s' "$OMNI_ROOT"
    return
  fi
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  printf '%s' "$here"
}

state_dir() {
  local root
  root="$(omni_root)"
  printf '%s/data/docs-daily' "$root"
}

state_file() {
  printf '%s/last-sha' "$(state_dir)"
}

init_paths() {
  local root
  root="$(omni_root)"
  LOG_FILE="$root/data/logs/docs-daily.log"
  mkdir -p "$(state_dir)" "$(dirname "$LOG_FILE")"
}

is_doc_path() {
  local p="$1"
  case "$p" in
    README.md|CLAUDE.md|AGENTS.md|CONTEXT.md|FORKING.md|CONTRIBUTING.md) return 0 ;;
    docs/*) return 0 ;;
    crew/*.md) return 0 ;;
    apps/mac/NOTES.md) return 0 ;;
    *) return 1 ;;
  esac
}

default_branch() {
  local root="$1" ref
  ref="$(git -C "$root" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || true)"
  if [[ -n "$ref" ]]; then
    printf '%s' "$ref"
    return
  fi
  if git -C "$root" rev-parse --verify origin/main >/dev/null 2>&1; then
    printf '%s' main
  else
    printf '%s' master
  fi
}

repo_root() {
  if [[ -n "${DOCS_DAILY_REPO:-}" ]]; then
    printf '%s' "$DOCS_DAILY_REPO"
    return
  fi
  omni_root
}

read_state_sha() {
  local f
  f="$(state_file)"
  if [[ -f "$f" ]]; then
    tr -d '[:space:]' <"$f"
  else
    printf ''
  fi
}

write_state_sha() {
  local sha="$1"
  mkdir -p "$(state_dir)"
  printf '%s\n' "$sha" >"$(state_file)"
}

# Files changed in rev-range (union), one path per line, sorted -u.
files_in_range() {
  local root="$1" base="$2" head="$3"
  if [[ "$base" == "$head" ]]; then
    return 0
  fi
  git -C "$root" diff --name-only "$base" "$head" | sort -u
}

fallback_base_sha() {
  local root="$1" head="$2"
  # First run: commits on default branch from the last 24 hours.
  local since
  since="$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)"
  git -C "$root" rev-list -n 1 "$head" --before="$since" 2>/dev/null || git -C "$root" rev-list -n 1 "$head" || echo ""
}

preflight() {
  init_paths
  local root repo_slug
  root="$(omni_root)"
  repo_slug="${1:-$REPO_SLUG_DEFAULT}"

  command -v git >/dev/null || die "git not found"
  command -v gh >/dev/null || die "gh not found"
  git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git checkout: $root"

  if [[ "${DOCS_DAILY_SKIP_FETCH:-}" != "1" ]]; then
    log "preflight: fetch origin ($repo_slug)"
    git -C "$root" fetch origin --prune
  else
    log "preflight: skip fetch (DOCS_DAILY_SKIP_FETCH)"
  fi

  local branch head
  branch="$(default_branch "$root")"
  head="origin/$branch"
  git -C "$root" rev-parse --verify "$head" >/dev/null || die "missing $head after fetch"

  local head_sha base_sha
  head_sha="$(git -C "$root" rev-parse "$head")"
  base_sha="$(read_state_sha)"
  if [[ -z "$base_sha" ]]; then
    base_sha="$(fallback_base_sha "$root" "$head_sha")"
    log "preflight: no state file; base is 24h fallback ${base_sha:-<empty>}"
  else
    log "preflight: last processed $base_sha"
  fi

  if [[ -z "$base_sha" ]]; then
    log "NOOP: no baseline commit on default branch"
    printf '%s\n' '{"skip":true,"reason":"no_baseline","head_sha":"'"$head_sha"'"}'
    return 0
  fi

  if ! git -C "$root" merge-base --is-ancestor "$base_sha" "$head_sha" 2>/dev/null; then
    log "preflight: stored base is not an ancestor of $head; resetting base to 24h fallback"
    base_sha="$(fallback_base_sha "$root" "$head_sha")"
  fi

  if [[ "$base_sha" == "$head_sha" ]]; then
    log "NOOP: default branch unchanged since last processed commit"
    printf '%s\n' '{"skip":true,"reason":"up_to_date","head_sha":"'"$head_sha"'","base_sha":"'"$base_sha"'"}'
    return 0
  fi

  local non_doc=0 f
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if ! is_doc_path "$f"; then
      non_doc=1
      break
    fi
  done < <(files_in_range "$root" "$base_sha" "$head_sha")

  if [[ "$non_doc" -eq 0 ]]; then
    log "NOOP: only documentation changed since $base_sha"
    write_state_sha "$head_sha"
    printf '%s\n' '{"skip":true,"reason":"docs_only","head_sha":"'"$head_sha"'","base_sha":"'"$base_sha"'"}'
    return 0
  fi

  local branch_name commits_json
  branch_name="docs/auto-$(TZ=Europe/Amsterdam date +%Y-%m-%d)"
  commits_json="$(git -C "$root" log --format='%H|%s' "$base_sha..$head_sha" | python3 -c '
import json, sys
rows = []
for line in sys.stdin:
    line = line.rstrip("\n")
    if "|" not in line:
        continue
    sha, subj = line.split("|", 1)
    rows.append({"sha": sha, "subject": subj})
print(json.dumps(rows))
')"

  log "preflight: work needed ($base_sha..$head_sha, branch $branch_name)"
  local def_branch
  def_branch="$(default_branch "$root")"
  python3 -c '
import json, sys
base, head, branch, slug, commits, default_branch = sys.argv[1:7]
commits = json.loads(commits)
print(json.dumps({
  "skip": False,
  "reason": "changes_need_docs",
  "repo": slug,
  "default_branch": default_branch,
  "base_sha": base,
  "head_sha": head,
  "branch_name": branch,
  "commits": commits,
}))
' "$base_sha" "$head_sha" "$branch_name" "$repo_slug" "$commits_json" "$def_branch"
}

assert_docs_only() {
  init_paths
  local root
  root="$(repo_root)"
  git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git checkout: $root"

  local bad=0 f
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if ! is_doc_path "$f"; then
      log "non-doc path in diff: $f"
      bad=1
    fi
  done < <(
    {
      git -C "$root" diff --name-only HEAD
      git -C "$root" diff --name-only --cached HEAD
      git -C "$root" ls-files --others --exclude-standard
    } | sort -u
  )

  if [[ "$bad" -ne 0 ]]; then
    die "abort: diff touches paths outside documentation"
  fi
  log "assert-docs-only: ok"
}

record() {
  init_paths
  local sha="${1:-}"
  [[ -n "$sha" ]] || die "record: missing commit sha"
  write_state_sha "$sha"
  log "record: last-sha -> $sha"
}

merge_when_ready() {
  init_paths
  local pr="${1:-}" repo_slug="${2:-$REPO_SLUG_DEFAULT}"
  [[ -n "$pr" ]] || die "merge-when-ready: missing PR number"

  log "merge-when-ready: PR #$pr on $repo_slug"

  local tries=0 max_tries=90
  while (( tries < max_tries )); do
    local state mergeable
    state="$(gh pr view "$pr" --repo "$repo_slug" --json state,mergeable,mergeStateStatus,statusCheckRollup -q '.state' 2>/dev/null || true)"
    if [[ "$state" == "MERGED" ]]; then
      log "merge-when-ready: already merged"
      return 0
    fi
    if [[ "$state" == "CLOSED" ]]; then
      die "PR #$pr is closed without merging"
    fi

    mergeable="$(gh pr view "$pr" --repo "$repo_slug" --json mergeable -q '.mergeable' 2>/dev/null || echo UNKNOWN)"
    if [[ "$mergeable" == "CONFLICTING" ]]; then
      die "PR #$pr has merge conflicts; fix manually"
    fi

    local failed=0 merge_state
    merge_state="$(gh pr view "$pr" --repo "$repo_slug" --json mergeStateStatus -q '.mergeStateStatus' 2>/dev/null || echo UNKNOWN)"
    failed="$(gh pr checks "$pr" --repo "$repo_slug" 2>/dev/null | awk '$2=="fail"{f=1} END{print f+0}' || echo 0)"
    if [[ "$failed" -eq 0 ]] && [[ "$merge_state" == "CLEAN" || "$merge_state" == "UNKNOWN" ]]; then
      if gh pr merge "$pr" --repo "$repo_slug" --squash --delete-branch 2>>"$LOG_FILE"; then
        log "merge-when-ready: squashed and merged PR #$pr"
        return 0
      fi
      local err
      err="$(gh pr merge "$pr" --repo "$repo_slug" --squash --delete-branch 2>&1 || true)"
      if [[ "$err" == *"Protected branch"* ]] || [[ "$err" == *"not mergeable"* ]]; then
        die "merge blocked by branch protection or policy; leave PR open. Check required reviews, status checks, and allow auto-merge for docs-only PRs from this account."
      fi
      die "merge failed: see log"
    fi

    log "merge-when-ready: waiting for checks (attempt $((tries + 1))/$max_tries)"
    sleep 60
    tries=$((tries + 1))
  done

  die "timed out waiting for PR #$pr checks"
}

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  printf '\nCommands:\n  preflight [owner/repo]\n  assert-docs-only\n  record <sha>\n  merge-when-ready <pr> [owner/repo]\n'
}

cmd="${1:-}"
case "$cmd" in
  preflight) shift; preflight "${1:-}" ;;
  assert-docs-only) assert_docs_only ;;
  record) shift; record "${1:-}" ;;
  merge-when-ready) shift; merge_when_ready "${1:-}" "${2:-}" ;;
  -h|--help|help|"") usage ;;
  *) die "unknown command: $cmd (use --help)" ;;
esac
