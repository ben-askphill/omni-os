# Access levels are set per channel and connector and enforced in the harness

Every thread ran with every tool allowed: Claude Code with `--permission-mode bypassPermissions`, Codex with `approvalPolicy: never` and `danger-full-access`, Cursor with `--force`. That suits a developer watching their own repo. It does not suit a channel that reads Ben's Gmail, or a new install whose user does not know what an agent can do yet. The knowledge-work plan (`docs/plans/2026-11-18-knowledge-work-slices.md`, Slice D: A6 and M1) asked for plain levels a person can set without reading a permission grammar, enforced where the tool runs, not only in the UI.

## Decision

- **Three levels for a channel, four for a connector.** A channel is Read only, Ask first or Full access (`packages/shared/access.ts`). A connector (Gmail, Google Calendar, Slack, Notion, Google Drive, Granola, the browser) can be any of those or Off, and a connector left alone follows the channel. The plan's Off, Read, Draft and Write map onto these: Draft is what Ask first does (drafting runs, sending waits for a yes), and Write is Full access.
- **What each level lets through.** Read only allows reading and searching, and refuses every edit, every command that is not on a short read-only list (`ls`, `cat`, `git status`, `rg` and the like) and every connector action that is not a read. Ask first allows the same reads plus edits inside the thread's working folder (its worktree, repo or base directory), and holds everything else for a yes. Full access runs everything, as before. Omni's folder for the thread (`data/threads/<id>`, its artifacts) stays writable at every level, so artifacts and notes still work. Omni's own MCP servers run at every level, since Omni checks what they do itself.
- **The server decides, per call.** `apps/server/access.ts` judges a call (`allow`, `deny` with a reason the agent reads, or `ask`). `apps/server/runner/approvals.ts` turns an `ask` into a question event with an `approval` field, so the card streams, syncs, alerts and shows on every client the way an `ask_user_question` card does, and the harness's call waits for the answer.
- **Per harness:**
  - **Claude Code** runs with `--permission-mode default --permission-prompt-tool stdio` and a `PreToolUse` hook that answers `ask` for every tool, so no allow rule in the user's settings skips the gate. The CLI sends `can_use_tool`, and the adapter answers it after the judge (and the card, when it asks). At Full access none of this is passed, and the arguments are exactly as before.
  - **Codex** runs Read only in its `read-only` sandbox with no approvals, so a write fails there, and Ask first with `approvalPolicy: untrusted` in `workspace-write`. Its `requestApproval` server requests go to the same judge.
  - **Cursor Agent** has no way to stop and ask in print mode. Below Full access it runs under the deny rules the delegate-only Conductor uses (`Shell(*)`, `Write(**)`), so Ask first runs as Read only there.
  - **Hermes and Cursor Cloud** run elsewhere, and Omni cannot see or stop their calls. Below Full access they are refused: starting a thread on one, or switching a thread to one, says why.
  - **The browser** has no per-call gate in Codex and Cursor, so below Full access for the browser connector those threads get no browser MCP.
- **Choices on the card.** Allow (this once), Allow in this thread, Always allow for <role> (when the thread runs as a crew role) and Don't allow. A typed answer refuses with that note. Grants are kept in the synced kv (`access-grants.thread.<id>`, `access-grants.role.<channel>.<role>`), so the other machine honours them, and Channel settings lists a role's grants with Remove.
- **A role can only narrow.** A crew role's `access:` frontmatter makes its threads stricter than the channel, never looser.
- **Only the user changes levels.** An agent's request (one that carries `x-omni-thread`) to set `access_level` or `connector_access`, or to remove a grant, gets a 403. Answering an approval was already refused to agents.

## New installs start at Ask first (M1)

- A channel's `access_level` is null until someone picks one, and null runs at the machine's default, kept in the local kv `sync.access.default`.
- The server settles that default once, at its first boot after this change: `full` when the database already has threads (Ben's existing installs keep running exactly as they did), `ask` on an empty one. `OMNI_ACCESS_DEFAULT` overrides it; the QA stack and the test servers set `full` so their fake turns run as before.
- Every channel record carries `access_default`, so a client shows what an unset channel runs at, and a new channel's form starts there.
- The default is per machine on purpose: a second machine set up fresh asks first even when the first one does not, and a channel with a level of its own runs at that level on both.

## Considered

- **Claude Code's own permission rules** (`--allowedTools`, `--disallowedTools`, settings allow and deny lists). They are static per spawn, cannot ask through Omni's card, and a user's allow rule could open what the channel closed.
- **A UI-only setting** that adds a line to the system prompt. An agent that ignores it still runs the tool, which is what the plan ruled out.
- **One level for everything, no connectors.** A channel that drafts in the repo but must not send Gmail would have to drop to Read only for everything.
- **A synced default.** Syncing `access.default` would flip a fresh second machine to Full access the moment it paired with Ben's.

## Consequences

- A thread at Full access can still do anything a shell can, `curl` included; levels are a guard against mistakes and surprises, not a sandbox against a hostile agent.
- The read-only command list errs on the side of asking: an unknown command under Ask first shows a card, under Read only it is refused.
- Cursor Agent loses edits under Ask first until its CLI can ask in print mode.
- Codex's sandbox and Omni's judge both apply under Ask first, so a call Codex itself refuses never reaches the card.
