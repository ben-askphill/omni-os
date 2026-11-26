# Omni OS

A local workspace where the user hands work to agents: channels hold threads, agents lead threads and join them as members, and every local agent runs on the user's own subscriptions through an official CLI.

## Language

### Work

**Channel**:
A client, project or area that groups threads and holds the facts they share, such as a repo, a store or a browser profile.
_Avoid_: Project, workspace, space

**Folder**:
A named group of threads inside one channel.
_Avoid_: Project, workstream, group

**Thread**:
One task's conversation between the user and the agents in it, its lead and any members, from the first prompt through every follow-up, kept and searchable in Omni.
_Avoid_: Chat, group chat, room, session, conversation, run

**Turn**:
One go of one agent in a thread, from a message to its final reply. A thread's agents can each have a turn running at once.
_Avoid_: Run, step

**Task**:
A thread with full tools and a place of its own to work, as opposed to a quick ask.
_Avoid_: Job, ticket

**Quick ask**:
A question an agent answers in place with read-only tools, kept out of the thread lists until the user keeps it or makes it a task. Members the user seats there get the same read-only tools.
_Avoid_: Chat, quick thread, Ask (the older question to another agent)

**Job**:
A Conductor thread together with every thread it delegated, shown as one tree.
_Avoid_: Project, epic, request

**Owner**:
The person a thread's work is for: the user, unless someone else is named.
_Avoid_: Assignee, holder (the machine that runs a thread), lead (the agent a thread started as)

**Workspace folder**:
The user's own folder, which a thread works in when its channel has no folder of its own.
_Avoid_: Home, project folder

**Worktree**:
A thread's own git checkout of its channel's repo, on a branch of its own, so threads in one repo never share files. Every agent in the thread works in the same one.
_Avoid_: Checkout, clone, sandbox

**Base**:
The commit a thread's worktree branch starts from.
_Avoid_: Parent commit, starting branch

**Setup**:
Preparing a thread's worktree at its base and running its channel's setup action, before the agent starts or alongside it.
_Avoid_: Provisioning, bootstrap

**Channel action**:
A named command a channel offers, run in a thread's checkout with the secrets and port it needs. One action can be the channel's setup action and one its teardown action.
_Avoid_: Script, task, job

**Template**:
A ready-made job the user starts by typing `/` and its name, whose instructions Omni sends with the user's text in place of the command.
_Avoid_: Prompt, macro, recipe

**Design system**:
A standalone HTML page set on a channel that its threads follow whenever they make a page, so the channel's artifacts share one look.
_Avoid_: Theme, style guide

**Artifact**:
A file a thread makes for the user, shown in the thread and in Files.
_Avoid_: Output, attachment, render

**Published artifact**:
A page a thread published to claude.ai, linked to its local file and updated at the same address each time.
_Avoid_: Artifact (alone: a local file), share link

**Artifacts**:
The page that holds two lists, Files and Claude Artifacts, behind the Artifacts disc on the channel rail and the Artifacts tab on a phone.
_Avoid_: Library, gallery

**Files**:
The list of every artifact the user's threads made, across channels on the Artifacts page, or one thread's own and its delegated threads' in that thread's Files tab.
_Avoid_: Artifacts (the page that holds Files and Claude Artifacts), outputs, downloads

**Claude Artifacts**:
The list of the user's Artifacts on claude.ai, on the Artifacts page beside Files.
_Avoid_: Library, claude.ai artifacts, Artifacts (the page that holds both lists)

**Review note**:
A note the user pins to lines in a thread's diff, kept with those lines until it is sent, resolved or deleted.
_Avoid_: Comment, annotation

**Watched PR**:
A thread's pull request whose checks and reviews Omni follows on its own, waking the thread when they change.
_Avoid_: PR subscription, PR monitor

### Crew

**Crew**:
Every agent a machine offers.
_Avoid_: Team (one delegation), members (one thread's agents)

**Agent**:
A name and avatar with a charter, run defaults and powers, which leads threads and is seated in them as a member: shipped with Omni, the user's own, or a remote agent the user connected.
_Avoid_: Crew role, role (in anything the user reads; the code still says crew role), persona, bot, harness (what a local agent runs in)

**Avatar**:
An agent's face wherever it shows: its uploaded photo, else its icon or emoji on its color, else its crew character: its shape, filled with its one color and leaning like the Omni mark, with eyes. The color says who the agent is and never changes with state.
_Avoid_: Initials disc (retired), crew mark (retired), monogram, profile picture, icon (one source of an avatar)

**Shape**:
One of the 16 silhouettes a crew character takes, each the Omni ring bent into a form and paired with a color. Nine belong to the built-in agents and seven are spares, one of which any other agent gets from its id until the user picks a shape.
_Avoid_: Crew mark, mark (a status mark, or the Omni mark), icon, glyph (an eye's or a status mark's), character (the whole drawing)

**Eyes**:
The pair of glyphs on a crew character that shows what its thread is doing, in the status mark's shapes: circles while the agent has the ball (idle, thinking or working), squares while something outside Omni does (waiting), diamonds when the user does (needs you) and arcs when it is done. Avatars of 31px and smaller draw dots, squares, tall bars and chevrons instead. Thinking is an eye pose, not effort.
_Avoid_: Ring (the working or Needs you outline that only a photo or icon avatar keeps), badge, status dot (the status mark beside the avatar), expression, mood

**Remote agent**:
An agent that runs on a server outside Omni, such as Hermes or an eve agent, which talks in threads but never changes their files, and sees a channel's messages and git-tracked files only where the channel lets remote agents see its work.
_Avoid_: Custom harness (the code's name for its server, which the user never picks), remote harness, provider

**eve agent**:
A remote agent built on Vercel's eve framework, which Omni talks to through eve's own API.
_Avoid_: Vercel agent, eve harness, Nomos (one eve agent, not the kind)

**Charter**:
The instructions an agent brings to every thread it leads or is seated in.
_Avoid_: System prompt, persona, role file

**Overlay**:
The user's edit of a shipped agent, which changes only what it names, so a release still updates the rest.
_Avoid_: Copy, duplicate (a duplicate stops following releases)

**Powers**:
The parts of an agent only the user may change, such as which tools it gets, whether the Conductor may delegate to it and whether it reviews work.
_Avoid_: Permissions, capabilities

**Conductor**:
The agent the user talks to, which answers quick questions itself and delegates real work to other agents' threads in the right channels.
_Avoid_: Orchestrator, router, main agent

**Delegation**:
One thread handing a piece of work to a new thread run as an agent, which reports back when it is done. The two are the parent and the delegated thread.
_Avoid_: Spawn, subagent, handoff

**Brief**:
The first message of a delegated thread, or one team member's part, written as Goal, Done when and Proof back, since the delegated thread cannot see its parent's conversation.
_Avoid_: Prompt, ticket, spec

**Task id**:
The short label, such as T-1A2B, that a delegated thread carries and its crew report is tagged with.
_Avoid_: Ticket, job id

**Team**:
A delegation of several parts of one job as one thread: a lead that plans and then messages each member its part, and one member per agent with a part, where an agent with two parts gets both in one message and the lead writes the crew report once every member has finished.
_Avoid_: Crew (every agent), swarm, member thread (the older form, one thread per part)

**Crew report**:
A delegated thread's final reply, delivered to the thread that delegated it when its lead's turn ends, even if members still run. A team's is its lead's reply after every member has finished.
_Avoid_: Result, callback

**Ask**:
The older way to put a question to another agent from inside a thread: a new thread under it, whose report came back as a card. Seating that agent as a member replaces it for new messages.
_Avoid_: Quick ask (a question with no thread to manage), second opinion, ask (for seating a member)

**Sub-agent**:
A helper a thread's harness starts inside its own turn, which Omni shows but does not run as a thread.
_Avoid_: Delegated thread, child, crewmate, member (an agent seated in the thread)

**Review**:
A thread run as a review agent that checks another thread's work against its brief, on the other model family from the one that wrote it.
_Avoid_: Audit, code review (the skill)

**Learning**:
A short lesson for every thread in one channel, whatever its agent.
_Avoid_: Memory, rule, lesson (an agent's)

**Lesson**:
A short note on how one agent should work, given to every later thread of that agent, in every channel or in one. An agent's lessons together are its agent memory.
_Avoid_: Learning (a channel's), memory (the harness's own)

### Group threads

**Lead**:
The agent a thread started as, fixed for the thread's life, which answers every message that names no agent and is the only agent that commits and opens the pull request. In a thread led by a remote agent, the user commits instead.
_Avoid_: Owner (the person the work is for), host, main agent, primary

**Member**:
An agent seated in a thread beside its lead, with its own session there, which replies only to messages that name it and edits files but never commits.
_Avoid_: Participant, guest, collaborator, sub-agent (a helper inside one turn)

**Seat**:
To make an agent a member of a thread, with an agent mention or Add an agent in the member list. Only the user seats agents, except the Conductor in its own #conductor thread and in a thread it delegates. The member starts from a catch-up and stays until the user removes it.
_Avoid_: Invite, ask (the older question to another agent)

**Agent mention**:
An `@` pill naming an agent in a message, which seats it the first time and makes it reply. A message with agent mentions goes only to the agents it names.
_Avoid_: Mention (a skill), machine mention, tag, ping

**Catch-up**:
The summary of a thread so far that Omni writes with a small model for a newly seated member's first turn.
_Avoid_: Excerpt (what an Ask carried), carryover (what a session reads when work moves), recap, briefing

**Collision**:
A file that two agents in one thread both changed, which the thread flags until the lead's next commit or until the user dismisses it. Omni then tells each agent still running which files the other changed.
_Avoid_: Conflict (a git merge conflict), clash

### Messages and results

**Request**:
A message sent to a thread, saved before the sender hears it was accepted, so a retry or a restart never loses or doubles it.
_Avoid_: Job, task, queued message

**Message context**:
Typed records a request carries beside its text, each with the user's note: picked diff lines, terminal output, a marked-up browser screenshot or another thread.
_Avoid_: Context (alone: the context window), attachment (a file)

**Delivery state**:
Where a request is on its way into a harness, from accepted to delivered, or why it stopped short.
_Avoid_: Status (a thread's), queue state

**Result**:
How a turn ended: done, failed or stopped.
_Avoid_: Completion, outcome

**Limit stop**:
A turn its harness ended because the plan's usage limit refused it. It waits for the user to resume it now or at the reset time.
_Avoid_: Rate limit (the meter), quota error

**Continuation**:
The single "continue where you left off" message that resuming a limit stop sends.
_Avoid_: Retry, auto-resume, fork

**Question card**:
One to four multiple-choice questions an agent asks the user during a turn, waiting in the thread and in Needs you until answered, skipped or overtaken by a message.
_Avoid_: Prompt, form, AskUserQuestion (Claude Code's own tool)

**Approval card**:
A card that holds one tool call in a channel at Ask first until the user allows or refuses it.
_Avoid_: Permission prompt, question card

**Open items**:
A card under a finished turn listing up to five things still for the user to resolve.
_Avoid_: Question card (the live ask during a turn), follow-up suggestion

**Steps**:
The plan a running turn shows in plain words: three to six steps, with a marker on the current one.
_Avoid_: Todos, tool rows, progress

**Goal**:
A condition a Claude Code session keeps working toward until it holds.
_Avoid_: Plan, objective

**Needs you**:
Every thread waiting on the user: a result not yet read, or something only the user can clear, such as a question card, a failed setup or a limit stop.
_Avoid_: Notifications, unread

**Inbox**:
The list of threads by activity: pinned threads, then the Needs you, Finished, Working and Done shelves. On a phone it is Activity.
_Avoid_: Needs you (the reasons a thread waits), notifications, Overview

**Overview**:
The dashboard beside the Inbox, with the Conductor composer, counts, machines and usage.
_Avoid_: Home, Inbox

**Marked done**:
A flag the user sets that takes a thread out of Needs you without changing its status or its place.
_Avoid_: Result, archive, closed

**Status mark**:
The one symbol every thread carries: its shape says who has the ball, its color repeats it and its fill says how far along it is. In a thread with members it shows the highest state of any of its agents, in this order: Needs you, Failed, Working, Done, Idle. Usage limit, Setup failed and Message held count as Failed, and Stopped as Done.
_Avoid_: Spinner, badge

### Runs

**Harness**:
The AI tool an agent runs in, together with the plan it bills: Claude Code, Codex, Cursor Agent, Cursor Cloud or Antigravity. A remote agent has none for the user to pick.
_Avoid_: Agent (who takes part in a thread), remote agent, custom harness, provider, engine, backend, runtime

**Account**:
Who a harness is signed in as on one machine, with its plan.
_Avoid_: Login, profile, user

**Model**:
The LLM a harness runs for an agent in a thread, picked from that harness's own list.
_Avoid_: Provider

**Effort**:
How hard the model reasons on each step, picked from the levels that model offers in its harness.
_Avoid_: Thinking, reasoning level

**Run**:
The harness, model and effort one agent runs on in a thread, together. An agent, channel or automation can set run defaults.
_Avoid_: Config, setup, engine

**Auto**:
The model picker's default, where Omni reads a new thread's first prompt and picks its run.
_Avoid_: Router, smart model, Cursor's own `auto` model

**Session**:
The harness's own record of one agent's conversation in a thread, which Omni resumes on that agent's next turn. A thread has one per agent seated in it.
_Avoid_: Codex "thread", Cursor "chat", run, browser session (a signed-in device)

**Warm session**:
A session whose prompt cache is likely still live: while it runs and for an hour after its model last acted. A session past that is cold.
_Avoid_: Live, active, idle

**Handover**:
What an agent's next session in a thread reads after that agent moved to another harness: the thread's facts and transcript, rebuilt by Omni.
_Avoid_: Context transfer, migration, handoff (a move to another machine)

**Fork**:
A new thread started from an idle one on another local harness, with its own session and worktree and a carryover from its source. The user starts one with Fork thread.
_Avoid_: Continued thread, continuation, child (a crew relation)

**Carryover**:
What a new session reads ahead of the user's first message when it picks up work that ran elsewhere, framed as data and cut to a budget.
_Avoid_: Handover (a thread that changed harness), context transfer

**Transition**:
A change to how or where a thread runs, with a preview and a cancel: a switch of run, a handoff or take over, or a fork.
_Avoid_: Move, migration

**Slash command**:
Anything the user runs by typing `/` at the start of a message: a harness command or an Omni command.
_Avoid_: Prompt, macro, shortcut

**Harness command**:
A skill, custom command, plugin command, MCP prompt or built-in that a thread's harness offers and runs itself.

**Omni command**:
A slash command Omni runs itself in place of a harness built-in that would change what Omni tracks, such as clearing or renaming a thread.
_Avoid_: omni CLI

**Mention**:
A skill or custom command named with `/` later in a message, which the harness loads alongside the text instead of running it.
_Avoid_: Tag, reference, machine mention, agent mention

**Machine mention**:
An `@` pill naming a machine in a message to the Conductor, which tells it where to run the task beside it.
_Avoid_: Mention (a skill), agent mention, tag

### Machines and sync

**Machine**:
A computer that runs an Omni server, such as a Mac or a Linux box, alone or paired with the user's other machines.
_Avoid_: Device, Mac (when it may be Linux), host, box

**Hub**:
The machine the user is talking to, which creates threads and follows the ones it sent to other machines.
_Avoid_: Primary, main, server

**Holder**:
The machine that holds a thread: the one running it, or between turns the one that ran it last. Only the holder starts the thread's turns.
_Avoid_: Owner (the person the work is for), execution owner, run machine

**Handoff**:
Moving a thread, its session and its files to another machine, started by the holder.
_Avoid_: Handover (a harness switch), transfer

**Take over**:
A handoff asked for by the machine that will take the thread.
_Avoid_: Force, steal

**Sync relay**:
The user's own Cloudflare Worker that carries changes, handoffs and commands between their machines.
_Avoid_: Server, Supabase, cloud

**Signed change**:
A change a machine pushes to the sync relay under its own signature, so the other machines can tell it came from that machine.
_Avoid_: Event, message

**Trusted machine**:
A machine whose signing key the others pinned and accepted, so its actions, such as handoffs and secret sends, apply.
_Avoid_: Paired (a phone or browser), known machine

**Signed-in device**:
A browser, phone app or desktop window signed in to one machine's Omni, which the user can revoke.
_Avoid_: Device (alone), machine, session

**Pairing**:
Signing a phone, browser or app in to a machine, or a machine in to a remote agent, with a one-time code made somewhere already signed in.
_Avoid_: Login, linking

**Install token**:
The credential that proves a caller is the user on one machine, held by the desktop app, the omni CLI and anything paired with it.
_Avoid_: API key, thread token

**Thread token**:
The credential each thread and its tools get, which acts only as that thread and can never do what only the user may.
_Avoid_: API token, install token

**Access level**:
How much a channel's agents may do before they ask: Read only, Ask first or Full access.
_Avoid_: Permission mode, sandbox

**Grant**:
A standing yes from an approval card, for one tool in a thread or for one agent in a channel.
_Avoid_: Allowlist, permission

**Omni Connect**:
Remote access to a machine through the sync relay's tunnel, signed in with Google, without Tailscale.
_Avoid_: Funnel, public tunnel, Tailscale Serve

### Automations

**Automation**:
A schedule or an event that starts a new thread on every run.
_Avoid_: Cron job, routine, workflow

**Trigger delivery**:
One saved event for an event automation, tracked from its arrival to whether it started a thread.
_Avoid_: Request (a message), delivery state (a request's), webhook

**Precheck**:
A command a scheduled automation runs first, which skips the run when there is nothing to do.
_Avoid_: Guard, condition

**Usage scan**:
A run the user starts from Scan my usage, which reads their repeated asks and suggests up to three automations.
_Avoid_: Insights, audit

### Clients

**Web UI**:
The browser client, on a desktop browser or a phone, and inside the desktop app.
_Avoid_: Frontend, dashboard

**Phone layout**:
The Web UI's own shell at phone width, with Activity, Channels, Artifacts and PRs tabs.
_Avoid_: Mobile site, iOS app

**Desktop app**:
The Electron app for macOS and Linux: the Web UI in a window of its own, with the Omni server inside.
_Avoid_: Mac app (the old SwiftUI client), Linux launcher, native UI, "the app"

**iOS app**:
The native iPhone app, which pairs with a machine to read, send and steer threads.
_Avoid_: Phone layout, mobile app

**omni CLI**:
The terminal command, with six commands, that the user and agents run against a machine's Omni.
_Avoid_: Omni command (a slash command)

**Channel rail**:
The desktop column of discs for the Inbox, the Conductor and each channel, with a list panel beside it.
_Avoid_: Sidebar (the Classic sidebar)

**Collapsed list**:
The channel rail's list panel narrowed to a strip of marks and avatars.
_Avoid_: Mini sidebar, compact mode, icon mode

**Quick-actions card**:
The compact card a thread opens with beside its transcript, naming where and how it runs, its branch and its pull requests.
_Avoid_: Side panel, Details tab, inspector

**Show technical details**:
The Appearance switch that, when off, hides code and harness detail and names every status in one of five plain words.
_Avoid_: Plain mode, simple mode

**Mod**:
A Claude Code plugin of hooks that Omni ships and loads into Claude Code threads when mods are on.
_Avoid_: Plugin, extension

**Grok Bot**:
A bot outside Omni that a thread or a new message can be sent to, and that can use Omni as an MCP server.
_Avoid_: Grok (the model)
