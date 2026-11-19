# Configuration

Everything personal lives in `data/` (gitignored) or the secret store. Tracked files hold only shared code and generic examples, so a fork can pull upstream without conflicts ([FORKING.md](../../FORKING.md)).

## Where things live

| Where | What |
| --- | --- |
| `data/omni.config.json` | You, your folders, integrations (Hermes URL, notes folder, the Tailscale login allowed through `tailscale serve`, the public MCP URL of a [Cloudflare Tunnel](external-mcp.md#from-anywhere-else-http), the Clerk instance for [Google sign-in](remote-access.md#sign-in-with-google)), automation on/off and this Mac's worktree retention policy. `omni.config.example.json` lists every field |
| `data/crew/*.md` | Your own crew roles, and your edits of the shipped ones in `crew/` ([Crew](crew.md)) |
| `data/automations/*.yaml` | Your own automations; one with the same id as a shared one replaces it |
| `.env` | Server options (port, model defaults, concurrency). Example: `.env.example`. An env var wins over the config file. In a checkout it sits at the repo root; the packaged desktop app reads it from its data dir instead ([Server options](#server-options)) |
| Secret store | Secret values: the Keychain on a Mac, `data/secrets.json` on Linux. The database keeps their names only |

`npm run setup` or the first-run screens write `data/omni.config.json` ([Install](install.md#set-up-by-hand)). Change it later in Settings, which has the same sections on desktop web, phone web, the desktop app and the native iOS app (`packages/shared/settings-catalog.ts`). The desktop app (`apps/desktop`) adds one more, Desktop app. On iOS, Channel Settings also opens from a channel's header or a long press in Channels, and About shows the native build, runtime and the running update id (or that the JS is still the one bundled with the binary).

| Group | Sections |
| --- | --- |
| | General (you, what you do and the tools you use, run setup again), Appearance, Notifications |
| Assistant | Models (each harness, which models the pickers list, the default model per channel (tick several channels to set or reset them at once), the model options from `.env`), Crew (every crew role, hidden ones included, and its editor, see [Crew](crew.md#settings--crew)), Accounts (each machine's harnesses and the account each is signed in to, see [Harnesses](harnesses.md#accounts)), Threads (run new threads on, sessions and usage limits from `.env`, a link to Automations) |
| Spaces | Channels (each channel's settings and actions), Workspace (your folders and GitHub owner) |
| Devices | Machines (this machine, your machines and their updates, the desktop app's own updates, the machines Omni Connect reaches), Sync, Sharing & access (Google account, signed-in devices, Omni Connect, Tailscale logins, public MCP URL), Desktop app, only in the desktop app (Quick Prompt and its shortcut, open at login, and links to Wispr Flow, zoom, updates and the server) |
| Developer | Worktrees (storage, cleanup now and Automatic cleanup), Secrets |
| Extras | Wispr Flow (dictation into the Quick Prompt, a switch in the Mac desktop app), Grok Bot (whether its webhook secrets are set), the Hermes URL and the notes folder |
| | About on every surface (version, build, the server's address, port and log, where the files live, the port and host from `.env`; on iOS also runtime and the running update) |

- Search at the top of the nav finds a single setting and scrolls to it.
- Each setting has one home. Where another section used to hold it, that section has a one-line link to it.
- Notifications, Models and Channels, the sections with values a channel sets, have a scope picker. This machine shows this machine's values, and a channel shows what it sets and what it inherits. The pick stays as you move between sections.
- A chip beside each label says where the value comes from: built-in default, `.env`, this machine, a channel, inherited, or this browser or app. Reset beside a saved value puts only that value back to its default. Values from `.env` show read-only with the variable's name. To change one, edit `.env` and restart the server (in the desktop app, **Server > Restart Server**).
- Settings save as you change them. A picker or switch saves at once, and a text field saves when you press Return or leave it. The Extras form (Hermes URL and notes folder) and the path map wait for **Save changes**, so a half-typed address never reaches the server.
- In the desktop app every field that takes a folder on this machine has **Browse**, which opens the system folder dialog and fills in the absolute path you choose: setup's workspace, repos and channel repo folders, Settings > Workspace's folders, the notes folder in Settings > Extras, a channel's repo path and base directory, and the path map's folder on this machine. In Settings > Workspace a picked folder saves at once. Typing a path still works. A browser and a phone cannot hand the page a path on the server's machine, so there these stay text fields. So do the path map's folder on the other machine and a channel's worktree copy and shared lists, which are paths inside the repo.
- Destructive actions (revoke, sign out, unlink, delete a secret, turn off Omni Connect, remove worktrees) are red, say what they cost first and ask before they act.
- Appearance also holds **Show technical details**, kept by the server so it applies on every client and syncs to your other machines. A new install starts with it off; an install that already had threads when the switch arrived keeps it on. Off, Omni reads as a workspace: status marks use five words (see [threads](threads.md#status-marks)), harness reads AI app, effort reads Thinking with levels Fast, Balanced and Thorough, and a channel without a repo hides pull requests, branches, worktrees, the session, task ids, token counts and the PRs, Changes, Terminal and Actions tabs. The context ring shows there only once the window is 70% full. A channel with a repo keeps all of its code detail. The inspector's Artifacts and Browser tabs show once there is a file or screenshot. The thread's quick card opens either way and leaves out the task id, working directory, model id, account and session state (see [threads](threads.md#the-thread-panel)). Channel Settings shows Branch steps only once a repo path is set. Pull requests leaves the rail's More menu, the classic sidebar, the command palette, the phone tab bar and Overview until some channel has a repo. Overview leaves out the cache figures and tokens by type, slash commands drop their source tag, and an Inbox card without a machine leaves out the branch. The Conductor reads the switch in its `settings` tool.
- Extras holds the **Shopify add-on**, kept with Show technical details and synced the same way. On, each channel's settings have a Store card (store domain and Ask Phill Portal slug), the channel page links the store's admin, channel lists name the store, and a thread's instructions name both. Off, the values stay saved but nothing shows or sends them. A new install starts with it off; an install where a channel already had a store domain or Portal slug keeps it on. Other features read it from `GET /api/display` (`shopify`).
- Appearance holds Theme, **Classic sidebar**, Keyboard and Text size, which in the desktop app is the app's zoom. Desktop web and the desktop app show the channel rail unless Classic sidebar is on for that browser or desktop app. The rail is a 72px column of discs with a list panel beside it. From the top: the Inbox disc, which opens the Inbox; the Conductor; channel discs that use each channel's avatar background; then More, a menu holding Pull requests, Library and Automations; then Add channel and Settings. More opens beside the rail on a click, Enter, Space or the down arrow; the arrow keys move through it, and Escape closes it and puts focus back on the disc. While one of its pages is open the More disc shows as selected. Channel discs rest in grayscale and take their color on hover, focus or selection. Each disc shows its channel's name in a tooltip on hover and on keyboard focus. **Full color channel rail**, shown under Channel rail while it is on, keeps them in color all the time. The panel follows the page. The Inbox disc shows the Inbox (Search, New thread, its shelves and usage) in the panel and the Overview dashboard (the Conductor composer, counts, machines and usage) beside it, a channel disc shows that channel's folders and threads, and Settings shows its sections. Pull requests, Library, Automations and Search have no panel. A thread opened from the Inbox or Overview keeps the Inbox in the panel and marks its channel's disc with a short bar at the rail's edge. The window title of a thread is its title, then its channel. The rail uses Adwaita Sans and JetBrains Mono. Classic and the phone layout keep the usual fonts. On macOS the desktop app centres the traffic lights at the top of the rail, above the Inbox disc, at the height the Claude desktop app uses, on a liquid-glass capsule. Phone web and the iOS app have no rail. **Press I for the Inbox** (on by default, stored per browser or desktop app) opens the Inbox view, the rail's Inbox, or the phone's Activity tab when you press `i` outside a text field, the terminal or an open dialog. Turn it off if that key gets in the way. The iOS app has no `i` shortcut. **Press E to mark done** (on by default, desktop web and the desktop app) marks the selected Inbox thread done while the Inbox view is on screen: the card with keyboard focus, or else the thread you have open. A running thread can't be marked done, so `e` does nothing on one. The phone layout has no selected thread, so it has no `e` shortcut.
- Channel settings (Basics) include **Avatar background**: automatic from the icon (an SVG's first full-size shape or a contrasting swatch), or a manual colour (picker, hex, or click the SVG to sample). Automatic updates when the icon changes; a manual colour stays. Reset to auto puts the automatic colour back. The colour shows on desktop web, phone web, the desktop app and iOS. SVG upload and sampling are only in the web settings. The Conductor takes an icon and background the same way, from its own Settings tab: with neither it shows the Omni mark, and what you save replaces the mark everywhere it shows. Clear both to get the mark back.
- On the web, Settings is `#/settings` and each section has its own hash (`#/settings/threads`). The old `#/secrets`, `#/sync` and `#/storage`, and `#/settings/integrations` (now Extras), still open the section that holds them. The Conductor reads the same values with its `settings` tool. Your name goes into the Home greeting and every agent's prompt.

An install from before the config file existed writes one at its first boot from the old defaults and skips onboarding, so it keeps behaving as before.

## Placeholders in shared files

Crew charters, automation prompts and automation prechecks can use these, filled from your config, so the shared files name nobody:

`{{user}}`, `{{workspace}}`, `{{reposDir}}`, `{{githubOwner}}`, `{{omniRoot}}`, `{{omniRepo}}`, `{{centralBrain}}`, `{{timezone}}`

`{{omniRoot}}` and `{{omniRepo}}` name an Omni git checkout, for automations you write that work on Omni itself. A server run from a checkout uses that one. The packaged desktop app is not a checkout. It uses `OMNI_CHECKOUT` from its data dir's `.env`, or else the checkout whose `data/` it kept using. With neither, those automations show the error "needs an Omni checkout" and do not run.

A precheck is a shell command, and any signed-in device can change your name and folders (a thread's own token cannot change the ones a placeholder reads), so a precheck never gets the values pasted in: each placeholder becomes a variable reference such as `$OMNI_PLACEHOLDER_USER`, set when the precheck runs ([Automations](automations.md)).

## Server options

Optional. Copy `.env.example` to `.env` (gitignored) and uncomment what you need. It covers the port and host, the default model, permission mode, concurrency per harness, keepalive, browser flags, data and automations dirs, upload cap and reply suggestions (`OMNI_SUGGESTIONS=0` turns them off). Each line in `.env.example` says what it does.

Where `.env` goes depends on what runs the server:

- From a checkout (`npm run dev`, `npm start`, or the desktop app with `--dev`): the repo root.
- The packaged desktop app: its data dir, like `~/Library/Application Support/Omni/data/.env` ([where the data dir is](install.md#the-desktop-app)). If you moved over from the old SwiftUI app or Linux launcher and kept using the checkout's `data/`, the server also reads the checkout's `.env`. A line in `data/.env` wins over the same one there.

The desktop app, packaged or `--dev`, starts the server with a fixed environment, so a variable exported in your shell never reaches it. Put it in `.env` instead. It also sets the port and data dir itself (`--port`, `--data-dir`), so `OMNI_PORT` and `OMNI_DATA_DIR` in `.env` have no effect there.

## Secrets

Values live in the server's secret store under service `omni-os`, account `<scope>/<NAME>`. The database keeps names only. Manage them in Settings > Secrets on every surface. That section says which store this server uses.

| Store | Default on | Where |
| --- | --- | --- |
| `keychain` | macOS | The login Keychain, through `security` |
| `file` | Linux | `data/secrets.json`, mode 0600 |
| `libsecret` | Never on its own | GNOME Keyring or KWallet, through `secret-tool` |

- `OMNI_SECRET_STORE=keychain|file|libsecret` picks one. Linux defaults to the file because a headless server has no desktop session to unlock a keyring. Use `libsecret` only when the server always starts inside one. A server started from ssh or systemd can't read values saved from the desktop.
- Values never sync, whatever the store, so set them on each machine. Switching stores leaves the old values behind; save them again.
- The Conductor can set one on another synced machine for you with `set_secret` (pass `machine`). Omni seals the value to that machine's own key (`OMNI_SEAL_KEY` in its store; the public half is in its synced device record), so the relay only carries ciphertext. That machine saves it after its next sync and answers. `sent_secrets` lists what was sent and each answer. One not taken within 24 hours expires. Omni's own credentials (sync, Connect, the seal key) and names that change how programs start can't be set this way. The sending machine refuses them, and so does the target. That covers `PATH`, `NODE_OPTIONS`, `LD_*`, `DYLD_*`, `GIT_*`, `NPM_CONFIG_*`, interpreter paths, shell startup files, proxies, CA bundles, harness endpoints and config dirs (`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_*`, `CODEX_*` and the like). Settings can still set them. A secret that reaches a harness is still subject to that harness's strip list ([Harnesses](harnesses.md)).

- Scope `global` goes to every thread as an env var.
- Scope `channel:<slug>` goes only to that channel's threads and overrides a global with the same name.
- Billing keys stay out of a harness and the terminal. Sync keys stay out of the terminal, and a global one stays out of a harness. `GROKBOT_WEBHOOK_URL`, `GROKBOT_WEBHOOK_AUTH` and webhook signing secrets (`OMNI_WEBHOOK_*`) stay out of both, at any scope. See [Grok Bot](#grok-bot) and [GitHub webhooks](automations.md#github-webhooks).

## Channel actions

A channel's settings list its named actions: a name, a command, the secrets it needs (names only) and a port. Each thread runs them from its Actions tab. Omni keeps them on this Mac and does not sync them.

- The command runs with your login shell in the thread's checkout, with the terminal's environment plus `OMNI_THREAD_ID`, `OMNI_BRANCH` and `OMNI_ARTIFACTS_DIR`. `OMNI_REPO_ROOT` is the channel's repo (the main checkout) and `OMNI_WORKTREE` the thread's own worktree, set only for a worktree thread. The setup action gets them too.
- Secrets: only the names listed reach the run, read from the secret store (the channel's value, else the global one). A missing one stops the run before it starts. Their values are masked as `[redacted]` in the run's stored output (values under 4 characters are not). Billing, sync and Grok Bot keys can't be listed.
- Port: none, a free one per run, or a fixed one. A free one comes from 9300 to 9399, as `$OMNI_PORT` and `$PORT`, so two threads previewing at once never share one, as in `shopify theme dev --port $OMNI_PORT`. A fixed port that another run or another program holds stops the run with a message naming it. Omni refuses a command with `--port 9292` written in it unless the action's port is set to 9292, so that Omni knows about the port.
- Setup: one action per channel can run in every new worktree, once each time the worktree is prepared. Pick "Before the agent starts" to hold the agent until it succeeds, or "Alongside the agent" to start both together. A blocking setup that fails, or one you stop, leaves the thread at Setup failed with its output and your first message kept, and Retry setup runs it again. Opening a thread or sending it a follow-up never reruns it. Threads in the channel's own checkout, Hermes and Cursor Cloud threads get no setup.
- Teardown: one action per channel can run in a thread's worktree right before a cleanup or the retention pass removes it (Run before a worktree is removed), to stop a preview or delete a Shopify preview theme. It gets the same environment as any other run, and its run shows in the thread's Actions tab. If it fails, can't start or runs past 5 minutes (`OMNI_TEARDOWN_TIMEOUT_MS`), Omni stops it, notes why on the cleanup's result and removes the worktree anyway. A deleted thread's worktree gets no teardown, since there is no thread to record it on.

Adding, editing, running and retrying an action take the install token or a session paired with it (the desktop app, or a browser paired with the token), the same as the thread terminal: a Google, Omni Connect or iOS app session gets 403 ([Remote access](remote-access.md)). So does Retry setup on a thread whose setup step failed, since it runs that step again. Any signed-in device can read actions and runs, stop a run and remove an action.

The Conductor reads a channel's actions, or a thread's actions and runs, with `list_channel_actions` (run output only with `include_output: true`), and starts one in a thread with `run_channel_action` (by id or name) when it runs with the install token, as an external MCP client on this machine does. From an Omni thread it is refused: a thread's own token cannot run a shell ([ADR 0016](../adr/0016-thread-bound-credentials.md)), so you start the action from the thread's Actions menu. Adding, editing and stopping actions stay in the UI.

## Worktree files

A new worktree has only what git tracks, so ignored files such as `.env` or `shopify.theme.toml` are missing. List them in a `.worktreeinclude` file in the repo's root, in `.gitignore` syntax, and Omni copies them from the main checkout into each thread worktree it makes, before the setup action and the agent start:

```
# .worktreeinclude
.env
shopify.theme.toml
config/*.local.json
```

- Only files that exist in the main checkout, are untracked and that the repo ignores are copied. A tracked file or one the repo does not ignore is skipped.
- On APFS the copy is a clone (as `cp -c`), so it takes no extra space until one side changes. Elsewhere it is a plain copy. Symlinks are skipped.
- A file the worktree already has is never overwritten. A worktree checked out again after a cleanup gets the files again.
- At most 200 files and 50 MB per worktree; the rest is skipped. The server log lists what was copied, what was over the budget and listed paths the main checkout lacks (a repo another machine cloned for a run-on thread has no `.env`). None of these stop the thread.
- A copy that is still the same as the main checkout's does not keep the worktree from cleanup ([Known limits](limits.md)).

For a client repo that can't take a committed `.worktreeinclude`, put the same lines in the channel's settings under **Copy into new worktrees** (Advanced, shown while Worktree per thread is on). They are added to the repo's file, if it has one, with the same rules. **Shared directories** lists folders, one path per line such as `node_modules` or `apps/web/node_modules`, that each new worktree links to in the main checkout instead of installing again:

- Each becomes a symlink to the main checkout's folder, so an install in the worktree changes the main checkout's copy too. A folder the main checkout lacks is skipped.
- Only a folder the repo ignores is linked. A rule such as `node_modules/` matches folders only, not a link, so Omni adds `/node_modules` to the repo's `.git/info/exclude` under an `# Omni shared directories` comment. The repo ignored that path already.
- Paths only: no patterns, nothing outside the repo or in `.git`, and never a folder that is itself a symlink leading out of the main checkout. A worktree that already has the folder keeps its own.
- Both lists sync to your other Macs with the channel and can be edited on the web, the phone layout and the iOS app. The Conductor sees them in `list_channels`.

## Worktree storage

Settings > Worktrees inventories worktrees and explains why each is kept or eligible for cleanup. Review the scan before removing them, or turn on automatic retention for this Mac. Retention is off by default and stays local in `data/omni.config.json`. The old `OMNI_WORKTREE_SWEEP` option no longer controls cleanup. The guards and what survives removal are in [Known limits](limits.md).

## Grok Bot

Send to Grok Bot posts a thread's title and messages to a webhook. The context is the channel id and the thread id. That only goes one way. For Grok Bot to read threads and start work in Omni, connect it to Omni's MCP server (see [Connect Grok Bot](external-mcp.md#connect-grok-bot)).

The action is in the thread's menu on desktop web and in the desktop app: the ⋯ in the thread header, or a right-click on the thread. On a phone it is in Thread options. The Conductor calls `send_to_grok_bot`. A new message can go straight to Grok Bot too: pick Grok Bot in the new-thread composer's Machine chip (see [Send to Grok Bot](threads.md#send-to-grok-bot)).

The menu items show only once `GROKBOT_WEBHOOK_URL` is set, as a global secret or in `.env`. `GET /api/status` reports this as `grokBot`. Without it, the Machine chip lists Grok Bot disabled ("Not set up on" this machine's name) when it shows for other machines, and nothing else of Grok Bot shows. Secrets are per machine, so set them on each machine whose composer should offer Grok Bot.

The URL and the Authorization value come from the Omni OS requests routine, on Grok Bot's Routines tab. Paste each one in either place.

1. Settings, Secrets, scope Global. Type `GROKBOT_WEBHOOK_URL` as the name and paste the URL, then do the same for `GROKBOT_WEBHOOK_AUTH`. Once the URL is saved, Known global secrets (the phone opens the same section) lists both names.
2. `.env`, as a fallback when the secret store has no value for that name. Copy the empty lines from `.env.example` and fill them in. An empty value leaves Grok Bot off. `.env` stays untracked.

When both are set, Omni uses the secret store's value. `GROKBOT_WEBHOOK_URL` is the routine's URL. `GROKBOT_WEBHOOK_AUTH` can be the bare key or a value that already starts with `Bearer `. Either form works. Omni leaves both values out of the log. A thread's harness and its terminal run without them.
