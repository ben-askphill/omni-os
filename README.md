# Omni OS

One local workspace for all agent work. Replaces hopping between Claude Desktop, Cursor cloud agents and the Grok conductor bot.

One Node server runs everything (threads, harnesses, database, secrets, automations). Two clients sit on top of its `/api`:

| Client | What | Where |
| --- | --- | --- |
| Web UI | React app, in any browser and on the phone over Tailscale | `apps/web/` |
| Mac app | Native SwiftUI app for the desk. Can start and stop the server itself | `apps/mac/` |

Both show the same channels and threads. They never share code directly: see [Web UI and Mac app](#web-ui-and-mac-app).

- **Channels** per client or project (Volero, Pink Gellac, Acne, internal, personal). Each has its own icon (emoji, design-system icon or SVG), default harness, model and effort, a design system file for the agent, and facts like the repo, Shopify store and Portal slug
- **Threads** per task, dated and full-text searchable (Search page), resumable any time. Rename or archive from the right-click menu or `/rename`
- **Composer**: `/` menu for skills, slash commands and MCP prompts per harness; `@` to mention artifacts and repo files; attachments; after a finished turn, Haiku suggests your likely next reply (Tab fills it in, `OMNI_SUGGESTIONS=0` turns it off)
- **Terminal tab** per thread: a real shell (PTY) in the thread's cwd. Billing and sync keys are kept out of its env
- **Sandbox per thread**: own git worktree in repo channels, a persistent browser per channel (logins survive) shown live in the thread's Browser panel, where you can click and type in it too, secrets from the Keychain injected as env
- **Artifacts** rendered inline: anything the agent writes to its artifacts dir
- **Published artifacts**: a page a Claude Code thread publishes to claude.ai with its Artifact tool shows as a card in the thread, linked to its local file. The channel's pages go into later threads' system prompt, so an update lands at the same URL, and "Check comments" (or the `artifact-comments` automation) hands a page's comments back to the thread that made it. There is no public Artifacts API, so Omni reads this from the CLI's own tool calls (`packages/shared/published.ts`)
- **Artifacts page**: every artifact across channels in one list
- **GitHub panel** per repo channel: PRs, checks, diff, merge (with confirm). Threads whose branch has an open or merged PR get a PR icon in the thread list
- **Conductor**: one front agent that delegates to crew roles, alone or as a team (a lead plus members); reports come back to it automatically and show as delegation cards
- **Automations**: cron YAML, every run is its own thread
- Runs each thread on the harness you pick — **Claude Code** (Claude plan), **Codex** (ChatGPT plan), **Cursor Agent** (Cursor plan) or **Hermes** (Anthropic API, on a remote server) — through its official CLI, or over HTTP for Hermes.

## Getting started

Forking Omni for yourself? Read [FORKING.md](FORKING.md) too: it says what is yours and how to pull updates.

### What you need

- macOS (the Mac app and Keychain secrets are Mac-only; the server and Web UI also run on Linux without them)
- Node 24+ and npm
- The `claude` CLI (Claude Code), signed in to your Claude plan: `npm install -g @anthropic-ai/claude-code`, then `claude` and `/login`
- `gh`, signed in, for the GitHub panel: `brew install gh && gh auth login`
- Optional: Codex (`npm install -g @openai/codex && codex login`), Cursor Agent (`curl https://cursor.com/install -fsS | bash && cursor-agent login`), Xcode for the Mac app

### Install and set up

```bash
git clone git@github.com:<you>/omni-os.git ~/omni-os
cd ~/omni-os
npm install
npm run setup        # asks who you are and where your work lives; Enter takes each default
```

`npm run setup` asks the same five things the first-run screens ask in the Web UI and the Mac app:

1. **You**: your name (what Omni and its agents call you), email, timezone (prefilled from the system) and pronouns (default they/them)
2. **Workspace**: the workspace folder (default `~/Omni`; threads without a repo run there and its CLAUDE.md and skills load in every Claude thread), your repos folder (default `~/code`) and your GitHub owner
3. **Harnesses**: which of Claude Code, Codex and Cursor Agent are installed and signed in, with the command to fix each one
4. **First channel**: a client or project with an optional repo and Shopify store, or skip
5. **Done**: saves `data/omni.config.json` and, in the apps, opens #conductor with a welcome message

It writes `data/omni.config.json`, which is gitignored with the rest of `data/`. Running it again is safe: every answer defaults to what is saved. `npm run setup -- --yes --name Ada --email ada@example.com` answers it without prompts (`--help` lists the flags). Skip it and the Web UI or Mac app asks on first open instead. Change anything later in **Settings** (web) or **Settings > Profile** (Mac), where **Run setup again** walks the screens once more.

### Start it

```bash
npm run dev          # server on :4747, UI on http://localhost:4748
```

Or the Mac app, which starts and stops the server itself:

```bash
scripts/build-mac.sh              # Release build, installs to ~/Applications/Omni.app and opens it
```

Production (one process, serves the built UI on http://127.0.0.1:4747):

```bash
npm run build && npm start
tailscale serve --bg 4747         # reach it from your phone over the tailnet
```

Optional: `./scripts/install-launchd.sh` installs a LaunchAgent that starts the server at login and keeps the Mac awake while it runs. Skip it when you use the Mac app.

### Your config

| Where | What |
| --- | --- |
| `data/omni.config.json` | You, your folders, integrations (Hermes URL, central brain), automation on/off. Example: `omni.config.example.json` |
| `data/crew/*.md` | Your own version of a crew charter; replaces the one in `crew/` with the same name |
| `data/automations/*.yaml` | Your own automations; one with the same id as a shared one replaces it |
| `.env` | Server options (port, model defaults, concurrency). Example: `.env.example`. An env var wins over the config file |
| Keychain | Secret values. The database keeps their names only |

Crew charters and automation prompts can use `{{user}}`, `{{workspace}}`, `{{reposDir}}`, `{{githubOwner}}`, `{{omniRoot}}`, `{{omniRepo}}`, `{{centralBrain}}` and `{{timezone}}`, filled from your config, so the shared files name nobody.

An install from before the config file existed writes one at its first boot from the old defaults and skips onboarding, so it keeps behaving as before.

Checks:

```bash
npm test             # turbo boundaries, then every package's vitest suite
npm run typecheck    # tsc in every package
npm run test:all     # vitest plus the Mac app's Swift tests
npx turbo run test --filter=@omni/web   # one package
npx turbo run test --affected           # only what changed against main
```

Mac app (needs Xcode, Node and this checkout on the Mac):

```bash
npm run test:mac                  # OmniKit tests, headless
```

Or open `apps/mac/Omni.xcodeproj` in Xcode and run the `Omni` scheme. The app finds the server on :4747, or starts one from the repo. See `apps/mac/NOTES.md`.

On first open, both clients ask what to call you. The name goes into the Home greeting and into every agent's prompt, and lives in Settings (web `#/settings`, Mac Settings > Profile). It is one kv row, so it syncs with your other settings.

Server options are optional: copy `.env.example` to `.env` (gitignored) and uncomment what you need. It covers the default model, permission mode, concurrency per harness, keepalive, browser flags, data and automations dirs, upload cap and reply suggestions. Who you are and where your work lives go in `data/omni.config.json` (above).

## Who can call the API

The network is the auth. The server binds `OMNI_HOST`, or `127.0.0.1` when that is unset, and Omni does not check a token. Anyone who can open the port can read threads, write Keychain entries via `POST /api/secrets`, merge PRs, and type into a thread shell. `tailscale serve` (above) is the supported remote path: the server stays on loopback, and the tailnet is the door.

## How a thread runs

Each Claude Code thread gets one long-lived `claude -p --input-format stream-json --output-format stream-json` process. Messages go in on stdin, the process runs many turns and stays warm for `OMNI_KEEPALIVE_SECONDS` (default 10 minutes) after the last one, so a follow-up starts instantly. While background agents of that thread are still running, it stays up to `OMNI_TASK_KEEPALIVE_SECONDS` (default 4 hours). It is launched with:

| Piece | What |
| --- | --- |
| cwd | worktree `data/worktrees/<thread>` on branch `omni/<id>` (repo channels), else the channel base dir, else your workspace folder |
| context | your workspace folder added with `--add-dir`, its CLAUDE.md loaded, all your user skills and MCP servers |
| system prompt | channel facts (store, Portal slug, repo, notes), artifacts and browser rules, the channel's design system file, the crew role charter |
| MCP | `omni-browser` (Playwright, attached over CDP to the channel's Chrome that Omni runs, profile in `data/browsers/<channel>`); conductor also gets `omni` |
| env | `OMNI_THREAD_ID`, `OMNI_ARTIFACTS_DIR`, `OMNI_URL`, plus global and channel secrets |
| session | `--session-id` on the first run, `--resume` after, so every follow-up keeps full context |

Codex threads run on `codex app-server` (ADR 0001) and Cursor threads on `cursor-agent`, each through an adapter in `apps/server/harness/` that turns its stream into the same events. Hermes is below.

Every stream event is stored in SQLite (`data/omni.db`) and pushed to the UI over SSE. The usage meter is per harness: Claude's rate-limit events drive the 5h / 7d meter, Codex reports its own, Cursor reports none.

Messages sent while a thread is busy:

| Mode | What happens |
| --- | --- |
| Steer (default, Enter) | Written to the CLI now. The agent reads it at its next step (after the running tool) and keeps going |
| Queue for after this turn | Held by Omni, runs as a new turn once the current one ends |
| Interrupt and send (Cmd/Ctrl+Shift+Enter) | Stops the current step, then runs the message |

Cmd/Ctrl+Enter adds a newline. Pending messages show under the live output and enter the transcript at the point the agent actually read them. Interrupt (header button or Esc) stops the turn but keeps the process and its context. Steers already sent still run; queued ones are recorded as "Not sent". A CLI that does not stop within `OMNI_INTERRUPT_GRACE_MS` is killed. Only turns in progress count toward `OMNI_MAX_CONCURRENT`; warm idle processes do not.

Files can ride along with a message (paperclip, drag-and-drop or paste). They land in `data/threads/<id>/uploads/`, keeping their original names, and the agent gets every one by absolute path; images small enough for the API also go in as real image blocks. `OMNI_MAX_UPLOAD_MB` caps a single file.

To continue a thread in a terminal or Claude Desktop: `cd <cwd> && claude --resume <session id>` (the thread's Details panel has a copy button). Check there that the session is no longer warm first, so two processes do not write the same session.

## Hermes (remote)

Hermes is an always-on agent on your own Linux server. Omni does not spawn it. The Hermes API server listens on the server's Tailscale address and is not public. A thread talks to it at `OMNI_HERMES_URL`, the server's Tailscale address and port (set it in Settings or `npm run setup`; empty means Hermes is off). The Mac must be on the tailnet.

The bearer token is the Keychain secret `HERMES_API_KEY` (global). It is not an env var, not a database column and not written to logs.

| Piece | What |
| --- | --- |
| Where it runs | On the Hermes server, in whatever clone Hermes already has. Omni does not create a worktree, browser profile or artifacts dir for the thread |
| Session | `omni-<thread id>`. The same id continues the conversation, with Hermes' own context |
| Prompt | Channel facts (repo, store, notes) go in `instructions` on the first run. The transcript shows only what you typed |
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

The frontmatter sets each role's model (Opus for most, Sonnet for inbox) and, for conductor and inbox, its default channel.

The conductor's `omni` MCP (`apps/mcp/omni.ts`) exposes `list_channels`, `list_crew`, `list_harnesses`, `delegate`, `delegate_team`, `message_thread`, `get_thread`, `list_threads`, `search_history`, `list_published_artifacts`, `check_artifact_comments`. A delegated thread runs in the target channel; when it finishes, its reply is posted to the conductor as a crew report (tagged with the task id) and the conductor is woken to relay it.

## Automations

`automations/*.yaml` are shared examples (`morning-coffee`, `weekly-review`, `artifact-comments`, `brain-nightly`, `pr-babysitter`), all off until you turn them on. Turning one on or off in the UI writes `automations.<id>.enabled` to `data/omni.config.json`, never the YAML, and `automations.<id>.channel` there moves it to another channel. Your own automations go in `data/automations/`.

```yaml
name: Morning coffee
enabled: false          # the default; the UI toggle overrides it per machine
cron: "0 8 * * 1-5"
timezone: Europe/Amsterdam  # optional, defaults to your timezone
channel: inbox          # default inbox
role: inbox
harness: claude         # optional, like model and effort
model: sonnet
prompt: |
  Run the morning-coffee skill for today.
```

`timezone` defaults to your timezone from the config (`OMNI_TZ` wins, else the system's). Both folders are watched; edits apply without a restart. The Mac has to be awake at the scheduled time.

## Mods

Claude Code mods are plugins of function hooks (Claude Code 2.1.287 and later, early access). The repo ships them in `mods/`. With `OMNI_MODS=1` in `.env`, every Claude Code thread's process starts with `--plugin-dir` for each one; the flag is off by default for now. Nothing is installed in `~/.claude`.

| Mod | What |
| --- | --- |
| `omni-progress` | Keeps a status line for the running turn (`Edit: src/foo.ts · 4 tools · 2m 10s`) and a summary when it ends (`Done · 7 tools · 1m 3s`). A watchdog toasts and logs when one tool call runs past 5 minutes, or the same tool fails 3 times in a row with the same input. It only observes: every hook passes the call through, and a failing hook passes it through too |

Under `-p` stream-json these come out as `system` events with subtype `ui_status`, `ui_toast` and `ui_log`.

- Bash is not watched by default. Any `tool.call` hook that matches Bash breaks subagents spawned with `isolation: "worktree"` (Claude Code bug #92533), so omni-progress names the other tools in its matcher. Its `watchBash` option turns Bash on; leave it off until that bug is fixed.
- Thresholds are `userConfig` options (`slowCallMinutes`, `repeatFailures`, `watchBash`), read from `pluginConfigs.omni-progress` in Claude Code settings.
- Hot reload is off under `-p`. A changed mod reaches a thread only once its warm process restarts (after `OMNI_KEEPALIVE_SECONDS`, or a server restart).
- Checks: `claude plugin validate mods/omni-progress` and `claude plugin test mods/omni-progress`. Neither type-checks; run `tsc` against the `claude-code.d.ts` the `plugin-authoring` skill writes.

## Secrets

Stored in the macOS Keychain under service `omni-os` (account `<scope>/<NAME>`). The DB keeps names only. Scope `global` goes to every thread; `channel:<slug>` only to that channel and overrides a global with the same name.

## Link previews

A link in a reply shows as its tool's mark, its id and the title the tool gives it (`#7723 Fix the cart`, `29549 Localization setup`), on the web and the Mac app. A link with its own words keeps them and gains the mark; hovering shows the source, state and URL.

- `packages/shared/link-sources.ts` reads what a URL points at, `apps/server/links.ts` asks the source for the live title and state (`POST /api/links/resolve`, cached 10 minutes), and the marks come from `packages/shared/link-icons.ts` (regenerate with `npx tsx packages/shared/scripts/build-link-icons.ts`).
- Sources with an API lookup, and the secret each needs (global, or the channel's own, which wins):

| Source | Secret |
| --- | --- |
| GitHub | none, uses your `gh` login |
| Azure DevOps | `AZURE_DEVOPS_PAT` |
| Jira, Confluence | `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN` |
| Productive | `PRODUCTIVE_API_KEY` |
| Shopify admin links | `SHOPIFY_ACCESS_TOKEN` |
| Notion | `NOTION_TOKEN` |
| Linear | `LINEAR_API_KEY` |
| Figma | `FIGMA_TOKEN` |
| Slack | `SLACK_BOT_TOKEN` |
| GitLab (private) | `GITLAB_TOKEN` |
| Sentry, Asana, ClickUp | `SENTRY_AUTH_TOKEN`, `ASANA_TOKEN`, `CLICKUP_TOKEN` |
| Trello | `TRELLO_KEY`, `TRELLO_TOKEN` |

- No secret needed: YouTube, Loom and Vimeo (oEmbed), npm, public GitLab and Bitbucket PRs, claude.ai artifacts Omni published, and Google Docs shared by link. Notion, Figma, Linear, Confluence and Trello links fall back to the title in their URL.
- Google Drive, Miro, Canva, Vercel, HubSpot, Klaviyo, Stripe, DatoCMS, Prismic, SharePoint, Teams and others get their mark and what the URL says. Any other public page shows its `<title>`; private, loopback and link-local addresses are never fetched.
- Credentials only go to fixed API hosts (or a self-hosted GitLab named in `GITLAB_HOST`), with ids from a link checked before they go in a request path, and no redirects. The page-title fetch checks the address it connects to, so DNS rebinding cannot reach a private one.
- Without its secret a link reads "Work item 29549", and its tooltip names the secret to add.

## Sync (two Macs)

Optional. Each Mac keeps its own SQLite as the source of truth; a Supabase project you own relays the changes between them (channels, sidebar folders, threads, events, artifacts, automation runs, settings) and holds thread files in a private bucket. With no credentials sync is off and Omni behaves as before. Why a relay and not a shared database: ADR 0004.

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
- Sidebar folders sync, along with which folder each thread sits in. Whether a folder shows open or closed stays per Mac. A relay set up before folders synced refuses them: paste `0001_changes.sql` in the SQL Editor again. Until then the rest keeps syncing and folders wait, counted as held.
- Needs you is the same on both Macs: a result reviewed on one leaves the other's after the next sync, and a newer result stays unread. A relay set up before this refuses results and reads: paste `0001_changes.sql` again, as for folders.
- A thread runs on one Mac at a time. Its row names the Mac running it (`run_machine`), so the other Mac shows it read-only until the run ends there, and an edit from the other Mac mid-run (a rename) never changes its status. After a crash, only the Mac that ran it marks it failed.
- Scheduled automations run on one Mac: the Sync page says which, and "Run them here" moves them. The first Mac to finish a sync with no owner set takes them. Manual runs work on either Mac.
- Copying `data/` to another Mac is fine: the folder remembers the Mac it was set up on (its hardware UUID), and on the next start the copy takes a new sync id and pulls the history again, logging one `[sync] this data folder was copied from another Mac` line. It never overwrites the Mac it came from, and scheduled automations stay there until you press "Run them here".

## Other entry points

- `scripts/omni.sh "prompt" -c volero -r researcher`: start a thread from the shell (`OMNI_URL` points it at another server)
- claude-bar hotkey prompt: set `"target": "omni"` in its config to send captures here
- `npm run import-history -- --days 30`: pull existing Claude Code sessions into Omni as resumable threads

## Web UI and Mac app

The two clients are kept apart so a change to one cannot break the other:

- `apps/web/` imports only `apps/web/`, `packages/shared/` and server types. It never imports `apps/mac/`.
- `apps/mac/` imports only `apps/mac/` and `packages/shared/`. Its Swift code talks to the server over HTTP and SSE, never to `apps/web/`.
- `packages/shared/` holds the pure TypeScript both need (slash grammar, `/` menu ranking, command pills) and imports only itself. The Mac app runs it through JavaScriptCore from a checked-in bundle: run `npm run build:slash` after changing a slash module.
- `turbo boundaries` (part of `npm test`) fails on any import that crosses these lines: a file outside its package, a package that is not a declared dependency, or a dependency the tags in `turbo.json` deny.
- `apps/server/tests/mac-fixtures.test.ts` pins the JSON the Mac app reads from the server, so a server change that would break the app fails `npm test`.
- Some screens copy a Web UI rule (transcript grouping, status line, format helpers). Those are ported to Swift with their own tests, not imported. A Web UI change to one of them should say whether the Mac app needs it too (ADR 0002).

## Layout

An npm workspaces monorepo run with Turborepo (`turbo.json`). Each app and package has its own
`package.json`, `tests/` and vitest config.

```
apps/server/                @omni/server: Hono API (*-api.ts), runner/, harness/ (claude, codex, cursor,
                            hermes adapters), db/, sync/, sandbox, secrets, terminal, browser, artifacts,
                            GitHub, scheduler; scripts/ for history import and sync backfill
apps/mcp/                   @omni/mcp: omni.ts, the conductor tools
apps/web/                   @omni/web: Web UI (React, Vite)
apps/mac/                   @omni/mac: SwiftUI app (Omni/), OmniKit package, slash engine entry and bundler
packages/shared/            @omni/shared: pure TypeScript both clients use (slash grammar, menu, pills)
packages/test-fixtures/     @omni/test-fixtures: fake CLIs and corpora the TS and Swift tests share
packages/typescript-config/ @omni/typescript-config: the tsconfig bases every package extends
crew/                       shared role charters (yours override them from data/crew/)
automations/                shared cron YAML (yours go in data/automations/)
omni.config.example.json    every field of data/omni.config.json
mods/                       Claude Code mods loaded with OMNI_MODS=1 (omni-progress)
scripts/                    shell shim, Mac build, QA stack, PR screenshots, launchd install
docs/                       ADRs (adr/0001 to 0004) and the PR screenshot guide
supabase/                   sync relay migration
CONTEXT.md                  domain glossary (channel, thread, harness, crew...)
data/                       gitignored: your config, db, thread dirs, worktrees, browser profiles, logs
```

## Contributing

- Read `CLAUDE.md` and `CONTEXT.md` first; the agent working in this repo reads them too.
- A change visible in the Web UI or Mac app ships with before/after screenshots in the PR, taken against a throwaway server (never :4747). See `docs/pr-screenshots.md` and `scripts/pr-screenshots.sh`.
- Never commit `data/` or `.env`, and never put a secret value anywhere but the Keychain.

## Limits

- Isolation is a worktree plus a browser profile, not a VM. Threads run with `bypassPermissions` because nobody can answer prompts headless; the write boundaries in your workspace folder's CLAUDE.md still apply.
- Only one live thread per channel gets the persistent browser profile; parallel ones get an isolated browser.
- The channel browser (`apps/server/browser.ts`) is one Chrome per channel that Omni launches on first use (a thread's MCP or the Browser panel) and closes after 5 idle minutes. The panel streams it with a CDP screencast and sends mouse, wheel and keys back (`/api/channels/:id/browser/*`). While someone watches, the page lays out at the viewer's size (`Emulation.setDeviceMetricsOverride`, sharp at the display's scale), so it reads like a real browser window in the panel; the last viewer to report a size wins, and with none watching the agent gets the 1280-wide desktop page back. Input goes in batches: a client queues while a batch is on its way and merges moves and scrolls. The frame is Chrome-like: tabs with favicons, the address bar, a loading bar, and Chrome's Cmd shortcuts (L, T, W, R, [, ], C, X, V; A and Z go to the page).
- Worktrees are not cleaned up automatically yet (`git worktree prune` in the repo).
- The run queue lives in memory. Restarting the server marks running threads failed and drops queued follow-ups; resend them.
- Subscription limits still apply. Each harness has its own concurrency cap (4 by default): `OMNI_MAX_CONCURRENT` (Claude Code), `OMNI_MAX_CONCURRENT_CODEX`, `OMNI_MAX_CONCURRENT_CURSOR`, `OMNI_MAX_CONCURRENT_HERMES`. A full harness never holds up threads on another. Hermes also enforces its own concurrent-run cap; Omni backs off and retries on HTTP 429.
