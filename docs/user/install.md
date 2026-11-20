# Install and first run

Omni runs on the computer where your agents work. Set that machine up first. Later, the Web UI on your phone talks to it.

Run it one of two ways: the desktop app, or the server from a checkout with `npm run dev` and the Web UI in a browser.

## The desktop app

The desktop app (`apps/desktop`, [ADR 0010](../adr/0010-desktop-app-is-electron.md)) is the Web UI in a window of its own, with the Omni server inside, so there is no repo checkout or Node to install. You still need Claude Code signed in, and `gh` for the GitHub panel ([What you need](#what-you-need)).

Download it from the [latest release](https://github.com/ben-askphill/omni-os/releases/latest). It updates itself from there ([Updating](#updating)).

- **Mac:** open `Omni-<version>-mac-universal.dmg` and drag Omni to Applications. It runs on Apple silicon and Intel, and is signed and notarized, so it opens without a warning. Run it from Applications. From the disk image it cannot update itself.
- **Linux:** make the AppImage executable and run it: `chmod +x Omni-*.AppImage && ./Omni-*.AppImage`. It adds no launcher entry by itself.
- **Build it yourself** from a checkout: `cd apps/desktop && npx tsx scripts/dist.ts --platform mac --arch arm64` (or `x64`, `universal`; `--platform linux --arch x64` for the AppImage). The build lands in `apps/desktop/release/`. A Linux build needs a working docker unless this machine's glibc is 2.28 or older, or you pass `--host-glibc` for a build that only runs here. On a Mac, `npm run build:desktop` (`scripts/build-desktop.sh`) builds for this Mac, installs to `~/Applications/Omni.app` and opens it. [apps/desktop/README.md](../../apps/desktop/README.md) has the details.

Opening the app starts the server on port 4747, or attaches to one this install already runs there. It also writes the `omni` command to `~/.local/bin/omni` ([The omni command](cli.md)), and `omni doctor` says why Omni will not start. Quitting stops a server the app started. Quitting while turns run asks whether to keep the server running for them. On a Mac the server keeps the machine from idle-sleeping while it runs (`OMNI_CAFFEINATE=0` turns that off). If you keep using a checkout's `data/` (below), the server still reads the checkout's `.env` for its server options. Variables exported in your shell do not reach the app's server.

| | Mac | Linux |
| --- | --- | --- |
| Data (database, threads, worktrees) | `~/Library/Application Support/Omni/data` | `~/.local/share/omni-os/data` |
| Server log (**Server > Show Server Log**) | `~/Library/Logs/Omni/server.log` | `~/.local/state/omni-os/server.log` |
| App settings (Quick Prompt, zoom, launch at login) | `~/Library/Application Support/Omni/settings.json` | `~/.config/Omni/settings.json` |
| Server options (`.env`, [Configuration](configuration.md#server-options)) | `~/Library/Application Support/Omni/data/.env` | `~/.local/share/omni-os/data/.env` |

### Coming from the SwiftUI app or the Linux launcher

The desktop app replaced both, and the repo no longer has them.

- On its first launch, when one of them kept an `omni.db` in a checkout's `data/` (the SwiftUI app's repo path, or `~/omni-os`), the desktop app asks once whether to keep using that folder where it is or start fresh. Keep it and your channels, threads and settings carry over. The app only reads the old folder to decide, and never copies or moves it.
- Mac: the SwiftUI app lived at `~/Applications/Omni.app` too. `npm run build:desktop` refuses to replace an app with another bundle id, so move the old one away first.
- Linux: the launcher's `~/.local/share/applications/omni-os.desktop` runs `scripts/omni-linux.sh`, which the repo no longer has. The desktop app reads that entry on its first launch to find your checkout, so remove it after that: `rm ~/.local/share/applications/omni-os.desktop`.

## What you need

| Need | Check | Fix |
| --- | --- | --- |
| Node 24+ and npm, to run from a checkout or build the app | `node -v` | `nvm install 24`, `mise use node@24`, or `brew install node` |
| Rust, to run from a checkout (the threads' `ask_user_question`, `html_render`, `set_steps` and `read_referenced_thread`, and `scripts/omni.sh`) or build the app | `cargo --version` | https://rustup.rs. The repo's `rust-toolchain.toml` pins the version. Building the app's `omni` command also needs a C compiler: Xcode's command line tools, or `musl-tools` on Linux |
| Chromium on Linux, for the agents' browser | `command -v chromium` | Your distro's Chromium, Chrome or Brave. Omarchy already has one |
| Claude Code, signed in | `claude --version` | **Install** and **Sign in to Claude** on the first-run screens, or `curl -fsSL https://claude.ai/install.sh \| bash`, then `claude auth login` |
| `gh`, signed in (GitHub panel, PR automations) | `gh auth status` | `brew install gh && gh auth login` |

Signing Claude Code in over ssh works too. The login keychain is locked there, so `claude` saves the login to `~/.claude/.credentials.json`. Before each Claude Code thread starts, Omni copies that login into the Keychain when it is newer than the one there, because the desktop session reads the Keychain first and would otherwise fail with "OAuth session expired". `OMNI_CLAUDE_LOGIN_SYNC=0` in `.env` turns this off.

Secrets go in the Keychain on a Mac and in `data/secrets.json` on Linux ([Configuration](configuration.md#secrets)). Cursor Agent is optional. Codex is too: when you ask the Conductor to review a pull request Claude wrote, the review runs on Codex ([Crew](crew.md)). See [Harnesses](harnesses.md).

## Agent instructions

This section is for an agent doing the setup (the README has the prompt to paste). Run each step, run its check, and stop on a failed check instead of working around it. Don't run `sudo`, and never write secret values anywhere but the secret store (Keychain on a Mac, `data/secrets.json` on Linux).

1. **Prerequisites.** Run every check in [What you need](#what-you-need). On a miss, give the user the fix and wait.

2. **Clone.** Skip if the folder is a checkout already.

   ```bash
   git clone https://github.com/<you>/omni-os.git ~/omni-os
   cd ~/omni-os
   ```

3. **Install.**

   ```bash
   npm install --include=dev
   ```

   `--include=dev` matters. With `NODE_ENV=production` in the shell (common in agent shells), a plain `npm install` skips dev dependencies like Turborepo, Vite and Electron, so the builds and `npm test` fail later. Check: `npx turbo --version` prints a version.

4. **Build and open the desktop app.**

   On a Mac:

   ```bash
   npm run build:desktop
   ```

   It builds the app for this Mac, installs it to `~/Applications/Omni.app` and opens it. Check: the script prints `==> Installed` with that path. If it stops with "is not this app", an older Omni app is at that path. Tell the user and wait rather than moving it yourself.

   On Linux:

   ```bash
   npm rebuild node-pty
   node apps/desktop/scripts/ensure-electron.mjs
   npm run dist:linux -w @omni/desktop -- --host-glibc
   chmod +x apps/desktop/release/Omni-*-linux-x86_64.AppImage
   ```

   The first two lines compile node-pty for this machine and fetch Electron, in case npm skipped their install scripts. `--host-glibc` builds for this machine only, without docker. Check: the AppImage exists. Tell the user to open it and wait until they have. It adds no launcher entry.

5. **Confirm it runs.** The app starts the server itself. Check: `curl -s 'http://127.0.0.1:4747/api/auth/proof?nonce=0123456789abcdef0123456789abcdef'` returns JSON with a `proof` field. If nothing answers yet, wait a few seconds and try again. An answer without `proof` means something else holds port 4747. Stop and tell the user rather than killing it.

6. **Hand over.** Tell the user the app is open and that its first-run screens ask who they are, what they do and where Omni should keep their files. After a `git pull`, the command in step 4 builds it again.

Prefer the browser? Steps 1 to 3 are the same. Then run `npm run setup` ([Set up by hand](#set-up-by-hand)) and `npm run dev`, and open http://localhost:4748.

## Set up by hand

```bash
git clone https://github.com/<you>/omni-os.git ~/omni-os
cd ~/omni-os
npm install --include=dev
npm run setup
```

The first-run screens in the Web UI and the desktop app ask, in plain words:

1. **Who are you?** Your name (what Omni and its agents call you), email, timezone (prefilled from the system) and pronouns (default they/them)
2. **What do you do?** A line about your work and the tools you use (chips such as Email, Calendar, Notion and Slack, plus any others). Every agent's prompt carries both, so answers fit your work and reach for your tools first. Picking GitHub turns on the code add-on, Shopify the store field
3. **Where should Omni keep your files?** The folder agents work in and save to (default `~/Omni`; threads without a repo run there and its CLAUDE.md and skills load in every Claude thread). **I work with code** is an add-on: it shows your repos folder (default `~/code`) and GitHub owner. Without it the GitHub CLI row and repo fields stay hidden. An empty GitHub owner fills in from the signed-in `gh` login, never from the checkout's own remote
4. **Harnesses**: whether Claude Code, Codex and Cursor Agent are ready, not installed, signed out or failing, with the install command for a missing one, the sign-in command for a signed-out one, and the reason for any other. A ready one names the account it is signed in to, so a work or personal mix-up shows here. With the code add-on, the GitHub CLI gets a row too, with the login `gh` uses, because the PR steps, PR alerts and the Conductor's PR reviews all run it
5. **First project**: a project or client channel, or skip. The repo folder shows with the code add-on, the Shopify store when you picked Shopify. Quick questions that belong to no project go to General (the seeded channel `inbox`)
6. **Done**: saves `data/omni.config.json` and leaves a welcome message in #conductor. Type a first question and **Ask** opens a thread in General on its answer; leave it empty and **Open Conductor** opens the welcome. It also points at what to set up next: a phone (Settings > Sharing & access > Pair a phone) and the [`omni` command](cli.md) (`scripts/omni.sh` in a checkout; a phone gets no command). It does not point at a second machine: one computer is enough to start, and Settings > Sync waits until you ask for it

`npm run setup` asks the same, except notifications, routines, the first question and the tool chips: it takes your tools as one comma-separated line.

On the first-run screens, the Claude Code row reads `claude auth status` itself, so a signed-out CLI never shows as Ready. A missing one has **Install Claude Code**, which runs Claude Code's own installer (`curl -fsSL https://claude.ai/install.sh | bash`) on the machine Omni runs on. A signed-out one has **Sign in to Claude**: it runs `claude auth login` there, links to the claude.com page it prints, and takes the code that page shows. Paste it, **Finish**, and the row turns to "Signed in as" your account. Claude Code keeps the login itself, as it does in a terminal, and Omni never sees the token. A sign-in nobody finishes stops after 15 minutes.

On the first-run screens, a signed-out GitHub CLI row also has **Connect GitHub**. It runs `gh auth login --web` on the machine Omni runs on and shows gh's one-time code with a link to github.com/login/device. Enter the code there and approve, and the row turns to "Signed in as" your login. gh keeps the token, as it does when you sign in from a terminal, and Omni never sees it. **Cancel** stops gh. Skipping the button changes nothing, and Done lists the GitHub CLI as signed out.

The first-run screens add **Notifications** and **Routines** before Done. Notifications: in a browser, a switch that turns on browser notifications and asks the browser for permission; in the desktop app, a test notification, so macOS asks for permission during setup rather than at the first alert ([Notifications](notifications.md)). Routines: three starter automations, each off. Morning plan (weekdays 8:30) and Weekly review (Fridays 16:00) only read and report; Mail follow-ups (weekdays 10:00) drafts replies and asks before it sends, and a draft nobody approves expires after 8 hours. The first two post nothing when there is nothing to report. One you turn on is saved in `data/automations/` when you finish, runs as the Admin agent in General, and is yours to change on the Automations page ([Quiet runs, approval and dry runs](automations.md#quiet-runs-approval-and-dry-runs)). Without a mail or calendar connector they say what to connect and ask instead.

Running it again is safe, because every answer defaults to what is saved. `npm run setup -- --yes --name Ada --email ada@example.com` answers it without prompts (`--help` lists the flags). Skip it and the Web UI asks on first open instead. `npm run setup` writes the checkout's `data/`, which the packaged desktop app does not use unless you keep it there, so set up the desktop app in its own first-run screens. When the desktop app's server holds the port (`:4747`), it refuses the checkout's token, and `npm run setup` stops and says so instead of writing a config the app never reads. Change anything later in **Settings > General** and **Workspace** on any surface; General has **Run setup again**, which walks the screens once more. [Configuration](configuration.md) describes what the file holds.

## Start it

| How | Command | Notes |
| --- | --- | --- |
| Desktop app | Open Omni from Applications, or run the AppImage | No checkout needed. See [The desktop app](#the-desktop-app) |
| Development | `npm run dev` | Server on :4747, Web UI with hot reload on http://localhost:4748 |
| Production | `npm run build && npm start` | One process, serves the built Web UI on http://127.0.0.1:4747 |

To reach it from your phone, see [Remote access](remote-access.md).

## Bring in your history

```bash
npm run import-history -- --days 30
```

This pulls your existing Claude Code sessions into Omni as resumable threads.

## Updating

Click **Update**. A server run from a checkout checks origin's `main` every 15 minutes. When `main` has commits the running server lacks, an Update notice shows in the desktop sidebar and on the phone's Activity screen. One click:

1. waits until no turn runs (Cancel stops the wait),
2. runs `scripts/sync-main.sh`, which puts the main checkout on `main`, level with origin (it refuses when tracked files have changes, leaves worktrees alone, and runs `npm install` when `package-lock.json` changed),
3. rebuilds the Web UI and restarts the server.

The packaged desktop app updates itself instead. It checks the GitHub Releases of the repo it was built from, downloads a new version in the background and offers to relaunch into it. Settings > Machines > This app's updates shows its version, Check for updates, the download's progress, Relaunch to update and what the coming release changed. Turn off **Check automatically** there and it looks only when you press Check for updates, and downloads only when you press Download. It installs a downloaded version when you quit, unless you keep the server running for turns. In that case it waits for a later quit. Relaunch to update with turns running offers to update once they finish or stop them now. A copy that cannot update itself says why in that card: a development build, a build made with `scripts/build-desktop.sh` (which rebuilding updates instead), a Mac app run from its disk image, or an AppImage in a folder it cannot write. Install the new DMG or AppImage over it by hand.

Update needs something that starts the server again after it exits: the desktop app run with `--dev`, or a service manager (below). A server you run with `npm run dev` or `npm start` shows the notice without the button. Update it by hand:

```bash
git pull                  # a fork: git fetch upstream && git merge upstream/main
npm install --include=dev
npm run build:desktop     # a desktop app built from this checkout, on a Mac (syncs main first; add -- --no-sync to build the branch you are on)
```

A server that a service manager keeps running, such as a systemd user service, can offer the button too. Set `OMNI_SUPERVISOR` in its environment and make sure the manager starts it again after it exits with code 75. With systemd, add a drop-in at `~/.config/systemd/user/<service>.service.d/update.conf`, then run `systemctl --user daemon-reload` and restart the service:

```ini
[Service]
Environment=OMNI_SUPERVISOR=systemd
# Already there when the unit has Restart=always.
Restart=always
```

The Conductor reaches the same button through its `omni_update` tool. `OMNI_UPDATE_CHECK=0` turns the check off. A fork merges cleanly as long as your settings stay in `data/` (see [FORKING.md](../../FORKING.md)).

### Every machine at once

With [sync](sync.md) on, Settings > Machines > Your machines and updates, on the computer (Update all machines in the iOS app), lists every synced machine with what it runs and where its update stands. **Check**, **Download all** and **Update all** ask them all in one go, and Update all first lists who it will ask and who it leaves out. The asks travel over sync, and each machine runs its own updater when it next syncs. A checkout updates as above, and the packaged desktop app downloads the release and relaunches itself. Update waits on each machine until no turn runs there. Each machine updates on its own, so one that fails shows its error in its row while the others go on. Retry on that row asks it again.

A machine that Omni Connect, or Tailscale without it, says is offline is skipped and says so. Retry on its row asks it anyway, and it takes the ask when it next syncs, within 30 minutes. A checkout that nothing restarts checks and downloads from here and says to apply its update there by hand. A machine that still runs an Omni from before this list shows as not reporting. Update it there once, and it joins the list. The Conductor does the same with `omni_update` and its `machines`.
