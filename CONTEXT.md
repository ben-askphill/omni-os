# Omni OS

A local workspace for agent work: channels, threads, crew and automations, running on the user's own subscriptions through the official agent CLIs.

## Language

### Work

**Channel**:
A client, project or area that groups threads and carries their shared facts (repo, store, Portal slug, browser profile).
_Avoid_: Project, workspace

**Design system**:
A standalone HTML file set in a **Channel**'s settings. Its threads read it before writing an HTML page, so every artifact in the channel shares one look.
_Avoid_: Theme, style guide

**Thread**:
One task's conversation with one agent, from the first prompt through every follow-up, stored and searchable in Omni.
_Avoid_: Chat, session, conversation

**Turn**:
One run of the agent, from a message to its final reply.

**Crew role**:
A charter in `crew/*.md` that gives a thread its job, defaults and extra tools.
_Avoid_: Agent, persona, bot

**Conductor**:
The crew role the user talks to, which delegates work to crew threads in other channels.

**Automation**:
A cron schedule, or a GitHub PR event (`on:`), that starts a new thread on every run.

**Request**:
A message sent to a thread through the API, saved before the client hears it was accepted. It carries the client's request id, kept across retries: a retry with the same id gets the first acceptance back, and the same id with another message is refused. Local to the Mac that accepted it (`message_requests`, `apps/server/db/repos/requests.ts`).
_Avoid_: Job, task

**Message context**:
Typed records a **Request** carries next to its text, each with the user's note: lines picked in the Changes panel (`diff_selection`) for now. The agent gets them as an `<omni-context>` block; the transcript keeps the records as sent ([docs/internals/message-context.md](docs/internals/message-context.md)).
_Avoid_: Context (alone, which is the context window), attachment (a file)

**Crew report**:
A child thread's reply to the thread that delegated it, sent when its turn ends. Saved as a **Request** on the parent before the parent is woken, once per child turn, so a restart before the parent reads it keeps it for Resume. A team's go to its lead is saved the same way. Omni wrote both, so the user can resume or discard them but not edit or move them.
_Avoid_: Result, callback

**Delivery state**:
Where a **Request** is. `accepted` (saved), `waiting` (for a slot), `held` (runs after this turn), `sent` (written to the harness), then `delivered` (the harness read it; the transcript keeps it where it did), `dropped` (stopped first), `discarded` (the user chose not to send it) or `cancelled` (the user removed it from the queue; the row is the record, the transcript never shows it). A restart parks the rest: `recovered` when no harness got it, held with Resume, and `uncertain` when one may have, sent again only when the user says so.
_Avoid_: Status (a thread's), queue state

**Setup**:
Making and checking a **Thread**'s own git worktree before anything runs in it, for a **Channel** with a worktree per thread. `preparing`, then ready, or `failed` with git's reason until the user presses Retry, which uses the same thread, branch and **Session**. A worktree thread's first prompt and files are saved as its first **Request**, so they survive a restart while it waits.
_Avoid_: Provisioning, bootstrap

**Result**:
How a **Turn** ended: `done`, `failed` or `stopped`. Each one is saved with an id of its own (`completions`), whatever ended the turn: the harness, the user's stop, a restart or a failed **Setup**. Only the Mac that ran the turn saves it; the other Mac gets that same row by sync, so a **Result** has one id on both.
_Avoid_: Completion (in UI text), outcome

**Limit stop**:
A **Turn** its **Harness** ended because the plan's usage limit refused it, as Claude Code or Codex reports it. A full usage meter is not one, and neither is any other failure or Hermes being at its run cap. The thread fails as usual and keeps the stop, with the reset time the harness gave if it gave one. The stop syncs, so both Macs list it in Needs you, but only the Mac that ran the turn resumes or schedules it. The user resumes it now, or, with a reset time, picks Resume at reset: one **Continuation** then, never automatic. A message, Stop or archiving the thread clears it.
_Avoid_: Rate limit (the meter), quota error

**Continuation**:
What resuming a **Limit stop** sends: Omni's "continue where you left off", saved as a **Request** keyed by the stop before the thread is woken, so it goes once, through the slots, even when it came due while Omni was down.
_Avoid_: Retry, auto-resume

**Question card**:
Questions an agent asks the user with Omni's `ask_user_question` tool: one to four, each with two to four options plus a free-text Other. It sits in the thread where the agent asked, and in **Needs you** until the user answers, skips or writes a message instead, which dismisses it. The first of those wins. The answers go back as the waiting tool call's result; when that call is gone (a restart, Stop, the harness's own timeout), they reach the thread as a message.
_Avoid_: Prompt, form, AskUserQuestion (Claude Code's own tool, off in Omni)

**Needs you**:
One list across every thread not archived: each thread's newest unread **Result**, and what blocks a thread until the user acts (a **Question card** waiting for an answer, even in a running thread, a failed **Setup**, `recovered` or `uncertain` **Requests**, a **Limit stop**). Opening a thread reads the **Result** it shows and only that one, so a later one stays unread. Read state is its own (`result_reads`): it never changes a thread's status, place in the lists or folder. It syncs, and only moves forward: each thread keeps the newest **Result** read on either Mac, ordered by the place each one has in its thread, never by a clock.
_Avoid_: Inbox (in UI text), notifications, unread thread

### Harnesses

**Harness**:
The agent a thread runs in, together with what it bills: Claude Code (Claude plan), Codex (ChatGPT plan), Cursor Agent (Cursor plan), Hermes (Anthropic API on the user's server, not their Claude, ChatGPT or Cursor plan) or Cursor Cloud (a Cursor cloud agent on Cursor's machines, Cursor plan).
_Avoid_: Provider, engine, backend, runtime

**Model**:
The LLM a harness runs for a thread, picked from that harness's own model list.
_Avoid_: Provider

**Effort**:
How hard the **Model** reasons on each step, picked from the levels that model supports in its harness.
_Avoid_: Thinking, reasoning level

**Auto**:
The model picker's default: Omni reads a new thread's first prompt and picks its **Harness**, **Model** and **Effort**, among Claude Code, Codex and Cursor's Composer, and keeps one line saying why (`auto_reason`). Cursor Agent has a model of its own called `auto`; that one stays Cursor's.
_Avoid_: Router, smart model

**Session**:
The harness's own record of a thread's conversation, which Omni resumes on every follow-up.
_Avoid_: Codex "thread", Cursor "chat" (their names for the same thing)

**Handover**:
What a thread's next **Session** reads ahead of the user's message after the thread moved to another **Harness**: the thread's facts and its transcript, built by Omni, since no harness reads another's session. A harness the thread never ran on gets the whole thread in a new **Session**; one it ran on before resumes its own **Session** and gets only what happened since. Pending until that session starts.
_Avoid_: Context transfer, migration

**Slash command**:
Anything the user runs by typing `/` in the composer: a **Harness command** or an **Omni command**.
_Avoid_: Prompt, macro, shortcut

**Harness command**:
A skill, custom command, plugin command, MCP prompt or built-in that a thread's **Harness** offers and runs itself.

**Omni command**:
A **Slash command** Omni runs itself in place of a harness built-in that would change what Omni tracks (`/clear`, `/rename`, `/model`). The harness's other names for that built-in run it too (Claude Code's `/reset` is `/clear`, `/name` is `/rename`).

**Mention**:
A skill or custom command named with `/` after the start of a message, which the harness loads alongside the text rather than running as the command.
_Avoid_: Tag, reference

### Clients

**Mac app**:
The native macOS client for the desk.
_Avoid_: Desktop app, native UI, "the app"

**Web UI**:
The browser client, used from the phone over tailscale and as a fallback on the Mac.
_Avoid_: Frontend, dashboard

## Relationships

- The **Mac app** and the **Web UI** are two clients of the same Omni server; neither holds thread state of its own
- A **Channel** has many **Threads**
- A **Thread** runs on one **Harness** and one **Model** at a time, and has one current **Session**; it keeps the **Session** it had on each harness it left
- A **Harness** offers many **Models**; the same model family can appear in several harnesses (Claude Opus runs in Claude Code and in Cursor Agent)
- A Hermes **Thread** runs on the Hermes server, reached over Tailscale. The API listens on the server's tailnet address and is not public. The thread has no Omni worktree, browser profile or artifacts directory. Its **Session** id is `omni-<thread id>`. Artifacts come back as links or text
- A Cursor Cloud **Thread** is one Cursor cloud agent on the **Channel**'s GitHub repo, on Cursor's Linux machines; each **Turn** is a run on it. Like Hermes it has no Omni worktree, browser profile or artifacts directory. Its **Session** id is the agent id, `bc-<thread id>`. Its work comes back as a branch and a PR that Cursor opens
- The user picks the **Harness** per thread, or leaves it to **Auto**; Omni never switches a thread's harness on its own
- The user (or the **Conductor**, when asked) can switch a thread's **Harness**, **Model** or **Effort** between **Turns**, never to or from Hermes or Cursor Cloud, and a Cursor Cloud thread keeps its model. A switch picked during a **Turn** waits and applies once it ends, so a **Turn** never spans two runs; messages sent meanwhile run on the new one. The same **Harness** keeps its **Session**; another one gets a **Handover**
- A **Crew role**, **Channel** or **Automation** can set a default **Harness**, **Model** and **Effort**, or **Auto**; a choice made on the thread wins, and **Auto** is the fallback
- The **Conductor** delegates on the crew role's defaults, which for most roles is **Auto**, unless the user names a harness or model
- A **Harness** offers many **Harness commands**; a thread's `/` menu lists its own **Harness**'s **Harness commands** plus the **Omni commands**
- An **Omni command** behaves the same on every **Harness**; `/clear` starts a new **Thread** rather than wiping the **Session**
- A message starts with at most one **Slash command** and can carry many **Mentions**; built-ins, MCP prompts and **Omni commands** only work at the start
- A Claude Code **Thread** lists its MCP prompts only while it is warm, once its MCP servers have connected; while warm, its `/` menu lists exactly what that session can run
- In Claude Code a **Mention** is best effort (the model decides whether to load it); Codex and Cursor load every one
- A **Request** belongs to one **Thread** and the Mac that accepted it; only that Mac resumes it, through the same slots as any message, so each **Harness**'s concurrency cap holds
- A **Thread** in a **Channel** with a worktree per thread runs only in its own worktree, on its own branch. When **Setup** fails, nothing runs in the channel's repo or the brain instead; channels with worktrees off still run in the repo, and a Hermes **Thread** never gets one
- Resume sends a **Thread**'s `recovered` **Requests** in their saved order; an `uncertain` one is never sent again on its own
- The user can edit, reorder or remove a **Request** while it is `waiting`, `held`, `recovered` or `uncertain`; once the runner starts sending it, a change is refused and the client keeps their edited text. Editing or reordering never resumes anything. A `held` **Request** can also be steered now: sent into the running turn instead of after it
- A **Crew report** for a parent the user stopped waits as `recovered` with Resume instead of starting it again; a team lead still waits for every member's report before it runs
- A **Thread** has at most one **Limit stop**, its last turn's. Messages queued behind that turn wait as `recovered` rather than running into the same limit, so the **Continuation** never has follow-ups ahead of it
- A **Thread** has many **Results** and at most one unread one in **Needs you**: its newest, while the thread is not running again. A delegated thread's `done` **Result** went to its parent as a **Crew report**, so only its failures and stops are listed
- **Harness commands** work in any message a **Thread** gets, whether the user, an **Automation** or the **Conductor** sent it; **Omni commands** only work from a thread's reply box, and anywhere else reach the harness as plain text

## Example dialogue

> **Dev:** "This thread runs Claude Opus 5.5 in Cursor Agent, so it uses the Claude plan?"
> **User:** "No, the **Harness** decides the bill. Cursor Agent with Opus bills Cursor. Only Claude Code bills the Claude plan."

## Flagged ambiguities

- "provider" was used for both the CLI a thread runs in and the company behind the model. Resolved: the CLI plus its subscription is the **Harness**; the model vendor is only part of the **Model** name.
- Codex calls its conversations "threads" and Cursor calls them "chats". Resolved: in Omni those are **Sessions**; **Thread** always means an Omni thread.
- "Syncing slash commands" could mean copying command files between the tools. Resolved: Omni reads each **Harness**'s own **Harness commands** live and copies nothing; a command defined in one tool only shows in threads on that tool.
