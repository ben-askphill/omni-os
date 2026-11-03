# Install and first run

Omni runs on the Mac where your agents work. Set that machine up first; the Web UI on your phone talks to it later.

## The desktop app

The desktop app (`apps/desktop`, [ADR 0010](../adr/0010-desktop-app-is-electron.md)) is replacing the SwiftUI Mac app and the Linux launcher below. It is the Web UI in a window of its own, with the Omni server inside: no repo checkout, Node or Xcode to install. You still need Claude Code signed in, and `gh` for the GitHub panel ([What you need](#what-you-need)).

- **Mac:** open the DMG and drag Omni to Applications. Take `arm64` for Apple silicon, `x64` for an Intel Mac, or `universal` for either. macOS blocks a build that is not notarized the first time it opens; allow it under **System Settings > Privacy & Security > Open Anyway**.
- **Linux:** make the AppImage executable and run it: `chmod +x Omni-*.AppImage && ./Omni-*.AppImage`. It adds no launcher entry by itself.
- **Build it yourself** from a checkout: `cd apps/desktop && npx tsx scripts/dist.ts --platform mac --arch arm64` (or `x64`, `universal`; `--platform linux --arch x64` for the AppImage). The build lands in `apps/desktop/release/`. A Linux build needs a working docker unless this machine's glibc is 2.28 or older. On a Mac, `npm run build:desktop` (`scripts/build-desktop.sh`) builds for this Mac, installs to `~/Applications/Omni.app` and opens it. That is the path `scripts/build-mac.sh` installs the SwiftUI app to, so each refuses to replace the other's app: move the old one away first. [apps/desktop/README.md](../../apps/desktop/README.md) has the details.

Opening the app starts the server on port 4747, or attaches to one this install already runs there. Quitting stops a server the app started. On its first launch, if the SwiftUI app or the Linux launcher kept data in a checkout's `data/`, the app asks once whether to keep using that folder where it is or start fresh. It never copies or moves the old folder. Kept in place, the server still reads the checkout's `.env` for its server options. Variables exported in your shell do not reach the app's server.

| | Mac | Linux |
| --- | --- | --- |
| Data (database, threads, worktrees) | `~/Library/Application Support/Omni/data` | `~/.local/share/omni-os/data` |
| Server log (**Server > Show Server Log**) | `~/Library/Logs/Omni/server.log` | `~/.local/state/omni-os/server.log` |
| App settings (Quick Prompt, zoom, launch at login) | `~/Library/Application Support/Omni/settings.json` | `~/.config/Omni/settings.json` |
| Server options (`.env`, [Configuration](configuration.md#server-options)) | `~/Library/Application Support/Omni/data/.env` | `~/.local/share/omni-os/data/.env` |

The rest of this page sets Omni up from a checkout: the SwiftUI app, the Linux launcher and `npm run dev`. Those stay until the desktop app replaces them.

## What you need

| Need | Check | Fix |
| --- | --- | --- |
| macOS, for the Mac app | `uname` prints `Darwin` | On Linux, skip the Mac app and run `scripts/install-linux.sh`. Secrets go in `data/secrets.json` ([Configuration](configuration.md#secrets)) |
| Node 24+ and npm | `node -v` | `nvm install 24`, `mise use node@24`, or `brew install node` |
| Chromium, for the Linux app and the agents' browser | `command -v chromium` | Your distro's Chromium, Chrome or Brave. Omarchy already has one |
| Claude Code, signed in | `claude --version` | `npm install -g @anthropic-ai/claude-code`, then `claude` and `/login` |
| `gh`, signed in (GitHub panel, PR automations) | `gh auth status` | `brew install gh && gh auth login` |
| Xcode (Mac app only) | `xcodebuild -version` | Install Xcode from the App Store, then `sudo xcode-select -s /Applications/Xcode.app` |

Command Line Tools alone are not enough: `xcodebuild` needs full Xcode. Codex and Cursor Agent are optional; see [Harnesses](harnesses.md).

## Agent instructions

For an agent doing the setup (the README has the prompt to paste). Run each step, run its check, and stop on a failed check instead of working around it. Don't run `sudo`, don't install Xcode for the user, and never write secret values anywhere but the secret store (Keychain on a Mac, `data/secrets.json` on Linux). On Linux, skip the Xcode check and step 5. After step 4, run `scripts/install-linux.sh` and tell the user to open Omni from the app launcher.

1. **Prerequisites.** Run every check in [What you need](#what-you-need). On a miss, give the user the fix and wait.

2. **Clone.** Skip if the folder is a checkout already.

   ```bash
   git clone https://github.com/<you>/omni-os.git ~/omni-os
   cd ~/omni-os
   ```

   The Mac app starts the server from `~/omni-os` by default. If you clone somewhere else, note the path for step 5.

3. **Install.**

   ```bash
   npm install --include=dev
   ```

   `--include=dev` matters: with `NODE_ENV=production` in the shell (common in agent shells), a plain `npm install` skips dev dependencies like Turborepo and Vite, so `npm run dev` and `npm test` fail later. Check: `npx turbo --version` prints a version.

4. **Set up.** Ask the user for their name and email, then:

   ```bash
   npm run setup -- --yes --name "<name>" --email "<email>"
   ```

   Check: `data/omni.config.json` exists. Skipping this is fine too; the app asks the same questions on first open.

5. **Build and open the Mac app.**

   ```bash
   scripts/build-mac.sh
   ```

   It builds in Release, installs to `~/Applications/Omni.app` and opens it. The first build fetches Swift packages from GitHub, so it takes a few minutes. Check: the script ends with `==> Opened Omni`. On a failure it prints the errors and the log path (`apps/mac/.xcode/build-release.log`); read the log before retrying.

   Cloned somewhere other than `~/omni-os`? Pass the path on the first open, then set it for good in the app under **Settings > Machines > Repo**:

   ```bash
   scripts/build-mac.sh -- -repoPath "$PWD"
   ```

6. **Confirm it runs.** The app starts the server itself. Check: `curl -s http://127.0.0.1:4747/api/status` returns JSON. If port 4747 is taken by something else, stop and tell the user rather than killing it.

7. **Hand over.** Tell the user the app is open, that first-run setup (if step 4 was skipped) waits in the app, and that `scripts/build-mac.sh` again rebuilds it after a `git pull`.

Prefer the browser? Steps 1 to 4 are the same; then `npm run dev` and open http://localhost:4748.

## Set up by hand

```bash
git clone https://github.com/<you>/omni-os.git ~/omni-os
cd ~/omni-os
npm install --include=dev
npm run setup
```

`npm run setup` asks the same five things the first-run screens ask in the Web UI and the Mac app:

1. **You**: your name (what Omni and its agents call you), email, timezone (prefilled from the system) and pronouns (default they/them)
2. **Workspace**: the workspace folder (default `~/Omni`; threads without a repo run there and its CLAUDE.md and skills load in every Claude thread), your repos folder (default `~/code`) and your GitHub owner
3. **Harnesses**: which of Claude Code, Codex and Cursor Agent are installed and signed in, with the command to fix each one
4. **First channel**: a client or project with an optional repo and Shopify store, or skip
5. **Done**: saves `data/omni.config.json` and, in the apps, opens #conductor with a welcome message

Running it again is safe: every answer defaults to what is saved. `npm run setup -- --yes --name Ada --email ada@example.com` answers it without prompts (`--help` lists the flags). Skip it and the Web UI or Mac app asks on first open instead. Change anything later in **Settings > General** and **Workspace** on any surface; General has **Run setup again**, which walks the screens once more. What the file holds: [Configuration](configuration.md).

## Start it

| How | Command | Notes |
| --- | --- | --- |
| Desktop app | Open Omni from Applications, or run the AppImage | No checkout needed. See [The desktop app](#the-desktop-app) |
| Mac app (being replaced by the desktop app) | `scripts/build-mac.sh` | Release build, installs to `~/Applications/Omni.app`, opens it. Starts and stops the server itself |
| Linux app (being replaced by the desktop app) | `scripts/install-linux.sh` | Builds the Web UI, installs `~/.local/share/applications/omni-os.desktop`. Open Omni from the app launcher. It starts the server, and stops it on quit only when this launch started it |
| Development | `npm run dev` | Server on :4747, Web UI with hot reload on http://localhost:4748 |
| Production | `npm run build && npm start` | One process, serves the built Web UI on http://127.0.0.1:4747 |

`scripts/build-mac.sh --no-open` installs without opening, and arguments after `--` go to the app (`-- -serverPort 4759`). You can also open `apps/mac/Omni.xcodeproj` in Xcode and run the `Omni` scheme; it finds the server on :4747 or starts one from the repo.

The Mac app and the Linux app own the server the way a desktop app owns its backend: opening the app starts it, quitting stops it. Quitting while turns run asks whether to keep the server running for them. Omni no longer ships a LaunchAgent; the Mac app turns off an old `com.omni-os.server` agent at launch and renames its plist to `.plist.disabled`. On a Mac the server keeps the machine from idle-sleeping while it runs (`OMNI_CAFFEINATE=0` turns that off).

Reaching it from your phone: [Remote access](remote-access.md).

## Bring in your history

```bash
npm run import-history -- --days 30
```

Pulls your existing Claude Code sessions into Omni as resumable threads.

## Updating

Click **Update**. The server checks origin's `main` every 15 minutes. When `main` has commits the running server or the Mac app lacks, an Update notice shows in the Mac app, in the desktop Web UI's sidebar and on the phone's Activity screen. One click:

1. waits until no turn runs (Cancel stops the wait),
2. runs `scripts/sync-main.sh`, which puts the main checkout on `main`, level with origin (it refuses when tracked files have changes, leaves worktrees alone, and runs `npm install` when `package-lock.json` changed),
3. rebuilds the Web UI and restarts the server,
4. in the Mac app, when the app itself is behind, rebuilds and relaunches it.

The desktop app updates itself instead: it checks the GitHub Releases of the repo it was built from, downloads a new version in the background and offers to relaunch into it. It installs a downloaded version when you quit, unless you keep the server running for turns: then it waits for a later quit. Relaunch to Update with turns running offers to update once they finish or stop them now. A build without a release feed (a development build, or an AppImage in a folder it cannot write) updates by installing the new DMG or AppImage over the old one.

Update needs an app that started the server from a checkout: the Mac app, the Linux app, or the desktop app run with `--dev`. A server you run with `npm run dev` or `npm start` shows the notice without the button; update it by hand:

```bash
git pull                  # a fork: git fetch upstream && git merge upstream/main
npm install --include=dev
scripts/build-mac.sh      # Mac: rebuilds and reinstalls the app (syncs main first; --no-sync builds the branch you are on)
scripts/install-linux.sh  # Linux: rebuilds the Web UI and the launcher
```

A server that a service manager keeps running, such as a systemd user service, can offer the button too. Set `OMNI_SUPERVISOR` in its environment and make sure the manager starts it again after it exits with code 75. With systemd, add a drop-in at `~/.config/systemd/user/<service>.service.d/update.conf`, then run `systemctl --user daemon-reload` and restart the service:

```ini
[Service]
Environment=OMNI_SUPERVISOR=systemd
# Already there when the unit has Restart=always.
Restart=always
```

The Conductor reaches the same button through its `omni_update` tool. `OMNI_UPDATE_CHECK=0` turns the check off. A fork merges cleanly as long as your settings stay in `data/`; see [FORKING.md](../../FORKING.md).
