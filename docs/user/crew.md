# Crew and Conductor

Roles live in `crew/*.md` (frontmatter + charter, edit freely, read on every run):

| Role | For |
| --- | --- |
| conductor | Front agent in #conductor. Routes every task to a crew thread, never does the work |
| researcher | Research, audits, answers to client questions, HTML reports |
| store-ops | Shopify store work, PSI/SEO, translations, imports |
| builder | Code in a repo channel, own worktree, opens PRs |
| inbox | Mail, calendar, Productive, Notion, Slack drafts. Never sends on its own |

The frontmatter sets each role's model and, for conductor and inbox, its default channel. The conductor defaults to `model: auto`, so the Home and Conductor composers start on Auto; a saved #conductor channel default still wins (see [Auto](harnesses.md#auto)). The other roles also default to `model: auto`, so each delegated brief gets the model it needs. Pin a model in a role's frontmatter to opt it out.

`delegate_only: true` in a role's frontmatter makes it a router: it runs without the tools that do work. Only the conductor sets it.

- Claude Code: `--disallowedTools` for Bash, Edit, Write, NotebookEdit, Agent, Task, Workflow, Artifact, ArtifactData and the browser MCPs.
- Codex: a `read-only` sandbox.
- Cursor Agent: its own config folder in the thread's data dir, passed as `CURSOR_CONFIG_DIR`. Its `cli-config.json` is a copy of yours with `Shell(*)` and `Write(**)` added to `permissions.deny`; everything else in the folder links to yours, so the login and chats stay put. Deny rules hold under `--force`, and MCP tools stay allowed. Cursor's read-only `--mode ask` is no use here: with `--force` it blocks nothing, and without it it blocks the `omni` tools too.
- Hermes and Cursor Cloud: refused. A thread there gets no `omni` tools, and Hermes takes no per-run tool limits, so a router could only do the work itself. Creating such a thread fails with the reason, and a Hermes thread that already has the role fails its turn the same way.

None of them gets the `omni-browser` MCP, and the system prompt drops the Artifacts and Browser sections for a "delegate first" rule. It can still read files, search and use the `omni` tools to write a brief.

The conductor's `omni` MCP (`apps/mcp/omni.ts`) exposes `list_channels`, `list_crew`, `list_harnesses`, `delegate`, `delegate_team`, `message_thread`, `mark_thread_done`, `recover_thread_session`, `switch_thread_run`, `continue_thread`, `get_thread`, `list_threads`, `search_history`, `list_published_artifacts`, `check_artifact_comments`, `list_devices`, `hand_off_thread`, `send_to_grok_bot`, `read_referenced_thread`, `watch_pr`, `list_automation_deliveries`, `retry_delivery`, `skip_delivery`, `worktree_storage`, `tool_failures`, `triage_tool_failure`, `note_tool_failure_recovery`. A delegated thread runs in the target channel; when it finishes, its reply is posted to the conductor as a crew report (tagged with the task id) and the conductor is woken to relay it. In Running and the Conductor's channel list, delegated children nest under their parent (expand/collapse, status, destination channel, and a link back to the parent); the same nesting shows on phone Activity and Channels. Any crew role whose frontmatter includes the `omni` MCP (Claude Code, Codex or Cursor Agent) also gets a short Thread delegation section in its system prompt: use `delegate` or `delegate_team`, call `list_crew` and `list_channels` for valid ids, and write each brief so the child thread stands alone.
