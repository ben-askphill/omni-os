# Configuration

Everything personal lives in `data/` (gitignored) or the secret store. Tracked files hold only shared code and generic examples, so a fork can pull upstream without conflicts ([FORKING.md](../../FORKING.md)).

## Where things live

| Where | What |
| --- | --- |
| `data/omni.config.json` | You, your folders, integrations (Hermes URL, central brain, the Tailscale login allowed through `tailscale serve`, the public MCP URL of a [Cloudflare Tunnel](external-mcp.md#from-anywhere-else-http), the Clerk instance for [Google sign-in](remote-access.md#sign-in-with-google)), automation on/off and this Mac's worktree retention policy. Every field: `omni.config.example.json` |
| `data/crew/*.md` | Your own version of a crew charter; replaces the one in `crew/` with the same name |
| `data/automations/*.yaml` | Your own automations; one with the same id as a shared one replaces it |
| `.env` | Server options (port, model defaults, concurrency). Example: `.env.example`. An env var wins over the config file. In a checkout it sits at the repo root; the packaged desktop app reads it from its data dir instead ([Server options](#server-options)) |
| Secret store | Secret values: the Keychain on a Mac, `data/secrets.json` on Linux. The database keeps their names only |

`npm run setup` or the first-run screens write `data/omni.config.json` ([Install](install.md#set-up-by-hand)). Change it later in Settings, which has the same sections on desktop web, phone web and the desktop app (`packages/shared/settings-catalog.ts`). The desktop app (`apps/desktop`) adds one more, Desktop app:

| Group | Sections |
| --- | --- |
| | General (you, run setup again), Appearance, Notifications |
| Agents | Harnesses & models (each harness, the default model per channel, the model options from `.env`), Threads (run new threads on, sessions and usage limits from `.env`, a link to Automations) |
| Code | Channels (each channel's settings and actions), Workspace (your folders, GitHub owner), Worktrees (storage and cleanup) |
| Connections | Machines (this machine and its server), Sync, Sharing & access (Google account, signed-in devices, Omni Connect, Tailscale logins, public MCP URL), Integrations (Hermes, central brain), Secrets |
| | Desktop app, only in the desktop app (Quick Prompt and its shortcut, Wispr Flow on a Mac, open at login, zoom, the app's version, server, log and updates), About (version, build, where the files live) |

- Search at the top of the nav finds a single setting and scrolls to it.
- Notifications, Harnesses & models, Channels, Workspace, Worktrees and Secrets have a scope picker: Every channel shows this machine's values, a channel shows what it sets and what it inherits. The pick stays as you move between sections.
- A chip beside each value says where it comes from: built-in default, set in `.env`, set on this machine, set on a channel, inherited, or this device only. Reset beside a saved value puts the default back. Values from `.env` are read-only there: change `.env` and restart the server (in the desktop app, **Server > Restart Server**).
- On the web, Settings is `#/settings` and each section has its own hash (`#/settings/threads`). The old `#/secrets`, `#/sync` and `#/storage` still open the section that holds them. The Conductor reads the same values with its `settings` tool. Your name goes into the Home greeting and every agent's prompt.

An install from before the config file existed writes one at its first boot from the old defaults and skips onboarding, so it keeps behaving as before.

## Placeholders in shared files

Crew charters and automation prompts can use these, filled from your config, so the shared files name nobody:

`{{user}}`, `{{workspace}}`, `{{reposDir}}`, `{{githubOwner}}`, `{{omniRoot}}`, `{{omniRepo}}`, `{{centralBrain}}`, `{{timezone}}`

`{{omniRoot}}` and `{{omniRepo}}` name an Omni git checkout, for the automations that work on Omni itself (docs-daily, brain-nightly, pr-babysitter, tool-failure-triage). A server run from a checkout uses that one. The packaged desktop app is not a checkout: it uses `OMNI_CHECKOUT` from its data dir's `.env`, or else the checkout whose `data/` it kept using. With neither, those automations show the error "needs an Omni checkout" and do not run.

## Server options

Optional. Copy `.env.example` to `.env` (gitignored) and uncomment what you need. It covers the port and host, the default model, permission mode, concurrency per harness, keepalive, browser flags, data and automations dirs, upload cap and reply suggestions (`OMNI_SUGGESTIONS=0` turns them off). Each line in `.env.example` says what it does.

Where `.env` goes depends on what runs the server:

- From a checkout (`npm run dev`, `npm start`, or the desktop app with `--dev`): the repo root.
- The packaged desktop app: its data dir, like `~/Library/Application Support/Omni/data/.env` ([where the data dir is](install.md#the-desktop-app)). If you moved over from the old SwiftUI app or Linux launcher and kept using the checkout's `data/`, the server also reads the checkout's `.env`; a line in `data/.env` wins over the same one there.

The desktop app, packaged or `--dev`, starts the server with a fixed environment, so a variable exported in your shell never reaches it: put it in `.env`. It also sets the port and data dir itself (`--port`, `--data-dir`), so `OMNI_PORT` and `OMNI_DATA_DIR` in `.env` have no effect there.

## Secrets

Values live in the server's secret store under service `omni-os`, account `<scope>/<NAME>`. The database keeps names only. Manage them in Settings > Secrets on every surface. That section says which store this server uses.

| Store | Default on | Where |
| --- | --- | --- |
| `keychain` | macOS | The login Keychain, through `security` |
| `file` | Linux | `data/secrets.json`, mode 0600 |
| `libsecret` | Never on its own | GNOME Keyring or KWallet, through `secret-tool` |

- `OMNI_SECRET_STORE=keychain|file|libsecret` picks one. Linux defaults to the file because a headless server has no desktop session to unlock a keyring. Use `libsecret` only when the server always starts inside one: a server started from ssh or systemd can't read values saved from the desktop.
- Values never sync, whatever the store, so set them on each machine. Switching stores leaves the old values behind; save them again.

- Scope `global` goes to every thread as an env var.
- Scope `channel:<slug>` goes only to that channel's threads and overrides a global with the same name.
- Billing keys stay out of a harness and the terminal. Sync keys stay out of the terminal, and a global one stays out of a harness. `GROKBOT_WEBHOOK_URL`, `GROKBOT_WEBHOOK_AUTH` and webhook signing secrets (`OMNI_WEBHOOK_*`) stay out of both, at any scope. See [Grok Bot](#grok-bot) and [GitHub webhooks](automations.md#github-webhooks).

## Channel actions

A channel's settings list its named actions: a name, a command, the secrets it needs (names only) and a port. Each thread runs them from its Actions tab. They are kept on this Mac and not synced.

- The command runs with your login shell in the thread's checkout, with the terminal's environment plus `OMNI_THREAD_ID`, `OMNI_BRANCH` and `OMNI_ARTIFACTS_DIR`.
- Secrets: only the names listed reach the run, read from the secret store (the channel's value, else the global one). A missing one stops the run before it starts. Billing, sync and Grok Bot keys can't be listed.
- Port: none, a free one per run, or a fixed one. A free one comes from 9300 to 9399, as `$OMNI_PORT` and `$PORT`, so two threads previewing at once never share one: `shopify theme dev --port $OMNI_PORT`. A fixed port that another run or another program holds stops the run with a message naming it. A command with `--port 9292` written in it is refused unless the action's port is set to 9292, so Omni knows about it.
- Setup: one action per channel can run in every new worktree, once each time the worktree is prepared. Pick "Before the agent starts" to hold the agent until it succeeds, or "Alongside the agent" to start both together. A blocking setup that fails, or one you stop, leaves the thread at Setup failed with its output and your first message kept, and Retry setup runs it again. Opening a thread or sending it a follow-up never reruns it. Threads in the channel's own checkout, Hermes and Cursor Cloud threads get no setup.

## Worktree storage

Settings > Worktrees inventories worktrees and explains why each is kept or eligible for cleanup. Review the scan before removing them, or turn on automatic retention for this Mac. Retention is off by default and stays local in `data/omni.config.json`; the old `OMNI_WORKTREE_SWEEP` option no longer controls cleanup. The guards and what survives removal are in [Known limits](limits.md).

## Grok Bot

Send to Grok Bot posts a thread's title and messages to a webhook. The context is the channel id and the thread id. That only goes one way. For Grok Bot to read threads and start work in Omni, connect it to Omni's MCP server: see [Connect Grok Bot](external-mcp.md#connect-grok-bot).

The action is in the thread's menu on desktop web and in the desktop app: the ⋯ in the thread header, or a right-click on the thread. On a phone it is in Thread options. The Conductor calls `send_to_grok_bot`.

The menu items show only once `GROKBOT_WEBHOOK_URL` is set, as a global secret or in `.env`. `GET /api/status` reports this as `grokBot`. Without it nothing of Grok Bot shows.

The URL and the Authorization value come from the Omni OS requests routine, on Grok Bot's Routines tab. Paste each one in either place.

1. Settings, Secrets, scope Global. Type `GROKBOT_WEBHOOK_URL` as the name and paste the URL, then do the same for `GROKBOT_WEBHOOK_AUTH`. Once the URL is saved, Known global secrets (the phone opens the same section) lists both names.
2. `.env`, as a fallback when the secret store has no value for that name. Copy the empty lines from `.env.example` and fill them in. An empty value leaves Grok Bot off. `.env` stays untracked.

When both are set, Omni uses the secret store's value. `GROKBOT_WEBHOOK_URL` is the routine's URL. `GROKBOT_WEBHOOK_AUTH` can be the bare key or a value that already starts with `Bearer `. Either form works. Omni leaves both values out of the log. A thread's harness and its terminal run without them.
