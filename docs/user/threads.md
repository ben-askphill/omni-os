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

## Watch PR

A thread with an open PR can watch its checks and its reviews: **Watch PR** in the composer's PR menu (on the phone, the PR screen), or the Conductor's `watch_pr` tool. Omni polls GitHub itself, so no client needs to be open and an unchanged poll costs no agent turn.

- A check that fails on the PR head wakes the thread once, with the head commit, the failing checks and the tail of each GitHub Actions log. The same check failing again on the same head, after a re-run, does not wake it again; failing on a new head does.
- New review feedback from someone else wakes it too: a review that says something or asks for changes, an inline comment, a conversation comment. One wake carries everything new since the last poll, with each author, a link, the head the comment was written on and an excerpt (the first eight with their text, the rest by link). Only feedback written after the watch started counts.
- Your own comments (the account `gh` is signed in as) never wake it, so the agent replying on the PR cannot start a loop. Comments from people with no history in the repo are ignored; bots count. A person editing a comment to new words wakes it once more; a bot editing its own comment does not, and neither does an edit back to words it already woke for.
- Comment text is quoted to the agent as input to weigh, not as instructions from you.
- The wake is saved before it is sent, like any queued message. One saved before a restart waits in the thread for Resume. A thread this Mac cannot run (it runs on your other Mac, its worktree is not ready) gets it held for Resume too.
- Polls come every minute while checks run and slow to every 15 minutes while nothing changes. GitHub errors back off, and five in a row stop the watch. A rate limit pauses every watch for 15 minutes without counting as an error.
- A watch ends when you stop it, the PR merges or closes, the thread is archived, it has woken the thread five times, or three times for review comments alone with no failing check in the wake. The PR menu says which; Watch PR starts it again with fresh budgets. Starting a watch that is already running changes nothing.
- Watches live on the Mac that started them and are not synced.

## Send to Grok Bot

The thread header and the right-click menu send the title and the messages. On a phone, Thread options has the same action. The context is the channel id and the thread id. The Conductor tool is `send_to_grok_bot`. Where the webhook URL and Authorization value go: [Configuration](configuration.md#grok-bot).
