# Install and first run

Omni runs on the computer where your agents work. Set that machine up first; the Web UI on your phone talks to it later.

Run it one of two ways: the desktop app, or the server from a checkout with `npm run dev` and the Web UI in a browser.

## The desktop app

The desktop app (`apps/desktop`, [ADR 0010](../adr/0010-desktop-app-is-electron.md)) is the Web UI in a window of its own, with the Omni server inside: no repo checkout or Node to install. You still need Claude Code signed in, and `gh` for the GitHub panel ([What you need](#what-you-need)).

- **Mac:** open the DMG and drag Omni to Applications. Take `arm64` for Apple silicon, `x64` for an Intel Mac, or `universal` for either. macOS blocks a build that is not notarized the first time it opens; allow it under **System Settings > Privacy & Security > Open Anyway**.
- **Linux:** make the AppImage executable and run it: `chmod +x Omni-*.AppImage && ./Omni-*.AppImage`. It adds no launcher entry by itself.
- **Build it yourself** from a checkout: `cd apps/desktop && npx tsx scripts/dist.ts --platform mac --arch arm64` (or `x64`, `universal`; `--platform linux --arch x64` for the AppImage). The build lands in `apps/desktop/release/`. A Linux build needs a working docker unless this machine's glibc is 2.28 or older, or you pass `--host-glibc` for a build that only runs here. On a Mac, `npm run build:desktop` (`scripts/build-desktop.sh`) builds for this Mac, installs to `~/Applications/Omni.app` and opens it. [apps/desktop/README.md](../../apps/desktop/README.md) has the details.

Opening the app starts the server on port 4747, or attaches to one this install already runs there. Quitting stops a server the app started; quitting while turns run asks whether to keep the server running for them. On a Mac the server keeps the machine from idle-sleeping while it runs (`OMNI_CAFFEINATE=0` turns that off). Kept in a checkout's `data/` (below), the server still reads the checkout's `.env` for its server options. Variables exported in your shell do not reach the app's server.

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
- Linux: the launcher's `~/.local/share/applications/omni-os.desktop` runs `scripts/omni-linux.sh`, which is deleted. The desktop app reads that entry on its first launch to find your checkout, so remove it after that: `rm ~/.local/share/applications/omni-os.desktop`.

## What you need

| Need | Check | Fix |
| --- | --- | --- |
| Node 24+ and npm, to run from a checkout or build the app | `node -v` | `nvm install 24`, `mise use node@24`, or `brew install node` |
| Chromium on Linux, for the agents' browser | `command -v chromium` | Your distro's Chromium, Chrome or Brave. Omarchy already has one |
| Claude Code, signed in | `claude --version` | `npm install -g @anthropic-ai/claude-code`, then `claude` and `/login` |
| `gh`, signed in (GitHub panel, PR automations) | `gh auth status` | `brew install gh && gh auth login` |

Secrets go in the Keychain on a Mac and in `data/secrets.json` on Linux ([Configuration](configuration.md#secrets)). Codex and Cursor Agent are optional; see [Harnesses](harnesses.md).

## Agent instructions

For an agent doing the setup (the README has the prompt to paste). Run each step, run its check, and stop on a failed check instead of working around it. Don't run `sudo`, and never write secret values anywhere but the secret store (Keychain on a Mac, `data/secrets.json` on Linux).

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

   `--include=dev` matters: with `NODE_ENV=production` in the shell (common in agent shells), a plain `npm install` skips dev dependencies like Turborepo, Vite and Electron, so the builds and `npm test` fail later. Check: `npx turbo --version` prints a version.

4. **Build and open the desktop app.**

   On a Mac:

   ```bash
   npm run build:desktop
   ```

   It builds the app for this Mac, installs it to `~/Applications/Omni.app` and opens it. Check: the script prints `==> Installed` with that path. If it stops with "is not this app", an older Omni app is at that path: tell the user and wait rather than moving it yourself.

   On Linux:

   ```bash
   npm rebuild node-pty
   node apps/desktop/scripts/ensure-electron.mjs
   npm run dist:linux -w @omni/desktop -- --host-glibc
   chmod +x apps/desktop/release/Omni-*-linux-x86_64.AppImage
   ```

   The first two lines compile node-pty for this machine and fetch Electron, in case npm skipped their install scripts. `--host-glibc` builds for this machine only, without docker. Check: the AppImage exists. Tell the user to open it and wait until they have; it adds no launcher entry.

5. **Confirm it runs.** The app starts the server itself. Check: `curl -s 'http://127.0.0.1:4747/api/auth/proof?nonce=0123456789abcdef0123456789abcdef'` returns JSON with a `proof` field. If nothing answers yet, wait a few seconds and try again. An answer without `proof` means something else holds port 4747: stop and tell the user rather than killing it.

6. **Hand over.** Tell the user the app is open and that its first-run screens ask who they are and where their work lives. After a `git pull`, the command in step 4 builds it again.

Prefer the browser? Steps 1 to 3 are the same; then `npm run setup` ([Set up by hand](#set-up-by-hand)), `npm run dev`, and open http://localhost:4748.

## Set up by hand

```bash
git clone https://github.com/<you>/omni-os.git ~/omni-os
cd ~/omni-os
npm install --include=dev
npm run setup
```

`npm run setup` asks the same five things the Web UI's first-run screens ask:

1. **You**: your name (what Omni and its agents call you), email, timezone (prefilled from the system) and pronouns (default they/them)
2. **Workspace**: the workspace folder (default `~/Omni`; threads without a repo run there and its CLAUDE.md and skills load in every Claude thread), your repos folder (default `~/code`) and your GitHub owner
3. **Harnesses**: which of Claude Code, Codex and Cursor Agent are installed and signed in, with the command to fix each one
4. **First channel**: a client or project with an optional repo and Shopify store, or skip
5. **Done**: saves `data/omni.config.json` and, in the Web UI, opens #conductor with a welcome message

Running it again is safe: every answer defaults to what is saved. `npm run setup -- --yes --name Ada --email ada@example.com` answers it without prompts (`--help` lists the flags). Skip it and the Web UI asks on first open instead. `npm run setup` writes the checkout's `data/`, which the packaged desktop app does not use unless you keep it there, so set up the desktop app in its own first-run screens. Change anything later in **Settings > General** and **Workspace** on any surface; General has **Run setup again**, which walks the screens once more. What the file holds: [Configuration](configuration.md).

## Start it

| How | Command | Notes |
| --- | --- | --- |
| Desktop app | Open Omni from Applications, or run the AppImage | No checkout needed. See [The desktop app](#the-desktop-app) |
| Development | `npm run dev` | Server on :4747, Web UI with hot reload on http://localhost:4748 |
| Production | `npm run build && npm start` | One process, serves the built Web UI on http://127.0.0.1:4747 |

Reaching it from your phone: [Remote access](remote-access.md).

## Bring in your history

```bash
npm run import-history -- --days 30
```

Pulls your existing Claude Code sessions into Omni as resumable threads.

## Updating

Click **Update**. A server run from a checkout checks origin's `main` every 15 minutes. When `main` has commits the running server lacks, an Update notice shows in the desktop sidebar and on the phone's Activity screen. One click:

1. waits until no turn runs (Cancel stops the wait),
2. runs `scripts/sync-main.sh`, which puts the main checkout on `main`, level with origin (it refuses when tracked files have changes, leaves worktrees alone, and runs `npm install` when `package-lock.json` changed),
3. rebuilds the Web UI and restarts the server.

The packaged desktop app updates itself instead: it checks the GitHub Releases of the repo it was built from, downloads a new version in the background and offers to relaunch into it. It installs a downloaded version when you quit, unless you keep the server running for turns: then it waits for a later quit. Relaunch to Update with turns running offers to update once they finish or stop them now. A build without a release feed (a development build, or an AppImage in a folder it cannot write) updates by installing the new DMG or AppImage over the old one.

Update needs something that starts the server again after it exits: the desktop app run with `--dev`, or a service manager (below). A server you run with `npm run dev` or `npm start` shows the notice without the button; update it by hand:

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

The Conductor reaches the same button through its `omni_update` tool. `OMNI_UPDATE_CHECK=0` turns the check off. A fork merges cleanly as long as your settings stay in `data/`; see [FORKING.md](../../FORKING.md).
