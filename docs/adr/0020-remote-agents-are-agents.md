# Remote agents are agents, and read the worktree only where the channel allows

> Decided with Ben on 2026-11-20. Not built yet: slices 4 and 5 of [the group threads plan](../plans/2026-11-20-group-threads.md). Until they ship, [ADR 0017](0017-custom-harnesses.md), [ADR 0018](0018-eve-agents.md) and [Custom harnesses](../user/harnesses.md#custom-harnesses) describe what runs.

[ADR 0017](0017-custom-harnesses.md) made a remote agent Ben registers a custom harness: a file whose id is `custom:<slug>`, listed in the harness and model pickers, with an agent bound to it by `harness: custom:<slug>`. [ADR 0018](0018-eve-agents.md) added eve agents as `kind: eve`. The Connect sheet already makes an agent of the same id by default (**Make an agent for it**). So Ben meets one server twice, once as a harness to pick and once as an agent. ADR 0017 also gave a remote agent nothing but Omni's prompt: "no channel or global secret, no install or thread token, no Omni tools". In a group thread ([ADR 0019](0019-group-threads.md)), a remote agent can sit next to local agents that change files, and Ben wants it to be able to read them.

## Decision

- **Connecting makes an agent.** Connecting Hermes or an eve agent creates an agent with a name and an avatar: the avatar the agent offers when it connects, else the initials disc. The agent is what connecting is for, so it is no longer an option on the sheet. Connect moves into Settings > Agents, as an **Add remote agent** button next to the agent list.
- **Its server is a detail of the agent.** A remote agent leaves the harness and model pickers. Its server (address, kind, key and cap, today's harness file) stays underneath and shows only in that agent's settings. No local agent's thread can be pointed at a remote server.
- **A remote agent can lead, talk-only.** A thread started as a remote agent has it as its lead. It never changes the thread's files. When files need changing, Ben seats a local member with an agent mention. Like any agent, a remote agent can also be seated as a member ([ADR 0019](0019-group-threads.md)).
- **One switch per channel, off by default.** **Remote agents can see this channel's work** covers both thread excerpts and worktree reads, and replaces "No thread excerpts to remote agents". It is off by default, so a client channel stays closed until Ben turns it on. Only Ben sets it: an agent thread cannot, as it cannot change the excerpt switch today.
- **Worktree read, git-tracked files only.** In a channel with the switch on, Omni gives the remote agents in that channel's threads a read tool scoped to the thread's worktree. It lists, reads and searches the worktree's git-tracked files and nothing else: no writes, nothing outside the worktree. Untracked and ignored files are hidden.
- **Existing threads convert.** Threads on `hermes` or a `custom:<slug>` harness become agent-led threads, with that remote agent as their lead, and stay usable.
- **What ADR 0017 keeps.** Keys stay on the server. The network rule stands, and so does syncing the file but not the key. Only Ben adds, changes or removes a remote agent. A remote agent still gets no channel or global secret, no install token, no Omni tools besides the read tool, and no way to write.

## How it looks

Ben picked these on 2026-11-20 from the same prototype as [ADR 0019](0019-group-threads.md#how-it-looks) (branch `prototype/group-threads`, never merged).

- **An agent is a page.** In Settings > Agents, an agent opens as a page of its own, its avatar large on top. Avatar is a card on it. A remote agent's page adds a Server card (address, kind, key, how many turns at once, Test connection and Remove) and an In threads card that says where it may read files. A local agent's page has its run and powers, as today's editor does.
- **A remote lead says so quietly.** Each fact sits where it matters, with no banner. The crumbs read "Hermes · talks only", and the composer's placeholder says a local agent changes files. A reply that could not read files ends with a lock line ("Remote agents can't read files in #Volero") linking Channel settings. The quick-actions card has a Files row ("Can't read or change", or "Can read, can't change" where the channel allows it).

## Supersedes

- ADR 0017: "The UI calls it a custom harness (E1)" (the UI calls it a remote agent), and "A remote agent gets nothing else (E6, E7, E9)" (except the read tool, in a channel that allows it). Its Not yet list's "remote mark in pickers" goes too, since there are no pickers to mark.
- ADR 0018: eve agents "connect as custom harnesses". They connect as remote agents, through the same eve API.
- `GLOSSARY.md`: Custom harness and eve agent. This change replaces them with Remote agent and eve agent.
- **No thread excerpts to remote agents** in Channel settings ([Ask an agent](../user/threads.md#ask-an-agent)), which **Remote agents can see this channel's work** replaces, with the default turned around: off means nothing goes.
- [Custom harnesses](../user/harnesses.md#custom-harnesses) in `docs/user/harnesses.md` (the Harnesses card list, **Make an agent for it**, "An agent binds to it by id" and "What it runs like") and [What a remote harness does not get](../internals/remote-harness-protocol.md#what-a-remote-harness-does-not-get) ("No Omni MCP tools … worktree"). Both change when slices 4 and 5 ship.
- The user-facing half of the crew plan's runtime binding ([user-defined crew plan](../plans/2026-11-18-user-defined-crew.md), section 2.5: an outside agent "joins the harness catalog under its id"). The binding stays in the code. Ben no longer picks it.

## Considered

The reasons below follow from Ben's decisions. The session that settled them did not record a reason for each option it turned down.

- **Keep a remote server as a harness with an agent on top**, as today. Ben meets one server twice. A local agent's charter, run on a remote server, also loses the tools it was written for: the browser, Omni's tools and the worktree.
- **Put the changed files in the prompt.** The prompt would grow on every turn and carry files whether the agent needs them or not. A read tool fetches only what the agent asks for, and only where the channel allows it.
- **A thread token or Omni's MCP tools for remote agents.** An outside server would get the API a local thread has. The read tool is the only door, and it opens on one worktree.
- **Worktree read on by default.** A client channel's files would reach an outside server before Ben had decided they may.
- **Two switches, one for excerpts and one for files.** Ben chose one switch for both.
- **Every file in the worktree.** Untracked and ignored files are where secrets and the channel's copied files sit, so the tool shows git-tracked files only.
- **Other layouts.** The prototype also drew the agent editor as today's modal with the server folded at its foot, and a remote lead's limits as a notice card on top of the thread. Ben did not record why he turned them down.

## Consequences

- The harness file, the key handling and the Runs API and eve adapters stay. What changes is where Ben sees them and what Omni offers a remote agent.
- Omni has to serve the read tool to a server that is not on this machine. That needs a transport and a credential narrower than a thread token. The plan lists both as open.
- The read tool sees git-tracked files only, so `.env` files, the channel's copied and shared files and anything else untracked or ignored stay hidden. Size caps for large or binary tracked files are open in the plan.
- Every channel starts with the switch off, including channels whose excerpts reach remote agents today.
- A remote agent seated in a channel with the switch off would still read the thread's messages as a member does ([ADR 0019](0019-group-threads.md)). How the two rules meet is open in the plan.
- A remote lead never changes files, and only the lead commits ([ADR 0019](0019-group-threads.md)). A remote-led thread with a local member therefore has no agent that commits. The plan lists this as open.
