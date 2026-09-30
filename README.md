# Omni OS

One local workspace for all agent work. Replaces hopping between Claude Desktop, Cursor cloud agents and the Grok conductor bot.

One Node server runs everything (threads, harnesses, database, secrets, automations). Two clients sit on top of its `/api`:

| Client | What | Where |
| --- | --- | --- |
| Web UI | React app, in any browser and on the phone over Tailscale | `web/` |
| Mac app | Native SwiftUI app for the desk. Can start and stop the server itself | `mac/` |

Both show the same channels and threads. They never share code directly: see [Web UI and Mac app](#web-ui-and-mac-app).

- **Channels** per client or project (Volero, Pink Gellac, Acne, internal, personal)
- **Threads** per task, dated and full-text searchable, resumable any time
- **Sandbox per thread**: own git worktree in repo channels, a persistent browser per channel (logins survive) shown live in the thread's Browser panel, where you can click and type in it too, secrets from the Keychain injected as env
- **Artifacts** rendered inline: anything the agent writes to its artifacts dir
- **GitHub panel** per repo channel: PRs, checks, diff, merge (with confirm)
- **Conductor**: one front agent that delegates to crew roles; reports come back to it automatically
- **Automations**: cron YAML, every run is its own thread
- Runs each thread on the harness you pick — **Claude Code** (Claude plan), **Codex** (ChatGPT plan), **Cursor Agent** (Cursor plan) or **Hermes** (Anthropic API, on a remote server) — through its official CLI, or over HTTP for Hermes.

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

Mac app (needs Xcode, Node and this checkout on the Mac):

```bash
scripts/build-mac.sh              # Release build, installs to ~/Applications/Omni.app and opens it
npm run test:mac                  # OmniKit tests, headless
```

Or open `mac/Omni.xcodeproj` in Xcode and run the `Omni` scheme. The app finds the server on :4747, or starts one from the repo. See `mac/NOTES.md`.

Config is optional, see `.env.example` (brain dir, default model, concurrency, permission mode).

## How a thread runs

Each thread gets one long-lived `claude -p --input-format stream-json --output-format stream-json` process. Messages go in on stdin, the process runs many turns and stays warm for `OMNI_KEEPALIVE_SECONDS` (default 10 minutes) after the last one, so a follow-up starts instantly. It is launched with:

| Piece | What |
| --- | --- |
| cwd | worktree `data/worktrees/<thread>` on branch `omni/<id>` (repo channels), else the channel base dir, else `~/phillbert` |
| context | `~/phillbert` added with `--add-dir`, its CLAUDE.md loaded, all your user skills and MCP servers |
| system prompt | channel facts (store, Portal slug, repo, notes), artifacts and browser rules, the crew role charter |
| MCP | `omni-browser` (Playwright, attached over CDP to the channel's Chrome that Omni runs, profile in `data/browsers/<channel>`); conductor also gets `omni` |
| env | `OMNI_THREAD_ID`, `OMNI_ARTIFACTS_DIR`, `OMNI_URL`, plus global and channel secrets |
| session | `--session-id` on the first run, `--resume` after, so every follow-up keeps full context |

Every stream event is stored in SQLite (`data/omni.db`) and pushed to the UI over SSE. The CLI's rate-limit events drive the 5h / 7d usage meter.

Messages sent while a thread is busy:

| Mode | What happens |
| --- | --- |
| Steer (default, Cmd/Ctrl+Enter) | Written to the CLI now. The agent reads it at its next step (after the running tool) and keeps going |
| Queue for after this turn | Held by Omni, runs as a new turn once the current one ends |
| Interrupt and send (Cmd/Ctrl+Shift+Enter) | Stops the current step, then runs the message |

Pending messages show under the live output and enter the transcript at the point the agent actually read them. Interrupt (header button or Esc) stops the turn but keeps the process and its context. Steers already sent still run; queued ones are recorded as "Not sent". A CLI that does not stop within `OMNI_INTERRUPT_GRACE_MS` is killed. Only turns in progress count toward `OMNI_MAX_CONCURRENT`; warm idle processes do not.

Files can ride along with a message (paperclip, drag-and-drop or paste). They land in `data/threads/<id>/uploads/`, keeping their original names, and the agent gets every one by absolute path; images small enough for the API also go in as real image blocks. `OMNI_MAX_UPLOAD_MB` caps a single file.

To continue a thread in a terminal or Claude Desktop: `cd <cwd> && claude --resume <session id>` (the thread's Details panel has a copy button). Check there that the session is no longer warm first, so two processes do not write the same session.

## Hermes (remote)

Hermes is Ben's always-on agent on a Linux server. Omni does not spawn it. The Hermes API server listens on the server's Tailscale address and is not public. A thread talks to it at `OMNI_HERMES_URL` (default `http://100.110.128.38:8642`). The Mac must be on the tailnet.

The bearer token is the Keychain secret `HERMES_API_KEY` (global). It is not an env var, not a database column and not written to logs.

| Piece | What |
| --- | --- |
| Where it runs | On the Hermes server, in whatever clone Hermes already has. Omni does not create a worktree, browser profile or artifacts dir for the thread |
| Session | `omni-<thread id>`. The same id continues the conversation, with Hermes' own context |
| Prompt | Channel facts (repo, store, notes) go in `instructions` on the first run. The transcript shows only what Ben typed |
| Steer / interrupt | `POST /v1/runs/{id}/steer` and `/stop`. A steer that arrives after the run finished is queued as the next run |
| Attachments | Described in the message. The files stay on the Mac; Hermes cannot read those paths |
| Usage | Token counts on the run, not the plan meter. It bills the Anthropic API, not the Claude, ChatGPT or Cursor plan |
| Availability | `GET /v1/capabilities` with the bearer token. Missing key or an unreachable URL shows the fix in the model picker |

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

## Sync (two Macs)

Optional. Each Mac keeps its own SQLite as the source of truth; a Supabase project you own relays the changes between them (channels, threads, events, artifacts, automation runs, settings) and holds thread files in a private bucket. With no credentials sync is off and Omni behaves as before. Why a relay and not a shared database: ADR 0004.

One-time Supabase setup:

1. Create a Supabase project (the free tier is enough).
2. SQL Editor: paste `supabase/migrations/0001_changes.sql` and run it. It is safe to run again. Check that it worked:
   - Table Editor shows `changes`, with RLS on.
   - Storage shows a private bucket `omni`.
   - Database, Publications, `supabase_realtime` includes `changes`.
3. Authentication, Users, Add user: create the one user both Macs sign in as (tick Auto Confirm). Then, under Sign In / Providers, turn off "Allow new users to sign up".
4. Only if you want to sign in with an emailed code rather than a password: Authentication, Emails, Magic Link template, add `{{ .Token }}` to the body so the email carries the 6-digit code.
5. Project Settings, API: copy the Project URL and the anon (or publishable) key. Never use the service-role or secret key; Omni refuses one.

On each Mac: Web UI Sync page (`#/sync`) or Mac app Settings, Sync. Paste the URL and key, sign in as that same user. The first sign-in queues this Mac's existing history, and the other Mac pulls it. The URL, the key and the sign-in token go to the Keychain (global scope, never passed to threads); the password is used once and not stored. Sign Out stops syncing and removes them; Pause keeps them.

- Path map: paths travel with the home folder as `~`. When the other Mac keeps a folder somewhere else, map it on the Sync page, like `~/work` to `~/code`.
- Files: after a Mac's first sync, Omni uploads the files and session files of every thread it wrote last, in the background (the log counts progress every 50 threads). After that, a thread's files go up after each turn. The bucket fills a few minutes after the rows.
- `npm run sync:backfill`: queue every existing row again, for instance after restoring a database. It is idempotent and skips rows the other Mac wrote last.
- Signing in to a different project or user starts that relay from the beginning and queues the history again.
- A thread runs on one Mac at a time. Its row names the Mac running it (`run_machine`), so the other Mac shows it read-only until the run ends there, and an edit from the other Mac mid-run (a rename) never changes its status. After a crash, only the Mac that ran it marks it failed.
- Scheduled automations run on one Mac: the Sync page says which, and "Run them here" moves them. The first Mac to finish a sync with no owner set takes them. Manual runs work on either Mac.
- Copying `data/` to another Mac is fine: the folder remembers the Mac it was set up on (its hardware UUID), and on the next start the copy takes a new sync id and pulls the history again, logging one `[sync] this data folder was copied from another Mac` line. It never overwrites the Mac it came from, and scheduled automations stay there until you press "Run them here".

## Other entry points

- `scripts/omni.sh "prompt" -c volero -r researcher`: start a thread from the shell
- claude-bar hotkey prompt: set `"target": "omni"` in its config to send captures here
- `npm run import-history -- --days 30`: pull existing Claude Code sessions into Omni as resumable threads

## Web UI and Mac app

The two clients are kept apart so a change to one cannot break the other:

- `web/` imports only `web/`, `shared/` and server types. It never imports `mac/`.
- `mac/` imports only `mac/` and `shared/`. Its Swift code talks to the server over HTTP and SSE, never to `web/`.
- `shared/` holds the pure TypeScript both need (slash grammar, `/` menu ranking, command pills) and imports only itself. The Mac app runs it through JavaScriptCore from a checked-in bundle: run `npm run build:slash` after changing a slash module.
- `tests/app-boundaries.test.ts` fails on any import that crosses these lines.
- `tests/mac-fixtures.test.ts` pins the JSON the Mac app reads from the server, so a server change that would break the app fails `npm test`.
- Some screens copy a Web UI rule (transcript grouping, status line, format helpers). Those are ported to Swift with their own tests, not imported. A Web UI change to one of them should say whether the Mac app needs it too (ADR 0002).

## Layout

```
server/      Hono API, runner (claude CLI), sandbox, secrets, artifacts watcher, GitHub, scheduler
mcp/omni.ts  conductor tools
web/         Web UI (React)
mac/         Mac app: SwiftUI app (Omni/), OmniKit package, slash engine entry
shared/      pure TypeScript both clients use (slash grammar, menu, pills)
crew/        role charters
automations/ cron YAML
scripts/     launchd install, shell shim, history import, Mac build, slash bundle
tests/       vitest suite, including the Mac fixtures and the app boundary check
data/        gitignored: db, thread dirs, worktrees, browser profiles, logs
```

## Limits

- Isolation is a worktree plus a browser profile, not a VM. Threads run with `bypassPermissions` because nobody can answer prompts headless; the write boundaries in phillbert's CLAUDE.md still apply.
- Only one live thread per channel gets the persistent browser profile; parallel ones get an isolated browser.
- The channel browser (`server/browser.ts`) is one Chrome per channel that Omni launches on first use (a thread's MCP or the Browser panel) and closes after 5 idle minutes. The panel streams it with a CDP screencast and sends mouse, wheel and keys back (`/api/channels/:id/browser/*`). While someone watches, the page lays out at the viewer's size (`Emulation.setDeviceMetricsOverride`, sharp at the display's scale), so it reads like a real browser window in the panel; the last viewer to report a size wins, and with none watching the agent gets the 1280-wide desktop page back. Input goes in batches: a client queues while a batch is on its way and merges moves and scrolls. The frame is Chrome-like: tabs with favicons, the address bar, a loading bar, and Chrome's Cmd shortcuts (L, T, W, R, [, ], C, X, V; A and Z go to the page).
- Worktrees are not cleaned up automatically yet (`git worktree prune` in the repo).
- The run queue lives in memory. Restarting the server marks running threads failed and drops queued follow-ups; resend them.
- Subscription limits still apply. Each harness has its own concurrency cap (4 by default): `OMNI_MAX_CONCURRENT` (Claude Code), `OMNI_MAX_CONCURRENT_CODEX`, `OMNI_MAX_CONCURRENT_CURSOR`, `OMNI_MAX_CONCURRENT_HERMES`. A full harness never holds up threads on another. Hermes also enforces its own concurrent-run cap; Omni backs off and retries on HTTP 429.
