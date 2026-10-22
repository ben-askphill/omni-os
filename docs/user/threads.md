# Threads

A thread is one task's conversation with one agent, from the first prompt through every follow-up. Threads are dated, full-text searchable (Search page) and resumable any time. Rename or archive one from its right-click menu or with `/rename`.

## The composer

- `/` opens the menu of skills, slash commands and MCP prompts for the thread's harness.
- `@` mentions artifacts and repo files.
- After a finished turn, Haiku suggests your likely next reply. Tab fills it in; `OMNI_SUGGESTIONS=0` in `.env` turns it off.

## Sending while a thread is busy

| Mode | What happens |
| --- | --- |
| Steer (default, Enter) | Written to the CLI now. The agent reads it at its next step (after the running tool) and keeps going |
| Queue for after this turn | Held by Omni, runs as a new turn once the current one ends |
| Interrupt and send (Cmd/Ctrl+Shift+Enter) | Stops the current step, then runs the message |

Cmd/Ctrl+Enter adds a newline. Pending messages show under the live output and enter the transcript at the point the agent actually read them. Interrupt (header button or Esc) stops the turn but keeps the process and its context. Steers already sent still run; queued ones are recorded as "Not sent". A CLI that does not stop within `OMNI_INTERRUPT_GRACE_MS` is killed. Only turns in progress count toward `OMNI_MAX_CONCURRENT`; warm idle processes do not.

Files can ride along with a message (paperclip, drag-and-drop or paste). They land in `data/threads/<id>/uploads/`, keeping their original names, and the agent gets every one by absolute path; images small enough for the API also go in as real image blocks. `OMNI_MAX_UPLOAD_MB` caps a single file.

To continue a thread in a terminal or Claude Desktop: `cd <cwd> && claude --resume <session id>` (the thread's Details panel has a copy button). Check there that the session is no longer warm first, so two processes do not write the same session.

## What a thread gets

- **Worktree**: in a repo channel, its own git worktree on branch `omni/<id>`. It is removed once nothing in it can be lost ([Known limits](limits.md)).
- **Browser**: the channel's persistent Chrome (logins survive), shown live in the thread's Browser panel. You can click and type in it too.
- **Terminal tab**: a real shell (PTY) in the thread's working directory.
- **Secrets**: global and channel secrets from the Keychain, as env vars ([Configuration](configuration.md#secrets)).
- **Artifacts**: anything the agent writes to its artifacts dir renders inline in the thread, and on the Artifacts page across channels.
- **Published artifacts**: a page a Claude Code thread publishes to claude.ai with its Artifact tool shows as a card in the thread, linked to its local file. The channel's pages go into later threads' system prompt, so an update lands at the same URL. "Check comments" (or the `artifact-comments` automation) hands a page's comments back to the thread that made it.
- **GitHub panel**: in a repo channel, PRs, checks, diff and merge (with confirm). Threads whose branch has an open or merged PR get a PR icon in the thread list.

How the process behind a thread is launched: [Architecture overview](../internals/overview.md#how-a-thread-runs).
