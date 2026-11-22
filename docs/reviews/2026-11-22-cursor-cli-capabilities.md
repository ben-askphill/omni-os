# Cursor CLI capabilities for the Omni harness adapter

Date: 2026-11-22. Scope: what `cursor-agent` (alias `agent`) supports for headless use, from primary sources only. Omni's own adapter is out of scope.

## Versions and sources

- Static analysis and `--help` ran on **2026.11.13-eacade1** (`~/.local/share/cursor-agent/versions/2026.11.13-eacade1/`).
- The CLI **auto-updated itself to 2026.11.22-e9042b2 at 08:08** during this research (`versions/` gained `2026.11.22-e9042b2`; `~/.local/bin/cursor-agent` now resolves there). Both live probes ran on 2026.11.22 (hook payloads report `"cursor_version": "2026.11.22-e9042b2"`). Key static findings were rechecked in the 2026.11.22 bundle (marked "rechecked").
- The bundle has a hidden `--disable-auto-update` flag ("Disable auto-updates", `index.js` @1444043, 11.13; still present in 11.22).
- Citation forms:
  - **help**: captured `--help` output in `~/.cache/cursor-probe/help/`.
  - **docs**: cursor.com URL.
  - **bundle**: `<file> @<char offset>` in the 11.13 version dir unless it says 11.22.
  - **probe 1 / probe 2**: live runs, artifacts below.
- Probe artifacts (all under `~/.cache/cursor-probe/`):
  - `bin/echo-mcp.js`: stdio MCP server with one `echo` tool. It logs to `$PROBE_LOG`.
  - `bin/hook.sh`: logs each hook's stdin payload.
  - `bin/setup.py`, `bin/setup2.py`: probe fixtures.
  - `run1/`: project `.cursor/mcp.json`, `.cursor/hooks.json` with all 18 agent events, `.cursor/rules/probe.mdc`, `AGENTS.md`, `CLAUDE.md`.
  - `cfg/`: used as `CURSOR_CONFIG_DIR`. Holds a decoy `mcp.json` (server `cfgdir`) and `hooks.json`.
  - `data/`: used as `CURSOR_DATA_DIR`.
  - `run2/`: project `.cursor/mcp.json` (server `proj2`).
  - `plugin/`: passed with `--plugin-dir`. Holds `mcp.json` (server `plugecho`), `hooks/hooks.json` and `rules/probe.mdc`.
- Probe 1 command (cwd `run1`, 120 s bound): `env TMPDIR=… CURSOR_CONFIG_DIR=…/cfg CURSOR_DATA_DIR=…/data PROBE_SECRET=interp-ok-123 timeout 120 cursor-agent -p --output-format stream-json --approve-mcps --force --trust --model auto "<prompt>"`. Output in `run1/stream.jsonl` (246 lines) and `run1/hooks.log`.
- Probe 2 command (cwd `run2`): same flags plus `--plugin-dir …/plugin --new-session-id <uuid>` and `PROBE_SECRET=interp-ok-456`. Output in `run2/stream.jsonl` (71 lines), `plugin/hooks.log` and `plugin/mcp-server.log`.
- `status` showed the CLI logged in. Both probes reported `"apiKeySource":"env"`, so they authenticated with an API key from the environment.

## 1. Headless output (`--print`, `stream-json`)

### Flags

- `-p, --print`: "Print responses to console (for scripts or non-interactive use). Has access to all tools, including write and shell." (help)
- `--output-format <format>`: "text | json | stream-json (default: "text")" (help)
- `--stream-partial-output`: "Stream partial output as individual text deltas (only works with --print and stream-json format)" (help). Using it with another format exits with "Error: --stream-partial-output requires --output-format stream-json" (bundle `1212.index.js` @23753).
- Hidden `--show-thinking`: "Include model thinking blocks in the final JSON result (only works with --print and --output-format json)" (bundle `index.js` @1438746).
- Hidden `--single-turn`: "Finish after the initial user turn and delegated subagents (skip background shell wait and other follow-up turns)" (bundle `index.js` @1438929).
- Hidden `--printenv`: adds an `env` snapshot to completed shell `tool_call` events (bundle `1212.index.js` @549202).

### Events

Source: the print handler (bundle `1212.index.js` @544700 to @558400, dump in `src/print_handler.txt`), plus both probes. Every event carries `session_id`.

| type / subtype | When | Fields |
|---|---|---|
| `system` / `init` | Once, after the model resolves | `apiKeySource` (`env`, `flag`, `login`), `cwd`, `session_id`, `model` (display name, e.g. `"Auto"`), `permissionMode` (always `"default"`) |
| `user` | Once, right after init | `message.role:"user"`, `message.content:[{type:"text",text}]` |
| `thinking` / `delta` | Each thinking token chunk | `text`, `timestamp_ms` |
| `thinking` / `completed` | End of a thinking block | `timestamp_ms` |
| `assistant` | Buffered text flush (see "Message boundaries") | `message.role:"assistant"`, `message.content:[{type:"text",text}]`, optional `model_call_id`, `timestamp_ms` |
| `tool_call` / `started` | Tool starts | `call_id`, `tool_call`, `model_call_id`, `timestamp_ms` |
| `tool_call` / `completed` | Tool ends | same as started; `tool_call.<kind>.result` is set; optional `env` with `--printenv` |
| `result` / `success` | End of run | `duration_ms`, `duration_api_ms`, `is_error:false`, `result`, `request_id`, `usage{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,reasoningTokens}` |
| `usage` / `model_call` | Per model call, only if `CURSOR_EMIT_MODEL_CALL_USAGE=1` | `model_call_id`, `usage` (bundle `1212.index.js` @549808; not observed) |
| `interaction_query` / `request`, `response` | Agent asks a question (web search or fetch approval, ask-question) | `query_type`, `query` or `response` (bundle; not observed) |
| `retry` / `starting`, `resuming` | Inference retry | `attempt`, `is_resume`, `checkpoint_turn_count` (bundle; not observed) |
| `connection` / `reconnecting`, `reconnected` | Stream reconnect | `attempt`, `endpoint_url` (bundle; not observed) |
| `system` / `task_notification` | Background task completed | `task_id`, `status`, `title`, `detail` (bundle `1212.index.js` @556400; not observed) |
| `system` / `background_shell_timeout` | Background shells aborted after the last turn | `aborted_count`, `timeout_ms` (bundle; not observed) |

- **Thinking is emitted.** The docs say "`thinking` events are suppressed in print mode and will not appear in any output format" (https://cursor.com/docs/cli/reference/output-format). The bundle writes them for `stream-json`. Probe 1 had 179 `thinking/delta` and 12 `thinking/completed` events.
- Failure: the docs say the stream "may end early without this event, and an error goes to stderr" (output-format docs). No error-shaped `result` was observed. Error shape: unconfirmed.

Raw lines (probe 2, `run2/raw_lines.txt`):

```json
{"type":"system","subtype":"init","apiKeySource":"env","cwd":"~/.cache/cursor-probe/run2","session_id":"2634e53c-07f8-4916-9a67-0e0d039e2a7d","model":"Auto","permissionMode":"default"}
{"type":"thinking","subtype":"delta","text":"The","session_id":"2634e53c-07f8-4916-9a67-0e0d039e2a7d","timestamp_ms":1795331650242}
{"type":"thinking","subtype":"completed","session_id":"2634e53c-07f8-4916-9a67-0e0d039e2a7d","timestamp_ms":1795331656503}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Calling both echo MCP tools now—no shell or file reads."}]},"session_id":"2634e53c-07f8-4916-9a67-0e0d039e2a7d","model_call_id":"3062054d-0e0a-4c9c-96a6-14172d4c58ab-0-6vvn","timestamp_ms":1795331656517}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"echo: one (server=proj2-probe, token=interp-ok-456)\necho: two (server=plugin-probe, token=interp-ok-456)\ndone"}]},"session_id":"2634e53c-07f8-4916-9a67-0e0d039e2a7d"}
{"type":"result","subtype":"success","duration_ms":18226,"duration_api_ms":18226,"is_error":false,"result":"Calling both echo MCP tools now—no shell or file reads.echo: one (server=proj2-probe, token=interp-ok-456)\necho: two (server=plugin-probe, token=interp-ok-456)\ndone","session_id":"2634e53c-07f8-4916-9a67-0e0d039e2a7d","request_id":"3062054d-0e0a-4c9c-96a6-14172d4c58ab","usage":{"inputTokens":44804,"outputTokens":1006,"cacheReadTokens":33536,"cacheWriteTokens":0,"reasoningTokens":824}}
```

### Message boundaries

- Intermediate assistant text is emitted as **separate `assistant` events between tool calls**, not as one final message. Probe 1 had 6 `assistant` events in one turn (`run1/assistant_keys.txt`).
- Without `--stream-partial-output`, the text buffer is flushed as one `assistant` event (bundle function `fe`, print handler):
  - before each `tool_call/started`, with `model_call_id` and `timestamp_ms`;
  - on `modelCallCompleted`, with `model_call_id` and `timestamp_ms`;
  - before `retry` and `interaction_query` events, with `timestamp_ms`;
  - once at the end of the turn, **without** `model_call_id` or `timestamp_ms`, just before `result`.
- With `--stream-partial-output`, each text delta is also written as an `assistant` event with `timestamp_ms` and no `model_call_id`. The flushes above still fire and repeat that text. The docs say to keep only delta events ("Buffered flush before a tool call (duplicate)", "Final flush at end of turn (duplicate)", output-format docs).
- `model_call_id` is `<request_id>-<n>-<suffix>`, with `n` counting model calls in the turn (`…-0-6vvn`, `…-1-2ttq` in probe 2). A change in `n` marks a new model call.
- `result.result` concatenates every assistant segment of the turn **with no separator** (`"…file reads.echo: one…"`). Build the transcript from `assistant` events, not from `result.result`.
- Process exit:
  - Probe 2 exited 0 right after `result`.
  - Probe 1 printed `result` at 106 s and was still running at the 120 s bound (`run1/rc.txt` rc=124). Its `sessionEnd` hook reported `reason:"error"` when it was killed. Cause: unconfirmed. Probe 1 ran shell calls; probe 2 did not.

### `tool_call` shape

- `tool_call` holds **one kind key plus siblings**: `hookAdditionalContexts`, `toolCallId`, `startedAtMs`, `completedAtMs` (completed only). Pick the key that ends in `ToolCall`; do not assume a single key (probe 1 `run1/summary.txt`).
- `call_id` contains a newline: `"call-…-0\nfc_…_0"` (both probes).
- Kinds observed: `readToolCall`, `globToolCall`, `grepToolCall`, `shellToolCall`, `editToolCall`, `getMcpToolsToolCall`, `mcpToolCall`.
  - The docs show `writeToolCall` for writes (output-format docs). Probe 1's file write came as `editToolCall` with `args.path`, `args.streamContent` and `result.success.{path,linesAdded,linesRemoved,diffString}`.
- Other kinds in the bundle (`index.js` @1601114, `1212.index.js` @486871, @510120, @981838): `lsToolCall`, `deleteToolCall`, `awaitToolCall`, `webSearchToolCall`, `webFetchToolCall`, `updateTodosToolCall`, `readTodosToolCall`, `readLintsToolCall`, `createPlanToolCall`, `taskToolCall`, `semSearchToolCall`, `listMcpResourcesToolCall`, `readMcpResourceToolCall`, `generateImageToolCall`.
- `result` is `{success:{…}}` or `{error:{…}}`.
- Shell (`shellToolCall`):
  - args: `command`, `workingDirectory`, `timeout`, `simpleCommands`, `parsingResult`, `isBackground`, `description`.
  - `result.success`: `exitCode`, `stdout`, `stderr`, `interleavedOutput`, `executionTime` (probe 1 line 99).

### MCP tool calls

- MCP tools reach the model through a **discovery meta tool**. The agent transcript names it `GetDynamicTools`; the stream calls it `getMcpToolsToolCall`. The model looks up the schema first, then calls the tool with `mcpToolCall` (both probes; transcript in `data/projects/home-<user>-cache-cursor-probe-run1/agent-transcripts/…jsonl`).
- `getMcpToolsToolCall.args`: `{pattern}` (search), `{server, toolName}` (schema) or `{}` (catalog).
  - `result.success.content` is a JSON **string**.
  - An unknown server gives `result.error.error: "namespace \"probe\" not found. Available namespaces: …"`.
- `mcpToolCall` fields:
  - `args.name`: `"<server>-<tool>"`.
  - `args.args`: the tool arguments object.
  - `args.providerIdentifier` and `args.serverIdentifier`: the server.
  - `args.toolName`: the tool.
  - Also `args.toolCallId`, `smartModeApprovalOnly`, `skipApproval`, `symbolicPathArguments`, `argumentsRepaired`, `refuseSavedSecrets`.
  - A sibling `description`, written by the model.
  - `result.success`: `{content:[{text:{text}}], isError, systemReminders}`. Content items are wrapped as `{text:{text}}`, not MCP's `{type:"text",text}`.
  - `result.error`: `{error, readToolDefReminder, systemReminders}` (probe 1 line 139).
- Server identifiers:
  - Project servers keep their `mcp.json` key (`proj2`).
  - Plugin servers become `plugin-<plugin>-<server>`. The local plugin dir named `plugin` gave `plugin-plugin-plugecho`.
  - The user's installed plugins show up the same way, e.g. `plugin-shopify-plugin-shopify`.

Raw lines (probe 2):

```json
{"type":"tool_call","subtype":"started","call_id":"call-d2ccb252-9510-461f-92f0-13418cb6b176-0\nfc_a0b0fc7d-f48e-4fe0-b0bb-0e57f24dbb48_0","tool_call":{"getMcpToolsToolCall":{"args":{"server":"proj2","toolName":"echo","toolCallId":"call-d2ccb252-9510-461f-92f0-13418cb6b176-0\nfc_a0b0fc7d-f48e-4fe0-b0bb-0e57f24dbb48_0"}},"hookAdditionalContexts":[],"toolCallId":"call-d2ccb252-9510-461f-92f0-13418cb6b176-0\nfc_a0b0fc7d-f48e-4fe0-b0bb-0e57f24dbb48_0","startedAtMs":"1795331656499"},"model_call_id":"3062054d-0e0a-4c9c-96a6-14172d4c58ab-0-6vvn","session_id":"2634e53c-07f8-4916-9a67-0e0d039e2a7d","timestamp_ms":1795331656517}
{"type":"tool_call","subtype":"started","call_id":"call-3302da10-f952-4c1a-8576-cd719ae0a9fd-2\nfc_75e530df-6dd9-92cc-a6b9-c56b3500a0ff_0","tool_call":{"mcpToolCall":{"args":{"name":"proj2-echo","args":{"text":"one"},"toolCallId":"call-3302da10-f952-4c1a-8576-cd719ae0a9fd-2\nfc_75e530df-6dd9-92cc-a6b9-c56b3500a0ff_0","providerIdentifier":"proj2","toolName":"echo","smartModeApprovalOnly":false,"skipApproval":false,"serverIdentifier":"proj2","symbolicPathArguments":[],"argumentsRepaired":false,"refuseSavedSecrets":false},"description":"Echo the text one from the proj2 server"},"hookAdditionalContexts":[],"toolCallId":"call-3302da10-f952-4c1a-8576-cd719ae0a9fd-2\nfc_75e530df-6dd9-92cc-a6b9-c56b3500a0ff_0","startedAtMs":"1795331657831"},"model_call_id":"3062054d-0e0a-4c9c-96a6-14172d4c58ab-1-2ttq","session_id":"2634e53c-07f8-4916-9a67-0e0d039e2a7d","timestamp_ms":1795331657844}
{"type":"tool_call","subtype":"completed","call_id":"call-3302da10-f952-4c1a-8576-cd719ae0a9fd-2\nfc_75e530df-6dd9-92cc-a6b9-c56b3500a0ff_0","tool_call":{"mcpToolCall":{"args":{"name":"proj2-echo","args":{"text":"one"},"toolCallId":"call-3302da10-f952-4c1a-8576-cd719ae0a9fd-2\nfc_75e530df-6dd9-92cc-a6b9-c56b3500a0ff_0","providerIdentifier":"proj2","toolName":"echo","smartModeApprovalOnly":false,"skipApproval":false,"serverIdentifier":"proj2","symbolicPathArguments":[],"argumentsRepaired":false,"refuseSavedSecrets":false},"result":{"success":{"content":[{"text":{"text":"echo: one (server=proj2-probe, token=interp-ok-456)"}}],"isError":false,"systemReminders":[]}},"description":"Echo the text one from the proj2 server"},"hookAdditionalContexts":[],"toolCallId":"call-3302da10-f952-4c1a-8576-cd719ae0a9fd-2\nfc_75e530df-6dd9-92cc-a6b9-c56b3500a0ff_0","startedAtMs":"1795331657831","completedAtMs":"1795331658055"},"model_call_id":"3062054d-0e0a-4c9c-96a6-14172d4c58ab-1-2ttq","session_id":"2634e53c-07f8-4916-9a67-0e0d039e2a7d","timestamp_ms":1795331658067}
```

## 2. MCP

### Where config is read

- Help: `mcp login` reads servers "configured in .cursor/mcp.json or ~/.cursor/mcp.json". Docs: "The CLI follows the same configuration precedence as the editor (project → global → nested)" (https://cursor.com/docs/cli/mcp).
- The session loader (bundle `index.js` @3205176; rechecked in 11.22 @3316470) builds its list in this order:
  - **enterprise**: a path from `CURSOR_PRIVATE_INFERENCE_CONFIG` (`.toml`) or the OS enterprise path, gated (`index.js` @4288755).
  - **project**: `<root>/.cursor/mcp.json` for **every workspace root**, meaning `--workspace` or cwd plus each `--add-dir`. Internal prefix `project-<i>-<basename>-`.
  - **user**: `path.join(os.homedir(), ".cursor", "mcp.json")`. **Hardcoded to the home dir, not `CURSOR_CONFIG_DIR`.**
- Plugins add servers from `mcp.json` or `.mcp.json` at the plugin root (`index.js` @3267620). Plugin sources:
  - `--plugin-dir` (help: "Load a local plugin directory (can be specified multiple times)");
  - `~/.cursor/plugins/local`;
  - Cursor marketplace plugins;
  - Claude Code plugins listed in `~/.claude/plugins/installed_plugins.json` (11.22 `index.js` @3361181, @3366941, @3370404: `loadClaude` defaults to true).
- Probe 1: the decoy `cfg/mcp.json` under `CURSOR_CONFIG_DIR` was **not loaded**. The `cfgdir` server never started (no `cfg/mcp-server.log`) and was absent from "Available servers".
- No flag or env var names a custom `mcp.json` path or dir in help, docs or bundle. The nearest routes are `--plugin-dir` and `--add-dir` (section 6).

### Approval in headless runs

- `--approve-mcps`: "Automatically approve all MCP servers" (help).
- Bundle: `ye=!0===r.approveMcps, ke=we||ye`, where `we` is Run Everything from `--force` or `--yolo` (`1212.index.js` @19747). So `--force` likely also approves MCP servers. Not tested separately: unconfirmed.
- Approvals persist in `$CURSOR_DATA_DIR/projects/<workspace-slug>/mcp-approvals.json`. Probe 1 wrote `["probe-9cf677a0f83c83ea"]` there. Bundle: `src/mcp/project-paths.ts`, `index.js` @1860948.
- Subcommands (help):
  - `mcp enable <id>` ("Add an MCP server to the local approved list"). Probe 1 printed "✓ Enabled and approved MCP server: probe".
  - `mcp disable <id>` writes `mcp-disabled.json` in the same dir.
  - `mcp list`, `mcp list-tools <id>`, `mcp login <id>`.
- `--trust`: "Trust the current workspace without prompting" (help). Probe 1 wrote `.workspace-trusted` under `data/projects/<slug>/`. Project hooks load only when the workspace is trusted (section 4).

### Does MCP work in `--print`

- **Yes.** In probe 2, with `-p --output-format stream-json --approve-mcps --force --trust`, the project server (`proj2`) and the `--plugin-dir` server (`plugecho`) were both discovered and called.
- The client handshake (`plugin/mcp-server.log`): `initialize` with `protocolVersion:"2025-11-25"` and `clientInfo:{name:"Cursor",version:"1.0.0"}`, then `notifications/initialized`, `tools/list`, `tools/call`.
- **The catalog is fixed at session start.** In probe 1 the agent fixed the broken config and ran `agent mcp enable probe` (output "probe: ready"). The same session still returned "MCP server does not exist: probe" (probe 1 lines 176, 193).
- **A server that fails to start is silently missing.** No stream event reports it. Only `agent mcp list` showed `probe: Error: Connection failed` with node's "Cannot find module" stderr (probe 1 line 99).
- `beforeMCPExecution` and `afterMCPExecution` hooks still fired for the call to the missing server, with `result_json:"{}"` (`run1/hooks_sample.txt`).
- Every session also loads the user's installed plugin servers, e.g. `plugin-shopify-plugin-shopify`, `plugin-playwright-playwright` and `plugin-chrome-devtools-mcp-chrome-devtools` (probe 1 line 139 `readToolDefReminder`).

### Transports and auth

- Docs list stdio, SSE and Streamable HTTP, with OAuth (PKCE) for remote servers (https://cursor.com/docs/context/mcp). The CLI `mcp list` output shows "Transport method (stdio, HTTP, SSE)" (https://cursor.com/docs/cli/mcp).
- The CLI keeps OAuth state in `<data>/projects/<slug>/mcp-auth.json` (bundle `index.js` @3206297; file present after probe 1).
- Only stdio was tested. HTTP and SSE in the CLI: unconfirmed.

### Env interpolation in `mcp.json`

- Docs: Cursor resolves `${env:NAME}`, `${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}`, `${pathSeparator}`, `${/}` in `command`, `args`, `env`, `url`, `headers` (https://cursor.com/docs/context/mcp).
- **`${env:NAME}` in `env` works** in the CLI, for both project and plugin `mcp.json`. Probe 2 servers received `PROBE_TOKEN=interp-ok-456` (`plugin/mcp-server.log`, probe 2 `result`).
- **`${userHome}` in `args` was not expanded.** Probe 1: "Cannot find module '~/.cache/cursor-probe/run1/${userHome}/.cache/cursor-probe/bin/echo-mcp.js'" (line 99). The literal string was resolved against cwd.
- **`${workspaceFolder}` in `env` did not resolve to the workspace.** Probe 2's `proj2` server got `PROBE_LOG="${workspaceFolder}/mcp-server.log"` and wrote no log file to the workspace.
- The bundle's plugin-variable parser matches `${NAME}` and `${env:NAME}` with default values (11.22 `index.js` @3332284).
- Use absolute paths and `${env:…}` only.

## 3. System prompt and rules

### Flags

- No public flag appends to the system prompt (help; https://cursor.com/docs/cli/using: "No system prompt flag is documented").
- Hidden flags (bundle `index.js` @1441343, @1441767; rechecked in 11.22):
  - `--system-prompt <file>`: "Replace system prompt with contents of file (Anysphere/OpenAI team only)". It replaces rather than appends; the CLI reads the file into `customSystemPrompt` (`1212.index.js` @28065). Whether the backend honors it for a normal account: unconfirmed, not tested.
  - `--exclude-workspace-context`: "Strip all workspace-sourced context (rules, skills, transcripts, notes) from the session."
  - `--conversation-history-file <file>`: "Import prior conversation history from the given file" (print mode only).
- The protocol has `SystemPromptSpec` with `replace` and `append` (`index.js` @4929132). No CLI flag sets `append`.

### How rules load

- Docs: "The CLI also reads `AGENTS.md` and `CLAUDE.md` at the project root" and "applies them as rules alongside `.cursor/rules`" (https://cursor.com/docs/cli/using).
- Project rules must be `.mdc` (https://cursor.com/docs/context/rules).
- Bundle `LocalCursorRulesService.loadRulesFromDirAndAncestors` (`index.js` @3807645) walks from the workspace dir **up to `/`**. At each level it loads:
  - `.cursor/rules` (`*.mdc`);
  - `AGENTS.md`;
  - `CLAUDE.md` and `CLAUDE.local.md`, when "third-party extensibility" is on.
- A second pass globs the workspace: `.cursorrules`, `AGENTS.md`, `**/.cursor/rules/**/*.mdc`, `**/AGENTS.md`, plus `**/CLAUDE.md` and `**/CLAUDE.local.md` when third-party is on (`index.js` @3838760).
- Bodies over 100 KB are truncated (`index.js` @3102378).
- The root is `--workspace <path-or-name>` ("defaults to current working directory", help), plus `--add-dir` roots.
- Probe 1: `AGENTS.md` (ALPACA), `CLAUDE.md` (BADGER) and `.cursor/rules/probe.mdc` with `alwaysApply: true` (CHEETAH) were all in context before the first tool call. The first thinking block (`run1/first_thinking.txt`) reads: "I found the codewords in the workspace rules: A is ALPACA, B is BADGER, and C is CHEETAH."
- Third-party (CLAUDE.md) loading was on by default in this install. Where the switch lives: unconfirmed.
- Probe 2: `rules/probe.mdc` (`alwaysApply: true`) inside the `--plugin-dir` plugin was **not** applied. The model found no codewords.
- Inference, not probed: because of the ancestor walk, a worktree under `~/omni-os/data/worktrees/<id>` also loads `AGENTS.md` and `CLAUDE.md` from `~/omni-os` and any other ancestor.

## 4. Hooks

### Where hooks load

Bundle `4107.index.js` @60624 (rechecked 11.22 `4721.index.js` @60910):

- enterprise: `/etc/cursor/hooks.json` on Linux;
- team: `<dir>/.cursor/managed/active-team-hooks/hooks.json`;
- user: `os.homedir()/.cursor/hooks.json`, **not `CURSOR_CONFIG_DIR`**;
- project: `<workspace>/.cursor/hooks.json`, loaded only when trusted;
- Claude Code: `~/.claude/settings.json`, `<ws>/.claude/settings.json`, `<ws>/.claude/settings.local.json`;
- plugins: `hooks/hooks.json`.

Notes:

- Claude event mapping (11.22 `index.js` @3426689): `PreToolUse→preToolUse`, `PostToolUse→postToolUse`, `UserPromptSubmit→beforeSubmitPrompt`, `Stop→stop`, `SubagentStop`, `SessionStart`, `SessionEnd`, `PreCompact`. `PermissionRequest` and `Notification` are not mapped.
- Probe 1: the decoy `cfg/hooks.json` under `CURSOR_CONFIG_DIR` never fired (no `cfg/hooks.log`).
- **Claude Code plugin hooks ran inside the Cursor CLI.** The `remember` plugin created `.remember/` in both probe workspaces. Its log reads "session-start: PROJECT_DIR=~/.cache/cursor-probe/run1 PIPELINE_DIR=~/.claude/plugins/cache/claude-plugins-official/remember/0.43.1". `security-guidance` logged a session-end warning (`run1/.remember/logs/`).
- Docs list file locations and events but have no CLI support table (https://cursor.com/docs/agent/hooks).

### Events

- Hook-step enum in the bundle (`index.js` @3301885): `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`, `afterMCPExecution`, `beforeReadFile`, `afterFileEdit`, `beforeTabFileRead`, `afterTabFileEdit`, `stop`, `beforeSubmitPrompt`, `afterAgentResponse`, `afterAgentThought`, `sessionStart`, `sessionEnd`, `preCompact`, `subagentStart`, `subagentStop`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `workspaceOpen`.
- What fired in `-p`:
  - Probe 1 registered all 18 agent events in project `.cursor/hooks.json` (`run1/hooks_summary.txt`).
  - Probe 2 registered them in the plugin's `hooks/hooks.json`.

| Event | Probe 1 (project) | Probe 2 (plugin) |
|---|---|---|
| workspaceOpen | 1 | 0 |
| sessionStart | 1 | 1 |
| beforeSubmitPrompt | **0** | **0** |
| afterAgentThought | 12 | 3 |
| preToolUse / postToolUse | 19 / 19 | 2 / 2 |
| beforeShellExecution / afterShellExecution | 5 / 5 | n/a |
| beforeReadFile | 9 | n/a |
| beforeMCPExecution / afterMCPExecution | 2 / 2 | 2 / 2 |
| afterFileEdit | 1 | n/a |
| afterAgentResponse | **0** | **0** |
| stop | **0** | **0** |
| sessionEnd | 1 | 1 |

- `stop`, `afterAgentResponse` and `beforeSubmitPrompt` **did not fire in print mode** in either probe.
  - In the 11.22 bundle, the `stop` and `afterAgentResponse` calls sit in the interactive session code (`7000.index.js` @594, @829865, @841633), and that `stop` path checks only user and project hooks.
  - A hooks protocol handler for them also exists (`4721.index.js` @101418, @102502). What drives it: unconfirmed.

### Payloads

Observed in `run1/hooks_sample.txt`, with `user_email` redacted.

- Common fields: `conversation_id` (= `session_id`), `generation_id`, `model`, `session_id`, `hook_event_name`, `cursor_version`, `workspace_roots`, `user_email`, `transcript_path` (`null` in `-p`).
- `afterAgentThought`:
  - `generation_id` equals the stream's `model_call_id`;
  - `model` (e.g. `"cursor-grok-4.5-high"`), `model_id` (`"grok-4.5"`), `model_params` (`[{id:"effort",value:"high"},…]`);
  - `text`: the full thinking text;
  - `duration_ms`.
- `preToolUse` / `postToolUse`:
  - `tool_name` (`Shell`, `Read`, `Grep`, `Write`, `MCP:echo`);
  - `tool_input`: an object;
  - `tool_use_id`;
  - post only: `tool_output` (JSON string) and `duration`.
- `beforeMCPExecution`: `tool_name:"echo"`, `tool_input:"{\"text\":\"hello\"}"` (a **string**), `tool_use_id`, `mcp_server_name:"probe"`, `command:"probe"`.
- `afterMCPExecution`: the same plus `result_json` and `duration`.
- `beforeShellExecution`: `command`, `cwd`, `sandbox`. The after event adds `output` and `duration`.
- `afterFileEdit`: `file_path`, `edits:[{old_string,new_string}]`.
- `sessionStart`: `is_background_agent`.
- `sessionEnd`: `reason`, `duration_ms`, `final_status`, `is_background_agent`.
- From the docs only (did not fire here):
  - `afterAgentResponse`: `"text"`;
  - `stop`: `status`, `loop_count`;
  - outputs: `permission` (`allow`, `deny`, `ask`), `continue`, `user_message`, `agent_message`, `followup_message` (https://cursor.com/docs/agent/hooks).
- The bundle's `afterAgentResponse` call also passes `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` (11.22 `7000.index.js` @640).

```json
{"conversation_id":"da01680c-edf1-485e-ade2-e9a2b7dee25a","generation_id":"da01680c-edf1-485e-ade2-e9a2b7dee25a","model":"default","tool_name":"echo","tool_input":"{\"text\":\"hello\"}","tool_use_id":"bd87cfb1-4ac5-4734-b2cb-160f26a147cc","mcp_server_name":"probe","command":"probe","session_id":"da01680c-edf1-485e-ade2-e9a2b7dee25a","hook_event_name":"beforeMCPExecution","cursor_version":"2026.11.22-e9042b2","workspace_roots":["~/.cache/cursor-probe/run1"],"user_email":"<redacted>","transcript_path":null}
```

## 5. Resume and sessions

- Flags and commands (help):
  - `--resume [chatId]`: "Select a session to resume";
  - `--continue`: "Continue previous session";
  - `resume`: "Resume the latest chat session";
  - `ls`: "Resume a chat session", interactive;
  - `create-chat`: "Create a new empty chat and return its ID".
- Hidden `--new-session-id <uuid>`: "Create a new session with a caller-provided ID" (bundle `index.js` @1440714; rechecked 11.22).
  - It must be a UUIDv4.
  - It "cannot be combined with --resume or --continue".
  - A reused ID errors with "Session ID … is already in use" (`1212.index.js` @763579).
  - **Probe 2 passed `2634e53c-07f8-4916-9a67-0e0d039e2a7d` and every event carried that `session_id`.**
- `session_id` is on every stream event. Docs: "Session IDs remain consistent throughout a single agent execution" (output-format docs). Hook `conversation_id` equals it.
- Storage, observed after probe 1:
  - chat DB: `$CURSOR_CONFIG_DIR/chats/<hash>/<session_id>/store.db` plus `meta.json`;
  - transcript: `$CURSOR_DATA_DIR/projects/<workspace-slug>/agent-transcripts/<session_id>/<session_id>.jsonl`.
- Not tested live:
  - `--resume <id>` in `-p` mode;
  - whether resume needs the same `CURSOR_CONFIG_DIR` and workspace. The chats dir is keyed by a hash, which suggests yes. Unconfirmed.

## 6. Config home and per-thread MCP config

### Env vars and flags

- `CURSOR_CONFIG_DIR`: config dir = `CURSOR_CONFIG_DIR` if set, else `$XDG_CONFIG_HOME/cursor`, else `~/.cursor` (bundle `paths.js`, `index.js` @3206890; rechecked 11.22 @3318421; docs https://cursor.com/docs/cli/reference/configuration).
  - It holds `cli-config.json` and `chats/` (probe 1 created both under `cfg/`).
  - It does **not** move `mcp.json` or `hooks.json` (probe 1).
- `CURSOR_DATA_DIR`, also hidden `--data-dir <path>` ("Set the Cursor data directory used for project metadata in this session (internal only)", `index.js` @1915347):
  - default `~/.cursor`;
  - holds `projects/<slug>/` with `mcp-approvals.json`, `mcp-auth.json`, `mcp-disabled.json`, `.workspace-trusted`, `agent-transcripts/`, `terminals/`, `repo.json`, `worker.log` (probe 1).
- `XDG_CONFIG_HOME`: the config fallback above. It also sets the Linux auth file `($XDG_CONFIG_HOME or ~/.config)/cursor/auth.json` (`index.js` @3139655).
  - Setting `CURSOR_CONFIG_DIR` and `CURSOR_DATA_DIR` left login working in both probes.
- `HOME`: user `mcp.json`, `hooks.json`, `~/.claude` hooks and plugins all come from `os.homedir()`.
  - Overriding `HOME` would move all of them, and would also move auth unless `XDG_CONFIG_HOME` or `CURSOR_API_KEY` is set.
  - Inference from source: unconfirmed, not tested.
- `TMPDIR`: CLI logs go to `$TMPDIR/cursor-agent-logs-<uid>/` (observed).
- `CURSOR_API_KEY`: auth for scripts (help, https://cursor.com/docs/cli/headless).

### Routes to a per-thread MCP config that leave `~/.cursor` alone

1. **`--plugin-dir <dir>` with `<dir>/mcp.json`.** Verified in probe 2.
   - Works in `-p`, `${env:…}` interpolates, and plugin `hooks/hooks.json` fires.
   - Costs: server ids get a `plugin-<name>-` prefix, and plugin rules did not apply.
2. **`--add-dir <dir>` with `<dir>/.cursor/mcp.json`.** The loader reads `.cursor/mcp.json` from every workspace root (bundle `index.js` @3205176). Not tested: unconfirmed.
   - It also widens the agent's workspace and rule roots.
3. **`<worktree>/.cursor/mcp.json`.** Verified in probe 2. It writes into the repo checkout.

## Not confirmed

- HTTP and SSE MCP servers in the CLI.
- Whether `--force` without `--approve-mcps` approves MCP servers.
- `--resume` in `-p` mode.
- The error event shape.
- Why probe 1 did not exit after `result`.
- `--system-prompt` for non-Anysphere accounts.
- Where the third-party (CLAUDE.md, Claude plugins) switch lives.
- Whether `stop`, `afterAgentResponse` or `beforeSubmitPrompt` fire in any headless path.
