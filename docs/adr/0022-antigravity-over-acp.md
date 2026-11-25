# Antigravity runs over ACP, on the user's own signed-in `agy`

> Decided with Ben on 2026-11-24 in spec #977. Not built yet: tickets #978 (skeleton), #979 (turns and models), #980 (permissions) and #981 (MCP and Notion) build it, and #982 (allowances) is closed as not planned. [Not proven yet](#not-proven-yet) lists what still has to be checked on a real `agy`. Each ticket proves its part first and reports on the ticket if the answer changes the plan.

Ben pays for Google AI Pro and wants Gemini 4 Neon in Omni, mainly for writing work such as the Writer agent. Omni had no way to reach it on that plan. Cursor Agent lists Gemini models, but only behind Cursor's paid credits, so a Neon thread there bills Cursor and not the Google plan. The earlier plan of calling Gemini through the Vertex API would bill a Google Cloud project per token, and Omni would have had to run its own agent loop with tools, permissions and MCP, which is the work the harness CLIs already do.

Google's Antigravity CLI, `agy`, has the whole agent loop (tools, MCP, skills, sub-agents), speaks the Agent Client Protocol (ACP) over stdio with `agy acp`, and bills the Google account it is signed in with. T3 Code already drives it over ACP, which gave the spec a reference for the protocol's shape and its traps.

## Decision

### A full local harness over ACP

- **`agy acp` is the harness.** A new built-in harness id, `antigravity`, named Antigravity, billing the Google AI plan, beside Claude Code, Codex and Cursor Agent. Any thread, channel default, automation or agent can run on it. Nothing in code ties it to the Writer: to run the Writer on it, Ben sets the Writer's run defaults, and to make it read only, its access (`access: read`).
- **The first harness whose turns run over ACP.** Cursor Agent's turns use print mode with stream-json, and only its command probe speaks ACP. One `agy acp` process per thread session stays up between turns (`warmProcess`), as Codex's app server does.
- **Omni's own ACP client.** A small JSON-RPC client over stdio, written the way the Codex client is. It advertises no file system and no terminal capabilities, so agy runs its own tools (T3 Code found that advertising file writes makes agy switch to whole-file edits). A request Omni does not handle gets -32601.
- **What it does and does not do.** Stop sends `session/cancel` and keeps the session (`interrupt: true`). A message sent mid-turn waits for the next turn (`steer: false`), as on Cursor Agent. Images go inline. Omni never sends a compact command, because ACP passes `/compact` to the model as plain text. agy's own conversation cannot be rewound; Omni's file checkpoints and undo work as on any harness. Its concurrency cap is `OMNI_MAX_CONCURRENT_ANTIGRAVITY`, 12 by default.
- **Resume with `session/resume`, never `session/load`.** `session/load` replays the history's tool calls into the thread. A failed resume starts a new session with a handover from the transcript, as a harness switch does. Omni's context (charter, channel facts, artifacts folder, tool-failure rule) goes as `systemPrompt.append` on every new session and every resume, because agy does not keep it, or ahead of the first message when agy does not advertise it.

### Bring your own `agy`, behind one state reader

- **The user installs and signs in.** Ben installs `agy` and signs in with Google once per machine, in a terminal. Omni finds it as `OMNI_ANTIGRAVITY_BIN`, then `agy` on `PATH`, then `antigravity` on `PATH`. T3 Code's managed release folders and the legacy `agy_acp_server` are not looked for.
- **One reader says what state it is in.** Not installed, too old, signed out, no Antigravity subscription, not answering, or ready, with the binary, version, reason and fix. The model picker, Settings > Models, Settings > Accounts, the Conductor's `delegate` errors and the skills hint all read it. Today a bring-your-own `agy` sits behind it. A managed install or a sign-in from inside Omni can replace what is behind it later without touching its callers.
- **The version comes from `initialize`.** `agentInfo.version`, with the `agy_acp_server_` prefix removed, as T3 Code reads it; Omni does not run `agy --version`. The minimum is 1.5.1: older runtimes hide non-Gemini models from clients not on Google's allowlist. A major version above 1 stays available, with a note that Omni was not tested on it.
- **Checks are rare.** Starting `agy` is heavy, so Omni checks at server start, on Check again and Check for new models, on demand while the harness is down (at most every 10 seconds), and when a thread session starts. The 15-minute catalog timer skips it. A check runs in a scratch folder and removes only the conversation files agy wrote for its own session.
- **Omni never opens a browser.** agy's `BROWSER` points at a helper that records the link and opens nothing. A sign-in link seen in a check reads as signed out; seen in a turn, it fails the turn with the sign-in step.

### The Google account, and nothing else

- **Only the Google account method.** After `initialize`, Omni calls `authenticate` with `oauth-personal`. It never uses the API key, Gemini Enterprise or Agent Platform methods agy also offers, so a thread never bills anything but the Google AI plan.
- **The environment guard strips what would move it.** `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_CLOUD_QUOTA_PROJECT`, `GOOGLE_GENAI_USE_VERTEXAI`, `GCLOUD_PROJECT`, `CLOUDSDK_CORE_PROJECT` and `AGY_ACP_CCPA_PROJECT` are dropped, over a channel or global secret of the same name, as for the other harnesses. `GEMINI_HOME` stays, because it says where the user's own sign-in lives. On Linux, an unset `SSL_CERT_FILE` gets the system CA bundle, which T3 Code found agy needs.

### Every permission request goes through the gate

- **Omni answers every `session/request_permission`.** agy stays in its default mode. At Full access, for an agent with full tools, Omni allows at once. Below Full access, or for an agent with limited tools, each request goes through the channel's permission gate, with the same approval cards, grants and dismiss-on-end as Claude Code and Codex. `read`, `search`, `think` and `fetch` run; `edit`, `delete` and `move` are file edits of each path; `execute` is a shell command judged by the read-only command rule; an MCP call is `mcp__<server>__<tool>`, so connector levels and Off apply; a sub-agent launch runs only at Full access until the proof shows its calls are asked about one by one; anything else is an unknown tool.
- **Omni's grants stay the only standing yes.** Omni answers `allow_once` and `reject_once`, never `allow_always`. agy's own multiple-choice questions (tool call ids starting `interaction_`) become question cards with its options.
- **Agents with limited tools** also get agy's edit tools, and for read-only agents its command tool, in `disabledTools` on `session/new`, the same belt and braces as Claude Code's denied tools.
- **The tripwire.** Below Full access, or for an agent with limited tools, a `tool_call` of kind `edit`, `delete`, `move` or `execute` that arrives with no permission request before it means agy ran it on its own. Omni stops the turn, names the tool and records a tool failure.
- **The `toolLimits` fallback.** `toolLimits` starts false, so Antigravity is refused below Full access and for agents with limited tools, as Hermes is. It turns true only when a live proof on the real binary shows that every tool that changes things, sub-agents' included, asks first. If any does not, it stays false until agy asks for every tool.

### Models from the account

- **The list is read live.** From the `session/new` answer (the `model` config option, else `models.availableModels`), kept on disk so a restart shows it at once and a failed refresh keeps the last list. Effort levels come from the `thought_level` option, read per model.
- **Gemini 4 Neon is the default**, by the id the account's live list gives. Until #979 records that id from a live ACP call, no code names a guessed one.
- **Non-Gemini models are hidden until switched on.** The shared model visibility rule gains a per-model hidden-until-switched-on flag, and Antigravity is its first user: every model outside the Gemini family (its Claude and GPT models) is listed but hidden, with the note "Bills your Google AI plan, not your Claude or ChatGPT plan". Switching one on under Models in the picker is an override like any other, and Reset hides it again.
- **Auto has no lane for it.** A thread runs on Antigravity only when a person or an agent's settings pick it ([Auto routing](../internals/auto-routing.md)).

### MCP, Notion and skills

- **Omni's per-thread MCP servers go in `session/new`** as ACP stdio entries, with their environment as name and value pairs and no secret value in any entry. Omni writes nothing into the user's Antigravity home or the repo, and the user's own Antigravity setup loads as it does in a terminal.
- **Notion** reaches an Antigravity thread through `OMNI_NOTION_TOKEN`, as on every local harness. Gmail, Calendar, Drive and Slack stay claude.ai connectors that only Claude Code loads.
- **Skills are agent-config's job.** One link per machine, `~/.gemini/antigravity-cli/skills` to `~/.agents/skills`, made by Ben's agent-config sync. The state reader shows a hint, never an unavailable state, when agy cannot see those skills.

### Usage

- Per-turn tokens come from the prompt answer's `usage` (input plus cached reads, output plus thought tokens). The context meter reads `usage_update` when agy sends it, and shows nothing rather than a guessed window when it does not. A refusal, or `QUOTA_EXHAUSTED` in agy's error text, becomes a limit stop with the reset time agy gives.
- **Allowances come from agy's own `/usage`** (2026-11-25). #982's design, T3 Code's reader, took the Google sign-in agy keeps in its profile, made an access token and called Google's internal quota endpoint. Omni has never used a harness's own credential, so #982 was closed as not planned. agy 1.5.16 answers `agy -p /usage --output-format json` with each model group's 5-hour and weekly buckets, reading its own sign-in, with no model call, no tokens and no conversation. `apps/server/antigravity-usage.ts` runs that command, files the numbers under the account agy's log names, and never touches the credential. `usage` is `five-hour-week`. Each group (Gemini, and Claude and GPT) gets its own windows on the Usage card, and the Gemini group's are the top-level ones. Auto still has no Antigravity lane (see Rejected alternatives).

## Not proven yet

The spec was written before any `agy` was at hand. `agy` 1.5.16 is now installed and signed in on Ben's machines, but none of the points below has been checked over ACP. Each belongs to the ticket named.

- **Shared sign-in (#978).** Does `agy acp`, started by Omni, use the sign-in the interactive `agy` made in a terminal? T3 Code runs its own profile and sign-in, so it never had to answer this. On macOS agy keeps the sign-in in the login Keychain. If the two are separate, #978 stops and signing the ACP server in becomes its own ticket.
- **Permission coverage (#980).** Does every tool that changes things, sub-agents' tools included, send `session/request_permission` first? agy 1.5.16's changelog says its default Auto mode now creates or edits files outside the workspace without asking when they are in a git repository or only add content. If that holds over ACP, the tripwire fires on those writes, and #980 has to find a mode or permission rule that asks, or keep `toolLimits` false.
- **Stdio MCP (#981).** Does agy start stdio MCP servers given in `session/new`, before anything else? T3 Code passes its server over HTTP. #981 also measures how long agy lets an MCP call wait, since `ask_user_question` waits up to a day elsewhere.
- **Neon's id (#979).** `agy models` lists Neon once per effort (`gemini-4-neon-low`, `-medium`, `-high`, `-xhigh`). Whether the ACP list gives one Neon model with `thought_level` options or these four ids is unknown, and the default follows what the ACP answer gives.
- **Context window (#979).** Does agy send `usage_update` with a window size? T3 Code found no sign that it does.
- **Skills folder.** agy 1.5.16 also reads `~/.agents/skills` itself, with its own folders winning a name clash. The agent-config link still covers 1.5.1 to 1.5.15 and does no harm on newer builds; the skills hint should count either path as seen.

## Considered

- **Calling Gemini through the Vertex API.** It bills a Google Cloud project per token, not the Google AI plan, and Omni would have had to write its own agent loop, tools, permissions and MCP. Dropped.
- **Gemini on Cursor Agent.** It works today, but bills Cursor's API credits, which run out first, and not the Google plan Ben already pays for.
- **T3 Code's managed install and private profile.** T3 Code downloads its own `agy` and signs it in with its own Google profile. That means an in-app sign-in flow, a second sign-in per machine and an updater of Omni's own. Bring your own `agy` is one install and one sign-in, the state reader leaves room for a managed install later, and neither is built.
- **Porting T3 Code's Effect packages.** Omni's ACP needs are a small JSON-RPC client over stdio, which it already writes by hand for Codex. Adopting Effect for one harness would bring a second programming model into the server.
- **`session/load`.** It replays the whole history's tool calls into the thread on every resume. `session/resume` continues without replaying, and a handover covers a failed resume.
- **Reading agy's stored Google sign-in for allowances.** #982, not planned. See Usage: agy's own `/usage` reads them instead.
- **An Auto lane.** Nothing in a brief says Neon would do better than the lanes Auto has.

## Consequences

- A thread on Antigravity is held to the channel's access level like Claude Code and Codex threads, but only after #980's proof passes. Until then it runs only at Full access, for agents with full tools.
- ACP's stop reasons, permission requests and plan updates now have a second reader in the server besides the Cursor command probe, which can move onto the new client.
- A handoff to another machine starts a new agy session there with a handover, because agy keeps its conversations in each machine's own Antigravity home.
- The Usage card's Antigravity row has no numbers. Ben sees a turn's tokens and a limit stop's reset time, not how much Neon is left in the window.
- The harnesses guide, the routing doc's "Not given a lane" list and the glossary's Harness entry name Antigravity.
