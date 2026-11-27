# OpenCode as a harness, with free DeepSeek as the Conductor's model

A feature spec for a new built-in harness, `opencode`, that runs OpenCode (`opencode.ai`) over the Agent Client Protocol, and for running the Conductor on it with DeepSeek at no cost.

- Status: proposal, not built. Nothing here is decided until the open questions in section 13 are answered.
- Surveyed: `main` at `73cd999b` (desktop 2.1.x), and OpenCode 2.3.0 installed on omarchy (`@opencode/cli`, 2026-11-27). The newest release is 2.4.2 ([npm](https://www.npmjs.com/package/@opencode/cli), [releases](https://github.com/anomalyco/opencode/releases)).
- Words: [GLOSSARY.md](../../GLOSSARY.md). "Harness" is the CLI a local agent runs in.
- How to read the evidence: a claim with a link is on that page. **Verified** means I ran it against the installed 2.3.0 on 2026-11-27, and the probe is described so it can be repeated. A probe's output is not kept in the repo.

## Summary

- OpenCode fits Omni's harness contract through its ACP server, `opencode acp` ([docs](https://opencode.ai/docs/acp/)). It is the same shape as Antigravity ([ADR 0022](../adr/0022-antigravity-over-acp.md)): one warm process per thread, Omni's own ACP client (`apps/server/harness/acp/client.ts`), permission requests answered through the channel's gate. About half of Antigravity's adapter is reusable.
- The Conductor can run on it. Verified under ACP: stdio MCP servers with their environment, `session/cancel`, `session/resume` with history intact, a model and effort switch, permission requests for `ask` rules, and a per-process config through `OPENCODE_CONFIG_CONTENT`. Denying shell, edit, subagent and browser removes those tools from the model, which is what delegate-only needs.
- The free DeepSeek route is real but narrow: `opencode/deepseek-v4.1-flash-free` on OpenCode Zen. It needs no account and no key, is free "for a limited time", and has no published rate limit. I hit a `provider.free-limit` 429 with a retry time of about 15 hours on requests that denied every built-in tool, while ordinary requests in the same minute passed. That is the main risk for a delegate-only Conductor (section 9).
- No other free DeepSeek route exists today. OpenRouter lists 11 free models and none is DeepSeek, DeepSeek's own API has no free tier, and Cloudflare Workers AI's free allowance excludes its DeepSeek V4 models (section 8).
- The "CLI runners are subscription-only" rule is a conflict only for keys. The free Zen tier is neither a subscription nor a key. Section 13 asks Ben to rule on it, and does not decide it.
- Version trap: there are two OpenCodes. `opencode-ai` on npm is v1 (1.19.6), and `@opencode/cli` is v2 (2.4.2). Both put an `opencode` binary on PATH, and their configs differ. This spec targets v2 only (section 5).

## 1. Goals and non-goals

Goals:

- Add `opencode` as a built-in harness beside Claude Code, Codex, Cursor Agent and Antigravity. Any thread, channel default, automation or agent can run on it.
- Run the Conductor on `opencode/deepseek-v4.1-flash-free` at no cost, set in the Conductor's run defaults, with every behavior it has today: `seat_agents`, `delegate`, `list_harnesses`, `harness_accounts`, `switch_thread_run`, questions, steps and shown reports.
- Stay inside Omni's access levels: a delegate-only agent gets no shell, file edits, browser or subagents, and a channel below Full access asks before changes.
- Keep any provider key in the secret store, never in a file, and never let OpenCode pick up a billing source Omni did not choose.
- Work on all three surfaces in the same change (desktop web, phone web, desktop app) and in the iOS app's harness lists.

Non-goals:

- A metered or API-key provider as a default or as a silent fallback. Section 13 asks whether one is allowed at all.
- Putting OpenCode in Auto's lanes. Nothing in a brief says it beats the lanes Auto has, so it runs only when picked, as Antigravity does ([auto routing](../internals/auto-routing.md)).
- OpenCode v1 (`opencode-ai`).
- Running OpenCode as a remote agent on the Runs API (section 4 says why).
- An `omni` command for any of this ([ADR 0014](../adr/0014-omni-command-line.md)).
- Any change to OpenCode's own TUI, web UI, share links or plugins.

## 2. User stories

- As Ben, I set the Conductor's run to OpenCode and DeepSeek once, and #conductor stays responsive without spending the Claude or ChatGPT plan on routing.
- As Ben, I see in the picker that OpenCode's free DeepSeek is free, may disappear, and what it does with my data.
- As Ben, when the free tier refuses a request, the thread says so with the reset time and offers a switch, and nothing silently moves to another model.
- As Ben, I can run any agent on OpenCode for a quick or low-stakes thread, and the access level I set on the channel still holds.
- As an agent, `list_harnesses` tells me whether OpenCode is available, which models it has, and what it cannot do (no steer, tool limits), so my briefs do not lean on it.
- As Ben, an OpenCode thread that moves to another machine or harness carries its history, since OpenCode keeps sessions per machine.

## 3. What OpenCode is, and the version split

- OpenCode v2 is a Bun-built agent with a background server. The CLI is `@opencode/cli`, it installs `opencode` and `opencode2`, and the source is `anomalyco/opencode` (renamed from `sst/opencode`). The README gives `curl -fsSL https://opencode.ai/v2/install | bash`, `npm i -g @opencode/cli@latest` and Homebrew ([repo](https://github.com/anomalyco/opencode)). The v2 install URL answers 200 (checked).
- v1 is `opencode-ai` on npm (latest 1.19.6) with docs at [opencode.ai/v1/docs](https://opencode.ai/v1/docs). The current docs at [opencode.ai/docs](https://opencode.ai/docs/server/) are v2: the config page uses `permissions`, `shell`, `subagent` and `mcp.servers`, where v1 used `permission`, `bash`, `task` ([permissions](https://opencode.ai/docs/permissions/), [config](https://opencode.ai/docs/config/)).
- The v1 code paths I tried to read (`packages/opencode/src/...`) are gone from the `dev` branch of the renamed repo. The repo now has `packages/cli`, `packages/core`, `packages/server` and `specs/v2/` ([repo](https://github.com/anomalyco/opencode)). I did not read the v2 source, so every behavior below comes from the v2 docs or from running 2.3.0, and says which.
- On omarchy the `opencode` on PATH is a mise wrapper (`~/.local/bin/opencode`) that runs `mise use -g opencode` before every exec. Omni should find the real binary, or take the cost, in `bin.ts` (section 6).

## 4. Choosing the route

| Route | What it is | Fit |
| --- | --- | --- |
| **ACP, `opencode acp`** (recommended) | JSON-RPC over stdio. Documented, one process per client, exits when stdin closes ([docs](https://opencode.ai/docs/acp/)). | Closest to `HarnessSession`: warm process, `session/prompt`, `session/cancel`, permission requests, MCP at `session/new`. Omni already has the client and an adapter to copy. |
| `opencode run --format json` | One process per turn, newline JSON events. | Simple, and a good probe. Cannot ask: with an `ask` rule it prints a non-JSON line, `! permission requested: shell (echo hi); auto-rejecting`, and rejects (verified). So it cannot hold a channel below Full access. No steer. |
| `opencode serve` plus HTTP and SSE | The v2 HTTP API: `POST /api/session/{id}/prompt` queues and returns, `GET /api/event` streams, permission reply and interrupt routes ([docs](https://opencode.ai/docs/server/)). | Works, but it is an "experimental" surface, and a long-lived server per machine is a lifecycle Omni would own, with a password (`OPENCODE_SERVER_PASSWORD`) to keep. Nothing ACP does not give. Left for later. |
| The JS SDK | `@opencode/sdk` is an embedded host, not a network client ([docs](https://opencode.ai/docs/sdk/)). | Pulls OpenCode's runtime into the Omni server. Rejected. |
| A custom harness on the Hermes adapter | `data/harnesses/<slug>.yaml`, Runs API ([ADR 0017](../adr/0017-custom-harnesses.md)). | Cheaper to add, but wrong for the Conductor. A remote agent gets no Omni tools, no thread token and no delegate-only role (ADR 0017), and OpenCode does not speak the Runs API, so a shim server would sit in between. Fine later as a talk-only remote agent. Rejected for this work. |

The recommendation is ACP, as one more built-in harness. It reuses `acp/client.ts`, `mcp-input.ts`, `env-guard.ts`, `resume-rules.ts`, `session.ts` and the structure of `antigravity/` (adapter, bin, models, normalize, permissions, profile, state).

## 5. OpenCode capabilities mapped to the adapter contract

`HarnessSession` is `send`, `interrupt`, `end` and an `exit` callback ([`harness/adapter.ts`](../../apps/server/harness/adapter.ts)).

| Contract item | OpenCode | Evidence |
| --- | --- | --- |
| Start a process | `opencode acp`, newline JSON-RPC, protocol version 1 | [ACP docs](https://opencode.ai/docs/acp/). Verified: `initialize` answers `agentInfo` `{name: "OpenCode", version: "2.3.0"}` |
| `send` starts a turn | `session/prompt` with text and image blocks. One prompt at a time per session: a second one is an error | [ACP docs](https://opencode.ai/docs/acp/). Verified: `promptCapabilities` `{embeddedContext: true, image: true}` |
| `send` mid-turn (steer) | `initialize` answers `_meta.steering.supported: true` (verified). Not documented, not exercised | Treat `steer: false` until proven (section 11) |
| `interrupt` | `session/cancel`, the turn ends with `stopReason: "cancelled"` | [ACP docs](https://opencode.ai/docs/acp/). Verified at 3 s into a long turn |
| `end('close')` | Close stdin: the server exits when the client closes it | [ACP docs](https://opencode.ai/docs/acp/) |
| `end('stop' / 'terminate' / 'kill')` | SIGINT, SIGTERM, SIGKILL on the process | Not probed beyond SIGTERM after a finished turn, which exited cleanly |
| Session id | `session/new` returns `ses_...`. Omni stores it as `thread.session_id` | Verified |
| Resume | `session/resume` continues without replaying history, `session/load` replays it, `session/fork` exists | [ACP docs](https://opencode.ai/docs/acp/). Verified: a new process resumed a session from another process and answered a question about its first turn. Use `resume`, never `load`, as for Antigravity |
| Records | `session/update`: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `usage_update`, `available_commands_update` | Verified (section 10) |
| Usage | The prompt answer carries `usage` `{inputTokens, outputTokens, totalTokens, thoughtTokens, cachedReadTokens}`. `usage_update` carries `used`, `size` and `cost` | Verified |
| Commands | `available_commands_update` lists `init`, `review`, `goal`, `compact` | Verified |
| Images | Inline image blocks | Verified in `promptCapabilities` |
| Context window | `usage_update.size` | Verified on the default model (1,048,576). Not checked on the DeepSeek free model, which [models.dev](https://models.dev/api.json) lists at 200,000 |
| Permissions | `session/request_permission` with `once`, `always` and `reject` options | [ACP docs](https://opencode.ai/docs/acp/). Verified for an `ask` rule on shell |
| MCP | `mcpServers` in `session/new`: stdio and HTTP, no SSE, no OAuth | [ACP docs](https://opencode.ai/docs/acp/). Verified: a stdio server with `env: [{name, value}]` ran and saw its env |
| Pid | The OS process runs the whole session, so `pid` is set (`processSession`) | `harness/session.ts` |

Capabilities to declare (`harness/types.ts`):

- `warmProcess: true`, `steer: false` (until proven), `interrupt: true`, `inlineImages: true`.
- `usage: 'none'`. The free tier has no plan window. A paid OpenCode Go account would need its own reader, which is out of scope.
- `remote: false`, `switchable: true`.
- `toolLimits: true` only after the proofs in section 11 pass for deny and ask under ACP. Until then `false`, and the Conductor refuses to start on it (`runner/tool-limits.ts`), which is the safe failure.

## 6. Config, install and auth

Install and detection:

- Install: `npm i -g @opencode/cli` or the v2 install script (section 3). `HARNESS_INSTALL.opencode` carries one of them.
- Binary lookup, in order: `OMNI_OPENCODE_BIN`, then `opencode` on PATH, as `antigravity/bin.ts` does for agy. The first check is a state reader like `antigravity/state.ts`: not installed, too old, v1, not answering, ready.
- Version comes from `initialize` (`agentInfo.version`), as Antigravity does. Minimum is 2.3.0, the one tested. A v1 binary answers differently or not at all and reads as "OpenCode 1 is not supported, install `@opencode/cli`". A newer major is allowed with a note.
- Checks are rare, as for agy: server start, Check again, and when a thread session starts. Run them in a scratch folder.

Auth and billing, three states:

1. **Free Zen models, no account.** Verified: with no credential saved and no `OPENCODE_API_KEY`, `opencode run -m opencode/deepseek-v4.1-flash-free` and an ACP session answered, at cost 0. Zen's page says free-tier chat models "require OpenCode" ([Zen](https://opencode.ai/docs/zen/)), so only the real OpenCode client can use them.
2. **OpenCode Go**, a subscription, signed in with `opencode auth login` (the ACP auth method id is `opencode-login`, [ACP docs](https://opencode.ai/docs/acp/)). Omni would never sign it in and never open a browser, as for agy. Go's page lists its price and models ([Go](https://opencode.ai/console/go)); I did not re-check them.
3. **A provider API key.** Not in scope until Ben answers section 13, question 1.

Where OpenCode keeps things (so Omni does not touch them):

- Sessions and state: `~/.local/share/opencode/` with a SQLite `opencode.db`. `OPENCODE_DB` is an env var in the binary, which could point a thread at its own file (strings in the 2.3.0 binary, not documented; proof item).
- User config: `~/.config/opencode/opencode.json` ([config](https://opencode.ai/docs/config/)).
- A background service. A plain `opencode run` started `opencode serve --service` on 127.0.0.1 and left it running (verified, and I stopped the one I started with `opencode service stop`). `opencode run --standalone` uses a private server. `opencode acp` does not accept `--standalone` (it answered "Unrecognized flag"), although the global help lists it.

Per-process config, with no write to the user's files:

- `OPENCODE_CONFIG_CONTENT` is read as JSON config (the name is in the binary; the docs pages I read do not list it). Verified: under `run` and under `acp` a `permissions` array passed this way took effect. Omni builds it per thread and passes it in the process env.
- The config holds no secret. Any reference to one is `{env:NAME}` ([config](https://opencode.ai/docs/config/)), resolved from the process env.
- Settings Omni sets, from the v2 schema ([schema](https://opencode.ai/config.json)): `permissions` (section 10), `share: "disabled"`, `autoupdate: false`, `instructions` (section 7), and `enabled_providers` (the schema marks it deprecated; its successor is not named, so this is a proof item).
- Env Omni sets: `OPENCODE_DISABLE_CLAUDE_CODE=1` and `OPENCODE_DISABLE_AUTOUPDATE=1` (names in the binary and in [rules](https://opencode.ai/docs/rules/)).

The environment guard needs more than a strip list:

- OpenCode enables a provider whenever its key is in the environment. Verified: `opencode auth list` on this machine shows Cloudflare AI Gateway, Cloudflare Workers AI and Hetzner as "environment" credentials, taken from Ben's shell, and the ACP model list included the Cloudflare models. Omni passes channel and global secrets into a harness's environment, so a stored `OPENAI_API_KEY` or `DEEPSEEK_API_KEY` would silently switch OpenCode to metered billing.
- Every other harness has a short strip list (`harness/env-guard.ts`). OpenCode's list would be long and always out of date, so this harness needs an allow-list of what its environment carries, plus `enabled_providers: ["opencode"]` in its config if that key still works in v2. Either way, `OPENCODE_API_KEY` is stripped (it moves Zen to pay-as-you-go), and so is every name `opencode auth list` would read as a provider credential.
- A key Omni deliberately gives it (question 1) goes through the secret store as a harness-scoped secret that reaches only this process, the way a custom harness's key does (`secretReachesThread`, [ADR 0017](../adr/0017-custom-harnesses.md)), never a terminal or channel action, and never written into a file.

## 7. Instructions and the system prompt

- `AGENTS.md` is read from the working directory upward, then `instructions` files, and a missing `AGENTS.md` falls back to `CLAUDE.md`, including `~/.claude/CLAUDE.md` ([rules](https://opencode.ai/docs/rules/)). Verified: a project `AGENTS.md` took effect, and with the default env a model quoted a phrase from Ben's global `CLAUDE.md`.
- `OPENCODE_DISABLE_CLAUDE_CODE=1` stops that ([rules](https://opencode.ai/docs/rules/)). Verified for the global file. A skills catalog from the user's agent skills still showed up with it set, so skills load from somewhere the flag does not cover (`~/.agents/skills` is the likely path; proof item). That is part of the 24,000 to 39,000 input tokens a trivial first prompt cost (verified: 23,755 and 38,878 across two runs), against a 200,000 window.
- An agent's `system` field replaces OpenCode's base prompt, with project instructions and skills still added ([agents](https://opencode.ai/docs/agents/)). Omni should not replace it: OpenCode's own prompt carries its tool guidance, and I could not tell whether the free endpoint expects it (section 9).
- Plan: write Omni's context (charter, channel facts, artifacts folder, reply rules) to `<thread dir>/omni-context.md` and name it in `instructions`. If the proof shows `instructions` does not reach an ACP session, lead the first message with it and resend the Reply block on resume, as Antigravity does without a system prompt field (`harness/resume-rules.ts`).
- The tool-failure policy is not sent to a delegate-only agent (`runner/prompts.ts` `getsToolFailurePolicy`), so the Conductor's prompt stays short.

## 8. Models, effort and DeepSeek

Model ids and the catalog:

- Ids are `provider/model`, with `#variant` accepted by `run -m` (verified in `opencode run --help`; [agents](https://opencode.ai/docs/agents/) shows `anthropic/claude-sonnet-5-5#high`).
- The list comes from the `model` config option on `session/new` (116 entries here, including every provider whose key is in the environment) and from `opencode models`. Omni reads it live, keeps it on disk, and shows only `opencode/...` entries by default. Other providers are listed hidden until switched on, using the `hiddenUntilOn` flag Antigravity added to `ModelEntry`, with a note that they bill elsewhere.
- A new ACP session starts on `opencode/seaglass-alpha-free`, a stealth model whose Zen privacy note says "collected data is retained and used to improve the model" ([Zen privacy](https://opencode.ai/docs/zen/)). Omni must set the model with `session/set_config_option` before the first prompt, every time, including after a resume (verified: a resumed session reports the model it was left on, but do not rely on it).

Effort:

- ACP gives an `effort` config option, per model. Verified: on the default model it lists `minimal, low, medium, high, xhigh, max, default`, and after switching to `deepseek-v4.1-flash-free` it lists `low, high, max, default`.
- Omni's levels are `low, medium, high, xhigh, max`. Read the model's list and use `nearestEffort` (`harness/auto.ts`) for a level it does not offer, and `default` when Omni's thread has none.
- `mode` is a second option: `build` (default) and `plan` ("read-only agent"). Omni leaves `build`, since access is Omni's gate, not OpenCode's plan agent.

DeepSeek free access, checked 2026-11-27:

| Route | Free? | Model and limits | Caveats |
| --- | --- | --- | --- |
| **OpenCode Zen, `opencode/deepseek-v4.1-flash-free`** | Yes, $0 in every price column ([Zen](https://opencode.ai/docs/zen/)). No account or key (verified) | 200,000 context and 32,000 output, tool calls and reasoning true ([models.dev](https://models.dev/api.json)). No rate limit published | "Free on OpenCode for a limited time". "Its provider follows a zero-retention policy and does not use your data for model training" ([Zen](https://opencode.ai/docs/zen/)). Free-tier chat models require OpenCode |
| Zen paid, `opencode/deepseek-v4.1-flash` | No: $0.12 in and $0.48 out per 1M tokens, and `deepseek-v4-pro` at $1.74 and $3.48 ([Zen](https://opencode.ai/docs/zen/)) | 1,000,000 context | Pay-as-you-go credits |
| DeepSeek API direct | No free tier stated. `deepseek-flash` at $0.15 in and $0.6 out per 1M ([pricing](https://api-docs.deepseek.com/quick_start/pricing/)) | 1M context, 384K output, tool calls supported. Limit is concurrency only: 2,500 for flash ([rate limits](https://api-docs.deepseek.com/quick_start/rate_limit/)) | "Granted balance" is mentioned with no amount. DeepSeek's own OpenCode guide uses `/connect` and a key ([guide](https://api-docs.deepseek.com/quick_start/agent_integrations/opencode/)) |
| OpenRouter | No free DeepSeek. The live model list has 11 `:free` models, none DeepSeek (checked via [the API](https://openrouter.ai/api/v1/models)) | Free models are capped at 20 requests a minute and 50 a day, or 1,000 a day after buying $10 of credit ([limits](https://openrouter.ai/docs/api-reference/limits)) | Paid DeepSeek models exist there |
| Cloudflare Workers AI | 10,000 neurons a day free, but its DeepSeek V4 models "require a paid billing method" ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)) | Not free for DeepSeek V4 | Not usable for DeepSeek V4 |
| OpenCode Go | Subscription, not free ([Go](https://opencode.ai/console/go)) | Lists paid DeepSeek V4 models | Its free models are not DeepSeek. Not re-checked by me |

So the free claim holds in one place only: Zen's `deepseek-v4.1-flash-free`, today, and Zen says it is temporary. Omni must read the live list, not name the model in code, and treat "the free DeepSeek is gone" as a normal state (the picker shows it as missing, the Conductor's run shows why, nothing falls back on its own).

Tool-calling reliability for an orchestrator is unmeasured. In a smoke test the model made every tool call asked of it (about eight: shell, an MCP call through Code Mode, an MCP call as a direct tool, and ACP calls), but that is not an evaluation. Section 12 proposes one against the Conductor's real job.

## 9. The free tier's tool-set refusal

The finding most likely to break the Conductor, so it has its own section.

- Setting: `OPENCODE_CONFIG_CONTENT` with `permissions` rules, `opencode run --standalone --auto -m opencode/deepseek-v4.1-flash-free "say hi"`, fresh session each time.
- Deny `shell, edit, webfetch, websearch, subagent, browser, execute`: answered normally.
- Deny every built-in, including `read`, `glob`, `grep`, `question` and `skill`, or deny `*` and allow only the MCP server: the stream's first event is `{"type":"error","error":{"type":"provider.free-limit","status":429,"message":"Free usage limit reached..."},"retryAfterMs":54299000}`. That is about 15.1 hours. It reproduced on three of three runs, including once on a second free model. Plain requests and partial-deny requests in the same minutes answered.
- What I did not establish: the cause. The error text is a rate-limit message, but the pattern follows the tool set, not the count or the minute. My hypothesis is that the free endpoint checks that the request looks like OpenCode's coding agent, which Zen's "Free-tier chat models require OpenCode" would allow. Nothing in the docs says so.
- What it means for the Conductor: on Claude the delegate-only list denies Bash, Edit, Write, NotebookEdit, Agent, Task, Workflow, Artifact and the browser servers, and keeps Read, Glob, Grep and the web tools (`DELEGATE_ONLY_DENIED`, `apps/server/crew.ts`). The same shape on OpenCode (deny `shell`, `edit`, `subagent`, `browser`, `execute`; keep `read`, `glob`, `grep`, the web tools and the MCP servers) passed. A stricter Conductor that denies the read tools too would not. The spec asks for Claude parity, which section 13 confirms.
- Mitigations to prove: keep `read`, `glob`, `grep` allowed whatever the role says; turn any `retryAfterMs` into a limit stop with the reset time (section 11); show the picker's note that the free tier may refuse reduced tool sets.

## 10. MCP, permissions, tools and events

MCP wiring:

- Omni's per-thread servers (`buildMcpConfig` in `apps/server/sandbox.ts`: `omni-ask`, `omni-render`, `omni-steps`, `omni-threads`, `omni-memory`, `omni-team`, `omni-browser`, and `omni` for roles that have it) go in `session/new` `mcpServers` as stdio entries with `env: [{name, value}]`, so no file is written. A shared helper turns `buildMcpConfig` into that shape, as `harness/mcp-input.ts` already does for the others.
- Verified under ACP: a stdio server got its env pairs. Under `run`, the config key is `mcp.servers.<name>` with `type: "local"`, a `command` array and `environment`, and `{env:NAME}` resolves ([MCP servers](https://opencode.ai/docs/mcp-servers/)).
- `omni-admin` is not a server in this repo. The Conductor's tools are all on `omni` (`crew/conductor.md` `mcp: [omni]`, `apps/mcp/omni.ts`), so reaching `omni` reaches them all. If Ben meant a separate admin set, section 13 asks.
- MCP calls wait up to 12 hours by default (`mcp.timeout.execution`, [MCP servers](https://opencode.ai/docs/mcp-servers/)), so `ask_user_question` can keep `ASK_TIMEOUT_SEC`. Not tested: agy cut calls off at 3 minutes (`ANTIGRAVITY_ASK_WAIT_SEC`), so measure this one.
- Names: a tool is `<server>_<tool>`, with other characters turned into `_` ([MCP servers](https://opencode.ai/docs/mcp-servers/)). `omni-ask_ask_user_question` is ambiguous to parse, so map it with the session's server list, as `mcpName` does for agy.

Code Mode hides MCP calls:

- By default MCP tools run through one built-in `execute` tool that takes JavaScript: `tools["omni-probe"].whoami()` ([MCP servers](https://opencode.ai/docs/mcp-servers/), [tools](https://opencode.ai/docs/tools/)). Verified: the stream shows `tool: "execute"` with a `code` string, and under ACP the call arrived as `kind: "other"` with no permission request, although shell was set to `ask`.
- Omni's gate judges `mcp__<server>__<tool>`, and connector levels and Off depend on that. So Omni turns Code Mode off by denying `execute` ([tools](https://opencode.ai/docs/tools/)). Verified under `run`: the MCP tool then appears as a direct call named `omni-probe_whoami`. Under ACP it is a proof item.

Permissions:

- Effects are `allow`, `deny` and `ask`, as an ordered `permissions` array where the last matching rule wins. Actions are `shell`, `edit` (edit, write and patch), `read`, `webfetch`, `subagent`, `browser`, `execute`, and an MCP tool's normalized name ([permissions](https://opencode.ai/docs/permissions/)).
- Verified: a denied tool is removed from the model's tool list (it answered "there's no shell tool"). Verified under ACP: an `ask` shell rule sent `session/request_permission` with options `once` (`allow_once`), `always` (`allow_always`) and `reject` (`reject_once`).
- Omni answers `once` or `reject`, never `always`, so Omni's grants stay the only standing yes (the Antigravity rule).
- Map to Omni's gate by `kind`: ACP tool calls report `kind: "execute"` for shell. A call's `rawInput` has `command` and `cwd`. The mapping table and the tripwire (a changing call that finishes with no request before it) copy `antigravity/permissions.ts`, once a live check shows which of OpenCode's tools ask (Antigravity's did not ask for file edits or sub-agents, and OpenCode must not be assumed to).
- Delegate-only, as `permissions`: deny `shell`, `edit`, `subagent`, `browser`, `execute`. A read-only thread (a quick ask) also denies `webfetch` and `websearch`. A no-edits agent denies `edit` only.

Event mapping, verified on ACP and in `run --format json`:

| OpenCode | Omni record |
| --- | --- |
| `agent_message_chunk` (ACP), `text` (run) | `assistant_text` |
| `agent_thought_chunk`, `reasoning` tokens | Not shown, as for Antigravity. Whether to show a thinking line is an open point |
| `tool_call` with `status: pending`, then `tool_call_update` `in_progress`, `completed` or `failed` | `tool_use` then `tool_result`. `kind` is `execute`, `other` and so on. `rawInput` and `rawOutput`, and `content` for the text |
| `execute` tool with a `code` string | A tool row named from the MCP calls inside, or `execute` when Code Mode is off by default |
| `step_start`, `step_finish` (run) | Turn bookkeeping. `step_finish` has `tokens {input, output, reasoning, cache{read,write}}` and `cost` (0 on the free model) |
| `usage_update` `{used, size, cost}` | `contextHint` and the meter |
| The prompt answer's `usage` | The turn's token counts |
| `available_commands_update` | The thread's `/` menu (`commands` callback) |
| `plan` | Not seen in my probes. Antigravity's `planRecords` would carry it if it appears |

In v2.3.0 the shell tool is named `shell` (v1 called it `bash`).

## 11. Errors, cancel and exit

- Cancel: `session/cancel`, then wait for `stopReason: "cancelled"`. A process silent past a deadline is ended and the next message resumes the session, as Antigravity does (`CANCEL_MS`).
- A request waiting for approval when the turn is cancelled is answered `cancelled` and dismissed.
- Exit codes: `opencode run` exited 0 after a finished turn and 1 for an unknown model, with a JSON `error` event of type `provider.no-route` (verified). The docs pages I read do not list exit codes. For ACP, treat any exit with no `result` as an error and read stderr.
- Errors arrive as JSON error events in `run`. In ACP I did not capture how the same error reaches the client, so the free-limit and no-route cases are proof items. The deny-all config reproduces the free-limit error on demand.
- Limit stop: an error whose `type` is `provider.free-limit` with `retryAfterMs` becomes Omni's `limit` record with the reset time, so the thread shows "waits for the reset or switch", as for a plan limit (`quotaLimit` in `antigravity/normalize.ts`).
- Sign-in: OpenCode Go signed out reads as signed out with the fix `opencode auth login`. The free tier has no sign-in, so it never reads signed out.
- Update prompts: `OPENCODE_DISABLE_AUTOUPDATE=1`, and Omni never runs `opencode upgrade`.

## 12. The Conductor on OpenCode

How the Conductor's run is chosen: `resolveRun` takes the thread's choice, then the agent's defaults, then the channel's, then Auto (`apps/server/harness/resolve.ts`). The Conductor's file says `model: auto` (`crew/conductor.md`). To run it on OpenCode, set the Conductor's own run defaults to harness `opencode` and model `opencode/deepseek-v4.1-flash-free` in Settings. A role that sets any of the three replaces the channel's default whole. Nothing is hard-coded, and Auto never picks OpenCode.

Requirements, each with where it is enforced:

- **No working tools.** `delegate_only` is locked on for the Conductor (`CREW_LOCKS`). `toolLimitRefusal` refuses a delegate-only agent on a harness without `toolLimits` (`apps/server/runner/tool-limits.ts`, `runner/api.ts`). So OpenCode needs `toolLimits: true` and the deny list in section 10, proved under ACP.
- **The `omni` tools.** Every Conductor tool lives in `apps/mcp/omni.ts` behind the `omni` server. `list_harnesses`, `harness_accounts`, `delegate`, `switch_thread_run` and `continue_thread` all name harness ids in their descriptions, and need `opencode` added (lines near `omni.ts:408`, `567`, `611`, `734`, `876`).
- **`list_harnesses`** reads `/harnesses` (`apps/server/harness/catalog-service.ts`), so OpenCode needs a catalog entry, the `ON_REQUEST_ONLY` list if its check is heavy, and `capabilities` honest about `steer: false` and `tool_limits`.
- **`harness_accounts`** (`apps/server/harness-accounts.ts`) needs a reader. For the free tier it reports "free, no account". For Go it reads `opencode auth list`, which prints provider names and where each credential came from, never the secret. Drop any token-shaped field with `accounts-parse.ts`, as the others do.
- **`switch_thread_run`** works on a `switchable` harness. OpenCode keeps sessions in a per-machine database, so a switch or handoff starts a new session with a handover, as Antigravity does. `profile.sessionFiles` is null.
- **Questions and steps.** `omni-ask` and `omni-steps` are plain stdio MCP servers, so `ask_user_question` and `set_steps` work if MCP does.
- **Context size.** The prompt overhead (section 7) takes about 15 to 20 percent of a 200,000 window before the first message. A long #conductor thread compacts: `compact` is an ACP command, and `profile.compact` is `{focus: false}` until proven.
- **No silent fallback.** If OpenCode is down or limited, the Conductor thread says so and offers the switch. Omni does not move it to Claude on its own, as `crew/conductor.md` already says for Cursor Cloud.
- **Quality.** Evaluate before making it the default: replay the cases used for the shadow agent router ([agent router](../internals/agent-router-shadow.md)) and a set of real #conductor turns, and compare its `seat_agents` and `delegate` choices and brief quality against the Claude Conductor.

## 13. Open questions for Ben

1. **Subscription-only runners versus a free API tier.** The rule is written down in [GLOSSARY.md](../../GLOSSARY.md) ("every local agent runs on the user's own subscriptions through an official CLI"), in the environment guard's header (it strips keys that "switch that harness off its subscription onto API billing"), and in the harnesses guide (a Codex API-key login reads as signed out). I did not find it as a dated decision, only as these. Hermes already bills an Anthropic key, so it has an exception. The free Zen tier is a third thing: no plan and no key. Which of these?
   - A. Free Zen only, no key ever, and the rule is amended to say "or a free tier that needs no account". My recommendation.
   - B. A plus OpenCode Go, signed in with `opencode auth login`, a subscription in the rule's own terms.
   - C. B plus a provider API key (DeepSeek, OpenRouter) in the secret store, as an opt-in metered mode.
2. **Does the OpenCode Conductor need work tools, or stay delegate-only?** I recommend delegate-only at Claude parity: deny shell, edit, subagent, browser and Code Mode, keep read, glob, grep and the web tools. Section 9 shows a stricter one is refused by the free tier. Confirm parity, or say you want it stricter and accept a paid route.
3. **Provider keys.** If question 1 lands on C, the key goes in the secret store as a harness-scoped secret and reaches only this process (never a file, terminal or channel action), with `{env:NAME}` in the config. And is `opencode auth login`'s own file under `~/.local/share/opencode` acceptable for Go, as `claude auth login`'s is, given OpenCode owns it and Omni never reads it?
4. **Client data.** The Conductor sees client channel names, thread titles and summaries. Zen says the free DeepSeek flash is zero-retention and not trained on, which is the provider's claim, not something I could check. The default stealth model for a new session does retain and train. Is routing that context to the free endpoint acceptable, with Omni always pinning the model?
5. **v1 users.** Support v2 only, and refuse `opencode-ai` with a clear fix? I recommend yes.
6. **Free-tier churn.** The model is "limited time". When it goes, should the Conductor's run show "model gone, pick another" and wait (my recommendation), or should the setting name an ordered list of models?
7. **Thinking.** Show OpenCode's reasoning as the thinking line, or keep it private as Antigravity does?
8. **The word "omni-admin".** There is no such server in the repo. Did you mean the `omni` server's admin-type tools, or a split you want?
9. **Remote-agent route.** Confirm a Hermes-style custom harness is not wanted for the Conductor (section 4).

## 14. Gaps, risks and how to bridge them

| Gap or risk | Why it matters | Bridge |
| --- | --- | --- |
| Free tier refuses reduced tool sets (section 9) | A delegate-only Conductor could be refused for about 15 hours | Keep `read`, `glob`, `grep`. Prove the minimum. Limit stop with the reset time. No silent fallback |
| Free model is temporary | The Conductor setting breaks when it is removed | Read the live list. Unavailable-model state with a fix. Question 6 |
| Provider keys in the environment enable themselves | Silent metered billing | Allow-list environment, `enabled_providers`, strip `OPENCODE_API_KEY` (section 6) |
| Code Mode hides MCP calls | The gate cannot see connector calls | Deny `execute` so MCP calls are direct tools (proof under ACP) |
| Default model is a data-retaining stealth model | A forgotten `set_config_option` leaks context | Always set the model before the first prompt, and test that a new session never prompts on the default |
| Two OpenCodes on PATH | A v1 binary has a different config and ACP | State reader reads `agentInfo.version`, refuses v1 |
| No steer proof | A message mid-turn waits for the next turn | `steer: false` until `_meta.steering.supported` is exercised |
| Prompt overhead of 24,000 to 39,000 tokens | Slower first turns, smaller window | Disable the Claude fallbacks, review skills loading, measure |
| `acp` may share a background service | Per-thread config could bleed across threads | Prove two concurrent `opencode acp` processes with different `OPENCODE_CONFIG_CONTENT` and env stay separate |
| Sessions live in a per-machine database | A handoff cannot move the session | New session with a handover, `OPENCODE_DB` per thread if it works |
| v2 moves fast (2.3.1 on 18 Nov, 2.4.2 on 26 Nov) | A release can change ACP or config | Pin a tested range in the state reader, pass the fake CLI in tests, note untested majors |
| Docs and binary disagree in places | Docs omit `run` flags and exit codes | Treat the binary as the source and record what the proofs found |
| `opencode run` pollutes JSON stdout with a non-JSON line | A parser built on `run` would break | Not the chosen route. Tolerate non-JSON lines in any probe |

## 15. Proof checklist (phase 0)

Run against a real `opencode` before building on each. Report on the ticket if one fails.

1. **Deny under ACP.** The deny list removes shell, edit, subagent and browser for an ACP session, and `execute` denied turns MCP calls into direct tools that reach `request_permission` when set to `ask`.
2. **Minimum tool set on the free tier.** Which built-in tools must stay for `provider.free-limit` not to fire, and how the error reaches an ACP client.
3. **Isolation.** Two concurrent `opencode acp` processes with different `OPENCODE_CONFIG_CONTENT`, env and MCP servers keep them apart, and neither starts a shared service that outlives the thread.
4. **Instructions.** An `instructions` file named in `OPENCODE_CONFIG_CONTENT` reaches an ACP session, and which skills paths load with `OPENCODE_DISABLE_CLAUDE_CODE=1`.
5. **Model pinning.** A session's first prompt never runs on the default stealth model, and a resume keeps the pinned model.
6. **Which tools ask.** With every action set to `ask`, which of file edits, deletes, subagents, web fetch and MCP send a request, and which run unasked (the tripwire's input).
7. **`ask_user_question` wait.** How long OpenCode lets an MCP call wait under ACP.
8. **Steering.** What `_meta.steering` does when a prompt is sent mid-turn.
9. **Context size.** What `usage_update.size` reports on `deepseek-v4.1-flash-free`, and what `/compact` does over ACP.
10. **Provider enablement.** Whether `enabled_providers` still restricts providers in v2, and what replaces it.
11. **`OPENCODE_DB`.** Whether it isolates a thread's sessions.
12. **Exit and stderr.** Exit codes for SIGINT, SIGTERM and stdin close under ACP.

## 16. Surfaces, files and fixtures

The files that name Antigravity today are the best list of what a new harness touches (a grep on this commit). Each decides per harness, even if the answer is "not supported" (`CLAUDE.md`).

- Server, harness: `harness/types.ts` (`HarnessId`, `HARNESS_IDS`, `CAPABILITIES`, `HARNESS_META`, `HARNESS_INSTALL`), `harness/opencode/` (adapter, bin, models, normalize, permissions, profile, state), `harness/profile.ts`, `harness/catalog.ts`, `harness/catalog-service.ts`, `harness/env-guard.ts`, `harness/resume-rules.ts`, `harness/auto.ts` (no lane), `harness/acp/client.ts` (reused).
- Server, runner and config: `runner/state.ts` (adapter map and cap), `runner/spawn.ts`, `config.ts` (`OMNI_MAX_CONCURRENT_OPENCODE`), `harness-accounts.ts`, `context.ts`, `sandbox.ts`, `index.ts`, `scripts/setup.ts`, `crew.ts`.
- MCP tools: `apps/mcp/omni.ts` (descriptions and the `switch_thread_run` and `continue_thread` harness fields).
- Shared: `packages/shared/brand.ts`, `machines.ts` (`HARNESS_ORDER`), `composer-slash.ts`, `context-meter.ts`, `account-usage.ts`, `model-visibility.ts`, `settings-catalog.ts`.
- Web UI (desktop and phone): `apps/web/src/api.ts`, `steer.ts`, `components/onboarding-parts.tsx`, `components/sidebar/UsageCard.tsx`, `components/thread/ContextMeter.tsx`, `components/thread/panel/DetailsTab.tsx`, and the phone layout under `apps/web/src/mobile/`.
- Desktop app: it shows the Web UI, so a Web UI change reaches it. Anything OpenCode-specific stays in the server. Check with the QA harness (`apps/desktop/scripts/qa.ts`), including a bundled server with no `opencode` on PATH.
- iOS: `apps/ios/src/settings/harness-model.ts`, `thread/format.ts`, `needs/limit.ts`, and `packages/client-core/src/api/harnesses.ts`.
- Design system: a `HarnessMark` icon for `opencode` in `design-system/components/icons/` and `design-system/assets/harness/`, with the trademark note `brand.ts` carries for the others, then `/design-sync`.
- Wire fixtures: `packages/test-fixtures/wire/harnesses.json` and `status.json`, re-recorded through `apps/server/tests/wire-fixtures.test.ts`. A `packages/test-fixtures/fake-opencode.mjs` beside `fake-agy.mjs`, an `initialize` capture beside `packages/test-fixtures/antigravity/initialize-1.5.16.json`, and `settings-catalog.json`.
- Tests that name a harness: `catalog.test.ts`, `harness-profile.test.ts`, `resume-rules.test.ts`, `system-prompt-order.test.ts`, `bundle-boot.test.ts`, the `*-restart.test.ts` set, and one `opencode-*.test.ts` per area as Antigravity has.
- Docs: `docs/user/harnesses.md` (a section like Antigravity's, and the strip list), `docs/internals/auto-routing.md` ("Not given a lane"), `docs/user/crew.md`, `docs/user/limits.md`, `docs/README.md`, the glossary's Harness entry, and an ADR once the decisions in section 13 are made.
- Sync: no new synced entity. Sessions stay on the machine that ran them.

## 17. Phased scope and dependencies

No estimates. Each phase ends in something that runs.

**Phase 0: prove it.** The checklist in section 15 against a real `opencode`. Depends on nothing. Output: this spec updated, and tickets for what changed. Phase 1 starts on questions 1 and 2 being answered.

**Phase 1: skeleton.** The `opencode` id, capabilities (`toolLimits: false`), metadata, install line, binary lookup, the state reader (not installed, v1, too old, ready), catalog entry with live models, environment guard with the allow-list, the fake CLI and `initialize` fixture, and the harnesses and accounts rows. A thread runs a plain turn at Full access. Depends on Phase 0 items 3 and 5, and the antigravity ACP client.

**Phase 2: turns, MCP and permissions.** Resume with a handover, cancel, usage and context, commands, the permission mapping and tripwire, Omni's MCP servers in `session/new`, Code Mode off, instructions. `toolLimits` turns true when proofs 1 and 6 pass. Depends on Phase 1.

**Phase 3: the Conductor.** Delegate-only deny list, the `omni` tools and their descriptions, limit stop for the free tier, the picker's notes, `harness_accounts` reader, and the Conductor run default setting. Depends on Phase 2 and questions 2, 4, 6 and 8, and on the quality check in section 12.

**Phase 4: all surfaces.** Web desktop, phone web, desktop app QA, iOS lists, design-system mark, wire fixtures, docs and screenshots on the PR. Can start with Phase 1 for the pickers. Depends on the brand mark being cleared.

**Phase 5: optional paths.** OpenCode Go account reader, a metered provider mode, `opencode serve`, a shown thinking line. Each depends on its question in section 13, and none ships without an answer.

## Sources

OpenCode and its providers:

- [Docs: ACP](https://opencode.ai/docs/acp/), [CLI](https://opencode.ai/docs/cli/), [Server](https://opencode.ai/docs/server/), [SDK](https://opencode.ai/docs/sdk/), [Config](https://opencode.ai/docs/config/), [MCP servers](https://opencode.ai/docs/mcp-servers/), [Permissions](https://opencode.ai/docs/permissions/), [Agents](https://opencode.ai/docs/agents/), [Rules](https://opencode.ai/docs/rules/), [Tools](https://opencode.ai/docs/tools/), [Providers](https://opencode.ai/docs/providers/), [Zen](https://opencode.ai/docs/zen/), [Go](https://opencode.ai/console/go), [v1 docs](https://opencode.ai/v1/docs), [config schema](https://opencode.ai/config.json)
- [Repo](https://github.com/anomalyco/opencode) and [releases](https://github.com/anomalyco/opencode/releases) (redirected from `sst/opencode`), npm [`@opencode/cli`](https://www.npmjs.com/package/@opencode/cli) and `opencode-ai`, [models.dev](https://models.dev/api.json)
- [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/), [rate limits](https://api-docs.deepseek.com/quick_start/rate_limit/), [OpenCode guide](https://api-docs.deepseek.com/quick_start/agent_integrations/opencode/); OpenRouter [limits](https://openrouter.ai/docs/api-reference/limits) and [models API](https://openrouter.ai/api/v1/models); Cloudflare [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

Omni files read: `apps/server/harness/adapter.ts`, `types.ts`, `registry.ts`, `session.ts`, `profile.ts`, `resolve.ts`, `env-guard.ts`, `mcp-input.ts`, `resume-rules.ts`, `catalog.ts`, `catalog-service.ts`, `acp/client.ts`, `antigravity/*` (adapter, permissions, state), `apps/server/sandbox.ts`, `crew.ts`, `runner/tool-limits.ts`, `runner/switch-plan.ts`, `harness-accounts.ts`, `apps/mcp/omni.ts`, `crew/conductor.md`, [ADR 0017](../adr/0017-custom-harnesses.md), [ADR 0022](../adr/0022-antigravity-over-acp.md), [auto routing](../internals/auto-routing.md), [harnesses guide](../user/harnesses.md), [GLOSSARY.md](../../GLOSSARY.md), `packages/test-fixtures/wire/harnesses.json`.
