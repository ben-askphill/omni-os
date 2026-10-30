# Install and first run

Omni runs on the Mac where your agents work. Set that machine up first; the Web UI on your phone talks to it later.

## What you need

| Need | Check | Fix |
| --- | --- | --- |
| macOS | `uname` prints `Darwin` | The Mac app is Mac-only. The server and Web UI also run on Linux, with secrets in `data/secrets.json` ([Configuration](configuration.md#secrets)) |
| Node 24+ and npm | `node -v` | `nvm install 24` or `brew install node` |
| Claude Code, signed in | `claude --version` | `npm install -g @anthropic-ai/claude-code`, then `claude` and `/login` |
| `gh`, signed in (GitHub panel, PR automations) | `gh auth status` | `brew install gh && gh auth login` |
| Xcode (Mac app only) | `xcodebuild -version` | Install Xcode from the App Store, then `sudo xcode-select -s /Applications/Xcode.app` |

Command Line Tools alone are not enough: `xcodebuild` needs full Xcode. Codex and Cursor Agent are optional; see [Harnesses](harnesses.md).

## Agent instructions

For an agent doing the setup (the README has the prompt to paste). Run each step, run its check, and stop on a failed check instead of working around it. Don't run `sudo`, don't install Xcode for the user, and never write secret values anywhere but the secret store (Keychain on a Mac, `data/secrets.json` on Linux).

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
| Mac app | `scripts/build-mac.sh` | Release build, installs to `~/Applications/Omni.app`, opens it. Starts and stops the server itself |
| Development | `npm run dev` | Server on :4747, Web UI with hot reload on http://localhost:4748 |
| Production | `npm run build && npm start` | One process, serves the built Web UI on http://127.0.0.1:4747 |

`scripts/build-mac.sh --no-open` installs without opening, and arguments after `--` go to the app (`-- -serverPort 4759`). You can also open `apps/mac/Omni.xcodeproj` in Xcode and run the `Omni` scheme; it finds the server on :4747 or starts one from the repo.

Optional: `scripts/install-launchd.sh` installs a LaunchAgent that starts the server at login, restarts it if it dies and keeps the Mac awake while it runs (`--uninstall` removes it). Skip it when you use the Mac app.

Reaching it from your phone: [Remote access](remote-access.md).

## Bring in your history

```bash
npm run import-history -- --days 30
```

Pulls your existing Claude Code sessions into Omni as resumable threads.

## Updating

```bash
git pull                  # a fork: git fetch upstream && git merge upstream/main
npm install --include=dev
scripts/build-mac.sh      # rebuilds and reinstalls the Mac app
```

Restart the server if you run it with `npm run dev` or `npm start`. The Mac app restarts its own. A fork merges cleanly as long as your settings stay in `data/`; see [FORKING.md](../../FORKING.md).
