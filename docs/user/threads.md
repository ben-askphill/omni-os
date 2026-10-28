# Threads

A thread is one task's conversation with one agent, from the first prompt through every follow-up. Threads are dated, full-text searchable (Search page) and resumable any time. Rename or archive one from its right-click menu or with `/rename`.

## Finding threads and clearing Needs you

Running, Pinned and Recent threads in the desktop web and Mac sidebars list work across channels. Running includes queued threads and threads whose sub-agents still run; it hides when empty. Recent threads shows the five latest by activity, including pinned and running threads. Conductor handoffs nest under their parent in those lists and in the Conductor's channel view (expand/collapse). Each section folds independently and remembers its state on that device. On a phone, these lists are in Activity, and a channel splits its folder and ungrouped threads between Active and Recent, with the same nesting.

Needs you holds unread results and threads waiting for you to act. Opening a thread reads the result it shows, so a newer result stays unread. **Mark as done** clears any of those reasons without archiving the thread or changing how its last turn ended. It stays in its channel and folder with a grey check, muted title and Done chip. **Mark as not done** brings back its unread result and blockers. A new message, a run starting or Retry setup clears done; the flag syncs between Macs. Running and queued threads cannot be marked done.

On desktop web and Mac, use the check on a Needs you row, the thread header or the thread's right-click menu. In a narrow desktop web header, Pin, Mark done, Hand off and Send to Grok Bot move into the More menu. On a phone, Mark done is on Activity blocker cards and in Thread options. The Conductor can use `mark_thread_done` when you ask it to.

## The composer

- A new thread follows the channel and crew defaults until you pick a model or effort for that draft. Auto picks from the first prompt when no default is set. The Conductor role's charter is Auto; a saved #conductor channel default still wins. See [Harnesses](harnesses.md#auto).
- `/` opens the menu of skills, slash commands and MCP prompts for the thread's harness.
- `@` mentions artifacts and repo files.
- After a finished turn, Haiku suggests your likely next reply. Tab fills it in; `OMNI_SUGGESTIONS=0` in `.env` turns it off.

## Sending while a thread is busy

| Mode | What happens |
| --- | --- |
| Steer (default, Enter) | Written to the CLI now. The agent reads it at its next step (after the running tool) and keeps going |
| Queue for after this turn | Held by Omni, runs as a new turn once the current one ends |
| Interrupt and send (Cmd/Ctrl+Shift+Enter) | Stops the current step, then runs the message |

Cmd/Ctrl+Enter adds a newline. Pending messages show under the live output and enter the transcript at the point the agent actually read them. A queued message has **Steer now**, which sends it into the running turn instead of waiting for the turn to end (not on Cursor Agent or Cursor Cloud, which cannot steer). Interrupt (header button or Esc) stops the turn but keeps the process and its context. Steers already sent still run; queued ones are recorded as "Not sent". A CLI that does not stop within `OMNI_INTERRUPT_GRACE_MS` is killed. Only turns in progress count toward `OMNI_MAX_CONCURRENT`; warm idle processes do not.

Cursor Agent and Cursor Cloud cannot steer; messages sent while they run wait for the next turn. A model, effort or harness switch picked during a turn also makes messages wait for that switch, even on a harness that can steer. See [Switching mid-thread](harnesses.md#switching-mid-thread). To start a separate linked thread with its own session and checkout, use [Fork thread](harnesses.md#continuing-on-another-harness) (branch icon in the reply box, or under + on a phone). To attach another thread without forking, use [Reference another thread](#point-the-agent-at-another-thread) in the header. To move a thread (running or idle) to your other Mac, use [Hand off](sync.md#hand-off-a-thread).

Files can ride along with a message (paperclip, drag-and-drop or paste). They land in `data/threads/<id>/uploads/`, keeping their original names, and the agent gets every one by absolute path; images small enough for the API also go in as real image blocks. `OMNI_MAX_UPLOAD_MB` caps a single file.

To continue a thread in a terminal or Claude Desktop: `cd <cwd> && claude --resume <session id>` (the thread's Details panel has a copy button). Check there that the session is no longer warm first, so two processes do not write the same session.

## Running subagents

The thread panel's Details tab lists **Running subagents** under Resume in terminal: every agent the thread started itself that is still working, such as an Agent call, a workflow, a fork or a teammate, with its kind and how long it has run. Click one to scroll the transcript to the call that started it, however far back. The Details tab shows how many run while another tab is open, and the section hides when none do. On a phone, the list is at the bottom of the thread's options sheet. Background shells and monitors are not listed, and neither are delegated threads: those are under Delegated threads, and their own agents show in their own thread.

Claude Code reports its agents itself. Codex (multi-agent spawns), Cursor Agent (its task tool) and Hermes (`subagent.*` events) are mapped onto the same list. Cursor Cloud reports no sub-agents.

## Plan steps

When the agent posts a plan, click a step's checkbox to cycle it through pending, in progress and completed. The change is saved as a `plan_step_update` event and survives reloads. Desktop web, phone web and the Mac app all do this.

## Point the agent at lines of a diff

In a thread's Changes panel (desktop, phone and the Mac app), click a line number to pick it and shift-click another in the same hunk to pick the lines between (on a phone, tap a line, then tap another). Write a note and press **Add to message**: the lines and the note go into the reply box as a chip, next to whatever you have typed. Click a chip to see what it holds, x to take it out. A message can be just chips.

The agent gets the lines as you saw them, with the path, the line numbers, the commits they were compared at and your note, and is told when the file has changed since you picked them. Your message in the thread keeps the lines exactly as you sent them. It is feedback for this thread only, not a GitHub review. Hermes and Cursor Cloud threads have no Changes panel; a message with lines in it tells them the file is on your Mac. How it works: [Message context](../internals/message-context.md).

## Point the agent at terminal output

In a thread's Terminal tab (desktop and the Mac app), select output with the mouse as usual. A panel opens over the terminal's foot: write a note and press **Add to message**, and the selected text goes into the reply box as a chip, next to whatever you have typed. Copy and paste work as before, and Esc in the panel clears the selection. On a phone the terminal is read only and can't be dragged over: tap a line, then tap another to take the lines between, then Add to message. A message can be just chips.

The chip is a snapshot of the text, the directory the shell started in, the shell's process id and the time you added it. It stays as it was when the terminal scrolls on, restarts or the shell exits. The agent gets the text as plain text and is told it was not run: escape sequences are dropped when you add it, and output that holds Omni's own block tags can't pass for them. Up to 200 lines and 8,000 characters at once; more is refused rather than cut. How it works: [Message context](../internals/message-context.md).

## Point the agent at part of a web page

In a thread's Browser panel (desktop, the Mac app and the phone's Browser screen), press **Annotate**. Omni screenshots the channel's own browser, the same session the agent drives, and shows that screenshot in place of the live view. Draw on it with the toolbar (select, pen, shapes, text, color, line width, undo and delete), drag over the part of the page you mean, or tap an element to pick it, write a note and press **Add to message**: a chip goes into the reply box, and opening it shows the screenshot with your marks or area outlined, the page's address and title, and when you took it. The page is only read, never clicked, navigated or changed. Esc or Cancel leaves without adding. The Mac app's Web tab has Annotate too: the screenshot is of your own web view, and the rest works the same.

If the page navigates, the tab changes, the browser is resized or the page scrolls while the screenshot is taken, Omni says so and offers **Try again**, so the area is never drawn on a different page than the one it describes. The screenshot is kept as a file in the thread, so the chip survives a reload (the web keeps unsent chips in this browser) and shows in the sent message. The agent gets the page's address and title, the viewport, and the area in page pixels, with the screenshot as an image: Claude Code and Codex see it, Cursor reads the file from the path it is given, and an agent on another machine (Hermes, Cursor Cloud) is told the file is on your Mac. A screenshot that has gone missing is stated, not skipped.

**Picking an element.** A tap on the screenshot (rather than a drag) asks the page what element is under that spot, marks its box, and shows its tag, selector, text and a short excerpt of its markup under **Details** before you add it. The agent gets that same excerpt, quoted as data from the page. It is bounded (600 characters of text, 2,000 of markup, four parent tags), never holds what you typed into a field, and leaves a link's query and fragment out. If the page has moved on since the screenshot, the spot is in a frame from another site, or the page cannot be read, Omni says so and the screenshot and any area you drag still go with the message, without the element. How it works: [Message context](../internals/message-context.md).

## Point the agent at another thread

In the thread's header, press the **Reference another thread** button (the speech bubble next to the context meter on desktop and the Mac app, or **Reference a thread** in the thread options on a phone). Archived threads hide the button. Search by title or channel and pick a thread: it goes into the reply box as a chip, next to whatever you have typed, and x takes it out. The search lists this channel's threads. **All channels** lists the others, and a thread from another channel is attached only when you pick it there; it is marked "other channel". Two threads with one title are told apart by the start of their id.

The chip holds the thread's title, channel and id as they were when you sent the message, so renaming or archiving it later changes nothing in a sent message. Click it to see them, and **Open thread** to go there. Attaching a thread does not message it, start it or change it, and none of its messages go into yours: the agent is told the thread exists and reads its history only when it needs to, with the `read_referenced_thread` tool, one page at a time (at most 100 messages and 60,000 characters). That tool reads only a thread you attached to a message of that thread, and says so when it is gone. Claude Code, Codex, Cursor and the conductor have it; Hermes and Cursor Cloud threads run elsewhere, so they are told the reference only. A message can be just chips. How it works: [Message context](../internals/message-context.md#thread-references).

## Reading a long thread

A thread opens on its newest messages. Scroll up to load earlier pages; a search hit opens the page with that message. If two loaded pages have a gap, use Show earlier or Show later to fill it. A large message or tool input may say **Trimmed for loading**; Show all loads that row whole.

Replies render as Markdown on desktop web, phone web and the Mac app. A `mermaid` code fence draws as a diagram (light and dark); a fence that fails to parse keeps its source visible. Wide diagrams scroll sideways on a phone.

Open a tool row to read its output. Long output starts with a preview, then loads in chunks with Load more. A running Codex command can show its live tail; the other harnesses show output when the call ends. If the harness cut the output before saving it, loading more cannot recover it. The budgets and client rules are in [Thread history](../internals/thread-history.md).

## When the agent asks you

An agent can stop and ask you one to four multiple-choice questions with Omni's `ask_user_question` tool. Every Claude Code, Codex and Cursor thread has it (the `omni-ask` MCP server); Hermes and Cursor Cloud threads have no Omni MCP servers, so not there. Claude Code's own AskUserQuestion is turned off in Omni, because nothing can answer it in a headless run.

- The questions show as a card in the thread, where the agent asked, and the thread shows in Needs you until you act, even while it runs. Pick an option (several on a multi select question) or type your own under Other. Skip leaves a question to the agent's judgement.
- The turn waits on the call until you answer, for up to a day on Claude Code and Codex. Your answers go back as the call's result and the turn carries on.
- If the call is gone by the time you answer (Omni restarted, you pressed Stop, or the harness gave up on it), your answers go to the thread as a message and it runs on them.
- Sending a message instead (steer or interrupt) closes the card as not answered, and the agent reads your message. A message queued for after the turn leaves the card open.

## What a thread gets

- **Worktree**: in a repo channel, its own git worktree on branch `omni/<id>`. It is removed once nothing in it can be lost ([Known limits](limits.md)). While it is prepared, the thread shows each step (checkout, the channel's setup action if it has one, then the agent) with the setup's output and a Stop button ([Configuration](configuration.md#channel-actions)).
- **Base**: the commit that branch starts from. The new-thread composer shows the repo's current commit as the default ("From main · a1b2c3d") and lets you pick another branch or tag, or the remote default branch. The remote default is fetched first, and the repo's own checkout and branches never move. The thread keeps the commit it resolved, and the Changes tab compares to it, so a branch that moves later changes nothing. If the fetch fails (offline, no access), the thread stops at "Setup failed" with the reason and your message kept, and Retry tries again. Threads started by a channel, crew role or automation without a choice start from the repo's current commit, as before. Hermes and Cursor Cloud threads have no worktree here, so no base.
- **Browser**: the channel's persistent Chrome (logins survive), shown live in the thread's Browser panel. You can click and type in it too.
- **Web tab** (Mac app only): your own browser, a native web view next to the Browser tab. Each channel keeps its own tabs, which reopen at the next launch; logins are shared by every channel and stay on this Mac. The agent can't see or drive it, so use the Browser tab for anything the agent should do. The web and phone have no Web tab: a web page can't hold a native web view.
- **Terminal tab**: a real shell (PTY) in the thread's working directory.
- **Actions tab**: the channel's named actions (Theme preview, Theme check, Tests) with a Run button each, and the thread's last 20 runs. A run starts only when you press Run or Retry, in the thread's checkout once it is verified (a worktree thread's own worktree on its own branch, never the repo itself). It shows Running, Succeeded, Failed or Stopped, the exit code, and the last 64 KB of its output. Stop ends the whole process group (SIGTERM, then SIGKILL after 5 seconds). Runs left running when Omni stopped show as Stopped. A running action keeps its worktree from cleanup, and starting an action after cleanup restores the thread's branch first. Hermes and Cursor Cloud threads can't run actions: there is no checkout on this Mac. On the phone, open it from the thread's menu ([Configuration](configuration.md#channel-actions)).
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
