# Group threads and remote agents: build slices

How to build [ADR 0019](../adr/0019-group-threads.md) (threads are group chats with agents) and [ADR 0020](../adr/0020-remote-agents-are-agents.md) (remote agents are agents, with worktree read gated per channel), as six slices in dependency order plus an iOS slice. Task T-9079.

- Status: Ben settled the decisions on 2026-11-20, in a grilling session. Nothing is built. Section 5 lists the questions this plan raised, which the decisions leave open. None of them is decided here.
- Surveyed: `main` at `0ce9873b` (desktop 0.1.43). Paths below are on that commit.
- Words: [GLOSSARY.md](../../GLOSSARY.md) as this change leaves it: **lead**, **member**, **seat**, **agent mention**, **collision** and **remote agent** are new. "Custom harness" stays the code's word for a remote agent's server.

## Summary

- A thread gets a member list. Its first entry is the lead, the agent the thread started as. An agent mention in Ben's message seats an agent as a member with a session of its own in that thread, until Ben removes it.
- A message goes to the agents it names, else to the lead. Several named agents reply in parallel in the thread's one worktree. Each reads every message since its own last turn, without tool calls.
- Omni tracks which files each agent changed in its turn. It tells running agents what the others changed, and it flags files that two agents both edited.
- Every agent has a name and an avatar, and every message shows who wrote it.
- Hermes and eve agents become remote agents. Their servers stay behind the agent and leave the harness pickers. A channel can let them read a thread's worktree through a scoped read tool. That switch is off by default.
- `delegate_team` makes one thread with a lead and members, in place of a tree of threads. Seating replaces Ask for new messages.

## 1. What changes for Ben

| Today | After |
| --- | --- |
| A thread is one agent and one session | A thread has a lead and any number of members, one session each |
| `@agent` at the start of a message starts a thread under this one (Ask) | `@agent` anywhere in a message seats that agent here, and it replies here |
| Messages show "the agent", with the harness logo | Messages show the agent's name and avatar. Harness and model show only with Show technical details on |
| Agent avatars are an icon or an emoji on a color | Ben uploads an image; without one, a colored initials disc |
| Hermes and custom harnesses are picked in the harness and model pickers, with an agent bound on top | Each remote server is one remote agent. The pickers list local harnesses only |
| A remote agent gets the prompt and nothing else | Where the channel allows it, a remote agent can also read the thread's worktree |
| A team is a lead thread and one thread per part, as a tree | A team is one thread: the lead and one member per part |
| A thread's mark is its one agent's state | A thread's mark is the busiest state among its agents, with avatars for who runs |

## 2. Current state

Where today's behavior lives, on `0ce9873b`. The slice that changes a row starts from it.

| What | Where |
| --- | --- |
| A thread has one session: `threads.session_id`, plus sessions a harness switch left behind in `threads.sessions` | `apps/server/db/migrate.ts:44`, `:27`; `apps/server/db/repos/threads.ts:118-123` |
| The live registry is keyed by thread id: one `ThreadController` and one `HarnessSession` per thread | `apps/server/runner/state.ts:186`, `apps/server/runner/spawn.ts:38-42`, `apps/server/runner/controller.ts:1`, `:31-32` |
| Delivery steers, queues or interrupts that one process, or puts the thread in the waiting queue | `apps/server/runner/queue.ts:39-107` |
| Transcript rows record no author. `events` holds `thread_id`, `kind` and `payload`. A `user` row's `payload.source` says `ben`, `conductor`, `crew` or `team`, and `assistant_text` is `{ text }` | `apps/server/db/migrate.ts:63-69`, `packages/shared/transcript-fold.ts:33-53`, `apps/server/runner/api.ts:429` |
| The harness a reply came from is read off `switch` events | `packages/shared/thread-view.ts:157`, `:204` |
| Ask: `POST /api/threads/:id/ask` makes an ordinary child thread (`parent_id` is the asking thread) and writes an `ask` event. The answer comes back through `reportToParent`, which wakes the thread unless the Ask was "Just show it" | `apps/server/ask.ts:149-177`, `apps/server/ask-api.ts:30-42`, `apps/server/runner/queue.ts:209-262` |
| `@agent` at the start of a message is parsed as an Ask. The code comment repeats "Omni never seats a second agent in a thread" | `packages/shared/ask.ts:2-3`, `:55-60`; `apps/web/src/components/Composer.tsx:451-478`; `apps/web/src/mobile/MoComposer.tsx:98` |
| A team: `createTeam` opens the lead and one child thread per part (`source: 'team'`, task id `<lead>.<n>`). The lead does not run until `settleTeam` sees no member running or queued, then wakes it once with every reply | `apps/server/runner/api.ts:348-380`, `apps/server/runner/queue.ts:224`, `:319-361`; the tool at `apps/mcp/omni.ts:359-400` |
| An agent's avatar is `{ icon, bg }` in its frontmatter, never an uploaded image. Channels take an uploaded SVG, kept inline in the channel row | `apps/server/crew.ts:179-190`, `apps/web/src/pages/SettingsCrew.tsx:419-421`, `packages/shared/channel-icon.ts` |
| The Web UI draws an agent as `CrewAvatar`: its avatar, else a built-in's `CrewMark`, else a monogram | `apps/web/src/components/CrewAvatar.tsx:9-17`, `apps/web/src/components/brand.tsx:218` |
| Show technical details is the kv key `display`, read with `useTechnical()` | `apps/server/display.ts:11`, `apps/web/src/display.ts:62` |
| A thread's mark is `threadMark`. "Waiting on crew" comes from the server's `delegating` flag, walked up `parent_id` | `packages/shared/status.ts:224-234`, `apps/server/delegating.ts:43-46`, `apps/server/db/repos/threads.ts:350-361` |
| Remote harnesses carry `HarnessCapabilities.remote` and join the catalog, and every `ModelPicker` lists them, with no remote filter | `apps/server/harness/types.ts:48-49`, `apps/server/harness/catalog.ts:248`, `:276`, `apps/web/src/components/ModelPicker.tsx:32` |
| A remote agent's prompt drops the worktree, browser and MCP sections, and goes as `instructions` | `apps/server/runner/prompts.ts:210-235`, `:281-286`, `apps/server/harness/hermes/adapter.ts:193-206` |
| The Connect sheet's "cannot" chips are Worktree, Browser and Omni tools. The eve offer reads only `name`, `description` and `code_url`, with no avatar | `apps/server/agent-connect.ts:127`, `:223-237`, `packages/shared/connect-agent.ts:112-136` |
| `remote_excerpts_off` defaults to 0, so excerpts go. Only Ask reads it, an agent may not set it, and Channel settings labels it "No thread excerpts to remote agents" | `apps/server/db/migrate.ts:360`, `apps/server/ask.ts:75`, `:115`, `apps/server/channels-api.ts:103`, `apps/web/src/pages/ChannelSettings.tsx:526-531` |
| Changes per turn: a before and after snapshot of the whole checkout for each turn, for worktree threads only. Nothing compares turns across agents | `apps/server/turns.ts:1-35`, `:87-107`, `apps/server/db/migrate.ts:208-226`, `apps/server/runner/snapshots.ts` |
| "Never in #conductor" is charter text only. `delegate` posts `/api/threads`, which refuses only an unknown channel | `crew/conductor.md:25`, `apps/server/runner/api.ts:189-191`, `apps/server/thread-routes-api.ts:151-180` |

## 3. Shape

These are proposals for the slices to start from, not decisions. A slice that finds a better shape says so in its PR and updates this section.

### 3.1 Members

- One member row per agent per thread: thread, agent id, whether it is the lead, when it was seated and when it was removed, its session id, its run (harness, model, effort) and a cursor, the last message it has read. The lead gets a row too, so "every agent in the thread" is one query.
- An agent mention is a typed record on the request, as a machine mention is ([Message context](../internals/message-context.md)), not text Omni parses from the message. That way an `@name` an agent types in a reply can never seat anyone, and the pill keeps the agent's id when its name changes.
- Transcript rows gain the id of the agent that wrote them. Ben's rows have none. Older rows read as the lead's.
- The member list is new synced state. It needs a handler in `apps/server/sync/handlers/` and a signed entity like crew files, since seating decides which charter runs in which channel.

### 3.2 Routing and context

- A request with no agent mention goes to the lead. A request with mentions goes to each named member, seating the ones not seated yet, and not to the lead unless it is named.
- An agent's turn opens with every message since its cursor that it did not write: Ben's, the lead's and other members' replies, as data with the author named, and no tool calls or tool output. The cursor moves when the turn starts.
- The context is built the way a carryover is (`apps/server/carryover.ts`): framed as data, cut to a budget, with what was left out listed.

### 3.3 Parallel turns and collisions

- Each agent's turn runs in its own harness session, on the thread's holder. The thread is running while any of its agents runs.
- Omni records which files each turn changed. The slice decides how (section 5, Q21). When a file shows up in two agents' sets in the same thread, Omni sends each running agent the other's list, and the thread records a collision on that file.
- The Changes view and the transcript show collisions. Clearing one is open (Q23).

### 3.4 Remote agents

- A remote agent is an agent whose run is a custom harness. The harness file, its key and its adapter stay as ADR 0017 and 0018 built them. Settings > Agents shows the server inside the agent, and the pickers stop listing it.
- The worktree read tool is the one Omni tool a remote agent can get. It lists, reads and searches one thread's worktree, through a credential that opens nothing else.

## 4. Slices

Ordered by dependency. Each slice ships on desktop web, phone web and the desktop app in one PR, per the repo rules. Each slice also decides every harness (Claude Code, Codex, Cursor Agent, Cursor Cloud, Hermes and custom harnesses), and adds any new state to sync, any changed API shape to the wire fixtures, the Conductor tools that apply and the design system components it needs. Each one rewrites the docs it makes wrong.

| Slice | Scope | Needs |
| --- | --- | --- |
| 1 Identity | Avatar upload, initials disc, author on every message, harness and model behind Show technical details | none |
| 2 Members and routing | Member list, seating by agent mention, a session per agent, routing, context since last turn, removal, busiest-state mark, Ask retired for new messages | 1 |
| 3 Parallel runs and collisions | Named agents run at once in one worktree, changed files per turn, warnings to running agents, collision flags, avatars on the mark | 2 |
| 4 Remote agents as agents | Connect makes an agent, remote agents leave the pickers, server as a detail of the agent, offered avatar, remote lead talk-only, remote members | 1, 2 |
| 5 Remote worktree read | Per-channel switch, scoped read tool, its credential and transport, exclusions | 3, 4 |
| 6 Conductor and one-thread teams | `delegate_team` as one thread, the Conductor seating in delegated threads only, lead woken after every member, crew report | 2, 3 |
| 7 iOS | Members, authors, avatars and the busiest-state mark in the iOS app | 2, then each slice it follows |

Slice 4 needs only 1 and 2, so it can run beside slice 3.

### Slice 1: Identity

- **Goal.** Every agent has a name and an avatar, and every message says which agent wrote it.
- **Scope.**
  - Avatar upload in Settings > Agents, with a default colored initials disc, the color taken from the agent's id. What happens to today's icon and emoji avatars is Q1.
  - Transcript rows record their agent. A one-agent thread shows the lead's name and avatar on its replies.
  - With Show technical details on, the harness and model show beside the name. Off, they do not.
  - The quick-actions card's Agent row, the thread header and the phone's sub line show the avatar beside the name.
- **Sync.** The avatar image has to reach the other machines with the agent's file (Q2).
- **Wire.** Thread and message shapes gain the author. Re-record the fixtures that change.
- **Design system.** An agent avatar (image and initials) and a message author line.
- **Docs.** `docs/user/crew.md` Avatar line, `docs/user/threads.md` on how a reply reads.
- **Done when.** An uploaded avatar shows in Settings > Agents, the composer's Agent picker and on every reply of a thread that agent leads, on all three surfaces and on a second synced machine. An agent without one shows its initials disc.

### Slice 2: Members and routing

- **Goal.** Ben seats agents in a thread with an agent mention, and each one answers there in its own session.
- **Scope.**
  - The member list (section 3.1) and a members strip in the thread, from which Ben removes a member. Removing one closes its session and keeps its replies.
  - Agent mentions in the composer's `@` menu, anywhere in a message, on every composer that can send to a thread. They are typed records on the request.
  - Routing (section 3.2): no mention goes to the lead, mentions go to the named agents only. In this slice, several named agents reply one after another, in the order the message names them. Slice 3 makes them parallel.
  - Context since each agent's last turn, with no tool calls (section 3.2).
  - Once per thread: a mention of a seated member makes it reply and seats nothing.
  - Agent replies never seat or wake anyone. An `@name` in a reply is plain text.
  - Question cards, approval cards and limit stops name the agent they belong to, and the answer goes to that agent's session.
  - The status mark takes the busiest state among the thread's agents (Q34 covers the states the decision does not rank).
  - Ask retires for new messages: `@agent` at the start of a message seats the agent, and the menu's **Ask an agent…** goes or turns into seating (Q8). Old Ask cards and their child threads keep rendering. `packages/shared/ask.ts` and its comment go with the composer's Ask chip.
  - Every place that reads one session per thread reads one per agent: resume, warm state, the context meter, Compact, limit stops, run switches, handoff and Take over, fork and continue (Q14).
- **Harnesses.** Claude Code, Codex and Cursor Agent as members. Cursor Cloud is Q20. Hermes and custom harnesses wait for slice 4.
- **Sync.** Member list and authors. A handoff moves every agent's session.
- **Conductor.** `get_thread` and `list_threads` show members. The Conductor cannot seat in this slice. Slice 6 adds that.
- **Wire.** Member list on the thread, author and mentions on messages. Re-record the fixtures.
- **Design system.** Agent mention pill, members strip, member row with Remove.
- **Docs.** Rewrite `docs/user/threads.md` Ask an agent as members, `docs/internals/message-context.md` for the new record kind and `docs/internals/execution-state.md` for several sessions per thread.
- **Done when.** In one thread, Ben seats two agents, a message with no mention gets only the lead's reply, and a message naming both gets a reply from each, which read each other's earlier replies but not their tool calls. Removing one keeps its replies, and its session does not resume. This works on all three surfaces and after a handoff to the other machine.

### Slice 3: Parallel runs and collisions

- **Goal.** Named agents work at the same time in one worktree, and Omni keeps them from stepping on each other unseen.
- **Scope.**
  - Agents named in one message start together. Each turn counts against its own harness's concurrency cap (Q16).
  - Changed files per turn, per agent (Q21).
  - When two agents in a thread touch the same file, Omni tells each running agent which files the other changed this turn (Q22 covers harnesses that cannot steer).
  - The thread flags every file both agents edited, in the transcript and in the Changes tab.
  - Avatars on the status mark show which agents are running, wherever the mark has room (Q35).
  - Stop and steering with several agents running (Q13).
  - Git operations two agents start at once, such as two commits (Q24).
- **Harnesses.** Claude Code and Codex can be told mid-turn by a steer. Cursor Agent cannot steer, so it hears at its next turn. Cursor Cloud is Q20.
- **Sync.** Collisions travel with the thread.
- **Design system.** The status mark with running avatars, and the collision flag.
- **Docs.** `docs/user/threads.md` status marks and Changes, `docs/internals/execution-state.md`.
- **Done when.** Two agents named in one message run at once and both edit `a.ts`. Each is told mid-turn that the other changed it, and the thread flags `a.ts`. The mark shows both avatars while they run and settles to the busiest state after.

### Slice 4: Remote agents as agents

- **Goal.** Connecting Hermes or an eve agent gives Ben an agent, and the server stays behind it.
- **Scope.**
  - The Connect sheet always makes the agent. **Make an agent for it** goes.
  - The offer a server makes when connecting can carry an avatar (Q29). The agent takes its name from the offer, as today.
  - Settings > Agents shows a remote agent's server (address, kind, secret, Test connection, Remove) inside the agent. Settings > Models > Harnesses stops listing custom harnesses. Hermes's URL and key move under its agent (Q27).
  - The harness and model pickers list local harnesses only. A local agent can no longer be run on a remote server.
  - A thread can start as a remote agent. It leads talk-only, and Ben seats a local member to change files (Q31 covers when such a thread gets its worktree).
  - A remote agent can be seated as a member and gets context as message text (section 3.2), subject to the channel's excerpt switch (Q37).
  - Existing threads and agents on `hermes` or `custom:<slug>` (Q26).
- **Harnesses.** Hermes and custom harnesses of both kinds.
- **Sync.** The agent file and harness file sync as today. A new avatar travels as slice 1's do.
- **Conductor.** `list_crew` marks remote agents. `list_harnesses` stops listing them.
- **Docs.** `docs/user/harnesses.md` Custom harnesses and Hermes, `docs/user/crew.md`, and `docs/internals/remote-harness-protocol.md` for the offer's avatar.
- **Done when.** Connecting Nomos makes a Nomos agent with its avatar, which shows in no picker. A thread started as Nomos answers without a worktree, and seating Builder in it makes the file change.

### Slice 5: Remote worktree read

- **Goal.** In a channel Ben opens to it, a remote agent can read the thread's files.
- **Scope.**
  - The per-channel switch in Channel settings, off by default and set only by Ben. An agent thread gets a 403, as it does for `remote_excerpts_off`. Whether it reuses that switch is Q36.
  - The read tool: list, read and search inside one thread's worktree. It has no writes and no paths outside the worktree, and it never follows a symlink out of it.
  - Its credential: scoped to one thread's worktree and one turn, revoked when the turn ends, and never a thread token (Q39).
  - Its transport to a server that is not on this machine (Q38).
  - Exclusions and size caps (Q40).
  - Every read shows as a tool row in the thread.
- **Harnesses.** Runs API servers and eve agents, each by whatever the transport needs from the protocol. `docs/internals/remote-harness-protocol.md` gains it as an optional call, so a server without it keeps working.
- **Docs.** `docs/internals/remote-harness-protocol.md` (What a remote harness does not get), `docs/user/harnesses.md` and `docs/user/configuration.md` for the channel switch.
- **Done when.** With the switch off, a remote agent's read is refused and the thread says why. With it on, the agent reads `src/a.ts` in the thread's worktree, and a read of `../`, of an excluded file or after the turn ended is refused.

### Slice 6: Conductor and one-thread teams

- **Goal.** A team is one thread in the client channel, and the Conductor seats agents only where it may.
- **Scope.**
  - `delegate_team` makes one thread in the target channel, with the lead and every member seated. The Conductor posts each member's part as a message that names it. Members run in parallel (slice 3).
  - Once every member has finished, Omni wakes the lead with their replies, and the lead writes the crew report (Q44 covers a member that fails or waits on Ben).
  - The Conductor can seat agents in a delegated thread it creates, in its channel, and never in a #conductor thread (Q45). The server enforces it, since today "never in #conductor" is only charter text.
  - `delegate` does not change: a thread of its own, a task id and a crew report.
  - Teams made before this slice keep their tree.
  - Two parts for one agent (Q42).
- **Conductor.** `delegate_team` changes. `message_thread` may carry agent mentions into threads the Conductor created (Q45). The Conductor's charter and the Thread delegation prompt section change.
- **Docs.** `docs/user/crew.md` Thread delegation, and `docs/user/threads.md` on the job tree.
- **Done when.** `delegate_team` with a lead and three members makes one thread. The three parts run at once, and the lead's crew report reaches the Conductor once all three finish. A Conductor attempt to seat an agent in #conductor is refused.

### Slice 7: iOS

- **Goal.** The iOS app shows and sends what slices 1 to 6 add.
- **Scope.** Author name and avatar on messages, agent mentions in the composer, the members strip, the busiest-state mark with running avatars, collisions in Changes, and remote agents in Settings and Agents once the app has that section (crew plan S8).
- **Needs.** Slice 2 at least, and each later slice before its part. Whether iOS ships inside each slice instead is Q47.

## 5. Open questions

Raised while writing this plan. None is decided. Each names the slice that needs the answer before it starts.

### Identity (slice 1)

- **Q1.** Do the icon and emoji avatars from crew plan S3 stay as an option beside upload and initials? Do built-in agents keep their marks or show initials until Ben uploads one?
- **Q2.** Where does an uploaded image live and how does it sync? Agent files are Markdown synced as `crew_file`, which cannot hold an image. The options include a synced file entity of its own, or the relay's file storage that threads use.
- **Q3.** Which formats and size cap does an upload take, and does Settings crop it?
- **Q4.** Do agent names have to be unique? A mention keeps the id, but two agents both shown as "Builder" read the same in a transcript.

### Members and routing (slice 2)

- **Q5.** Can Ben remove or replace the lead? What happens to a thread whose lead agent is hidden or deleted?
- **Q6.** What does a newly seated member read first? "Every message since its last turn" has no last turn for it. Is it the whole thread up to a budget, or the message that seated it and what that message references?
- **Q7.** What budget caps the context of a member that has been away for many messages, and what does it drop first?
- **Q8.** Can Ben seat an agent without sending it a message, for example by turning **Ask an agent…** into **Add an agent…**, or only by mention?
- **Q9.** Can Ben seat agents in a #conductor thread, or in a quick ask? The decision limits only the Conductor.
- **Q10.** Which agents can be seated: the Conductor, usage-scan and other `delegatable: false` agents, a delegate-only agent, or an agent this machine cannot run?
- **Q11.** How does the `@` menu order agents, machines, files and artifacts, now that agent mentions are not only at the start of a message?
- **Q12.** Removing a member while its turn runs: stop the turn first, or let it finish? What happens to messages queued for it?
- **Q13.** Steering and Stop with several agents running: does a message with no mention steer only the lead, and does Stop stop every running agent or one?
- **Q14.** Handoff, Take over, fork and continue on another harness with several sessions: do they move every agent at once, and are they refused while any member runs?
- **Q15.** Which run does a member get: its agent's run defaults, then the channel's, then Auto on the message that seated it? Can Ben switch one member's run?
- **Q16.** Does a thread with several running agents take one slot per agent from each harness's cap, and does it need a cap of its own?
- **Q17.** In an ordinary delegated thread with members, when does the crew report go: when the lead's turn ends, or once every member is idle?
- **Q18.** Which turn feeds the follow-up suggestion, the title and the Open items card when several agents replied to one message?
- **Q19.** Do older clients (an iOS app or a desktop app on an earlier build) that still send an Ask get the old flow, a refusal, or a seat?

### Parallel runs and collisions (slice 3)

- **Q20.** Can a Cursor Cloud agent be a member? It works on its own cloud checkout and branch, not the thread's worktree. Should Omni refuse it, allow it talk-only, or let it push to the thread's branch?
- **Q21.** How does Omni know which agent changed which file when two run at once in one worktree? Edit tool inputs miss shell commands (codegen, formatters, `npm install`). Today's turn snapshots (`apps/server/turns.ts`) and a file watcher catch those, but a snapshot of the whole checkout holds both agents' edits and cannot tell them apart.
- **Q22.** How is a running agent told? A steer reaches Claude Code and Codex mid-turn. Cursor Agent cannot steer. Does it hear at its next turn, or is its turn interrupted?
- **Q23.** When does a collision flag clear: when Ben dismisses it, at the next commit, or never?
- **Q24.** Two agents running git at once collide on `.git/index.lock`. Does Omni serialize git commands, or do charters leave commits to the lead?
- **Q25.** Turn checkpoints and undo with two agents' changes interleaved in one worktree: per agent, per thread, or off while members run?

### Remote agents as agents (slice 4)

- **Q26.** What happens to existing threads and agents on `hermes` or `custom:<slug>`, including a local agent such as Builder that an agent file binds to a remote server? Migrate them to the remote agent as lead, keep them readable only, or keep them running as they are?
- **Q27.** The built-in Hermes (its URL in Settings, `HERMES_API_KEY`, the id `hermes` that ADR 0017 kept): does it become an agent the same way, and with which id?
- **Q28.** Does Omni still send a remote agent a charter as `instructions`, and who writes it, given that the remote server has its own instructions?
- **Q29.** How does a server offer its avatar: a URL Omni fetches once (under the network rule: https, no redirects, a size cap) or image data in the offer? Is it offered again when the agent reconnects?
- **Q30.** How much of the server shows in the agent's settings with Show technical details off?
- **Q31.** Does a thread led by a remote agent get a worktree at the start, so a local member can be seated later, or only when the first local member is seated, with setup running then?
- **Q32.** A remote agent's own tools on its own server (Hermes works in its own clone and can push to the same repo) are outside Omni. Does anything change for a remote lead or member, or does it stay as today?
- **Q33.** Does Auto still never pick a remote agent for a new thread, now that remote agents are no longer runs?

### Status mark (slices 2 and 3)

- **Q34.** Where do Failed, Stopped, Usage limit, Setup failed and Message held rank against Needs you, Working and Done in "the busiest state"?
- **Q35.** Where do running avatars show: only in the thread's header, or also on Inbox cards, sidebar rows and phone Activity rows, and how many before a +N?

### Remote worktree read (slice 5)

- **Q36.** One switch or two? "No thread excerpts to remote agents" is off by default today, so excerpts flow, while worktree read must start off. Inverting that switch into "Remote agents may read" with two parts (messages, files) changes the default for messages. A second switch keeps it.
- **Q37.** Can a remote agent be seated, or lead, in a channel that keeps excerpts from remote agents? As a member it reads every message since its last turn (ADR 0019).
- **Q38.** Transport: does the remote server call back to Omni (an MCP endpoint reachable over Tailscale or Omni Connect), or does Omni carry the tool through the protocol (a client-side tool in the Runs API and in eve's API)? The Runs API has no tool callback today.
- **Q39.** The read credential: per turn or per thread, and how it is bound to one worktree and revoked.
- **Q40.** What the tool never returns: gitignored files, `.env` files, the channel's worktree copy and shared directories (which can hold secrets), `.git/`, symlinks out of the worktree, and binary or very large files. Is the excluded list fixed or per channel?
- **Q41.** Does the tool read only the files, or also the thread's diff and changed-file list?

### Conductor and teams (slice 6)

- **Q42.** A team today can give two parts to one agent, say two Builder parts. Seating allows one Builder per thread. Does `delegate_team` refuse that, put both parts in one message to that member, or fall back to separate threads?
- **Q43.** Does the lead run a turn on the team's brief before the members start, or wait until all of them finish, as a team lead does today (`apps/server/runner/queue.ts:224`)? Who does the thread's first message name?
- **Q44.** A member that fails, stops or waits on Ben: does the lead wait (and the thread show Needs you), or wake with the replies it has? Is there a time limit?
- **Q45.** Can the Conductor seat further members in a delegated thread it created after its first turn, for example with `message_thread`, or only when it creates the thread? Can `delegate` (not only `delegate_team`) seat members?
- **Q46.** Task ids and crew tools: is there one task id per team thread, or one per part? How do `crew_prs` and `crew_questions` report members?

### Surfaces

- **Q47.** Does iOS ship inside each slice, or as slice 7 after them, as crew plan S8 did?
