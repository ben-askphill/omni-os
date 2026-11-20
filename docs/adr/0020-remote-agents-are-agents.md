# Remote agents are agents, and read the worktree only where the channel allows

> Decided with Ben on 2026-11-20. Not built yet: slices 4 and 5 of [the group threads plan](../plans/2026-11-20-group-threads.md). Until they ship, [ADR 0017](0017-custom-harnesses.md), [ADR 0018](0018-eve-agents.md) and [Custom harnesses](../user/harnesses.md#custom-harnesses) describe what runs.

[ADR 0017](0017-custom-harnesses.md) made a remote agent Ben registers a custom harness: a file whose id is `custom:<slug>`, listed in the harness and model pickers, with an agent bound to it by `harness: custom:<slug>`. [ADR 0018](0018-eve-agents.md) added eve agents as `kind: eve`. The Connect sheet already makes an agent of the same id by default (**Make an agent for it**). So Ben meets one server twice, once as a harness to pick and once as an agent. ADR 0017 also gave a remote agent nothing but Omni's prompt: "no channel or global secret, no install or thread token, no Omni tools". In a group thread ([ADR 0019](0019-group-threads.md)), a remote agent can sit next to local agents that change files, and Ben wants it to be able to read them.

## Decision

- **Connecting makes an agent.** Connecting Hermes or an eve agent creates an agent with a name and an avatar: the avatar the agent offers when it connects, else the initials disc. The agent is what connecting is for, so it is no longer an option on the sheet.
- **Its server is a detail of the agent.** A remote agent leaves the harness and model pickers. Its server (address, kind, key and cap, today's harness file) stays underneath and shows only in that agent's settings. No local agent's thread can be pointed at a remote server.
- **A remote agent can lead, talk-only.** A thread started as a remote agent has it as its lead. It never changes the thread's files. When files need changing, Ben seats a local member with an agent mention. Like any agent, a remote agent can also be seated as a member ([ADR 0019](0019-group-threads.md)).
- **Worktree read, per channel, off by default.** In a channel that allows it, Omni gives the remote agents in that channel's threads a read tool scoped to the thread's worktree. It lists, reads and searches files there and nothing else: no writes, nothing outside the worktree. The switch is per channel and off by default, so a client channel stays closed until Ben turns it on. Only Ben sets it: an agent thread cannot, as it cannot change "No thread excerpts to remote agents" today. It reuses or extends that switch. Which one is open in the plan.
- **What ADR 0017 keeps.** Keys stay on the server. The network rule stands, and so does syncing the file but not the key. Only Ben adds, changes or removes a remote agent. A remote agent still gets no channel or global secret, no install token, no Omni tools besides the read tool, and no way to write.

## Supersedes

- ADR 0017: "The UI calls it a custom harness (E1)" (the UI calls it a remote agent), and "A remote agent gets nothing else (E6, E7, E9)" (except the read tool, in a channel that allows it). Its Not yet list's "remote mark in pickers" goes too, since there are no pickers to mark.
- ADR 0018: eve agents "connect as custom harnesses". They connect as remote agents, through the same eve API.
- `GLOSSARY.md`: Custom harness and eve agent. This change replaces them with Remote agent and eve agent.
- [Custom harnesses](../user/harnesses.md#custom-harnesses) in `docs/user/harnesses.md` (the Harnesses card list, **Make an agent for it**, "An agent binds to it by id" and "What it runs like") and [What a remote harness does not get](../internals/remote-harness-protocol.md#what-a-remote-harness-does-not-get) ("No Omni MCP tools … worktree"). Both change when slices 4 and 5 ship.
- The user-facing half of the crew plan's runtime binding ([user-defined crew plan](../plans/2026-11-18-user-defined-crew.md), section 2.5: an outside agent "joins the harness catalog under its id"). The binding stays in the code. Ben no longer picks it.

## Considered

The reasons below follow from Ben's decisions. The session that settled them did not record a reason for each option it turned down.

- **Keep a remote server as a harness with an agent on top**, as today. Ben meets one server twice. A local agent's charter, run on a remote server, also loses the tools it was written for: the browser, Omni's tools and the worktree.
- **Put the changed files in the prompt.** The prompt would grow on every turn and carry files whether the agent needs them or not. A read tool fetches only what the agent asks for, and only where the channel allows it.
- **A thread token or Omni's MCP tools for remote agents.** An outside server would get the API a local thread has. The read tool is the only door, and it opens on one worktree.
- **Worktree read on by default.** A client channel's files would reach an outside server before Ben had decided they may.

## Consequences

- The harness file, the key handling and the Runs API and eve adapters stay. What changes is where Ben sees them and what Omni offers a remote agent.
- Omni has to serve the read tool to a server that is not on this machine. That needs a transport and a credential narrower than a thread token. The plan lists both as open.
- A remote agent with worktree read can see whatever the worktree holds, including files the channel copies or links into it. The plan lists the exclusions to decide.
- A remote agent in a channel that holds excerpts back still reads the thread's messages once it is seated, since every member does ([ADR 0019](0019-group-threads.md)). How the two rules meet is open in the plan.
