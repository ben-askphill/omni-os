# Threads are group chats: agents seated as members

> Decided with Ben on 2026-11-20. Not built yet: [the group threads plan](../plans/2026-11-20-group-threads.md) splits the build into slices and lists what is still open. Until a slice ships, the user docs it names describe what runs.

A thread today is one agent with one harness session. The glossary defined it as "one task's conversation with one agent", and [Ask an agent](../user/threads.md#ask-an-agent) says "Omni never seats a second agent in a thread". Ben has two ways to bring in another agent, and both make another thread. An Ask (`@agent` at the start of a message, or **Ask an agent…** in the thread's menu) starts a thread on that agent under this one. By default it carries an excerpt of up to 6,000 characters, and its answer comes back as a report card. A team (`delegate_team`) is a lead thread plus one member thread per part, drawn as a tree under the Conductor. Ben wants a thread to work as a group chat: several agents in one conversation, each answering when named, working on the same files.

## Decision

- **Every agent has a name and an avatar.** There is no per-agent voice. Ben uploads the avatar in Settings > Agents. Without one, the agent shows a colored disc with its initials. A remote agent can offer its own avatar when it connects ([ADR 0020](0020-remote-agents-are-agents.md)). Every message in a transcript shows the name and avatar of the agent that wrote it. The harness and model show beside them only with **Show technical details** on.
- **The lead.** The agent a thread started as is its lead. A message that names no agent goes to the lead.
- **Seating.** An agent mention (`@agent`) in Ben's message seats that agent in the thread as a **member**, for good, with a session of its own in that thread. It stays until Ben removes it from the thread's member list. Removing it closes its session and keeps its past replies in the transcript.
- **Once per thread.** An agent is seated in a thread at most once. Naming a member again makes it reply. It never seats a second copy.
- **Routing.** A message that names one or more agents goes to each of them, and they reply in parallel. The lead stays quiet unless the message names it too.
- **What a member reads.** On each turn, an agent gets every message posted since its own last turn as context: Ben's, the lead's and the other members'. It never gets their tool calls or tool output.
- **One worktree, parallel turns, own powers.** Every agent in a thread works in the thread's one worktree and branch. Their turns run at the same time, and each agent keeps its own powers and run. When two agents touch the same file, Omni tells each running agent which files the other changed this turn. The thread flags every file both of them edited (a **collision**).
- **Agents do not seat agents.** An `@name` in an agent's reply is plain text. It seats no one and wakes no one. The one exception is the Conductor. It can seat agents, but only in a delegated thread it creates in the client channel, never in its own #conductor thread.
- **A team is one thread.** `delegate_team` makes a single thread in the client channel, with a lead and the members seated. The Conductor posts each member's part as a message that names that member. The members run in parallel. Once every one of them has finished, Omni wakes the lead with their replies, and the lead writes the crew report. Ordinary delegation does not change: `delegate` still makes a thread of its own with a task id and a crew report.
- **The status mark shows the busiest agent.** A thread's mark is Needs you when any of its agents waits on Ben, else Working when any of them runs, else Done. Avatars on the mark show which agents are running.
- **Seating replaces Ask for new messages.** An agent mention no longer starts a thread under this one with a report card. Asks already sent stay readable as they are.

## Supersedes

- `GLOSSARY.md`: Thread (one agent), Turn, Session, Run, Ask, Team, Crew report and Mention. This change rewrites them and adds Lead, Member, Seat, Agent mention and Collision.
- [Ask an agent](../user/threads.md#ask-an-agent) in `docs/user/threads.md`: "Omni never seats a second agent in a thread", the Ask chip, the thread excerpt and the report card, for new messages. The section changes when the members slice ships.
- A team as a lead thread with one member thread per part, in `docs/user/crew.md` (Thread delegation) and in `docs/user/threads.md` ("A team's members sit under their lead", "Team of 7"). Teams already made keep their tree.
- Agents without an uploaded avatar: the crew plan's S3 build note ([user-defined crew plan](../plans/2026-11-18-user-defined-crew.md), section 6.3, "no SVG upload") and the Avatar line in [Settings > Agents](../user/crew.md#settings--agents). These change when the identity slice ships.

## Considered

The reasons below follow from Ben's decisions. The session that settled them did not record a reason for each option it turned down.

- **Keep Ask, and show its answer inline.** The answer would still come from a session that saw only an excerpt, framed as data, and every follow-up would need another Ask. A seated member keeps its session and reads the thread as it grows.
- **A worktree per member.** Two agents could not build on each other's changes without merging branches, and one thread would carry several branches and pull requests. One worktree keeps one branch and one diff per thread. The cost is collisions, which the warnings and flags make visible.
- **Members taking turns.** Naming several agents is a request for several answers. Taking turns makes each one wait for the slowest.
- **Agents mentioning each other.** Two agents could wake each other back and forth with nobody reading, and the work would leave Ben's hands. The Conductor's exception is bounded the way delegation already is: threads it creates, in a client channel.
- **Members see tool calls.** Tool output is most of a turn's size, and it would fill every member's context. A member that needs the files reads the shared worktree.
- **Several copies of one agent.** `@builder` would no longer name one agent, and two sessions with one charter would split one role's work.
- **A lead that hears every message.** It would answer messages meant for members and spend a turn on each one.

## Consequences

- A thread has one session per seated agent. Everything that assumes one session per thread moves to one per agent in the thread: resume, warm state, the context meter, limit stops, switching a run, handoff to another machine and fork.
- Transcript rows record the agent that wrote them, and the member list syncs to the other machines.
- Each member's spawn gets a thread token of its own ([ADR 0016](0016-thread-bound-credentials.md)). An agent's `access` still only narrows the channel's access level ([ADR 0015](0015-access-levels.md)).
- A harness that cannot work in the thread's worktree cannot be a member that changes files. Cursor Cloud works on its own cloud checkout. The plan lists this as open.
