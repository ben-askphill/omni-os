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

Cmd/Ctrl+Enter adds a newline. Pending messages show under the live output and enter the transcript at the point the agent actually read them. A queued message has **Steer now**, which sends it into the running turn instead of waiting for the turn to end (not on Cursor, which cannot steer). Interrupt (header button or Esc) stops the turn but keeps the process and its context. Steers already sent still run; queued ones are recorded as "Not sent". A CLI that does not stop within `OMNI_INTERRUPT_GRACE_MS` is killed. Only turns in progress count toward `OMNI_MAX_CONCURRENT`; warm idle processes do not.

Files can ride along with a message (paperclip, drag-and-drop or paste). They land in `data/threads/<id>/uploads/`, keeping their original names, and the agent gets every one by absolute path; images small enough for the API also go in as real image blocks. `OMNI_MAX_UPLOAD_MB` caps a single file.

To continue a thread in a terminal or Claude Desktop: `cd <cwd> && claude --resume <session id>` (the thread's Details panel has a copy button). Check there that the session is no longer warm first, so two processes do not write the same session.

## When the agent asks you

An agent can stop and ask you one to four multiple-choice questions with Omni's `ask_user_question` tool. Every Claude Code, Codex and Cursor thread has it (the `omni-ask` MCP server); Hermes threads have no MCP servers, so not there. Claude Code's own AskUserQuestion is turned off in Omni, because nothing can answer it in a headless run.

- The questions show as a card in the thread, where the agent asked, and the thread shows in Needs you until you act, even while it runs. Pick an option (several on a multi select question) or type your own under Other. Skip leaves a question to the agent's judgement.
- The turn waits on the call until you answer, for up to a day on Claude Code and Codex. Your answers go back as the call's result and the turn carries on.
- If the call is gone by the time you answer (Omni restarted, you pressed Stop, or the harness gave up on it), your answers go to the thread as a message and it runs on them.
- Sending a message instead (steer or interrupt) closes the card as not answered, and the agent reads your message. A message queued for after the turn leaves the card open.

## What a thread gets

- **Worktree**: in a repo channel, its own git worktree on branch `omni/<id>`. It is removed once nothing in it can be lost ([Known limits](limits.md)). While it is prepared, the thread shows each step (checkout, the channel's setup action if it has one, then the agent) with the setup's output and a Stop button ([Configuration](configuration.md#channel-actions)).
- **Base**: the commit that branch starts from. The new-thread composer shows the repo's current commit as the default ("From main · a1b2c3d") and lets you pick another branch or tag, or the remote default branch. The remote default is fetched first, and the repo's own checkout and branches never move. The thread keeps the commit it resolved, and the Changes tab compares to it, so a branch that moves later changes nothing. If the fetch fails (offline, no access), the thread stops at "Setup failed" with the reason and your message kept, and Retry tries again. Threads started by a channel, crew role or automation without a choice start from the repo's current commit, as before. Hermes and Cursor Cloud threads have no worktree here, so no base.
- **Browser**: the channel's persistent Chrome (logins survive), shown live in the thread's Browser panel. You can click and type in it too.
- **Terminal tab**: a real shell (PTY) in the thread's working directory.
- **Actions tab**: the channel's named actions (Theme preview, Theme check, Tests) with a Run button each, and the thread's last 20 runs. A run starts only when you press Run or Retry, in the thread's checkout once it is verified (a worktree thread's own worktree on its own branch, never the repo itself). It shows Running, Succeeded, Failed or Stopped, the exit code, and the last 64 KB of its output. Stop ends the whole process group (SIGTERM, then SIGKILL after 5 seconds). Runs left running when Omni stopped show as Stopped. Hermes and Cursor Cloud threads can't run actions: there is no checkout on this Mac. On the phone, open it from the thread's menu ([Configuration](configuration.md#channel-actions)).
- **Secrets**: global and channel secrets from the Keychain, as env vars ([Configuration](configuration.md#secrets)).
- **Artifacts**: anything the agent writes to its artifacts dir renders inline in the thread, and on the Artifacts page across channels.
- **Published artifacts**: a page a Claude Code thread publishes to claude.ai with its Artifact tool shows as a card in the thread, linked to its local file. The channel's pages go into later threads' system prompt, so an update lands at the same URL. "Check comments" (or the `artifact-comments` automation) hands a page's comments back to the thread that made it.
- **GitHub panel**: in a repo channel, PRs, checks, diff and merge (with confirm). Threads whose branch has an open or merged PR get a PR icon in the thread list.

How the process behind a thread is launched: [Architecture overview](../internals/overview.md#how-a-thread-runs).

## Send to Grok Bot

The thread header and the right-click menu send the title and the messages. On a phone, Thread options has the same action. The context is the channel id and the thread id. The Conductor tool is `send_to_grok_bot`. Where the webhook URL and Authorization value go: [Configuration](configuration.md#grok-bot).
