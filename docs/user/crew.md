# Crew and Conductor

Each role is a file in `crew/*.md` with frontmatter and a charter. Omni reads them on every run. The shipped charters are generic and go to every install, so they name no person, company, client or tool of anyone's own. The desktop build fails when one does (`personalCrewProblems` in `apps/desktop/scripts/stage.ts`).

| Role | For |
| --- | --- |
| conductor | Front agent in #conductor. Routes every task to a crew thread, never does the work |
| researcher | Research, audits, answers to client questions, HTML reports |
| builder | Code in a repo channel, own worktree, opens PRs. |
| reviewer | Reviews a PR against its brief, from the spec and diff only. Read only |
| inbox | Mail, calendar, time tracking, tasks, notes and chat drafts. Never sends on its own |
| usage-scan | Leads Scan my usage in #inbox: turns the repeated asks Omni found into up to 3 suggested automations ([Automations](automations.md#scan-my-usage)). Omni starts it; not for delegation |

Your own roles live in `data/crew/`, which is never shipped and which a release never touches. A file there with a new name is a role of your own. For example, a role for hands-on store work:

```markdown
---
name: Store ops
description: Hands-on store work. Admin API, theme checks, translations, imports, PageSpeed, SEO, using the channel browser.
model: auto
---
You operate on client stores.

- Never write to a published theme or a live store unless the brief explicitly says so. When unsure, do a dry run and report.
- For performance and SEO work, report numbers before and after.
- End with: what changed, where, and how to undo it.
```

A file there with a shipped role's name is your edit of that built-in, an overlay:

- It sets only the frontmatter fields it names. The rest, and any the next release changes, come from the shipped file.
- With `charter_mode: append` its body is added after the shipped charter, so a release's fixes to the charter still reach you. Omni writes new edits this way.
- With `charter_mode: replace`, or no `charter_mode` at all (a copy made before overlays), its body is the whole charter. Omni then records the shipped charter it was written against as `based_on`, and the role shows `builtInChanged` once a release changes that charter, or when a hand copy never recorded it.
- Hiding a built-in is per machine (`crew` in `data/omni.config.json`): no new thread starts as it, and lists leave it out. The conductor and usage-scan cannot be hidden.

`delegatable: false` keeps a role out of the Conductor's `list_crew` and makes `delegate` and `delegate_team` refuse it. The conductor and usage-scan set it. Starting a thread as a role no file has, or one hidden on this machine, is refused with the valid ids; it used to run with no charter.

`harness` is the role's runtime binding: any harness id this machine's catalog has, checked when the role is saved. A role whose harness this machine lacks still loads, with an error on it. Omni keeps frontmatter keys it does not know when it edits a file.

The clients edit roles through the API, the same files underneath:

| Call | Does |
| --- | --- |
| `GET /api/crew` | Every role this machine offers, each with `kind` (`shipped`, `edited` or `own`), `hidden`, `delegatable` and, for an edit, `charterMode` and `builtInChanged`. `?all=1` adds the hidden ones |
| `GET /api/crew/:id` | The role, the shipped file's text, your file's text and the shipped charter's hash |
| `POST /api/crew` | A new role of your own: `{ id, fields, charter }` or `{ id, markdown }` |
| `PUT /api/crew/:id` | Edit a role: `{ fields, charter, charter_mode }` or `{ markdown }`. On a built-in it writes the overlay. An empty field removes it |
| `DELETE /api/crew/:id` | Delete a role of your own |
| `POST /api/crew/:id/reset` | Drop your edit of a built-in |
| `POST /api/crew/:id/hidden` | `{ hidden }` for a built-in |

A save is refused when its run defaults, default channel or MCP servers are unknown here, or when it would give the conductor or usage-scan working tools.

A role is a prompt every later thread of it runs with, so an agent thread's write (one that names its thread in `x-omni-thread`, as Omni's MCP servers do) goes through the crew guard (`apps/server/crew-guard.ts`) and gets a 403 unless all of these hold:

- It is a save or a reset. Deleting, hiding and showing a role stay yours, in Settings.
- The thread runs as the Conductor. No other role writes roles, even one you gave the `omni` MCP server, and usage-scan never does.
- The save leaves powers alone: no `mcp`, `delegate_only` or `delegatable`, and no whole-file `markdown`. Those are yours to set.
- No automation started the thread or any thread above it.
- You answered in that thread after its first message, or answered a question it asked. The guard cannot read whether you agreed: it holds the Conductor to proposing an edit and waiting for you. An agent's own call never counts as your answer: a message an agent thread sends (`x-omni-thread`), including through `check_artifact_comments` or a compact, is recorded as the Conductor's, and an agent thread cannot answer a question card. The same holds for review notes an agent thread sends, and for messages a thread carries when it moves to another machine, which keep their sender.

Like the automation guard, it holds the path agents are told to use. A shell command that calls the API without the header is not stopped.

Your edits sync to your other Macs as `crew_file`, a signed action that applies only from a trusted machine ([Sync](sync.md)). Hiding stays per Mac.

The frontmatter sets each role's model and, for conductor and inbox, its default channel. The conductor defaults to `model: auto`, so the Overview and Conductor composers start on Auto; a saved #conductor channel default still wins (see [Auto](harnesses.md#auto)). The other roles also default to `model: auto`, so each delegated brief gets the model it needs. Pin a model in a role's frontmatter to opt it out.

The conductor does not review a PR by itself. When a builder reports one, it relays the PR and you say whether you want it reviewed. When you ask, it reviews on the other model family from the one that wrote it, read from the builder thread's harness and model (`get_thread`): Codex `gpt-6.1-sol` at `high` for a PR Claude wrote, following `/code-review:code-review` from the `gpt-review` skill where the machine has it in `~/.agents/skills`, else the reviewer charter's own steps; Claude Code `claude-opus-5-5` at `xhigh` for any other. When that harness or model is unavailable, or the builder's model does not say its family, it asks you instead of reviewing on the same family.

A `reviewer` thread on a GPT model (Codex, or a `gpt-*` model on Cursor) always runs at `high` effort. Omni sets it when the thread is made, switched to another run or continued, even when `xhigh` or no effort was asked for. Claude reviewers keep the effort they were given.

`delegate_only: true` in a role's frontmatter makes it a router that runs without the tools that do work. The conductor sets it, and so does usage-scan, which only reads its first message and saves what you pick.

- Claude Code: `--disallowedTools` for Bash, Edit, Write, NotebookEdit, Agent, Task, Workflow, Artifact, ArtifactData and the browser MCPs.
- Codex: a `read-only` sandbox.
- Cursor Agent: its own config folder in the thread's data dir, passed as `CURSOR_CONFIG_DIR`. Its `cli-config.json` is a copy of yours with `Shell(*)` and `Write(**)` added to `permissions.deny`; everything else in the folder links to yours, so the login and chats stay put. Deny rules hold under `--force`, and MCP tools stay allowed. Cursor's read-only `--mode ask` is no use here: with `--force` it blocks nothing, and without it it blocks the `omni` tools too.
- Hermes and Cursor Cloud: refused. A thread there gets no `omni` tools, and Hermes takes no per-run tool limits, so a router could only do the work itself. Creating such a thread fails with the reason, and a Hermes thread that already has the role fails its turn the same way.

None of them gets the `omni-browser` MCP, and the system prompt drops the Artifacts and Browser sections for a "delegate first" rule. A router can still read files, search and use the `omni` tools to write a brief.

The conductor's `omni` MCP (`apps/mcp/omni.ts`) exposes `list_channels`, `list_crew`, `list_harnesses`, `harness_accounts`, `delegate`, `delegate_team`, `file_thread`, `message_thread`, `mark_thread_done`, `recover_thread_session`, `switch_thread_run`, `continue_thread`, `get_thread`, `list_threads`, `list_pull_requests`, `search_history`, `list_published_artifacts`, `check_artifact_comments`, `list_claude_artifacts`, `refresh_claude_artifacts`, `list_devices`, `machines`, `hand_off_thread`, `signed_in_devices`, `revoke_signed_in_device`, `rotate_install_token`, `mcp_clients`, `remove_mcp_client`, `send_to_grok_bot`, `read_referenced_thread`, `watch_pr`, `set_auto_merge`, `crew_prs`, `rerun_failed_checks`, `crew_questions`, `list_review_notes`, `list_automations`, `run_automation`, `set_automation_enabled`, `delete_automation`, `get_automation`, `save_automation`, `list_automation_deliveries`, `retry_delivery`, `skip_delivery`, `set_automations_machine`, `scan_usage`, `list_channel_actions`, `run_channel_action`, `worktree_storage`, `disk_space`, `settings`, `set_secret`, `sent_secrets`, `insights`, `tool_failures`, `triage_tool_failure`, `note_tool_failure_recovery`, `omni_connect_status`, `omni_connect_set`, `omni_update`. A tool that takes a `thread_id` also takes its first 8 characters or its `omni/<id>` branch, as the `omni` command does, looked up among the latest 500 threads. A delegated thread runs in the target channel; when it finishes, Omni posts its reply to the conductor as a crew report (tagged with the task id) and wakes the conductor to relay it. In the sidebar, the Inbox and phone Activity, each Conductor thread shows its delegated threads (and a team's members under their lead) as a tree under its row; how it opens, closes and what it lists are in [Threads](threads.md). The parent's header shows an overlapping avatar for each channel its delegated threads work in, once per channel and finished threads included, with every channel named in its tooltip. It shows only when one of them works outside the parent's own channel, draws four discs at most (three avatars and a +N chip past four channels), sits in the sub line on a phone and opens the parent's Details. The parent's Inbox card, sidebar row and phone Activity row show the same avatars ([Threads](threads.md)). A thread started as a crew role names it by the charter's `name` (Builder, Store ops) beside the channel crumb in its header, in a Role row in Details, and in the sub line under the title on a phone and in the iOS app. A thread without a role shows neither. The parent's Details tab lists its delegated threads, and the Conductor's channel page on the desktop still nests them under their parent. The phone Conductor list keeps a delegate count that opens the parent's Details. Any crew role whose frontmatter includes the `omni` MCP (Claude Code, Codex or Cursor Agent), except usage-scan, also gets a short Thread delegation section in its system prompt: use `delegate` or `delegate_team`, call `list_crew` and `list_channels` for valid ids, and write each brief as Goal, Done when and Proof back, since the child thread cannot see the parent's chat.

A parent follows up on a thread it already has with the prompt cache in mind (`apps/server/session-warmth.ts`). A thread's session counts as warm while it runs, before its first turn, and for an hour after its model's last reply, tool call or turn end; `get_thread` shows this as `session` (`warm`, `last_activity_at`, `idle_minutes`). A warm thread gets `message_thread`. The parent does not wake a cold one. It opens a new session with `continue_thread` or delegates a fresh thread that links it, and says which thread replaced which. `message_thread` (a send `from: "conductor"` to `POST /api/threads/:id/messages`) returns 409 for a cold thread unless it passes `wake_cold: true`, for when you asked to resume that thread itself. Your own messages from the composer are never refused. The hour is the best case. The provider can drop a cache sooner, for example to 5 minutes in overage, and Omni cannot see that.
