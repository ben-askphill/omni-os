# Crew and Conductor

Roles live in `crew/*.md` (frontmatter + charter, edit freely, read on every run):

| Role | For |
| --- | --- |
| conductor | Front agent in #conductor. Delegates, never does the grind or writes code |
| researcher | Research, audits, answers to client questions, HTML reports |
| store-ops | Shopify store work, PSI/SEO, translations, imports |
| builder | Code in a repo channel, own worktree, opens PRs |
| inbox | Mail, calendar, Productive, Notion, Slack drafts. Never sends on its own |

The frontmatter sets each role's model and, for conductor and inbox, its default channel. The conductor defaults to Opus unless #conductor has a saved default run in its channel settings, including Auto. The other roles default to `model: auto`, so each delegated brief gets the model it needs (see [Auto](harnesses.md#auto)). Pin a model in a role's frontmatter to opt it out.

The conductor's `omni` MCP (`apps/mcp/omni.ts`) exposes `list_channels`, `list_crew`, `list_harnesses`, `delegate`, `delegate_team`, `message_thread`, `mark_thread_done`, `switch_thread_run`, `continue_thread`, `get_thread`, `list_threads`, `search_history`, `list_published_artifacts`, `check_artifact_comments`, `list_devices`, `hand_off_thread`, `send_to_grok_bot`, `read_referenced_thread`, `watch_pr`, `list_automation_deliveries`, `retry_delivery`, `skip_delivery`, `worktree_storage`, `tool_failures`, `triage_tool_failure`, `note_tool_failure_recovery`. A delegated thread runs in the target channel; when it finishes, its reply is posted to the conductor as a crew report (tagged with the task id) and the conductor is woken to relay it.
