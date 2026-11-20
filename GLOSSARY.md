# Omni OS

A local workspace where the user hands work to agents: channels hold threads, agents give threads their jobs, and every thread runs on the user's own subscriptions through an official CLI.

## Language

### Work

**Channel**:
A client, project or area that groups threads and holds the facts they share, such as a repo, a store or a browser profile.
_Avoid_: Project, workspace, space

**Folder**:
A named group of threads inside one channel.
_Avoid_: Project, workstream, group

**Thread**:
One task's conversation with one agent, from the first prompt through every follow-up, kept and searchable in Omni.
_Avoid_: Chat, session, conversation, run

**Turn**:
One go of the agent in a thread, from a message to its final reply.
_Avoid_: Run, step

**Task**:
A thread with full tools and a place of its own to work, as opposed to a quick ask.
_Avoid_: Job, ticket

**Quick ask**:
A question an agent answers in place with read-only tools, kept out of the thread lists until the user keeps it or makes it a task.
_Avoid_: Chat, quick thread, ask (a question to another agent)

**Job**:
A Conductor thread together with every thread it delegated, shown as one tree.
_Avoid_: Project, epic, request

**Owner**:
The person a thread's work is for: the user, unless someone else is named.
_Avoid_: Assignee, holder (the machine that runs a thread)

**Workspace folder**:
The user's own folder, which a thread works in when its channel has no folder of its own.
_Avoid_: Home, project folder

**Worktree**:
A thread's own git checkout of its channel's repo, on a branch of its own, so threads in one repo never share files.
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
A file a thread makes for the user, shown in the thread and in Claude Artifacts.
_Avoid_: Output, attachment, render

**Published artifact**:
A page a thread published to claude.ai, linked to its local file and updated at the same address each time.
_Avoid_: Artifact (alone: a local file), share link

**Claude Artifacts**:
The place that lists every artifact across channels and, behind a switch, the user's Artifacts on claude.ai.
_Avoid_: Library, Artifacts (alone: one thread's files), Artifacts page

**Review note**:
A note the user pins to lines in a thread's diff, kept with those lines until it is sent, resolved or deleted.
_Avoid_: Comment, annotation

**Watched PR**:
A thread's pull request whose checks and reviews Omni follows on its own, waking the thread when they change.
_Avoid_: PR subscription, PR monitor

### Crew

**Crew**:
Every agent a machine offers.
_Avoid_: Team (one delegation)

**Agent**:
A charter with run defaults and powers that gives a thread its job, either shipped with Omni or the user's own.
_Avoid_: Crew role (in anything the user reads; the code still says it), persona, bot

**Charter**:
The instructions an agent gives every thread started as it.
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
The first message of a delegated thread, written as Goal, Done when and Proof back, since the delegated thread cannot see its parent's conversation.
_Avoid_: Prompt, ticket, spec

**Task id**:
The short label, such as T-1A2B, that a delegated thread carries and its crew report is tagged with.
_Avoid_: Ticket, job id

**Team**:
A delegation of several parts of one job: a lead thread with one member thread per part, where the lead waits for every member's report.
_Avoid_: Crew (every role), swarm

**Crew report**:
A delegated thread's final reply, delivered to the thread that delegated it when its turn ends.
_Avoid_: Result, callback

**Ask**:
A question the user puts to another agent from inside a thread, answered by a new thread under it whose report comes back there.
_Avoid_: Quick ask (a question with no thread to manage), second opinion

**Sub-agent**:
A helper a thread's harness starts inside its own turn, which Omni shows but does not run as a thread.
_Avoid_: Delegated thread, child, crewmate

**Review**:
A thread run as a review agent that checks another thread's work against its brief, on the other model family from the one that wrote it.
_Avoid_: Audit, code review (the skill)

**Learning**:
A short lesson for every thread in one channel, whatever its agent.
_Avoid_: Memory, rule, lesson (an agent's)

**Lesson**:
A short note on how one agent should work, given to every later thread of that agent, in every channel or in one. An agent's lessons together are its agent memory.
_Avoid_: Learning (a channel's), memory (the harness's own)

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
The one symbol every thread carries: its shape says who has the ball, its color repeats it and its fill says how far along it is.
_Avoid_: Spinner, badge

### Runs

**Harness**:
The AI tool a thread runs in, together with the plan it bills: Claude Code, Codex, Cursor Agent, Cursor Cloud, Hermes or a custom harness.
_Avoid_: Provider, engine, backend, runtime, agent (what a thread runs as)

**Custom harness**:
A remote AI service the user registered on a server of their own, which Omni reaches the same way it reaches Hermes.
_Avoid_: Provider, engine, plugin

**Account**:
Who a harness is signed in as on one machine, with its plan.
_Avoid_: Login, profile, user

**Model**:
The LLM a harness runs for a thread, picked from that harness's own list.
_Avoid_: Provider

**Effort**:
How hard the model reasons on each step, picked from the levels that model offers in its harness.
_Avoid_: Thinking, reasoning level

**Run**:
The harness, model and effort a thread runs on, together. An agent, channel or automation can set run defaults.
_Avoid_: Config, setup, engine

**Auto**:
The model picker's default, where Omni reads a new thread's first prompt and picks its run.
_Avoid_: Router, smart model, Cursor's own `auto` model

**Session**:
The harness's own record of a thread's conversation, which Omni resumes on every follow-up.
_Avoid_: Codex "thread", Cursor "chat", run, browser session (a signed-in device)

**Warm session**:
A session whose prompt cache is likely still live: while it runs and for an hour after its model last acted. A session past that is cold.
_Avoid_: Live, active, idle

**Handover**:
What a thread's next session reads after the thread moved to another harness: its facts and transcript, rebuilt by Omni.
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
_Avoid_: Tag, reference, machine mention

**Machine mention**:
An `@` pill naming a machine in a message to the Conductor, which tells it where to run the task beside it.
_Avoid_: Mention (a skill), tag

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
Signing a phone, browser or app in to a machine with a one-time code made somewhere already signed in.
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
The Web UI's own shell at phone width, with Activity, Channels, Claude Artifacts and PRs tabs.
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
