# Omni OS

One local workspace for all agent work. Replaces hopping between Claude Desktop, Cursor cloud agents and the Grok conductor bot.

- **Channels** per client or project (Volero, Pink Gellac, Acne, internal, personal)
- **Threads** per task, dated and full-text searchable, resumable any time
- **Sandbox per thread**: own git worktree in repo channels, a persistent browser per channel (logins survive), secrets from the Keychain injected as env
- **Artifacts** rendered inline: anything the agent writes to its artifacts dir
- **GitHub panel** per repo channel: PRs, checks, diff, merge (with confirm)
- **Conductor**: one front agent that delegates to crew roles; reports come back to it automatically
- **Automations**: cron YAML, every run is its own thread
- Runs on your **Claude subscription** through the official `claude` CLI. No API key, no Cursor caps.

## Run

```bash
npm install
npm run dev          # server on :4747, UI on http://localhost:4748
```

Production (one process, serves the built UI on http://127.0.0.1:4747):

```bash
npm run build && npm start
./scripts/install-launchd.sh      # autostart at login, keeps the Mac awake while running
tailscale serve --bg 4747         # reach it from your phone over the tailnet
```

Config is optional, see `.env.example` (brain dir, default model, concurrency, permission mode).

## How a thread runs

Each message spawns `claude -p --output-format stream-json` with:

| Piece | What |
| --- | --- |
| cwd | worktree `data/worktrees/<thread>` on branch `omni/<id>` (repo channels), else the channel base dir, else `~/phillbert` |
| context | `~/phillbert` added with `--add-dir`, its CLAUDE.md loaded, all your user skills and MCP servers |
| system prompt | channel facts (store, Portal slug, repo, notes), artifacts and browser rules, the crew role charter |
| MCP | `omni-browser` (Playwright, profile in `data/browsers/<channel>`); conductor also gets `omni` |
| env | `OMNI_THREAD_ID`, `OMNI_ARTIFACTS_DIR`, `OMNI_URL`, plus global and channel secrets |
| session | `--session-id` on the first run, `--resume` after, so every follow-up keeps full context |

Every stream event is stored in SQLite (`data/omni.db`) and pushed to the UI over SSE. The CLI's rate-limit events drive the 5h / 7d usage meter.

Messages sent while a thread is busy are queued: they show as "Queued" under the live output and enter the transcript when their turn starts. Stop cancels the current turn and drops anything queued.

Files can ride along with a message (paperclip, drag-and-drop or paste). They land in `data/threads/<id>/uploads/`, keeping their original names, and the agent gets every one by absolute path; images small enough for the API also go in as real image blocks. `OMNI_MAX_UPLOAD_MB` caps a single file.

To continue a thread in a terminal or Claude Desktop: `cd <cwd> && claude --resume <session id>` (the thread's Details panel has a copy button).

## Crew and conductor

Roles live in `crew/*.md` (frontmatter + charter, edit freely, read on every run):

| Role | For |
| --- | --- |
| conductor | Front agent in #conductor. Delegates, never does the grind or writes code |
| researcher | Research, audits, answers to client questions, HTML reports |
| store-ops | Shopify store work, PSI/SEO, translations, imports |
| builder | Code in a repo channel, own worktree, opens PRs |
| inbox | Mail, calendar, Productive, Notion, Slack drafts. Never sends on its own |

The conductor's `omni` MCP (`mcp/omni.ts`) exposes `list_channels`, `list_crew`, `delegate`, `message_thread`, `get_thread`, `list_threads`, `search_history`. A delegated thread runs in the target channel; when it finishes, its reply is posted to the conductor as a crew report (tagged with the task id) and the conductor is woken to relay it.

## Automations

`automations/*.yaml`:

```yaml
name: Morning coffee
enabled: false          # toggle here or in the UI
cron: "0 8 * * 1-5"
timezone: Europe/Amsterdam
channel: inbox
role: inbox
model: sonnet           # optional
prompt: |
  Run the morning-coffee skill for today.
```

The folder is watched; edits apply without a restart. The Mac has to be awake at the scheduled time.

## Secrets

Stored in the macOS Keychain under service `omni-os` (account `<scope>/<NAME>`). The DB keeps names only. Scope `global` goes to every thread; `channel:<slug>` only to that channel and overrides a global with the same name.

## Other entry points

- `scripts/omni.sh "prompt" -c volero -r researcher`: start a thread from the shell
- claude-bar hotkey prompt: set `"target": "omni"` in its config to send captures here
- `npm run import-history -- --days 30`: pull existing Claude Code sessions into Omni as resumable threads

## Layout

```
server/      Hono API, runner (claude CLI), sandbox, secrets, artifacts watcher, GitHub, scheduler
mcp/omni.ts  conductor tools
web/         React UI
crew/        role charters
automations/ cron YAML
scripts/     launchd install, shell shim, history import
data/        gitignored: db, thread dirs, worktrees, browser profiles, logs
```

## Limits

- Isolation is a worktree plus a browser profile, not a VM. Threads run with `bypassPermissions` because nobody can answer prompts headless; the write boundaries in phillbert's CLAUDE.md still apply.
- Only one live thread per channel gets the persistent browser profile; parallel ones get an isolated browser.
- Worktrees are not cleaned up automatically yet (`git worktree prune` in the repo).
- The run queue lives in memory. Restarting the server marks running threads failed and drops queued follow-ups; resend them.
- Subscription limits still apply. Concurrency is capped at 4 by default (`OMNI_MAX_CONCURRENT`).
