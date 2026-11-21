# Group threads and remote agents: build slices

How to build [ADR 0019](../adr/0019-group-threads.md) (threads are group chats with agents) and [ADR 0020](../adr/0020-remote-agents-are-agents.md) (remote agents are agents, with worktree read gated per channel), as six slices in dependency order plus an iOS slice. Task T-9079.

- Status: Ben settled the decisions on 2026-11-20, in a grilling session, and picked the UI the same day from a prototype (section 3.5). Later that day he answered 21 of the questions in section 5, then Q54, Q57 and Q59 to Q68. Each answered one says so. He then answered Q69, the one his answers raised, and the last open questions in a fourth round, with nine left to the builder as defaults he did not pick. No question is open. Nothing is built.
- Surveyed: `main` at `0ce9873b` (desktop 0.1.43). Paths below are on that commit.
- Words: [GLOSSARY.md](../../GLOSSARY.md) as this change leaves it: **lead**, **member**, **seat**, **catch-up**, **agent mention**, **collision** and **remote agent** are new. "Custom harness" stays the code's word for a remote agent's server.

## Summary

- A thread gets a member list. Its first entry is the lead, the agent the thread started as. An agent mention in Ben's message seats an agent as a member with a session of its own in that thread, until Ben removes it.
- A message goes to the agents it names, else to the lead. Several named agents reply in parallel in the thread's one worktree. A new member starts from a catch-up Omni writes with a small model, then reads every message since its own last turn, without tool calls. Only the lead commits, or Ben where the lead is a remote agent.
- Omni tracks which files each agent changed in its turn. It tells running agents what the others changed, and it flags files that two agents both edited.
- Every agent has a name and an avatar, and every message shows who wrote it.
- Hermes and eve agents become remote agents. Their servers stay behind the agent and leave the harness pickers. One channel switch lets them see a thread's messages and read its git-tracked files through a scoped read tool. It is off by default.
- `delegate_team` makes one thread with a lead and members, in place of a tree of threads. Seating replaces Ask for new messages.

## 1. What changes for Ben

| Today | After |
| --- | --- |
| A thread is one agent and one session | A thread has a lead and any number of members, one session each |
| `@agent` at the start of a message starts a thread under this one (Ask) | `@agent` anywhere in a message seats that agent here, and it replies here |
| Messages show "the agent", with the harness logo | Messages show the agent's name and avatar. Harness and model show only with Show technical details on |
| Agent avatars are an icon or an emoji on a color | Ben uploads an image, or keeps an icon or emoji; without any, a colored initials disc |
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

- One member row per agent per thread: thread, agent id, whether it is the lead, when it was seated and when it was removed, its session id, its run (harness, model, effort) and a cursor, the last message it has read. The lead gets a row too, so "every agent in the thread" is one query. The lead's row never changes: the lead is fixed once the thread starts.
- An agent mention is a typed record on the request, as a machine mention is ([Message context](../internals/message-context.md)), not text Omni parses from the message. That way an `@name` an agent types in a reply can never seat anyone, and the pill keeps the agent's id when its name changes.
- Transcript rows gain the id of the agent that wrote them. Ben's rows have none. Older rows read as the lead's.
- The member list is new synced state. It needs a handler in `apps/server/sync/handlers/` and a signed entity like crew files, since seating decides which charter runs in which channel.

### 3.2 Routing and context

- A request with no agent mention goes to the lead. A request with mentions goes to each named member, seating the ones not seated yet, and not to the lead unless it is named.
- An agent's turn opens with every message since its cursor that it did not write: Ben's, the lead's and other members' replies, as data with the author named, and no tool calls or tool output. The cursor moves when the turn starts.
- A newly seated member's first turn opens with a catch-up instead: a summary of the thread so far, which Omni writes with a small model, beside the Haiku sidecars in `apps/server/runner/aux.ts` that write titles and follow-ups (Q6, Q60). The lead does not write it.
- The context is built the way a carryover is (`apps/server/carryover.ts`): framed as data, cut to a budget, with what was left out listed.
- A remote agent in a channel with **Remote agents can see this channel's work** off gets only the message addressed to it: no catch-up and no other agents' replies (Q37).

### 3.3 Parallel turns and collisions

- Each agent's turn runs in its own harness session, on the thread's holder. The thread is running while any of its agents runs.
- Omni records which files each turn changed. The slice decides how (section 5, Q21). When a file shows up in two agents' sets in the same thread, Omni sends each running agent the other's list, and the thread records a collision on that file.
- The Changes view and the transcript show collisions. A flag clears at the lead's next commit, or sooner when Ben dismisses it (Q23).
- Turn checkpoints and undo work per message, across all agents. Undo restores the worktree as it was before that message (Q25).
- Changes shows one combined diff. Omni credits no change to an agent, so the per-agent file sets exist only to raise the collision flags.
- Only the lead commits and opens the pull request. Members edit files only. In a remote-led thread, Omni shows Ben a Commit button for the local members' edits, and Ben commits (Q64).
- A Cursor Cloud member works on its own branch, and its changes come back as a separate diff. When it finishes, the lead pulls its branch into the thread's branch and resolves conflicts (Q63).

### 3.4 Remote agents

- A remote agent is an agent whose run is a custom harness. The harness file, its key and its adapter stay as ADR 0017 and 0018 built them. Settings > Agents shows the server inside the agent, and the pickers stop listing it.
- The worktree read tool is the one Omni tool a remote agent can get. It lists, reads and searches one thread's git-tracked files and returns the thread's diff and changed-file list, through a credential that opens nothing else (Q41). Omni carries it through the protocol as a client-side tool call (Q38).
- One channel switch, **Remote agents can see this channel's work**, gates both the thread's messages and the read tool. It replaces `remote_excerpts_off`.
- Threads on `hermes` or `custom:<slug>` convert to agent-led threads with that remote agent as lead.

### 3.5 UI

Ben picked the UI on 2026-11-20. [ADR 0019](../adr/0019-group-threads.md#how-it-looks) and [ADR 0020](../adr/0020-remote-agents-are-agents.md#how-it-looks) record the picks under How it looks, and the slices below build them.

- The prototype is on the branch `prototype/group-threads`, never merged. `npm run prototype` serves it, and its README says how to switch screens and states. Each screen opens on Ben's pick, with the variants he turned down behind the switcher.
- It draws inside Omni's real channel rail and list panel, on a fake `/api` built from the wire fixtures. Its data, wording and sizes are a starting point, not a spec.
- Questions Q48 to Q58 come from it. Ben answered all of them, and the prototype draws the answers that change a screen: two-letter initials, the join line, the pills, the placeholder and hint, the collision flag's path and the Add remote agent button.

| Screen | Pick | Slice |
| --- | --- | --- |
| Who wrote a reply | Avatar in a 24px gutter, name and time beside it. Initials discs show two unique letters, color only below 18px | 1 |
| Agent mention | One `@` menu with tabs Machines, Agents and Files, opening on Agents (Q11). The placeholder names the lead; once an `@` is typed, a hint line names who gets the message. Agent pills carry the avatar in the agent's own color, machine pills a device icon in the current blue | 2 |
| Joining and leaving | Quiet "Designer joined" and "Designer left" lines in the transcript | 2 |
| Model picker | Changes only the lead's model | 2 |
| Member list | Avatars in the thread header open the list (popover, phone sheet); running agents get a ring, and the header has no Working label. The quick-actions card keeps Lead and Members rows | 2 |
| Parallel turns | A lane per agent, one per tab on the phone, kept as lanes in the history. From three agents the lanes stack, each collapsed to its latest line. The collision flag above shows folder and file, the full path on hover | 3 |
| Mark in a list | Desktop: the avatars are the mark, the one asking first; a failure beside a working agent adds a red dot to the row. Phone: a second line | 3 |
| Remote lead | Quiet labels in the crumbs, the composer, a lock line and the quick-actions card, whose rows match a local thread's, empty where they do not apply | 4 |
| Settings > Agents | An agent page, with Avatar and Server cards. **Add remote agent** next to the agent list | 1, 4 |

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
  - Avatar upload in Settings > Agents, with a default colored initials disc, the color taken from the agent's id. Icon and emoji on a color stay as a third option, and built-in agents keep their marks as their icon (Q1). An upload is PNG, JPEG or WebP up to 2 MB, cropped square from the center and scaled to 256px (Q3, builder default).
  - Agent names are unique, ignoring case, checked when an agent is saved (Q4).
  - The disc's two letters are unique across agents: Researcher RS, Reviewer RV, never both RE (Q48). `monograms()` would give RE and RV, so agents need a rule of their own. Below 18px the disc shows its color only (Q49).
  - Transcript rows record their agent. A one-agent thread shows the lead's name and avatar on its replies.
  - With Show technical details on, the harness and model show beside the name. Off, they do not.
  - The quick-actions card's Agent row, the thread header and the phone's sub line show the avatar beside the name.
  - A reply's author line: the avatar in a 24px gutter, the name and time beside it, one head for replies in a row from one agent (section 3.5).
  - Settings > Agents opens an agent as a page with its avatar on top and an Avatar card (section 3.5). Slice 4 adds the Server card.
- **Sync.** The avatar syncs to every machine with the agent's crew file, the phone included (Q2).
- **Wire.** Thread and message shapes gain the author. Re-record the fixtures that change.
- **Design system.** An agent avatar (image and initials, Q48 and Q49), the gutter author line and the agent page.
- **Docs.** `docs/user/crew.md` Avatar line, `docs/user/threads.md` on how a reply reads.
- **Done when.** An uploaded avatar shows in Settings > Agents, the composer's Agent picker and on every reply of a thread that agent leads, on all three surfaces and on a second synced machine. An agent without one shows its initials disc.

### Slice 2: Members and routing

- **Goal.** Ben seats agents in a thread with an agent mention, and each one answers there in its own session.
- **Scope.**
  - The member list (section 3.1). The members' avatars at the right of the thread header open it as a popover on desktop and a sheet on the phone, with Remove on each member. Removing one closes its session and keeps its replies. A member removed mid-turn finishes that turn, its queued messages are dropped, and the "left" line comes after its reply (Q12). The quick-actions card gets a Lead row and a Members row.
  - **Add an agent** in the member list seats an agent with a joined line and no turn (Q8). Each member's row has its run, which Ben can switch there. A member starts on its agent's run defaults, then the channel's, then Auto (Q15).
  - Ben seats agents in any thread, #conductor threads and quick asks included. A member in a quick ask gets the quick ask's read-only tools (Q9).
  - Any agent except the Conductor can be seated. An agent this machine cannot run is seated, and its turn fails when it runs, saying why (Q10).
  - The lead is fixed once the thread starts, and the list offers no way to change it (Q5). To change the lead, Ben starts a new thread. A thread whose lead agent is hidden or deleted goes read-only (Q59).
  - Running agents' avatars in the header get a ring, and the header drops the Working label (Q54).
  - Seating writes a quiet line in the transcript, "Designer joined" (Q52), and removing a member writes "Designer left" (Q67).
  - Agent mentions in the composer's `@` menu, anywhere in a message, on every composer that can send to a thread. They are typed records on the request. The menu has tabs, **Machines | Agents | Files**, and opens on Agents, which lists the thread's members, then the agents a mention would seat. Artifacts sit in the Files tab under a heading of their own. A tab with nothing in it does not show (Q11).
  - With no `@`, the composer's placeholder names the lead ("Reply to Builder"). Once Ben types an `@`, a hint line under the composer names who gets the message ("Goes to Designer only") and whether it joins (Q50).
  - An agent pill carries the agent's avatar in the agent's own color, its image's main color or its initials disc's color. A machine pill carries a device icon in the current blue (Q53).
  - With several agents in the thread, the composer's model picker changes only the lead's model (Q51).
  - Routing (section 3.2): no mention goes to the lead, mentions go to the named agents only. In this slice, several named agents reply one after another, in the order the message names them. Slice 3 makes them parallel.
  - A newly seated member's first turn opens with a catch-up Omni writes with a small model (Q6, Q60). After that, context since each agent's last turn, with no tool calls (section 3.2). A member away for many messages gets the carryover budget, with the oldest messages as a small-model summary and what was dropped listed (Q7, builder default).
  - Once per thread: a mention of a seated member makes it reply and seats nothing.
  - Agent replies never seat or wake anyone. An `@name` in a reply is plain text.
  - Question cards, approval cards and limit stops name the agent they belong to, and the answer goes to that agent's session.
  - The status mark takes the highest state among the thread's agents: Needs you, then Failed with Usage limit, Setup failed and Message held, then Working, then Done with Stopped, then Idle (Q34, Q61).
  - Ask retires for new messages: `@agent` at the start of a message seats the agent, and **Add an agent** replaces the menu's **Ask an agent…** (Q8). Old Ask cards and their child threads keep rendering. `packages/shared/ask.ts` and its comment go with the composer's Ask chip. An Ask from an older client becomes a seat in the asking thread (Q19, builder default).
  - Every place that reads one session per thread reads one per agent: resume, warm state, the context meter, Compact, limit stops, run switches, handoff and Take over, fork and continue. Handoff, Take over, fork and continue are refused until every agent is idle, and then every session moves together (Q14).
  - After several agents reply to one message, the follow-up suggestion and the Open items card read the lead's reply if it answered, else the last agent to finish. The title stays the first message's (Q18, builder default).
  - In a delegated thread with members, the crew report goes when the lead's turn ends, even if members still run (Q17). Team threads differ (slice 6).
- **Harnesses.** Claude Code, Codex and Cursor Agent as members. Cursor Cloud joins in slice 3, on its own branch (Q20). Hermes and custom harnesses wait for slice 4.
- **Sync.** Member list and authors. A handoff moves every agent's session.
- **Conductor.** `get_thread` and `list_threads` show members. The Conductor cannot seat in this slice. Slice 6 adds that.
- **Wire.** Member list on the thread, author and mentions on messages. Re-record the fixtures.
- **Design system.** Agent mention pill with its avatar, machine mention pill with its device icon, header avatars, member list popover and sheet with Remove, the join line, the composer's hint line.
- **Docs.** Rewrite `docs/user/threads.md` Ask an agent as members, `docs/internals/message-context.md` for the new record kind and `docs/internals/execution-state.md` for several sessions per thread.
- **Done when.** In one thread, Ben seats two agents, a message with no mention gets only the lead's reply, and a message naming both gets a reply from each, which read each other's earlier replies but not their tool calls. Removing one keeps its replies, and its session does not resume. This works on all three surfaces and after a handoff to the other machine.

### Slice 3: Parallel runs and collisions

- **Goal.** Named agents work at the same time in one worktree, and Omni keeps them from stepping on each other unseen.
- **Scope.**
  - Agents named in one message start together. Each turn takes a slot from its own harness's concurrency cap, the rest queue, and a thread has no cap of its own (Q16, builder default).
  - Changed files per turn, per agent, only to raise collision flags. Changes shows one combined diff with no credit per agent (Q21).
  - When two agents in a thread touch the same file, Omni tells each running agent which files the other changed this turn. A harness that cannot steer hears at its next turn (Q22).
  - The thread flags every file both agents edited, in the transcript and in the Changes tab. A flag clears at the lead's next commit, or sooner when Ben dismisses it (Q23).
  - One turn checkpoint per message across all agents. Undo restores the worktree as it was before that message (Q25).
  - While several agents answer one message, the turn splits into a lane per agent with its steps and changed files, the collision flag above the lanes. The lanes stay as lanes in the history after the turn ends (Q55). The phone shows one lane per tab. With three or more agents running, the lanes stack vertically, each collapsed to its latest line (Q62).
  - In the desktop list, a thread where one agent failed while another works shows the working avatar as its mark and a red dot on the row for the failure: Failed outranks Working in the order only (Q68).
  - A collision flag names the file with its folder (`thread/Composer.tsx`) and shows the full path on hover (Q56).
  - In the desktop thread list, the avatars are the mark while agents run or wait on Ben: the one asking first, in the Needs you ring and diamond, then the ones working in the Working ring, two at most, else one and a count. Phone rows say it on their second line. Inbox cards, phone Activity and the Overview dashboard draw the same avatar mark, two at most, else one and a count (Q35).
  - Stop stops every running agent, with no Stop for one agent. A message steers the agents it goes to, so one with no mention steers only the lead (Q13).
  - Only the lead commits and opens the pull request. Members edit files only (Q24).
  - A Cursor Cloud member works on its own branch, and its changes come back as a separate diff (Q20). When it finishes, the lead pulls its branch into the thread's branch and resolves conflicts (Q63).
- **Harnesses.** Claude Code and Codex can be told mid-turn by a steer. Cursor Agent cannot steer, so it hears at its next turn, and its turn is not interrupted (Q22). Cursor Cloud never shares the worktree, so it has no collisions; its diff stays separate.
- **Sync.** Collisions travel with the thread.
- **Design system.** The avatar mark (Needs you and Working), the phone row's second line, lanes and the collision flag.
- **Docs.** `docs/user/threads.md` status marks and Changes, `docs/internals/execution-state.md`.
- **Done when.** Two agents named in one message run at once and both edit `a.ts`. Each is told mid-turn that the other changed it, and the thread flags `a.ts`. The mark shows both avatars while they run and settles to the busiest state after.

### Slice 4: Remote agents as agents

- **Goal.** Connecting Hermes or an eve agent gives Ben an agent, and the server stays behind it.
- **Scope.**
  - The Connect sheet always makes the agent. **Make an agent for it** goes.
  - The offer a server makes when connecting can carry an avatar, as image data up to 256 KB, read again on reconnect unless Ben set one of his own (Q29, builder default). The agent takes its name from the offer, as today.
  - Settings > Agents shows a remote agent's server (address, kind, secret, Test connection, Remove) as a Server card on the agent's page, with an In threads card for where it may read files. Settings > Models > Harnesses stops listing custom harnesses. Hermes becomes a remote agent the same way and keeps the id `hermes`, and its URL and key move under its agent (Q27). With Show technical details off, the Server card shows connection status, Test connection and Remove; address, kind and key show only with it on (Q30). Connect moves into Settings > Agents, as an **Add remote agent** button next to the agent list (Q58).
  - The harness and model pickers list local harnesses only. A local agent can no longer be run on a remote server. Auto never picks a remote agent (Q33).
  - Omni sends a remote agent a charter as `instructions` only when Ben wrote one in its file. Otherwise it sends the thread framing, and the server's own instructions lead (Q28). What a remote agent does with its own tools on its own server does not change (Q32).
  - A thread can start as a remote agent. It leads talk-only, and Ben seats a local member to change files. The thread gets its worktree at the start, so seating a local member needs no setup run (Q31). The thread says so with quiet labels: "talks only" in the crumbs, the composer's placeholder, a lock line under a reply that could not read files, and a Files row in the quick-actions card (section 3.5). The quick-actions card has a local thread's rows, empty where they do not apply to a remote agent (Q57). The machine, folder and branch rows fill from the start, since the worktree does (Q31).
  - In a remote-led thread, local members edit and Omni shows Ben a **Commit** button for their changes. Ben commits (Q64). Opening the pull request can go through the thread's existing Open PR action.
  - A remote agent can be seated as a member and gets context as message text (section 3.2). In a channel with the switch off it can still be seated or lead, but gets only the message addressed to it, with no catch-up and no other agents' replies (Q37).
  - Threads on `hermes` or `custom:<slug>` convert to agent-led threads, with that remote agent as lead, and stay usable (Q26). A local agent whose file binds it to a remote server becomes a remote agent with the same name and avatar (Q65).
- **Harnesses.** Hermes and custom harnesses of both kinds.
- **Sync.** The agent file and harness file sync as today. A new avatar travels as slice 1's do.
- **Conductor.** `list_crew` marks remote agents. `list_harnesses` stops listing them.
- **Design system.** The Server and In threads cards, the Remote tag, the lock line.
- **Docs.** `docs/user/harnesses.md` Custom harnesses and Hermes, `docs/user/crew.md`, and `docs/internals/remote-harness-protocol.md` for the offer's avatar.
- **Done when.** Connecting Nomos makes a Nomos agent with its avatar, which shows in no picker. A thread started as Nomos answers without changing files, and seating Builder in it makes the file change.

### Slice 5: Remote worktree read

- **Goal.** In a channel Ben opens to it, a remote agent can read the thread's files.
- **Scope.**
  - One per-channel switch in Channel settings, **Remote agents can see this channel's work**, covering thread excerpts and worktree reads (Q36). It replaces "No thread excerpts to remote agents". It starts on only in channels where an Ask actually sent an excerpt to a remote agent: an `ask` event with `remote` set and an `excerpt` (`apps/server/ask.ts:168-175`) in one of the channel's threads. Every other channel starts off, new ones included (Q69). Only Ben sets it: an agent thread gets a 403, as it does for `remote_excerpts_off`.
  - The read tool: list, read and search inside one thread's worktree, plus the thread's diff and changed-file list (Q41). It has no writes and no paths outside the worktree, and it never follows a symlink out of it. The diff and list leave untracked and ignored files out, as reads do.
  - Its credential: scoped to one thread's worktree and one turn, revoked when the turn ends, and never a thread token. A random token in memory, keyed to the thread, the turn and the worktree path, kept on Omni's side and revoked at turn end and on server restart (Q39, builder default).
  - Its transport to a server that is not on this machine: Omni carries the tool through the protocol as an optional client-side tool call, with no inbound endpoint (Q38, builder default).
  - Git-tracked files only. Untracked and ignored files are hidden (Q40). Text only, up to 1 MB: binary files are refused, and larger text comes back truncated with a note (Q66).
  - Every read shows as a tool row in the thread.
- **Harnesses.** Runs API servers and eve agents, each by whatever the transport needs from the protocol. `docs/internals/remote-harness-protocol.md` gains it as an optional call, so a server without it keeps working.
- **Docs.** `docs/internals/remote-harness-protocol.md` (What a remote harness does not get), `docs/user/harnesses.md`, `docs/user/configuration.md` for the channel switch, and `docs/user/threads.md` where it names the old excerpt switch.
- **Done when.** With the switch off, a remote agent's read is refused and the thread says why. With it on, the agent reads `src/a.ts` in the thread's worktree and the thread's diff, and a read of `../`, of an untracked or ignored file, of a binary file or after the turn ended is refused. A 3 MB text file comes back cut to 1 MB with a note.

### Slice 6: Conductor and one-thread teams

- **Goal.** A team is one thread in the client channel, and the Conductor seats agents only where it may.
- **Scope.**
  - `delegate_team` makes one thread in the target channel, with the lead and every member seated. The thread's first message is the Conductor's brief to the lead. The lead runs a planning turn on it, then messages each member its part, and the members run in parallel (Q43, slice 3).
  - The lead messages members through a tool only a team lead gets, in its team thread: a typed message to members already seated, which seats no one. An `@name` in a reply stays plain text (see [Where answers met earlier decisions](#where-answers-met-earlier-decisions)).
  - Once every member has finished, Omni wakes the lead with their replies, and the lead writes the crew report. The lead waits while a member waits on Ben, with the thread on Needs you. A failed or stopped member counts as finished, and the lead wakes with the replies there are and the failure. There is no time limit (Q44). The report goes when that turn ends, not when the planning turn ends.
  - The Conductor can seat agents in a delegated thread it creates, in its channel, and never in a #conductor thread. It can seat more with agent mentions in follow-up messages to threads it created (Q45). The server enforces it, since today "never in #conductor" is only charter text. Ben seating agents in #conductor is not limited (Q9).
  - `delegate` takes an optional member list (Q45). Otherwise it does not change: a thread of its own, a task id and a crew report.
  - One task id per team thread. `crew_prs` reports the thread's one pull request, and `crew_questions` names the member that asks (Q46, builder default).
  - Teams made before this slice keep their tree.
  - An agent with two parts gets one seat, and the lead gives it both parts in one message (Q42).
- **Conductor.** `delegate_team` and `delegate` change. `message_thread` may carry agent mentions into threads the Conductor created (Q45). The Conductor's charter and the Thread delegation prompt section change.
- **Docs.** `docs/user/crew.md` Thread delegation, and `docs/user/threads.md` on the job tree.
- **Done when.** `delegate_team` with a lead and three members makes one thread. The lead plans, then messages the three parts, which run at once, and the lead's crew report reaches the Conductor once all three finish. A Conductor attempt to seat an agent in #conductor is refused.

### Slice 7: iOS

- **Goal.** The iOS app shows and sends what slices 1 to 6 add.
- **Scope.** Author name and avatar on messages (avatars reach the phone with the agent's crew file), agent mentions in the composer with the hint line, the join line, the member list sheet, the busiest-state mark with the phone row's second line, a lane per tab for parallel turns, collisions in Changes, and remote agents in Settings and Agents once the app has that section (crew plan S8). The phone layouts in section 3.5 are the starting point.
- **Needs.** Slice 2 at least, and each later slice before its part. iOS ships as this slice, after the other six (Q47).

## 5. Questions

Raised while writing this plan. Ben answered them on 2026-11-20, over four rounds, and each answer says so. Nine he left to the builder (Q3, Q7, Q16, Q18, Q19, Q29, Q38, Q39 and Q46): each carries a builder default the slice starts from. Ben did not pick those, and a slice that finds a better one says so in its PR. None is open. Where an answer met an earlier decision, [Where answers met earlier decisions](#where-answers-met-earlier-decisions) says how the docs resolved it.

### Identity (slice 1)

- **Q1.** Do the icon and emoji avatars from crew plan S3 stay as an option beside upload and initials? Do built-in agents keep their marks or show initials until Ben uploads one? **Answered 2026-11-20:** icon and emoji on a color stay as an avatar option for now, beside upload. An agent with none of them shows the initials disc. Built-in agents keep their marks as their icon until Ben sets another (see [Where answers met earlier decisions](#where-answers-met-earlier-decisions)).
- **Q2.** Where does an uploaded image live and how does it sync? Agent files are Markdown synced as `crew_file`, which cannot hold an image. The options include a synced file entity of its own, or the relay's file storage that threads use. **Answered 2026-11-20:** the avatar syncs to every machine with the agent's crew file, the phone included. Whether the file holds the image inline, as a channel row holds its SVG, or carries it beside it is the slice's call. Q3's builder default stores it inline.
- **Q3.** Which formats and size cap does an upload take, and does Settings crop it? **Builder default 2026-11-20, not Ben's pick:** PNG, JPEG or WebP up to 2 MB, cropped to a square from the center, scaled down to 256px and stored inline with the crew file.
- **Q4.** Do agent names have to be unique? A mention keeps the id, but two agents both shown as "Builder" read the same in a transcript. **Answered 2026-11-20:** yes. Names are unique, ignoring case, and Omni checks when an agent is saved: Builder and builder cannot both exist.

### Members and routing (slice 2)

- **Q5.** Can Ben remove or replace the lead? What happens to a thread whose lead agent is hidden or deleted? **Answered 2026-11-20:** the lead is fixed once the thread starts. To change it, Ben starts a new thread. A lead agent that is hidden or deleted moved to Q59.
- **Q6.** What does a newly seated member read first? "Every message since its last turn" has no last turn for it. Is it the whole thread up to a budget, or the message that seated it and what that message references? **Answered 2026-11-20:** a catch-up summary of the thread on its first turn only, which Omni writes with a small model (Q60 replaced the earlier "written by the lead"). After that, every message since its last turn.
- **Q7.** What budget caps the context of a member that has been away for many messages, and what does it drop first? **Builder default 2026-11-20, not Ben's pick:** the carryover budget (`apps/server/carryover.ts`). Past it, the oldest messages become a small-model summary, as the catch-up is, and the context lists what it dropped.
- **Q8.** Can Ben seat an agent without sending it a message, for example by turning **Ask an agent…** into **Add an agent…**, or only by mention? **Answered 2026-11-20:** yes. **Add an agent** in the member list seats an agent with a joined line and no turn. Its first turn, when a message names it, opens with the catch-up. **Add an agent** replaces the thread menu's **Ask an agent…**.
- **Q9.** Can Ben seat agents in a #conductor thread, or in a quick ask? The decision limits only the Conductor. **Answered 2026-11-20:** yes. Ben seats agents in #conductor threads and in quick asks the same way as in any other thread. (His first answer was no, and he changed it the same day.) The Conductor's own rule does not change: it seats agents only in threads it delegates, never in a #conductor thread. (Changed 2026-11-21: the Conductor now seats agents in its own #conductor thread first; see the ADR 0019 amendment.) A member in a quick ask gets the quick ask's read-only tools (see [Where answers met earlier decisions](#where-answers-met-earlier-decisions)).
- **Q10.** Which agents can be seated: the Conductor, usage-scan and other `delegatable: false` agents, a delegate-only agent, or an agent this machine cannot run? **Answered 2026-11-20:** any agent except the Conductor, usage-scan, other `delegatable: false` agents and delegate-only agents included. The list grays nothing out: an agent this machine cannot run is seated, and its turn fails when it runs, saying why.
- **Q11.** How does the `@` menu order agents, machines, files and artifacts, now that agent mentions are not only at the start of a message? Partly answered on 2026-11-20: agents first (members, then agents a mention would seat), then machines and files. Where artifacts go was still open. **Answered 2026-11-20:** the `@` menu has tabs, **Machines | Agents | Files**. Artifacts sit in the Files tab under a heading of their own. The Agents tab lists the thread's members, then the agents a mention would seat. The menu opens on Agents (see [Where answers met earlier decisions](#where-answers-met-earlier-decisions)).
- **Q12.** Removing a member while its turn runs: stop the turn first, or let it finish? What happens to messages queued for it? **Answered 2026-11-20:** the running turn finishes. The messages queued for that member are dropped, and the "left" line comes after its reply.
- **Q13.** Steering and Stop with several agents running: does a message with no mention steer only the lead, and does Stop stop every running agent or one? **Answered 2026-11-20:** Stop stops every running agent. There is no Stop for one agent. A message steers the agents it goes to under the routing rule, so one with no mention steers only the lead.
- **Q14.** Handoff, Take over, fork and continue on another harness with several sessions: do they move every agent at once, and are they refused while any member runs? **Answered 2026-11-20:** they are refused until every agent in the thread is idle. Then every agent's session moves together.
- **Q15.** Which run does a member get: its agent's run defaults, then the channel's, then Auto on the message that seated it? Can Ben switch one member's run? (The composer's model picker changes only the lead's model, Q51.) **Answered 2026-11-20:** its agent's run defaults, then the channel's, then Auto. Ben can switch one member's run from the member list. The composer's model picker still changes only the lead's (Q51).
- **Q16.** Does a thread with several running agents take one slot per agent from each harness's cap, and does it need a cap of its own? **Builder default 2026-11-20, not Ben's pick:** no thread cap. Each running agent takes one slot from its own harness's cap, and the rest queue.
- **Q17.** In an ordinary delegated thread with members, when does the crew report go: when the lead's turn ends, or once every member is idle? **Answered 2026-11-20:** when the lead's turn ends, even if members are still running. A team thread is the exception (see [Where answers met earlier decisions](#where-answers-met-earlier-decisions)).
- **Q18.** Which turn feeds the follow-up suggestion, the title and the Open items card when several agents replied to one message? **Builder default 2026-11-20, not Ben's pick:** the lead's reply if the lead answered that message, else the reply of the last agent to finish. The title stays the one the first message gave.
- **Q19.** Do older clients (an iOS app or a desktop app on an earlier build) that still send an Ask get the old flow, a refusal, or a seat? **Builder default 2026-11-20, not Ben's pick:** a seat. The server turns an Ask from an older client into an agent mention in the asking thread.

### Parallel runs and collisions (slice 3)

- **Q20.** Can a Cursor Cloud agent be a member? It works on its own cloud checkout and branch, not the thread's worktree. Should Omni refuse it, allow it talk-only, or let it push to the thread's branch? **Answered 2026-11-20:** it can be a member. It works on its own branch, and its changes come back as a separate diff. How that diff reaches the thread's branch moved to Q63.
- **Q21.** How does Omni know which agent changed which file when two run at once in one worktree? Edit tool inputs miss shell commands (codegen, formatters, `npm install`). Today's turn snapshots (`apps/server/turns.ts`) and a file watcher catch those, but a snapshot of the whole checkout holds both agents' edits and cannot tell them apart. **Answered 2026-11-20:** the diff view credits no change to an agent. Changes shows one combined diff, and the collision flags are enough. The slice picks what feeds the flags; it does not have to credit every change.
- **Q22.** How is a running agent told? A steer reaches Claude Code and Codex mid-turn. Cursor Agent cannot steer. Does it hear at its next turn, or is its turn interrupted? **Answered 2026-11-20:** it hears at its next turn. Its turn is not interrupted.
- **Q23.** When does a collision flag clear: when Ben dismisses it, at the next commit, or never? **Answered 2026-11-20:** at the lead's next commit, or sooner if Ben dismisses it. In a remote-led thread, Ben's commit through the Commit button clears it.
- **Q24.** Two agents running git at once collide on `.git/index.lock`. Does Omni serialize git commands, or do charters leave commits to the lead? **Answered 2026-11-20:** only the lead commits and opens the pull request. Members edit files only. Who commits when the lead never changes files moved to Q64.
- **Q25.** Turn checkpoints and undo with two agents' changes interleaved in one worktree: per agent, per thread, or off while members run? **Answered 2026-11-20:** one checkpoint per message, across all agents. Undo restores the worktree as it was before that message.

### Remote agents as agents (slice 4)

- **Q26.** What happens to existing threads and agents on `hermes` or `custom:<slug>`, including a local agent such as Builder that an agent file binds to a remote server? Migrate them to the remote agent as lead, keep them readable only, or keep them running as they are? **Answered 2026-11-20:** threads on `hermes` or `custom:<slug>` convert to agent-led threads, with that remote agent as lead, and stay usable. A local agent whose file binds it to a remote server moved to Q65.
- **Q27.** The built-in Hermes (its URL in Settings, `HERMES_API_KEY`, the id `hermes` that ADR 0017 kept): does it become an agent the same way, and with which id? **Answered 2026-11-20:** it becomes a remote agent the same way and keeps the id `hermes`, so existing threads and links keep working.
- **Q28.** Does Omni still send a remote agent a charter as `instructions`, and who writes it, given that the remote server has its own instructions? **Answered 2026-11-20:** only when Ben wrote a charter in the agent's file. Otherwise it gets Omni's thread framing, and its server's own instructions lead.
- **Q29.** How does a server offer its avatar: a URL Omni fetches once (under the network rule: https, no redirects, a size cap) or image data in the offer? Is it offered again when the agent reconnects? **Builder default 2026-11-20, not Ben's pick:** image data in the offer, up to 256 KB. Omni reads it again on reconnect unless Ben set an avatar of his own.
- **Q30.** How much of the server shows in the agent's settings with Show technical details off? **Answered 2026-11-20:** connection status, Test connection and Remove. Address, kind and key show only with Show technical details on.
- **Q31.** Does a thread led by a remote agent get a worktree at the start, so a local member can be seated later, or only when the first local member is seated, with setup running then? **Answered 2026-11-20:** at the start, so seating a local member later needs no setup run.
- **Q32.** A remote agent's own tools on its own server (Hermes works in its own clone and can push to the same repo) are outside Omni. Does anything change for a remote lead or member, or does it stay as today? **Answered 2026-11-20:** nothing changes. What a remote agent does with its own tools on its own server stays outside Omni, as today.
- **Q33.** Does Auto still never pick a remote agent for a new thread, now that remote agents are no longer runs? **Answered 2026-11-20:** yes, Auto never picks a remote agent. Ben picks one by name.

### Status mark (slices 2 and 3)

- **Q34.** Where do Failed, Stopped, Usage limit, Setup failed and Message held rank against Needs you, Working and Done in "the busiest state"? **Answered 2026-11-20:** Needs you, Failed, Working, Done, Idle. Stopped, Usage limit, Setup failed and Message held moved to Q61.
- **Q35.** Where do running avatars show: only in the thread's header, or also on Inbox cards, sidebar rows and phone Activity rows, and how many before a +N? Partly answered on 2026-11-20: the desktop thread list draws them as the mark, two at most, else one and a count, and phone rows on their second line. Inbox cards, the dashboard and phone Activity were still open. **Answered 2026-11-20:** everywhere the mark shows: Inbox cards, phone Activity and the Overview dashboard too, with two avatars at most, else one and a count.

### Remote worktree read (slice 5)

- **Q36.** One switch or two? "No thread excerpts to remote agents" is off by default today, so excerpts flow, while worktree read must start off. Inverting that switch into "Remote agents may read" with two parts (messages, files) changes the default for messages. A second switch keeps it. **Answered 2026-11-20:** one switch, **Remote agents can see this channel's work**, covering thread excerpts and worktree reads. It starts on only in channels where an Ask actually sent an excerpt to a remote agent, and off everywhere else (Q69).
- **Q37.** Can a remote agent be seated, or lead, in a channel with **Remote agents can see this channel's work** off? As a member it reads every message since its last turn (ADR 0019). **Answered 2026-11-20:** yes, it can be seated or lead. It gets only the message addressed to it: no catch-up and no other agents' replies, as today.
- **Q38.** Transport: does the remote server call back to Omni (an MCP endpoint reachable over Tailscale or Omni Connect), or does Omni carry the tool through the protocol (a client-side tool in the Runs API and in eve's API)? The Runs API has no tool callback today. **Builder default 2026-11-20, not Ben's pick:** Omni carries the tool through the protocol, as an optional client-side tool call in the Runs API and in eve's API. The server never calls back to Omni, so Omni opens no inbound endpoint.
- **Q39.** The read credential: per turn or per thread, and how it is bound to one worktree and revoked. **Builder default 2026-11-20, not Ben's pick:** a random token kept in memory, keyed to the thread, the turn and the worktree path. It stays on Omni's side, since the tool call comes back through the protocol, and is revoked when the turn ends and when the server restarts.
- **Q40.** What the tool never returns: gitignored files, `.env` files, the channel's worktree copy and shared directories (which can hold secrets), `.git/`, symlinks out of the worktree, and binary or very large files. Is the excluded list fixed or per channel? **Answered 2026-11-20:** git-tracked files only, the same in every channel. Untracked and ignored files are hidden, which covers `.git/` and, where they are untracked or ignored, `.env` files and the channel's copied and shared files. Size caps for large or binary tracked files moved to Q66.
- **Q41.** Does the tool read only the files, or also the thread's diff and changed-file list? **Answered 2026-11-20:** the files plus the thread's diff and changed-file list. Both follow Q40's rule, so untracked and ignored files stay out of them too (see [Where answers met earlier decisions](#where-answers-met-earlier-decisions)).

### Conductor and teams (slice 6)

- **Q42.** A team today can give two parts to one agent, say two Builder parts. Seating allows one Builder per thread. Does `delegate_team` refuse that, put both parts in one message to that member, or fall back to separate threads? **Answered 2026-11-20:** the agent gets one seat, and the Conductor gives it both parts in one message.
- **Q43.** Does the lead run a turn on the team's brief before the members start, or wait until all of them finish, as a team lead does today (`apps/server/runner/queue.ts:224`)? Who does the thread's first message name? **Answered 2026-11-20:** the lead runs a planning turn on the brief first, then messages each member its part, and the members run in parallel. The thread's first message is the Conductor's brief to the lead (see [Where answers met earlier decisions](#where-answers-met-earlier-decisions) for how the lead messages members).
- **Q44.** A member that fails, stops or waits on Ben: does the lead wait (and the thread show Needs you), or wake with the replies it has? Is there a time limit? **Answered 2026-11-20:** the lead waits while any member waits on Ben, and the thread shows Needs you. A failed or stopped member counts as finished, so the lead wakes with the replies there are and the failure. There is no time limit.
- **Q45.** Can the Conductor seat further members in a delegated thread it created after its first turn, for example with `message_thread`, or only when it creates the thread? Can `delegate` (not only `delegate_team`) seat members? **Answered 2026-11-20:** yes to both. The Conductor can seat agents with agent mentions in follow-up messages (`message_thread`) to threads it created, and `delegate` takes an optional member list.
- **Q46.** Task ids and crew tools: is there one task id per team thread, or one per part? How do `crew_prs` and `crew_questions` report members? **Builder default 2026-11-20, not Ben's pick:** one task id per team thread. `crew_prs` reports the thread's one pull request, and `crew_questions` names the member that asks.

### Surfaces

- **Q47.** Does iOS ship inside each slice, or as slice 7 after them, as crew plan S8 did? **Answered 2026-11-20:** slice 7, after the other six.

### UI, from the prototype

Raised by the prototype (section 3.5). Each names its slice.

- **Q48.** Initials collide: Reviewer and Researcher are both "RE". Do agents get unique initials, as channels do from `monograms()`, or does Q4 cover initials as well as names? (Slice 1) **Answered 2026-11-20:** two letters, unique across agents: RS and RV, not RE.
- **Q49.** Two letters do not read below about 18px: header avatars, mention pills, list rows and the avatar mark. Does the disc show one letter there, as the prototype does? (Slice 1) **Answered 2026-11-20:** no letters below 18px, the disc's color only.
- **Q50.** When does the hint line under the composer show: always, once Ben starts typing, or only when the message names an agent? The phone's placeholder already says "Reply to Builder". (Slice 2) **Answered 2026-11-20:** the "Goes to X only" hint shows only once Ben types an `@`. With no `@`, the placeholder names the lead, on desktop and phone.
- **Q51.** The composer's run pill shows one harness and model. In a thread with members, whose run does it show, and does switching it change only one member's run (Q15)? (Slice 2) **Answered 2026-11-20:** it changes only the lead's model.
- **Q52.** Does seating write a line in the transcript ("You seated Reviewer and Hermes"), and removing one too? Without one, nothing marks when an agent joined. (Slice 2) **Answered 2026-11-20:** yes, a quiet "Designer joined" line when an agent is seated. A line for removal moved to Q67.
- **Q53.** Agent mention pills use the machine mention pill's blue. Should the two look different? (Slice 2) **Answered 2026-11-20:** an agent pill carries the agent's avatar in the agent's own color, which Ben confirmed. A machine pill carries a device icon in the current blue.
- **Q54.** The header shows the members' avatars and the Working pill side by side. Which one says who is working: the pill naming the agent, or a ring on the running avatars? (Slice 3) **Answered 2026-11-20:** the header avatars only. Running agents get a ring, and the Working label goes.
- **Q55.** What do a turn's lanes become once every agent has finished: do they stay as lanes in the transcript, or fold back into replies with the collision flag kept? How do lanes fit three or more agents on desktop? (Slice 3) **Answered 2026-11-20:** the lanes stay as lanes in the history. Lanes for three or more agents moved to Q62.
- **Q56.** A file name alone misleads (`status.tsx` and `status.ts` in one turn). How much of the path do collision flags and a lane's file list show? (Slice 3) **Answered 2026-11-20:** a collision flag shows the file name and its folder (`thread/Composer.tsx`), and the full path on hover.
- **Q57.** A remote-led thread has no machine, folder or branch for the quick-actions card's top rows. The prototype shows the agent's server and "No worktree until a local agent joins", which assumes an answer to Q31. (Slice 4) **Answered 2026-11-20:** the same rows as a local thread. Rows that do not apply show empty.
- **Q58.** Where does Connect live once remote agents leave Settings > Models? The prototype puts **Connect remote agent** beside **New agent** in Settings > Agents. (Slice 4) **Answered 2026-11-20:** in Settings > Agents, as an **Add remote agent** button next to the agent list.

### Raised by Ben's answers

The parts of a question his answers left open, and the gaps they opened. Each names its slice.

- **Q59.** The lead is fixed. What happens to a thread whose lead agent is hidden or deleted? From Q5. (Slice 2) **Answered 2026-11-20:** the thread goes read-only. Ben starts a new thread to carry on.
- **Q60.** How does the lead write a catch-up: as a turn of its own in the transcript, or out of sight? Does a new member wait while the lead runs a turn of its own, and how long may a catch-up be? (Slice 2) **Answered 2026-11-20:** Omni writes the catch-up with a small model, not the lead. This replaces the lead-written catch-up in Q6.
- **Q61.** Where do Stopped, Usage limit, Setup failed and Message held rank against Needs you, Failed, Working, Done and Idle? From Q34. (Slices 2 and 3) **Answered 2026-11-20:** Usage limit, Setup failed and Message held rank with Failed. Stopped ranks with Done.
- **Q62.** How do lanes fit three or more agents on desktop? From Q55. (Slice 3) **Answered 2026-11-20:** they stack vertically, each collapsed to its latest line.
- **Q63.** How does a Cursor Cloud member's separate diff reach the thread's branch: the lead applies it, Ben merges it, or it stays a pull request of its own? (Slice 3) **Answered 2026-11-20:** when the member finishes, the lead pulls its branch into the thread's branch and resolves conflicts.
- **Q64.** Only the lead commits, and a remote lead never changes files. Who commits in a remote-led thread with a local member that edited files? (Slice 4) **Answered 2026-11-20:** local members edit, Omni shows Ben a Commit button, and Ben commits.
- **Q65.** A local agent, such as Builder, that its agent file binds to a remote server: does it become that remote agent, run locally on its defaults, or stop? From Q26. (Slice 4) **Answered 2026-11-20:** it becomes a remote agent with the same name and avatar.
- **Q66.** What size caps does the read tool put on large or binary tracked files? From Q40. (Slice 5) **Answered 2026-11-20:** text only, with a 1 MB cap. Binary files are refused, and larger text comes back truncated with a note.
- **Q67.** Does removing a member write a line too ("Hermes left")? From Q52. (Slice 2) **Answered 2026-11-20:** yes, a quiet "Designer left" line.
- **Q68.** Failed now ranks above Working, but the desktop list draws avatars as the mark while any agent works. When one agent failed and another still works, does the failed agent's face lead with the Failed mark on it, as Needs you does, or does the plain Failed mark show? From Q34. (Slice 3) **Answered 2026-11-20:** the mark shows the working avatar, and the row adds a red dot for the failure. Failed outranks Working in the order only, not in the mark.
- **Q69.** Excerpts reach remote agents by default today: `remote_excerpts_off` starts at 0, so every channel sends them unless Ben turned the switch on. Read literally, "channels that send excerpts today start with it on" turns worktree reads on in nearly every existing channel, client channels included. Does it mean every channel with `remote_excerpts_off` at 0, or only channels where an Ask actually carried an excerpt to a remote agent? (Slice 5) **Answered 2026-11-20:** only channels where an Ask actually sent an excerpt to a remote agent start with the switch on. Every other channel starts off.

### Where answers met earlier decisions

Some of the last round's answers ran into decisions recorded earlier. This is how the docs resolve each one. Ben can overrule any of them.

- **A team lead messages its members (Q43).** Agents never seat or wake agents, and an `@name` in a reply is plain text, but the team lead has to reach its members. In a team thread, and only there, the lead gets a tool that posts a part to members already seated, as a typed message the way an agent mention is. It seats no one and works in no other thread, and an `@name` in its text stays plain. An agent with two parts gets both in one message from the lead, so Q42's "the Conductor gives it both parts" now means the lead.
- **When a team's crew report goes (Q17, Q43 and Q44).** Q17 sends the report when the lead's turn ends, but a team lead's planning turn ends as its members start. A team thread sends its report when the lead's turn after every member has finished ends. Q17 holds for every other delegated thread with members.
- **`delegate` changes (Q45).** Slice 6 said `delegate` does not change. It now takes an optional member list. The thread of its own, its task id and the crew report stay.
- **Tabs and "agents first" (Q11).** The UI pick put agents first in one list, and the tabs put Machines first. The tabs keep Ben's order, and the menu opens on Agents. A tab with nothing in it, such as Machines outside a Conductor thread, does not show.
- **A remote lead's worktree (Q31 and Q57).** ADR 0020 showed the machine, folder and branch rows empty until a local member worked there, and slice 4's check had a remote-led thread answer "without a worktree". With the worktree made at the start, those rows fill from the start, and the check reads "without changing files". Rows that do not apply to a remote agent, such as its model, show empty.
- **Seating in a quick ask (Q9).** A quick ask has read-only tools and no worktree, while a member edits files. A member seated in a quick ask gets the quick ask's read-only tools, as its lead does, and edits nothing. An agent a quick ask cannot run, such as Cursor Cloud, is seated and fails when it runs (Q10). Builder default: Keep as thread keeps the members, and Make it a task seats them again in the new task thread.
- **A remote agent in a closed channel (Q37).** ADR 0019 gives every new member a catch-up and then every message since its last turn. A remote agent in a channel with **Remote agents can see this channel's work** off gets neither, only the message addressed to it.
- **The read tool's diff (Q41).** A thread's diff can hold a file a member created that nobody has added to git yet, which Q40 hides. The diff and changed-file list leave untracked and ignored files out, so a new file reaches a remote agent once it is staged or committed.
- **Built-in agents' marks (Q1).** Ben kept icon and emoji beside upload and the initials default, and did not name built-in agents. Built-ins keep their marks as their icon until Ben sets another. ADR 0019 no longer drops the S3 icon and emoji avatars.
