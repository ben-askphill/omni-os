# Crew and Conductor

Each role is a file in `crew/*.md` with frontmatter and a charter. Omni reads them on every run. The shipped charters are generic and go to every install, so they name no person, company, client or tool of anyone's own. The desktop build fails when one does (`personalCrewProblems` in `apps/desktop/scripts/stage.ts`).

| Role | For |
| --- | --- |
| conductor | Front agent in #conductor. Answers quick asks itself, routes real work to a crew thread |
| researcher | Research, audits, answers to client questions, HTML reports |
| writer | Drafts and edits writing in your voice: emails, posts, proposals, docs, summaries. Never sends or publishes |
| builder | Code in a repo channel, own worktree, opens PRs. |
| reviewer | Reviews a PR against its brief, from the spec and diff only. Read only. A review role (`review: true`) |
| inbox | Admin: mail, calendar, time tracking, tasks, notes and chat drafts. Never sends on its own; Approve on a run's question card is the go-ahead for that draft |
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
- Hiding a built-in is per machine (`crew` in `data/omni.config.json`): no new thread starts as it, and lists leave it out. The conductor and usage-scan cannot be hidden (see [Roles Omni relies on](#roles-omni-relies-on)).

`delegatable: false` keeps a role out of the Conductor's `list_crew` and makes `delegate` and `delegate_team` refuse it. The conductor and usage-scan set it. Starting a thread as a role no file has, or one hidden on this machine, is refused with the valid ids; it used to run with no charter.

`harness` is the role's runtime binding: any harness id this machine's catalog has, checked when the role is saved. A role whose harness this machine lacks still loads, with an error on it. Omni keeps frontmatter keys it does not know when it edits a file.

## Settings > Crew

Settings > Crew, in the Agents group, lists every role this machine has, hidden ones included, on desktop web, phone web and the desktop app. Each row shows the role's avatar, its chips (Built-in, Edited or Yours, then Hidden, Built-in charter changed, or Can't run here when its run defaults name a harness or model this machine lacks), its description and the run it defaults to. The iOS app gets the section later; until then use phone web.

- **New role** makes a role of your own: a name, an id (made from the name; it never changes), a description, an avatar, a charter, run defaults, a default channel and its powers.
- **Edit** opens a Form or the Markdown. On a built-in, the form writes your overlay: a field you set back to the built-in's value leaves the overlay, so a release sets it again, and your text is added to the built-in charter (Add to built-in) or replaces it (Replace). Markdown saves the file as written. The two tabs are one draft: switching carries your edits across, and keys the form does not show stay in the file.
- **Avatar**: one of the shared icons or one emoji, on a background color, as channels have (no SVG upload: it would not read in a markdown file). `avatar: { icon: icon:tool, bg: "#d4e9fa" }` in the frontmatter. Without one a built-in keeps its mark and any other role shows its initials. The composer's Role picker shows the same avatar.
- **Duplicate** makes a role of your own with everything the role has now, its whole charter included. A copy of a built-in no longer changes with a release.
- **Compare with built-in** shows the built-in charter and yours line by line. When the built-in changed under a charter you replaced, it offers Keep mine, Add mine to the new one, or Take the new one.
- **Hide** and **Show** a built-in on this machine, **Reset to built-in** drops your overlay, and **Delete** removes a role of your own.
- **Powers**: whether the Conductor may delegate to it, the conductor tools, whether it only routes work, and whether it reviews work (`review: true`). A field or action the role cannot change shows a lock and why.

The composer's Role picker leaves out roles the Conductor may not delegate to, as `list_crew` does, except the Conductor itself, which the composer attaches in #conductor.

## The API

The clients edit roles through the API, the same files underneath:

| Call | Does |
| --- | --- |
| `GET /api/crew` | Every role this machine offers, each with `kind` (`shipped`, `edited` or `own`), `hidden`, `delegatable`, `review`, `locks` on the roles Omni relies on and, for an edit, `charterMode` and `builtInChanged`. `?all=1` adds the hidden ones |
| `GET /api/crew/:id` | The role, the built-in alone (`builtIn`), the shipped file's text, your file's text, the shipped charter's hash, and the charters as written (`charters.builtIn`, `charters.own`, `charters.effective`) |
| `POST /api/crew` | A new role of your own: `{ id, fields, charter }` or `{ id, markdown }` |
| `PUT /api/crew/:id` | Edit a role: `{ fields, charter?, charter_mode? }` or `{ markdown }`. On a built-in it writes the overlay. An empty field (or null, for `avatar`, `mcp`, `delegate_only`, `delegatable` and `review`) removes it. Send `charter` and `charter_mode` only to change them: either one records the built-in charter as seen |
| `POST /api/crew/draft` | `{ id?, own?, save }`: the file a save would write and the role it makes, nothing written. `own` stands in for your file. Settings' Form and Markdown tabs turn into each other through it |
| `POST /api/crew/:id/duplicate` | `{ id, name? }`: a new role of your own with everything this one has |
| `DELETE /api/crew/:id` | Delete a role of your own |
| `POST /api/crew/:id/reset` | Drop your edit of a built-in |
| `POST /api/crew/:id/hidden` | `{ hidden }` for a built-in |

A save is refused when its run defaults, default channel or MCP servers are unknown here, when it breaks a lock below, or when it puts a role that only routes work on Hermes or Cursor Cloud, where it would never start.

## Roles Omni relies on

Three built-ins keep fields and refuse actions, each with a reason the API sends as `locks` and Settings shows by the field. Everything else about them is yours to edit, and Reset always works.

| Role | Locked | Refused |
| --- | --- | --- |
| conductor | `delegate_only`, the `omni` MCP server, `delegatable: false` | Duplicate, Hide |
| usage-scan | `delegate_only`, the `omni` MCP server, `delegatable: false`, and its charter can only be added to (`charter_mode: append`) | Duplicate (a copy would not be a usage scan: only Omni starts one), Hide |
| reviewer | `review: true` | none: duplicate it for a reviewer without the review rules |

The locks hold however the file got there. A crew file another machine syncs that breaks one is refused and listed under Refused changes in Settings > Sync, and an overlay written by hand loads with the locked fields as the built-in has them (its other edits still apply).

No role of your own takes one of these ids. Builder has no locks; Review PR runs as it, so while it is hidden Review PR refuses with a note to show it again.

A role is a prompt every later thread of it runs with, so an agent thread's write (one that names its thread in `x-omni-thread`, as Omni's MCP servers do) goes through the crew guard (`apps/server/crew-guard.ts`) and gets a 403 unless all of these hold:

- It is a save or a reset. Deleting, hiding and showing a role stay yours, in Settings. A reset that would change the role's powers (your edit gave the built-in the conductor tools, say) is refused: reset it yourself.
- The thread runs as the Conductor. No other role writes roles, even one you gave the `omni` MCP server, and usage-scan never does.
- The save leaves powers alone: no `mcp`, `delegate_only`, `delegatable` or `review`, and no whole-file `markdown`. Those are yours to set.
- No automation started the thread or any thread above it.
- You answered in that thread after its first message, or answered a question it asked. The guard cannot read whether you agreed: it holds the Conductor to proposing an edit and waiting for you. An agent's own call never counts as your answer: a message an agent thread sends (`x-omni-thread`), including through `check_artifact_comments` or a compact, is recorded as the Conductor's, and an agent thread cannot answer a question card. The same holds for review notes an agent thread sends, and for messages a thread carries when it moves to another machine, which keep their sender.

Like the automation guard, it holds the path agents are told to use. A shell command that calls the API without the header is not stopped.

The Conductor writes roles with its own tools, which go through that guard:

- `get_crew_role` reads a role by id, the Conductor and usage-scan included: its fields, powers, locks and charters as written (`charters.built_in`, `own`, `effective`).
- `save_crew_role` creates a role of your own (`create: true`) or edits one. On a built-in it writes your overlay, adding to the charter unless it says `replace`. Its `charter` is the whole text of your file for the role, so the Conductor starts from `get_crew_role`.
- `reset_crew_role` drops your edit of a built-in.

The Conductor proposes the role or the edit in its thread and saves it once you answer. A role it creates names no power, so it gets what any role without them gets: no conductor tools, not delegate-only, not a review role, and delegatable, so `list_crew` and `delegate` offer it at once. It shows in Settings > Crew as Yours and syncs as `crew_file`, like a role you made. A power the save names comes back as the guard's refusal, and nothing is written. No Conductor tool deletes, hides or duplicates a role. The external MCP has none of these tools: its calls name no thread, so the guard would take them for yours.

Your edits sync to your other Macs as `crew_file`, a signed action that applies only from a trusted machine ([Sync](sync.md)). Hiding stays per Mac.

The frontmatter sets each role's model and, for conductor and inbox, its default channel. The conductor defaults to `model: auto`, so the Overview and Conductor composers start on Auto; a saved #conductor channel default still wins (see [Auto](harnesses.md#auto)). The other roles also default to `model: auto`, so each delegated brief gets the model it needs. Pin a model in a role's frontmatter to opt it out.

The conductor does not review a PR by itself. When a builder reports one, it relays the PR and you say whether you want it reviewed. When you ask, it delegates to `reviewer` with `review_of: <builder thread id>` and no run, and Omni picks the other model family from that thread's run (`apps/server/harness/review.ts`):

- Work Claude wrote (Claude Code, Hermes, or a `claude-*` model on Cursor) is reviewed on Codex, on `gpt-6.1-sol` at `high`. The Conductor's brief then follows `/code-review:code-review` from the `gpt-review` skill where the machine has it in `~/.agents/skills`, else the reviewer charter's own steps.
- Work any other model wrote (GPT, Composer, Grok, Gemini) is reviewed on Claude Code, on `claude-opus-5-5` at `xhigh`.
- Those runs are pinned. When this machine's catalog lacks the model, or the model lacks the effort, the review is refused (409): Omni never runs it on Codex's default or the nearest model or effort instead.
- A run the delegation names is kept when it is on the other family. The same family is refused, and so is a thread whose run does not say its family (Cursor's own `auto`, a runtime Omni does not know), or a review whose harness is not available here. The Conductor then asks you.
- `review_of` needs a review role. It is on `POST /api/threads` and on the Conductor's `delegate` tool.

A thread as a review role (`review: true`: the shipped reviewer, or a role of your own with Reviews work on) on a GPT model (Codex, or a `gpt-*` model on Cursor) always runs at `high` effort. Omni sets it when the thread is made, switched to another run or continued, even when `xhigh` or no effort was asked for. Claude reviewers keep the effort they were given.

`delegate_only: true` in a role's frontmatter makes it a router that runs without the tools that do work. The conductor sets it, and so does usage-scan, which only reads its first message and saves what you pick.

- Claude Code: `--disallowedTools` for Bash, Edit, Write, NotebookEdit, Agent, Task, Workflow, Artifact, ArtifactData and the browser MCPs.
- Codex: a `read-only` sandbox.
- Cursor Agent: its own config folder in the thread's data dir, passed as `CURSOR_CONFIG_DIR`. Its `cli-config.json` is a copy of yours with `Shell(*)` and `Write(**)` added to `permissions.deny`; everything else in the folder links to yours, so the login and chats stay put. Deny rules hold under `--force`, and MCP tools stay allowed. Cursor's read-only `--mode ask` is no use here: with `--force` it blocks nothing, and without it it blocks the `omni` tools too.
- Hermes and Cursor Cloud: refused. A thread there gets no `omni` tools, and Hermes takes no per-run tool limits, so a router could only do the work itself. Creating such a thread fails with the reason, and a Hermes thread that already has the role fails its turn the same way.

None of them gets the `omni-browser` MCP, and the system prompt drops the Artifacts and Browser sections for a router's rule: answer a quick ask (the conversation, Omni's own state, a light lookup) in the thread with no new thread, no brief and no folder question, and delegate work that writes, runs, browses at length, changes code or a store, or will clearly grow. A router can still read files, search, use its connectors and use the `omni` tools to answer or to write a brief.

The conductor's `omni` MCP (`apps/mcp/omni.ts`) exposes `list_channels`, `list_crew`, `get_crew_role`, `save_crew_role`, `reset_crew_role`, `list_harnesses`, `harness_accounts`, `delegate`, `delegate_team`, `file_thread`, `message_thread`, `mark_thread_done`, `recover_thread_session`, `switch_thread_run`, `continue_thread`, `get_thread`, `list_threads`, `list_pull_requests`, `search_history`, `list_published_artifacts`, `check_artifact_comments`, `list_claude_artifacts`, `refresh_claude_artifacts`, `list_devices`, `machines`, `hand_off_thread`, `signed_in_devices`, `revoke_signed_in_device`, `rotate_install_token`, `mcp_clients`, `remove_mcp_client`, `send_to_grok_bot`, `read_referenced_thread`, `watch_pr`, `set_auto_merge`, `crew_prs`, `rerun_failed_checks`, `crew_questions`, `list_review_notes`, `list_automations`, `run_automation`, `set_automation_enabled`, `delete_automation`, `get_automation`, `save_automation`, `list_automation_deliveries`, `retry_delivery`, `skip_delivery`, `set_automations_machine`, `scan_usage`, `list_channel_actions`, `run_channel_action`, `worktree_storage`, `disk_space`, `settings`, `set_secret`, `sent_secrets`, `insights`, `tool_failures`, `triage_tool_failure`, `note_tool_failure_recovery`, `omni_connect_status`, `omni_connect_set`, `omni_update`. A tool that takes a `thread_id` also takes its first 8 characters or its `omni/<id>` branch, as the `omni` command does, looked up among the latest 500 threads. A delegated thread runs in the target channel; when it finishes, Omni posts its reply to the conductor as a crew report (tagged with the task id). The report shows on that thread's row of the delegation card (desktop web, phone web and iOS) and starts no Conductor turn: the conductor's harness reads it with your next message. A delegation made with `follow_up: true` (the conductor will act on the report: the next step of a chain, combining reports, a review's findings) wakes the conductor instead, as a busy conductor is steered the report while it runs. Reports to any other parent wake it as before. In the sidebar, the Inbox and phone Activity, each Conductor thread shows its delegated threads (and a team's members under their lead) as a tree under its row; how it opens, closes and what it lists are in [Threads](threads.md). The parent's header shows an overlapping avatar for each channel its delegated threads work in, once per channel and finished threads included, with every channel named in its tooltip. It shows only when one of them works outside the parent's own channel, draws four discs at most (three avatars and a +N chip past four channels), sits in the sub line on a phone and opens the parent's Details. The parent's Inbox card, sidebar row and phone Activity row show the same avatars ([Threads](threads.md)). A thread started as a crew role names it by the charter's `name` (Builder, Store ops) beside the channel crumb in its header, in a Role row in Details, and in the sub line under the title on a phone and in the iOS app. A thread without a role shows neither. The parent's Details tab lists its delegated threads, and the Conductor's channel page on the desktop still nests them under their parent. The phone Conductor list keeps a delegate count that opens the parent's Details. Any crew role whose frontmatter includes the `omni` MCP (Claude Code, Codex or Cursor Agent), except usage-scan, also gets a short Thread delegation section in its system prompt: use `delegate` or `delegate_team`, call `list_crew` and `list_channels` for valid ids, and write each brief as Goal, Done when and Proof back, since the child thread cannot see the parent's chat.

A parent follows up on a thread it already has with the prompt cache in mind (`apps/server/session-warmth.ts`). A thread's session counts as warm while it runs, before its first turn, and for an hour after its model's last reply, tool call or turn end; `get_thread` shows this as `session` (`warm`, `last_activity_at`, `idle_minutes`). A warm thread gets `message_thread`. The parent does not wake a cold one. It opens a new session with `continue_thread` or delegates a fresh thread that links it, and says which thread replaced which. `message_thread` (a send `from: "conductor"` to `POST /api/threads/:id/messages`) returns 409 for a cold thread unless it passes `wake_cold: true`, for when you asked to resume that thread itself. Your own messages from the composer are never refused. The hour is the best case. The provider can drop a cache sooner, for example to 5 minutes in overage, and Omni cannot see that.
