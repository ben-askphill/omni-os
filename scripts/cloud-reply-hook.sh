#!/bin/sh
# Stop hook for repos that Omni starts Claude Code cloud sessions in. Posts each turn's final assistant
# message to Omni (/api/cloud/reply/<session id>) so the Omni thread gets it as its reply and crew report.
# Install: commit this file to the repo and add to its .claude/settings.json:
#   {"hooks":{"Stop":[{"hooks":[{"type":"command","timeout":15,"command":"sh \"$CLAUDE_PROJECT_DIR/scripts/cloud-reply-hook.sh\""}]}]}}
# Set on the cloud environment: OMNI_REPLY_URL (Omni's tunnel URL, e.g. https://omni.example.ts.net) and the network
# secret OMNI_CLOUD_REPLY_SECRET, matching the Keychain secret of the same name in Omni. Add the tunnel host to the
# environment's allowed domains. Does nothing outside a cloud session or without both values. Never fails the turn.

[ -n "${CLAUDE_CODE_REMOTE_SESSION_ID:-}" ] || exit 0
[ -n "${OMNI_REPLY_URL:-}" ] && [ -n "${OMNI_CLOUD_REPLY_SECRET:-}" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

sid=$(printf '%s' "$CLAUDE_CODE_REMOTE_SESSION_ID" | sed 's/^cse_/session_/')
jq -r '.last_assistant_message // empty' | \
  curl -fsS -m 10 -X POST -H @- -H 'content-type: text/plain' --data-binary @/dev/fd/3 \
    "${OMNI_REPLY_URL%/}/api/cloud/reply/$sid" >/dev/null 2>&1 3<&0 <<EOT || true
Authorization: Bearer $OMNI_CLOUD_REPLY_SECRET
EOT
exit 0
