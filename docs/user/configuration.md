# Configuration

Everything personal lives in `data/` (gitignored) or the Keychain. Tracked files hold only shared code and generic examples, so a fork can pull upstream without conflicts ([FORKING.md](../../FORKING.md)).

## Where things live

| Where | What |
| --- | --- |
| `data/omni.config.json` | You, your folders, integrations (Hermes URL, central brain, the Tailscale login allowed through `tailscale serve`), Google sign-in (`auth`, see [Sign in with Google](google-sign-in.md)), automation on/off and this Mac's worktree retention policy. Every field: `omni.config.example.json` |
| `data/crew/*.md` | Your own version of a crew charter; replaces the one in `crew/` with the same name |
| `data/automations/*.yaml` | Your own automations; one with the same id as a shared one replaces it |
| `.env` | Server options (port, model defaults, concurrency). Example: `.env.example`. An env var wins over the config file |
| Keychain | Secret values. The database keeps their names only |

`npm run setup` or the first-run screens write `data/omni.config.json` ([Install](install.md#set-up-by-hand)). Change it later in **Settings** (web, `#/settings`) or **Settings > Profile** (Mac). Your name goes into the Home greeting and every agent's prompt.

An install from before the config file existed writes one at its first boot from the old defaults and skips onboarding, so it keeps behaving as before.

## Placeholders in shared files

Crew charters and automation prompts can use these, filled from your config, so the shared files name nobody:

`{{user}}`, `{{workspace}}`, `{{reposDir}}`, `{{githubOwner}}`, `{{omniRoot}}`, `{{omniRepo}}`, `{{centralBrain}}`, `{{timezone}}`

## Server options

Optional. Copy `.env.example` to `.env` (gitignored) and uncomment what you need. It covers the port and host, the default model, permission mode, concurrency per harness, keepalive, browser flags, data and automations dirs, upload cap and reply suggestions (`OMNI_SUGGESTIONS=0` turns them off). Each line in `.env.example` says what it does.

## Secrets

Stored in the macOS Keychain under service `omni-os` (account `<scope>/<NAME>`). The database keeps names only. Manage them on the Secrets page (web) or **Settings > Secrets** (Mac).

- Scope `global` goes to every thread as an env var.
- Scope `channel:<slug>` goes only to that channel's threads and overrides a global with the same name.
- Billing keys stay out of a harness and the terminal. Sync keys stay out of the terminal, and a global one stays out of a harness. `GROKBOT_WEBHOOK_URL`, `GROKBOT_WEBHOOK_AUTH`, webhook signing secrets (`OMNI_WEBHOOK_*`) and the Google sign-in client secrets (`GOOGLE_OAUTH_CLIENT_SECRET` and `GOOGLE_OAUTH_WEB_CLIENT_SECRET`) stay out of both, at any scope. See [Grok Bot](#grok-bot), [GitHub webhooks](automations.md#github-webhooks) and [Sign in with Google](google-sign-in.md).

## Channel actions

A channel's settings list its named actions: a name, a command, the secrets it needs (names only) and a port. Each thread runs them from its Actions tab. They are kept on this Mac and not synced.

- The command runs with your login shell in the thread's checkout, with the terminal's environment plus `OMNI_THREAD_ID`, `OMNI_BRANCH` and `OMNI_ARTIFACTS_DIR`.
- Secrets: only the names listed reach the run, read from the Keychain (the channel's value, else the global one). A missing one stops the run before it starts. Billing, sync and Grok Bot keys can't be listed.
- Port: none, a free one per run, or a fixed one. A free one comes from 9300 to 9399, as `$OMNI_PORT` and `$PORT`, so two threads previewing at once never share one: `shopify theme dev --port $OMNI_PORT`. A fixed port that another run or another program holds stops the run with a message naming it. A command with `--port 9292` written in it is refused unless the action's port is set to 9292, so Omni knows about it.
- Setup: one action per channel can run in every new worktree, once each time the worktree is prepared. Pick "Before the agent starts" to hold the agent until it succeeds, or "Alongside the agent" to start both together. A blocking setup that fails, or one you stop, leaves the thread at Setup failed with its output and your first message kept, and Retry setup runs it again. Opening a thread or sending it a follow-up never reruns it. Threads in the channel's own checkout, Hermes and Cursor Cloud threads get no setup.

## Worktree storage

Settings > Storage inventories worktrees and explains why each is kept or eligible for cleanup. Review the scan before removing them, or turn on automatic retention for this Mac. Retention is off by default and stays local in `data/omni.config.json`; the old `OMNI_WORKTREE_SWEEP` option no longer controls cleanup. The guards and what survives removal are in [Known limits](limits.md).

## Grok Bot

Send to Grok Bot posts a thread's title and messages to a webhook. The context is the channel id and the thread id.

The button is in the thread header on the Web UI and on the Mac app. A narrow desktop web header puts it in More. The same action is in the thread's right-click menu on both, and in Thread options on a phone. The Conductor calls `send_to_grok_bot`.

The URL and the Authorization value come from the Omni OS requests routine, on Grok Bot's Routines tab. Paste each one in either place.

1. Settings, Secrets, scope Global. On the Web UI, Known global secrets lists `GROKBOT_WEBHOOK_URL` and `GROKBOT_WEBHOOK_AUTH`. The phone opens that same page. On the Mac app, Settings > Secrets shows Use GROKBOT_WEBHOOK_URL and Use GROKBOT_WEBHOOK_AUTH while the name field is empty.
2. `.env`, as a fallback when the Keychain has no value for that name. Copy the empty lines from `.env.example` and fill them in. An empty value leaves Grok Bot off. `.env` stays untracked.

When both are set, Omni uses the Keychain value. `GROKBOT_WEBHOOK_URL` is the routine's URL. `GROKBOT_WEBHOOK_AUTH` is the Authorization header, sent as stored. Omni leaves both values out of the log. A thread's harness and its terminal run without them.
