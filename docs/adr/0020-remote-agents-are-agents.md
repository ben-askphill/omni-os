# Remote agents are agents, and read the worktree only where the channel allows

> Decided with Ben on 2026-11-20. Slices 4 and 5 of [the group threads plan](../plans/2026-11-20-group-threads.md) built it: slice 4 the remote agents, slice 5 the switch and the read tool ([the read call](../internals/remote-harness-protocol.md#the-read-call)). [Remote agents](../user/crew.md#remote-agents) describes what runs.

[ADR 0017](0017-custom-harnesses.md) made a remote agent Ben registers a custom harness: a file whose id is `custom:<slug>`, listed in the harness and model pickers, with an agent bound to it by `harness: custom:<slug>`. [ADR 0018](0018-eve-agents.md) added eve agents as `kind: eve`. The Connect sheet already makes an agent of the same id by default (**Make an agent for it**). So Ben meets one server twice, once as a harness to pick and once as an agent. ADR 0017 also gave a remote agent nothing but Omni's prompt: "no channel or global secret, no install or thread token, no Omni tools". In a group thread ([ADR 0019](0019-group-threads.md)), a remote agent can sit next to local agents that change files, and Ben wants it to be able to read them.

## Decision

- **Connecting makes an agent.** Connecting Hermes or an eve agent creates an agent with a name and an avatar: the avatar the agent offers when it connects, else the initials disc. The agent is what connecting is for, so it is no longer an option on the sheet. Connect moves into Settings > Agents, as an **Add remote agent** button next to the agent list. The built-in Hermes becomes a remote agent the same way and keeps the id `hermes`.
- **Its server is a detail of the agent.** A remote agent leaves the harness and model pickers. Its server (address, kind, key and cap, today's harness file) stays underneath and shows only in that agent's settings: connection status, Test connection and Remove, with address, kind and key only when **Show technical details** is on. No local agent's thread can be pointed at a remote server, and Auto never picks a remote agent.
- **A remote agent can lead, talk-only.** A thread started as a remote agent has it as its lead, and gets its worktree at the start. The remote agent never changes the thread's files. When files need changing, Ben seats a local member with an agent mention. The local members edit, Omni shows Ben a **Commit** button, and Ben commits. Like any agent, a remote agent can also be seated as a member ([ADR 0019](0019-group-threads.md)).
- **What Omni tells it.** Omni sends a remote agent a charter as `instructions` only when Ben wrote one in its agent file. Otherwise it sends the thread framing, and the server's own instructions lead. What the agent does with its own tools on its own server stays outside Omni, as today.
- **One switch per channel.** **Remote agents can see this channel's work** covers both thread excerpts and worktree reads, and replaces "No thread excerpts to remote agents". Only channels where an Ask actually sent an excerpt to a remote agent start with it on. Every other channel starts with it off, new channels included, so a client channel stays closed until Ben turns it on. Only Ben sets it: an agent thread cannot, as it cannot change the excerpt switch today. With the switch off, a remote agent can still be seated or lead, but it gets only the message addressed to it, with no catch-up and no other agents' replies.
- **Worktree read, git-tracked files only.** In a channel with the switch on, Omni gives the remote agents in that channel's threads a read tool scoped to the thread's worktree. It lists, reads and searches the worktree's git-tracked files, and returns the thread's diff and changed-file list, and nothing else: no writes, nothing outside the worktree. The diff and list leave out what the reads leave out. Untracked and ignored files are hidden. It reads text only, up to 1 MB: a binary file is refused, and a larger text file comes back cut to 1 MB with a note saying so.
- **Existing threads and agents convert.** Threads on `hermes` or a `custom:<slug>` harness become agent-led threads, with that remote agent as their lead, and stay usable. A local agent whose file binds it to a remote server becomes a remote agent with the same name and avatar.
- **What ADR 0017 keeps.** Keys stay on the server. The network rule stands, and so does syncing the file but not the key. Only Ben adds, changes or removes a remote agent. A remote agent still gets no channel or global secret, no install token, no Omni tools besides the read tool, and no way to write.

## How it looks

Ben picked these on 2026-11-20 from the same prototype as [ADR 0019](0019-group-threads.md#how-it-looks) (branch `prototype/group-threads`, never merged).

- **An agent is a page.** In Settings > Agents, an agent opens as a page of its own, its avatar large on top. Avatar is a card on it. A remote agent's page adds a Server card (connection status, Test connection and Remove, plus address, kind, key and how many turns at once with Show technical details on) and an In threads card that says where it may read files. A local agent's page has its run and powers, as today's editor does.
- **A remote lead says so quietly.** Each fact sits where it matters, with no banner. The crumbs read "Hermes · talks only", and the composer's placeholder says a local agent changes files. A reply that could not read files ends with a lock line ("Remote agents can't read files in #Volero") linking Channel settings. The quick-actions card has a Files row ("Can't read or change", or "Can read, can't change" where the channel allows it).
- **The details panel matches a local thread's.** A remote-led thread's quick-actions card has the same rows as a local one. The worktree exists from the start, so the machine, folder and branch rows fill in. Rows that do not apply to a remote agent show empty.

## Supersedes

- ADR 0017: "The UI calls it a custom harness (E1)" (the UI calls it a remote agent), and "A remote agent gets nothing else (E6, E7, E9)" (except the read tool, in a channel that allows it). Its Not yet list's "remote mark in pickers" goes too, since there are no pickers to mark.
- ADR 0018: eve agents "connect as custom harnesses". They connect as remote agents, through the same eve API.
- `GLOSSARY.md`: Custom harness and eve agent. This change replaces them with Remote agent and eve agent.
- **No thread excerpts to remote agents** in Channel settings ([Ask an agent](../user/threads.md#ask-an-agent)), which **Remote agents can see this channel's work** replaces. Off now means nothing goes, and a channel keeps sending excerpts only if an Ask there has already sent one to a remote agent.
- Custom harnesses in `docs/user/harnesses.md` (the Harnesses card list, **Make an agent for it**, "An agent binds to it by id" and "What it runs like"), now [Remote agents' servers](../user/harnesses.md#remote-agents-servers), and [What a remote harness does not get](../internals/remote-harness-protocol.md#what-a-remote-harness-does-not-get) ("No Omni MCP tools … worktree"), which changes when slice 5 ships.
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
- Omni has to serve the read tool to a server that is not on this machine. That needs a transport and a credential narrower than a thread token. The plan gives builder defaults for both (Q38 and Q39): Omni carries the tool through the protocol, and the credential is a per-turn token that stays on Omni's side.
- The read tool sees git-tracked files only, so `.env` files, the channel's copied and shared files and anything else untracked or ignored stay hidden. Binary files are refused, and text over 1 MB comes back truncated with a note.
- Excerpts reach remote agents by default today, so nearly every channel could send them. The switch starts on only where an Ask actually did, which Omni reads from past `ask` events. A channel that never sent a remote agent anything, client channels included, starts closed.
- A remote agent seated in a channel with the switch off does not read the thread's messages as a member does ([ADR 0019](0019-group-threads.md)). It gets only the message addressed to it.
- A remote-led thread sets up its worktree when it starts, even if no local member ever joins.
- A remote lead never changes files, and only the lead commits ([ADR 0019](0019-group-threads.md)), so Ben commits a remote-led thread's changes himself through the Commit button.
