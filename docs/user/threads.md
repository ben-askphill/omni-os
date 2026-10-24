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

## Point the agent at lines of a diff

In a thread's Changes panel (desktop, phone and the Mac app), click a line number to pick it and shift-click another in the same hunk to pick the lines between (on a phone, tap a line, then tap another). Write a note and press **Add to message**: the lines and the note go into the reply box as a chip, next to whatever you have typed. Click a chip to see what it holds, x to take it out. A message can be just chips.

The agent gets the lines as you saw them, with the path, the line numbers, the commits they were compared at and your note, and is told when the file has changed since you picked them. Your message in the thread keeps the lines exactly as you sent them. It is feedback for this thread only, not a GitHub review. Hermes and Cursor Cloud threads have no Changes panel; a message with lines in it tells them the file is on your Mac. How it works: [Message context](../internals/message-context.md).

## Point the agent at terminal output

In a thread's Terminal tab (desktop and the Mac app), select output with the mouse as usual. A panel opens over the terminal's foot: write a note and press **Add to message**, and the selected text goes into the reply box as a chip, next to whatever you have typed. Copy and paste work as before, and Esc in the panel clears the selection. On a phone the terminal is read only and can't be dragged over: tap a line, then tap another to take the lines between, then Add to message. A message can be just chips.

The chip is a snapshot of the text, the directory the shell started in, the shell's process id and the time you added it. It stays as it was when the terminal scrolls on, restarts or the shell exits. The agent gets the text as plain text and is told it was not run: escape sequences are dropped when you add it, and output that holds Omni's own block tags can't pass for them. Up to 200 lines and 8,000 characters at once; more is refused rather than cut. How it works: [Message context](../internals/message-context.md).

## Point the agent at part of a web page

In a thread's Browser panel (desktop, the Mac app and the phone's Browser screen), press **Annotate**. Omni screenshots the channel's own browser, the same session the agent drives, and shows that screenshot in place of the live view. Drag over the part of the page you mean, or tap an element to pick it, write a note and press **Add to message**: a chip goes into the reply box, and opening it shows the screenshot with your area outlined, the page's address and title, and when you took it. The page is only read, never clicked, navigated or changed. Esc or Cancel leaves without adding.

If the page navigates, the tab changes, the browser is resized or the page scrolls while the screenshot is taken, Omni says so and offers **Try again**, so the area is never drawn on a different page than the one it describes. The screenshot is kept as a file in the thread, so the chip survives a reload (the web keeps unsent chips in this browser) and shows in the sent message. The agent gets the page's address and title, the viewport, and the area in page pixels, with the screenshot as an image: Claude Code and Codex see it, Cursor reads the file from the path it is given, and an agent on another machine (Hermes, Cursor Cloud) is told the file is on your Mac. A screenshot that has gone missing is stated, not skipped.

**Picking an element.** A tap on the screenshot (rather than a drag) asks the page what element is under that spot, marks its box, and shows its tag, selector, text and a short excerpt of its markup under **Details** before you add it. The agent gets that same excerpt, quoted as data from the page. It is bounded (600 characters of text, 2,000 of markup, four parent tags), never holds what you typed into a field, and leaves a link's query and fragment out. If the page has moved on since the screenshot, the spot is in a frame from another site, or the page cannot be read, Omni says so and the screenshot and any area you drag still go with the message, without the element. How it works: [Message context](../internals/message-context.md).

## Point the agent at another thread

In a reply box, press the **Reference another thread** button (the speech bubble next to the paperclip on desktop and the Mac app, or **Reference a thread** under + on a phone). Search by title or channel and pick a thread: it goes into the reply box as a chip, next to whatever you have typed, and x takes it out. The search lists this channel's threads. **All channels** lists the others, and a thread from another channel is attached only when you pick it there; it is marked "other channel". Two threads with one title are told apart by the start of their id.

The chip holds the thread's title, channel and id as they were when you sent the message, so renaming or archiving it later changes nothing in a sent message. Click it to see them, and **Open thread** to go there. Attaching a thread does not message it, start it or change it, and none of its messages go into yours: the agent is told the thread exists and reads its history only when it needs to, with the `read_referenced_thread` tool, one page at a time (at most 100 messages and 60,000 characters). That tool reads only a thread you attached to a message of that thread, and says so when it is gone. Claude Code, Codex, Cursor and the conductor have it; Hermes and Cursor Cloud threads run elsewhere, so they are told the reference only. A message can be just chips. How it works: [Message context](../internals/message-context.md#thread-references).

## When the agent asks you

An agent can stop and ask you one to four multiple-choice questions with Omni's `ask_user_question` tool. Every Claude Code, Codex and Cursor thread has it (the `omni-ask` MCP server); Hermes threads have no MCP servers, so not there. Claude Code's own AskUserQuestion is turned off in Omni, because nothing can answer it in a headless run.

- The questions show as a card in the thread, where the agent asked, and the thread shows in Needs you until you act, even while it runs. Pick an option (several on a multi select question) or type your own under Other. Skip leaves a question to the agent's judgement.
- The turn waits on the call until you answer, for up to a day on Claude Code and Codex. Your answers go back as the call's result and the turn carries on.
- If the call is gone by the time you answer (Omni restarted, you pressed Stop, or the harness gave up on it), your answers go to the thread as a message and it runs on them.
- Sending a message instead (steer or interrupt) closes the card as not answered, and the agent reads your message. A message queued for after the turn leaves the card open.

## What a thread gets

- **Worktree**: in a repo channel, its own git worktree on branch `omni/<id>`. It is removed once nothing in it can be lost ([Known limits](limits.md)).
- **Browser**: the channel's persistent Chrome (logins survive), shown live in the thread's Browser panel. You can click and type in it too.
- **Terminal tab**: a real shell (PTY) in the thread's working directory.
- **Secrets**: global and channel secrets from the Keychain, as env vars ([Configuration](configuration.md#secrets)).
- **Artifacts**: anything the agent writes to its artifacts dir renders inline in the thread, and on the Artifacts page across channels.
- **Published artifacts**: a page a Claude Code thread publishes to claude.ai with its Artifact tool shows as a card in the thread, linked to its local file. The channel's pages go into later threads' system prompt, so an update lands at the same URL. "Check comments" (or the `artifact-comments` automation) hands a page's comments back to the thread that made it.
- **GitHub panel**: in a repo channel, PRs, checks, diff and merge (with confirm). Threads whose branch has an open or merged PR get a PR icon in the thread list.

How the process behind a thread is launched: [Architecture overview](../internals/overview.md#how-a-thread-runs).

## Send to Grok Bot

The thread header and the right-click menu send the title and the messages. On a phone, Thread options has the same action. The context is the channel id and the thread id. The Conductor tool is `send_to_grok_bot`. Where the webhook URL and Authorization value go: [Configuration](configuration.md#grok-bot).
