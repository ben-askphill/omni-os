# Threads

A thread is one task's conversation with one agent, from the first prompt through every follow-up. Threads are dated, full-text searchable (Search page) and resumable any time. Rename or archive one from its menu or with `/rename`.

A thread's menu is the same list on every surface. On desktop web and in the desktop app, open it with the ⋯ in the thread header or a right-click on the thread. On a phone, open the thread's options. It has at most ten actions in three groups. **Organize** has Pin, Mark as done, Rename, Move to folder and Archive. **Continue** has Fork thread and Reference a thread. **Send to** has Grok Bot, shown only when its webhook URL is set. The menu leaves out any action that does not apply to the thread right now. It has no action for where the thread runs. The Machine chip in the reply box hands a thread off or takes it over (see [Where a thread runs](sync.md#where-a-thread-runs)).

## Finding threads and clearing Needs you

On desktop web and in the desktop app, the sidebar's Running and Pinned sections list work across channels. Running lists queued threads, threads whose sub-agents still run (with those sub-agents nested under them) and threads with a delegated thread still working at any depth. It hides when empty.

A thread shows as running everywhere while a thread it delegated (a team lead and its members included) or a sub-agent it started (an Agent call, workflow, fork or teammate) still works, even after its own turn ended. That covers its sidebar row, the Inbox's Working shelf, thread lists, its channel's running count and the thread's status pill. Every thread above it shows as running too. It goes back to done or idle when the last one finishes and Omni has handled its report. Background shells and monitors do not count, and neither do sub-agents left running by a stopped or failed turn. A delegated thread counts only while its own status is running or queued. A child that died stops counting once Omni marks it failed or stopped, which happens at its exit, on Stop or when Omni restarts. On your other machines, a thread that runs elsewhere shows as running from the sub-agent updates sync brings. A sub-agent there that sends nothing for 15 minutes stops counting, so a machine that went offline mid-run does not keep the thread busy everywhere.

While Running is open, a thread in it has no second row under its channel or folder, so clicking it highlights one row. Fold Running and its threads show under their channels again. A pinned thread still shows under its channel too. For the latest threads by activity, use the Inbox view (or the Inbox disc when [Channel rail](configuration.md) is on) or Cmd-K.

A Conductor thread has one row in the sidebar, under Conductor or, while it works, in Running. The row has the delegate icon and, on the right, a count of every thread it delegated. The count turns blue while one of them works, shows the needs-you diamond while one needs you or failed, and goes grey once all are done and seen. Hover it for "N delegated threads, M active". Delegated threads get no sidebar row of their own, not even under their channel, though the channel's running count still includes them. Click the count to open the parent on its Details tab at the agents card that lists them. The Conductor's channel page still nests them under their parent, with expand and collapse.

Each section folds on its own and remembers its state on that device. On desktop web and in the desktop app, the Conductor section starts folded, because its folders hold every job. Clicking it opens its page without unfolding it. Click it again on its page to unfold it.

The sidebar's Inbox view, toggled against Projects, lists pinned threads first, then four shelves in a fixed order, each with its count: Needs you (a question, a failure or a usage limit), Finished (turns that ended, bold while unread), Working and Done. Needs you and Finished show the latest back on top and never fold. Working and Done fold and remember their state on that device. The phone's Activity tab still shows Needs you and Finished as one list. Under its title a card names the machine the thread runs on now, or last ran on, and while it runs, how long the current turn has gone ("MacBook Air · 12m", counted from your last message, the same as the thinking line). On desktop web and in the desktop app, hover the line for the machines it ran on before a handoff or Take over, and its branch. A thread from before sync, or on a single machine without sync, shows its branch there instead. Channel thread lists and the native iOS Activity list still show the branch on that line. A card's status matches what Home says about the thread. It reads Working while sub-agents still run after a turn that ended done, and Stopped for a thread you stopped, even while a background task from its turn still runs. The check on a card marks it done, and the undo on a Done row puts it back. In the channel rail the same shelves fill the list panel from the Inbox disc (and from Go > Inbox in the desktop app), and the page beside it shows what needs you and your unread results at full size until you open a thread. Overview's Working count is the Inbox's own, so the two never disagree.

On a phone, Activity shows the same list as the Inbox view, and a channel splits its folder and ungrouped threads between Active and Recent. Conductor threads there carry the same delegate count instead of nested rows, and tapping it opens the thread's Details.

**New thread** in the sidebar opens a composer in the channel you are in. In the desktop app, File > New Thread and Cmd-N (Ctrl-N off the Mac) do the same. From inside a thread, it uses that thread's channel. On a phone, a New thread chip above the reply box does the same.

Overview (`#/`, the Omni mark on the rail), on desktop web and in the desktop app, is a dashboard for Today, 7 days or 30 days, and that device remembers the range. Under the New thread composer, the Start in chips offer the four channels with the most threads started in the range. Four tiles count Needs you (by what holds each thread up), Working (the Inbox's Working shelf, with the busiest harness's slots), Unread and Done (marked done in the range). Each opens its list in place, at `#/?list=needs`, `running`, `unread` or `done`.

Once another machine syncs with this one, a Machines row under the tiles has a tile per machine, this one first. A tile shows the machine's running threads (and queued, delegated and Needs you), each busy harness against its slots, and, for this machine only, in-process sub-agents, since only this machine sees its own processes. Under those are a CPU bar and a RAM bar with their numbers. The CPU bar's tooltip has the load average and core count.

- CPU is the busy share of all cores over the last 5 seconds, from the change in `os.cpus()` times.
- RAM is memory in use against the total, as the OS counts it. On macOS it is app memory, wired and compressed from `vm_stat`, matching Activity Monitor's Memory Used. Node's free memory there counts only free pages, so a full file cache would look like a full Mac. On Linux it is MemTotal less MemAvailable from `/proc/meminfo`, matching `free`. Other platforms get no RAM bar.
- A stat a machine cannot measure is left out, never shown as zero.

A machine samples only while someone watches. It samples every 5 seconds while a client on it shows the tiles, or while another machine that shows them has asked through sync in the last 90 seconds (kv `machine-watch.<id>`, renewed every 45 seconds). Omni ignores a watch stamped over five minutes ago, such as one a machine catches up on after sleeping. While sampling, the machine sends its sample every 15 seconds (kv `machine-stats.<id>`, which keeps the time it was taken).

Another machine's sample shows grey with its age ("Sampled 4m ago") when it is over a minute old, when Tailscale reports that machine offline, or while sync here is not live. A machine on an older build says it has sent no stats yet. The thread numbers come from the thread rows sync carries and refresh with the feed, and the bars move with the feed's samples. A machine Tailscale reports offline shows a dash, when it was last seen and what it last reported. While sync here is paused or failing, the other machines' tiles say how old their numbers are. A tile opens the Working list narrowed to that machine (`#/?list=running&machine=<id>`). The phone's Activity screen shows the same tiles in a strip you scroll sideways. The Conductor reads them with its `machines` tool, stats included with each sample's age, after waiting a few seconds for fresh ones.

Usage sums tokens and cost from the Claude Code and Codex session logs on this machine (`~/.claude/projects`, `~/.codex/sessions`). It counts all sessions, not only Omni's, and adds Cursor's billed usage where Omni can read its dashboard, the way T3 Code's usage view does. Cost is LiteLLM's list price per model, or what the provider billed. Cache hit, tokens per session and cache savings are computed from the totals shown. The first read of the logs runs in the background and the section fills in as it goes. After that, Omni reads only what changed.

Below Usage come Needs you, Busiest channels, Pull requests (open, yours, with CI checks, merged from a thread's branch in the range) and the automations still to run today. When you come back to Overview, it shows the numbers it last read at once and asks the server again only when they are over five minutes old. The header says when they were read, and Refresh reads them now. A refresh that fails keeps the numbers on screen and says why. The Conductor reads the dashboard's other numbers with its `insights` tool. On a phone, Overview stays Activity.

Needs you holds unread results and threads waiting for you to act. Opening a thread reads the result it shows, so a newer result stays unread. **Mark as done** clears any of those reasons without archiving the thread or changing how its last turn ended. The thread stays in its channel and folder with a grey check, a muted title and a Done chip. **Mark as not done** brings back its unread result and blockers. A new message, a run starting or Retry setup clears done. The server keeps the flag and syncs it between Macs, so desktop web, the desktop app and the phone show the same threads as done. You cannot mark a running or queued thread done.

On desktop web and in the desktop app, use the check on a Needs you row or an Inbox card, the check in the thread header, or the thread's menu. The thread header keeps only the context meter, Mark as done, the status, the thread menu (⋯) and the quick-card and panel toggle. Pin, Reference and Send to Grok Bot are in the menu. Hand off and Take over are on the reply box's Machine chip. On a phone, use the check on an Activity row or Thread options. The Conductor can use `mark_thread_done` when you ask it to.

## The composer

- A new thread follows the channel and crew defaults until you pick a model or effort for that draft. When no default is set, Auto picks from the first prompt. The Conductor role's charter is Auto, and a saved #conductor channel default still wins. See [Harnesses](harnesses.md#auto).
- `/` opens the menu of skills, slash commands and MCP prompts for the thread's harness. In a thread's reply box, `/model`, `/effort` and `/fast` open the model pill, and what you pick applies from the next turn.
- `@` mentions artifacts and repo files.
- After a finished turn, Haiku suggests your likely next reply. Tab fills it in, and `OMNI_SUGGESTIONS=0` in `.env` turns it off. That call, and the ones that title a new thread or propose a follow-up, run in a private folder under Omni's data dir, not the shared temp dir.
- An **Open PR** control appears in the composer next to the machine and model pills when three things hold: the agent's last reply asks whether to open a PR (open, create, raise, file or submit a PR or pull request), the thread is idle and its branch has no PR yet. On phone web and in the iOS app, it is a chip next to the machine chip. It sends the same open-PR prompt as the panel's Open PR button, reads **Opening PR** while that turn runs, and goes away once a PR exists or you reply.

## Sending while a thread is busy

| Mode | What happens |
| --- | --- |
| Steer (default, Enter) | Omni writes it to the CLI now. The agent reads it at its next step (after the running tool) and keeps going |
| Queue for after this turn | Omni holds it and runs it as a new turn once the current one ends |
| Interrupt and send (Cmd/Ctrl+Shift+Enter) | Stops the current step, then runs the message |

Cmd/Ctrl+Enter adds a newline. Pending messages show under the live output and enter the transcript at the point the agent read them. A queued message has **Steer now**, which sends it into the running turn instead of waiting for the turn to end. Cursor Agent and Cursor Cloud cannot steer, so they lack it. While a turn runs and the reply box is empty, the send button turns into **Stop**. Stop (or Esc) stops the turn but keeps the process and its context. Steers already sent still run, and Omni records queued ones as "Not sent". Omni kills a CLI that does not stop within `OMNI_INTERRUPT_GRACE_MS`. Only turns in progress count toward `OMNI_MAX_CONCURRENT`; warm idle processes do not.

On Cursor Agent and Cursor Cloud, messages sent during a turn wait for the next turn. A model, effort or harness switch picked during a turn also makes messages wait for that switch, even on a harness that can steer. See [Switching mid-thread](harnesses.md#switching-mid-thread).

- To start a separate linked thread with its own session and checkout, use [Fork thread](harnesses.md#continuing-on-another-harness): the branch icon in the reply box, under + on a phone, or the thread's menu.
- To attach another thread without forking, use [Reference another thread](#point-the-agent-at-another-thread) in the header.
- To move a running or idle thread to another machine, or bring one your other Mac holds here, use the [Machine chip](sync.md#where-a-thread-runs) in the reply box.

To attach files to a message, use the paperclip, drag and drop, or paste. Omni saves them in `data/threads/<id>/uploads/` under their original names and gives the agent each one's absolute path. Images small enough for the API also go in as image blocks. `OMNI_MAX_UPLOAD_MB` caps a single file.

To continue a thread in a terminal or Claude Desktop, run `cd <cwd> && claude --resume <session id>`. The thread's Details panel has a copy button for it. Check there first that the session is no longer warm, so two processes do not write the same session.

## The thread panel

On desktop web and in the desktop app, a thread opens with a compact **quick-actions card** beside the transcript, not the full inspector. The card shows the machine (with a copy-path button), working directory, harness and model, run state (live or cold session), and branch and PR status. Cursor Cloud threads get Open in Cursor instead of the path. A thread with no branch shows one muted "No branch" row.

**Lineage** lists the parent when this thread was delegated, then what runs under it: delegated threads and the thread's own sub-agents, with how long each has run. A top-level thread with nothing running shows no Lineage. Each row opens the inspector on its tab, and **All details** opens it on Details. The inspector replaces the card and never sits beside it. The header's panel button switches between the card and no panel, and with the inspector open it goes back to the card. The device remembers that choice. An artifact link or a new HTML artifact still opens the inspector.

On a phone, the same card is a popover from the header's panel button. The phone does not remember it, because it would cover most of a 390px screen. Tapping outside closes it, and rows open the matching thread screen.

The inspector's tabs are Details, PRs, Artifacts, Changes, Browser, Terminal and Actions, and the desktop app adds Web. Actions and the diff are only in the inspector, not on the quick card.

**Details** starts with the branch card for a thread on its own branch. It shows the branch, its PR with what decides whether it can merge (checks, conflicts, review), the files changed, and one button for the step the PR needs next:

- **Open PR** while there is none.
- **Fix conflicts** or **Fix checks**, each of which asks the agent and queues mid-turn. After the prompt, Fix checks also sends up to five failing checks with their links and log tails, or the prompt alone when gh cannot read them.
- **Merge**, which squash-merges in place and deletes the branch, with the same settings as the phone's merge slider. The PR page still has the full merge card for other merge methods, with an **Auto-merge** row under it ([Auto-merge](#auto-merge)).

Each channel sets what Open PR, Fix conflicts and Fix checks ask the agent, under **Branch steps** in its settings (desktop web, phone web and the iOS app). For example, "use the pr-writer skill and the repo template". An empty field sends the built-in prompt, which it shows greyed out. The prompts sync to your other machine with the rest of the channel.

From the click until the turn ends, while that step's prompt is queued or its turn runs, these show **Opening PR** (or the matching label for Fix conflicts and Fix checks) with a spinner: the PRs tab, the Details branch card, the phone web PR view, and the iOS PR screen and its composer chip. A step whose message was parked (`recovered` or `uncertain`) stops spinning. The button says why it did not start, and the next press resumes that parked message. On a thread another machine holds, a forwarded Open PR, Fix conflicts or Fix checks stays in the pending rows until that machine takes it, on desktop web, phone web, the desktop app and the iOS app ([Sync](sync.md#run-a-thread-on-another-machine)). The PR and changes rows open their tabs.

A thread that delegated work, such as a Conductor thread, gets a second card with the open PRs its delegated threads opened, each with **Merge #N**. It gets this card even with no branch of its own, and after a merge the card shows the PR as merged. Under the cards, the agents card shows the thread's lineage (the thread that delegated it, and the thread it continued from or in), what runs now, and its finished delegated threads under **Previous agents**. MCP servers take one line, with their names behind its arrow.

**PRs** lists every PR from the branch with its checks, conflicts and review state, the next step, **Open a new PR** when none is open, and [Watch PR](#watch-pr). A thread that delegated work, such as a Conductor thread, also gets **From delegated threads**, which lists the open and merged PRs opened by the threads under it, teams included, oldest delegation first. Each row shows the PR, the task and thread it came from, and its state. Clicking a row opens the PR, and the message icon beside it opens the thread. The tab shows this list for a thread with no branch too.

On a phone (phone web and the iOS app), Thread options lists Details first and the PR screen second. A thread with delegated PRs gets that PR entry without a branch. Without a PR of its own, its PR screen shows the first open delegated PR with the merge slide and a row that opens the delegated thread. Tap a delegated PR in the list below to show that one instead.

A PR page opened from the PRs tab has buttons back to the thread that opened the PR and, for delegated work, to the thread that delegated it. **Ask builder to review** (and Fix conflicts when it asks for a review) opens that work under the nearest Conductor ancestor of the thread that owns the PR's branch, or under that builder when there is no Conductor. That keeps the review and its report with the original job. A PR with no clear Omni origin, or a fork PR, gets a new standalone builder instead.

**Rerun failed checks** shows on an open PR's page (desktop), the phone web PR view and the iOS PR screen while a failing check is a GitHub Actions job. It runs `gh run rerun --failed` for each failing workflow run, with no agent turn, and says in place how many runs started again or why none did. Omni leaves alone a failing check from outside GitHub Actions, such as a commit status or another app. The Conductor does the same with `rerun_failed_checks`.

## Running subagents

The Details tab's agents card lists them under **Running**. That is every agent the thread started itself that is still working, such as an Agent call, a workflow, a fork or a teammate, with its kind and how long it has run. Click one to scroll the transcript to the call that started it, however far back. While another tab is open, the Details tab shows how many run. On a phone, the list is at the bottom of the thread's options sheet and in its Details screen. Background shells and monitors are not listed. Delegated threads that still run are listed under Running too, and finished ones under Previous agents. Their own agents show in their own thread.

Claude Code reports its agents itself. Omni maps Codex (multi-agent spawns), Cursor Agent (its task tool) and Hermes (`subagent.*` events) onto the same list. Cursor Cloud reports no sub-agents.

## Goals

On Claude Code, `/goal <condition>` keeps the thread working until the condition holds. A line under the transcript shows the goal: **Pursuing goal** while a turn works on it, **Goal set** while it waits, and **Goal complete** once a turn ends with it met. It also counts how often Claude's check found the condition unmet. **Clear** sends `/goal clear`. A `/goal` message never steers into a running turn: it queues, and a new goal or a clear while one is active stops the turn first. A met goal leaves the line when your next message reaches the session, and any goal goes away when the thread starts a new session. While the thread works toward a goal, its status reads **Goal**, not Running. Claude Code has no pause or resume for goals. The goal stays on the machine that runs the thread and does not sync. Desktop web, phone web and the desktop app show the line; the iOS app does not. Codex, Cursor Agent, Cursor Cloud and Hermes get no goal line.

## Plan steps

When the agent posts a plan, click a step's checkbox to cycle it through pending, in progress and completed. Omni saves the change as a `plan_step_update` event, so it survives reloads. This works on desktop web, phone web and the desktop app.

## Point the agent at lines of a diff

In a thread's Changes panel (desktop web, phone and the desktop app), click a line number to pick it, and shift-click another in the same hunk to pick the lines between. On a phone, tap a line, then tap another. Write a note and press **Add to message**. The lines and the note go into the reply box as a chip, next to whatever you have typed. Click a chip to see what it holds, or x to take it out. A message can be just chips.

The agent gets the lines as you saw them, with the path, the line numbers, the commits they were compared at and your note. Omni tells it when the file has changed since you picked them. Your message in the thread keeps the lines exactly as you sent them. It is feedback for this thread only, not a GitHub review. Hermes and Cursor Cloud threads have no Changes panel, and a message with lines in it tells them the file is on your Mac. How it works: [Message context](../internals/message-context.md).

### Review notes

**Pin note**, next to Add to message, keeps the note on the lines instead of sending it (desktop web, phone web, the desktop app and the iOS app). The note stays in the diff under its lines, survives a reload and syncs to your other Mac. Edit it with the pencil, resolve it with the check, or delete it with the bin. Resolved notes fold into **Resolved** above the diff, kept as history.

When the diff changes, a note follows its lines. Omni looks for the same text nearest where you pinned it, and marks the note **Moved** when it finds the text somewhere else. When the lines are gone, the note is listed above the diff as **Outdated**, with the lines you pinned it to. **This turn** shows only the notes on lines that turn changed and counts the rest.

**Send open notes** sends every note that is neither resolved nor sent yet as one message to the thread, each with its lines, and marks them **Sent**. Editing a sent note opens it again, so the new words go with the next send. One send carries up to 40 notes.

**Send to**, under the button, picks where that message goes:

- This thread, the default.
- One of the threads it delegated to.
- **New delegate**, which starts a thread under this one in the same channel, with the same harness and model and the notes as its first message. A new delegate runs on this Mac and, in a worktree channel, branches from this thread's branch (committed work only). Its report comes back to this thread like any delegate's.

Either way the notes stay on this thread, marked **Sent**. The picker is the same on the desktop, the phone and the iOS Changes screen. The Conductor reads a thread's open notes with `list_review_notes`.

## Point the agent at terminal output

In a thread's Terminal tab (desktop web and the desktop app), select output with the mouse as usual. A panel opens at the bottom of the terminal. Write a note and press **Add to message**, and the selected text goes into the reply box as a chip, next to whatever you have typed. Copy and paste work as before, and Esc in the panel clears the selection. On a phone the terminal is read only and you can't drag over it. Tap a line, then tap another to take the lines between, then press Add to message. A message can be just chips.

The chip is a snapshot of the text, the directory the shell started in, the shell's process id and the time you added it. It does not change when the terminal scrolls on, restarts or the shell exits. The agent gets the text as plain text and is told it was not run. Omni drops escape sequences when you add it, and output that holds Omni's own block tags can't pass for them. A chip takes up to 200 lines and 8,000 characters. Omni refuses more rather than cutting it. How it works: [Message context](../internals/message-context.md).

## Point the agent at part of a web page

In a thread's Browser panel (desktop web, the desktop app and the phone's Browser screen), or in the desktop app's Web tab, press **Annotate**. It stays on until you press it again, Done or Esc, and the page stays live under it:

- **Hover** over the page (desktop web and the desktop app) to see what is under the pointer. Omni outlines the element, and a tooltip shows its tag, id and classes, its size, its path in the page (`body › main#cart › button#go`) and a few computed styles (color, background, font, display, padding, margin, z-index). The page still gets the pointer, so hover menus open as usual. Scrolling and typing go to the page too.
- **Click** an element to pick it, or **drag** over an area. On a phone, tap or drag. Omni takes a screenshot at once, so what you send is the page as you saw it, and the outline follows the page when it scrolls.
- **Hold ⌥ Option** to click the page itself while Annotate is on, for example to open a menu before you pick an item in it.

A card at the bottom shows the screenshot of what you picked, the element's details and a note field.

- **Send** sends it to the thread at once, with your note as the message and the annotation attached.
- **Add to message** puts it in the reply box as a chip instead, with the note on the chip, so you can add more before sending.
- **Draw** opens the screenshot in the markup toolbar (select, pen, shapes, text, color, line width, undo and delete) with your pick already marked. Add to message there adds the marked-up screenshot.
- x clears the pick. Esc clears it, then turns Annotate off.

A pick never clicks, navigates or changes the page. The desktop app's Web tab is your own browser, and Annotate works the same way on it. The agent gets the same annotation, though it still can't see or drive that browser.

If the page navigates, the tab changes, the browser is resized or the page scrolls while Omni takes the screenshot, Omni says so and offers **Try again**. That way the area is never drawn on a different page than the one it describes. Omni keeps the screenshot as a file in the thread, so the chip survives a reload (the web keeps unsent chips in this browser) and shows in the sent message. The agent gets the page's address and title, the viewport, and the area in page pixels, with the screenshot as an image. Claude Code and Codex see the image. Cursor reads the file from the path it is given. An agent on another machine (Hermes, Cursor Cloud) is told the file is on your Mac. If the screenshot has gone missing, the message says so instead of skipping it.

**Picking an element.** A click or tap, as opposed to a drag, asks the page what element is under that spot. Omni marks its box and, under **Details**, shows its tag, selector, text, a short excerpt of its markup and its computed styles before you send it. The agent gets that same excerpt, quoted as data from the page. The excerpt is capped at 600 characters of text, 2,000 of markup and four parent tags. It never holds what you typed into a field, and it leaves out a link's query and fragment. Omni says so when the page has moved on since the screenshot, the spot is in a frame from another site, or the page cannot be read. The screenshot and any area you drag still go with the message, without the element. How it works: [Message context](../internals/message-context.md).

## Point the agent at another thread

In the thread's header, press the **Reference another thread** button (the speech bubble next to the context meter on desktop web and in the desktop app). On every surface, **Reference a thread** in the thread's menu does the same. Archived threads hide the button. Search by title or channel and pick a thread. It goes into the reply box as a chip, next to whatever you have typed, and x takes it out. The search lists this channel's threads. **All channels** lists the others, and Omni attaches a thread from another channel only when you pick it there, marked "other channel". When two threads share a title, the start of their id tells them apart.

The chip holds the thread's title, channel and id as they were when you sent the message, so renaming or archiving it later changes nothing in a sent message. Click the chip to see them, and **Open thread** to go there. Attaching a thread does not message it, start it or change it, and none of its messages go into yours. The agent is told the thread exists and reads its history only when it needs to, with the `read_referenced_thread` tool, one page at a time (at most 100 messages and 60,000 characters). The tool reads only a thread you attached to a message in the calling thread, and says so when that thread is gone. Claude Code, Codex, Cursor and the Conductor have it. Hermes and Cursor Cloud threads run elsewhere, so they get only the reference. A message can be just chips. How it works: [Message context](../internals/message-context.md#thread-references).

## Reading a long thread

A thread opens on its newest messages. Scroll up to load earlier pages. A search hit opens the page with that message. If two loaded pages have a gap, use Show earlier or Show later to fill it. A large message or tool input may say **Trimmed for loading**, and Show all loads that row whole.

A message that starts a turn shows in the transcript as soon as you send it, above the thinking line. That covers the first message on a new thread, a reply sent while the thread is idle, and a queued message released after the turn it waited for. It shows even while the harness is still starting (hooks, MCP servers) or Omni is handing the turn to another machine.

While a turn runs, a thinking line stays up for the whole turn, tool calls included. It has the Omni mark, the label ("Thinking" or the agent's status) with a vermilion shimmer, and the time since your last message. It shows on desktop web, phone web, the desktop app and the iOS app. Reduce Motion stops the mark and the shimmer. A delegated thread's brief (its first message) folds to the first 6 lines, with Show more, when it is longer than 8 lines. Other long messages on desktop keep the character cut with Show all.

Replies render as Markdown on desktop web, phone web and the desktop app. A `mermaid` code fence draws as a diagram in light and dark. A fence that fails to parse keeps its source visible. Wide diagrams scroll sideways on a phone.

Open a tool row to read its output. Long output starts with a preview, then loads in chunks with Load more. A running Codex command can show its live tail. The other harnesses show output when the call ends. If the harness cut the output before saving it, loading more cannot recover it. The budgets and client rules are in [Thread history](../internals/thread-history.md).

## When the agent asks you

An agent can stop and ask you one to four multiple-choice questions with Omni's `ask_user_question` tool. Every Claude Code, Codex and Cursor thread has it through the `omni-ask` MCP server. Hermes and Cursor Cloud threads have no Omni MCP servers, so they don't. Omni turns off Claude Code's own AskUserQuestion, because nothing can answer it in a headless run.

- The questions show as a card in the thread, where the agent asked, and the thread shows in Needs you until you act, even while it runs. Pick an option (several on a multi-select question) or type your own under Other. Skip leaves a question to the agent's judgement.
- A card from a delegated thread (from `delegate` or `delegate_team`, at any depth) also shows at the end of every thread above it, under the asking thread's task id and title, which link to it. Needs you shows the top one, the thread you delegated from, and brings it back if you had marked it done. Answer on either card, on desktop web, the phone layout, the desktop app or the iOS app. The first answer wins and closes both. The asking thread keeps its card and the answer. The phone alert opens the thread you delegated from and names the thread that asked. A thread you continued (Continue on another harness) also shows the cards of the crew its earlier thread delegated. The Conductor sees what its crew waits on with `crew_questions`.
- The turn waits on the call until you answer, for up to a day on Claude Code and Codex. Your answers go back as the call's result and the turn continues.
- If the call is gone by the time you answer (Omni restarted, you pressed Stop, or the harness gave up on it), your answers go to the thread as a message and it runs on them.
- A thread that runs on another machine takes the answer the same way, including one the Conductor delegated there. While a turn runs there, the answer syncs to that machine and its waiting call returns. Between turns, Omni forwards the answer there as a message. Answer on the hub, on the thread's card or the parent's. You do not need to open the other machine. If the other machine refuses the answer for a reason other than "already answered", the card shows that reason instead of spinning.
- Sending a message instead (steer or interrupt) closes the card as not answered, and the agent reads your message. A message queued for after the turn leaves the card open.

## What a thread gets

- **Worktree**: in a repo channel, its own git worktree on branch `omni/<id>`. If the agent checks out a branch of its own there (`git checkout -b feat/x`), the thread takes that branch as its own when the turn ends, so the PRs tab, PR marks and the PR watch find the PR opened from it. The thread does not take a detached HEAD or the default branch. The next message stops at Setup failed, and Retry switches a clean worktree back. Omni removes the worktree once nothing in it can be lost ([Known limits](limits.md)). While Omni prepares it, the thread shows each step (checkout, the channel's setup action if it has one, then the agent) with the setup's output and a Stop button ([Configuration](configuration.md#channel-actions)). When the channel's repo is not on this machine, the first step clones the channel's GitHub repo with this machine's `gh` (or `git`) login. It clones to the channel's path when Omni can create it here, and otherwise to `~/<repo name>`, or under the Repos folder in Settings > Workspace if you have set one there (its `~/code` default is not used). This machine's path map then records where the repo went. Threads that start together wait for one clone. Stop ends the wait at once, and the clone finishes in the background for Retry. A clone that fails, a folder in the way that is not the repo, or a path whose drive is not connected stops at Setup failed with the reason. Omni never clones into a folder that has files in it.
- **Base**: the commit that branch starts from. The new-thread composer shows the repo's current commit as the default ("From main · a1b2c3d") and lets you pick another branch or tag, or the remote default branch. Omni fetches the remote default first, and the repo's own checkout and branches never move. The thread keeps the commit it resolved, and the Changes tab compares against it, so a branch that moves later changes nothing. If the fetch fails (offline, no access), the thread stops at "Setup failed" with the reason and keeps your message, and Retry tries again. Threads started by a channel, crew role or automation without a choice start from the repo's current commit, as before. Hermes and Cursor Cloud threads have no worktree here, so they have no base.
- **Browser**: the channel's persistent Chrome, where logins survive, shown live in the thread's Browser panel. You can click and type in it too.
- **Web tab** (desktop app only): your own browser, a web view in the app next to the Browser tab. Each channel keeps its own page, which reopens at the next launch. Logins are shared by every channel and stay on this machine. The agent can't see or drive it, so use the Browser tab for anything the agent should do. A browser and the phone have no Web tab, because a web page can't hold a web view of its own.
- **Terminal tab**: a real shell (PTY) in the thread's working directory.
- **Actions tab**: the channel's named actions (Theme preview, Theme check, Tests), each with a Run button, and the thread's last 20 runs. A run starts only when you press Run or Retry. It runs in the thread's checkout once Omni has verified it: a worktree thread's own worktree on its own branch, never the repo itself. A run shows Running, Succeeded, Failed or Stopped, the exit code, and the last 64 KB of its output. Stop ends the whole process group (SIGTERM, then SIGKILL after 5 seconds). Runs left running when Omni stopped show as Stopped. A running action keeps its worktree from cleanup, and starting an action after cleanup restores the thread's branch first. Hermes and Cursor Cloud threads can't run actions, because they have no checkout on this Mac. On the phone, open it from the thread's menu ([Configuration](configuration.md#channel-actions)).
- **Secrets**: global and channel secrets from the secret store, as env vars ([Configuration](configuration.md#secrets)).
- **Artifacts**: anything the agent writes to its artifacts dir renders inline in the thread and on the Artifacts page across channels. That page's claude.ai switch lists your Artifacts on claude.ai ([claude.ai Artifacts](claude-artifacts.md)). Local threads also get an `html_render` tool (`omni-render` MCP) that shows a chart, diagram or mockup in the transcript above the reply. The render is sandboxed, sized to fit and drawn in Omni's theme. Hermes has no local MCP servers, so it cannot use it. When you ask an agent to "show me", "list out" or "visualize" something, its system prompt tells it to answer with `html_render` (cards, a table or a chart) rather than a wall of text. Omni saves the page under `artifacts/renders/`, and it stays in the Library like any file. A thread that delegated work, such as a Conductor thread, also lists the files and browser screenshots of every thread under it, teams and deeper delegations included, newest first under **From delegated threads**. On desktop they are in the panel's Artifacts tab and the Browser tab's screenshots. On a phone they are in the Details screen. Each one names the thread that made it and links to it, and a new one shows up while the parent is open. A page the parent lists itself shows once, as its own.
- **Published artifacts**: a page a Claude Code thread publishes to claude.ai with its Artifact tool shows as a card in the thread, linked to its local file. The channel's pages go into later threads' system prompt, so an update lands at the same URL. "Check comments" (or the `artifact-comments` automation) hands a page's comments back to the thread that made it.
- **Pull requests**: in a repo channel and each thread's PRs tab, checks, diff and merge. Merge works in place from the panel's Merge button, and the phone PR screen keeps its merge slide. The Pull requests page (`#/prs`, and the phone's PRs tab) lists every channel's PRs with search, sort and filters, grouped into Authored, Review requested and Others. Threads whose branch has an open or merged PR get a PR icon in the thread list.

How Omni launches the process behind a thread: [Architecture overview](../internals/overview.md#how-a-thread-runs).

## Watch PR

A thread with an open PR can watch its checks and its reviews. Start it with **Watch PR** in the thread panel's PRs tab (on the phone, the PR screen) or the Conductor's `watch_pr` tool. Omni polls GitHub itself, so no client needs to be open, and a poll with no changes costs no agent turn.

- A check that fails on the PR head wakes the thread once, with the head commit, the failing checks and the tail of each GitHub Actions log. If the same check fails again on the same head after a re-run, it does not wake the thread again. A failure on a new head does.
- New review feedback from someone else wakes it too: a review with a comment or a change request, an inline comment, or a conversation comment. One wake carries everything new since the last poll, with each author, a link, the head the comment was written on and an excerpt. The first eight come with their text and the rest by link. Only feedback written after the watch started counts.
- Your own comments (from the account `gh` is signed in as) never wake it, so the agent replying on the PR cannot start a loop. Omni ignores comments from people with no history in the repo; bots count. A person editing a comment to new words wakes it once more. A bot editing its own comment does not, and neither does an edit back to words it already woke for.
- Omni quotes comment text to the agent as input to weigh, not as instructions from you.
- Omni saves the wake before it sends it, like any queued message. A wake saved before a restart waits in the thread for Resume. A thread this Mac cannot run (it runs on your other Mac, or its worktree is not ready) also gets the wake held for Resume.
- Polls come every minute while checks run and slow to every 15 minutes while nothing changes. GitHub errors back off, and five in a row stop the watch. A rate limit pauses every watch for 15 minutes without counting as an error.
- A watch ends when you stop it, the PR merges or closes, or the thread is archived. It also ends after it has woken the thread five times, or three times for review comments alone with no failing check in the wake. The PRs tab says which. Watch PR starts it again with fresh budgets. Starting a watch that is already running changes nothing.
- Watches live on the Mac that started them and do not sync.

## Auto-merge

An open PR can merge by itself once its required checks and reviews pass (`gh pr merge --auto`), so you can turn it on from the phone and walk away. The **Auto-merge** row shows whether it is on, with which method and who turned it on, and turns it on or off. It is on the desktop PR page under the merge card, where it uses the merge method picked there. It is also on the phone web PR screen and in the iOS app, where a tap shows the same confirm slide as a merge.

- Only a paired device can turn it on. The server refuses a request from the install token, which agents hold, so the Conductor's `set_auto_merge` tool can only read it or turn it off.
- It uses the repo's merge method: the one asked for when the repo allows it, otherwise the first of squash, merge and rebase that the repo allows.
- A repo with auto-merge turned off in its GitHub settings refuses, and gh's message shows in place.
- A PR that can already merge may merge at once.
- The state lives on GitHub, so every Mac and client sees the same.

## Send to Grok Bot

Send to Grok Bot in the thread's menu (the header's ⋯ or a right-click) sends the title and the messages. On a phone, Thread options has the same action. Omni sends the channel id and the thread id as context. The Conductor tool is `send_to_grok_bot`. The action shows only on a server with a Grok Bot webhook URL. For where the webhook URL and Authorization value go, see [Configuration](configuration.md#grok-bot).

To send a new message straight to Grok Bot, without a thread running here first, pick **Grok Bot** in the new-thread composer's Machine chip ("To Grok Bot"). This works on desktop web, the phone and the desktop app. Send posts your text to the same webhook, with the channel id as context. No thread starts in Omni, and Grok Bot's reply comes back in Grok Bot.

- On success the composer empties and says Sent to Grok Bot.
- If the webhook refuses the message, the composer keeps your text and shows Grok Bot's error: a missing secret, the HTTP status, or why it could not be reached.
- The model, base and role pickers hide while Grok Bot is picked.
- Grok Bot takes text only, so the composer won't send while a file is attached and asks you to remove it.
- Grok Bot is never a default, so Settings > Run new threads on doesn't list it.
- On a server without the webhook URL, the row is listed but disabled when other machines show the chip. On a single machine the chip stays hidden.
