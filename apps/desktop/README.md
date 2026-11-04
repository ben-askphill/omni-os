# Omni desktop app

An Electron window on the Web UI that runs the Omni server itself ([ADR 0010](../../docs/adr/0010-desktop-app-is-electron.md)). It loads `apps/web` as it is, starts the bundled server on Electron's own Node, and adds what a browser cannot do: menus, notifications, the Quick Prompt shortcut, launch at login, zoom, thread windows and the native Web tab. One codebase builds the Mac app (arm64, x64, universal) and the Linux AppImage. It replaced the SwiftUI Mac app and the Linux launcher.

## Layout

| Path | What it holds |
| --- | --- |
| `src/main.ts` | The main process: one instance, the backend, the windows, and each feature's `install*(ctx)` |
| `src/context.ts` | `AppContext`, what every feature gets |
| `src/backend/` | Attach to this install's server or start one, restart it after exit 75, stop it on quit if this app started it (on this launch, or on an earlier one that kept it running: a note in userData's `server-<port>.json` says so). An attached server that stops answering shows the failure screen. `data-dir.ts` picks the data dir |
| `src/ipc.ts`, `src/handle.ts`, `src/preload.ts` | The bridge: channel table, typed `ipcMain` handlers with an origin check, and `window.omniDesktop` |
| `src/options.ts`, `src/paths.ts`, `src/settings.ts` | Command line, per-OS default paths, the app's own settings file |
| `scripts/build.ts` | Builds `dist/main.cjs`, `dist/preload.cjs` and `dist/pick-preload.cjs` |
| `scripts/stage.ts`, `scripts/dist.ts`, `electron-builder.config.cjs` | Stage the server bundle and package the app |
| `scripts/qa.ts` | The QA harness |
| `scripts/update-check.ts` | The self-update, end to end on Linux: every way of quitting with an update downloaded |
| `scripts/version.ts`, `RELEASE.md` | The version bump the release workflow (`.github/workflows/desktop-release.yml`) runs, and how to release |

## The bridge

`packages/shared/desktop-bridge.ts` is the contract: the `DesktopBridge` type the page sees as `window.omniDesktop`, the events the main process sends (`DesktopEvent`, including menu commands as `DesktopCommand`), and the pure rules both sides share (settings parsing, zoom steps, Quick Prompt shortcuts). The Web UI reads the bridge only through `apps/web/src/desktop.ts`, which is `null` in a browser or on a phone. Gate every desktop-only piece of UI on it, so the other two surfaces stay as they were.

To add a call, add the channel to `src/ipc.ts`, the method to `src/preload.ts` and the type to `desktop-bridge.ts`, then answer it in the main process with `handle` or `on` from `src/handle.ts`. Those check that the sender is an Omni page, so a site in the Web tab cannot reach the bridge. `apps/desktop` imports `@omni/shared` only, never `apps/server` or `apps/web` source.

## Develop

Never point a development app at port 4747 or the main checkout's `data/`. Without flags it would use exactly those: port 4747 and this checkout's `data/`. Start a QA stack and attach to it:

```sh
QA_SERVER_PORT=4766 QA_NO_WEB=1 scripts/qa-stack.sh up     # its data dir: ${TMPDIR:-/tmp}/omni-qa-4766/data
cd apps/desktop
npm run dev -- --port 4766 --data-dir "${TMPDIR:-/tmp}/omni-qa-4766/data" --user-data-dir="${TMPDIR:-/tmp}/omni-qa-4766/electron"
```

Pass `--user-data-dir` too. The app names itself Omni, so without it a dev run shares the installed app's user-data folder (`~/Library/Application Support/Omni` or `~/.config/Omni`): with the installed app open, the single-instance lock makes the dev run exit with no window, and with it closed, the dev window's zoom, Quick Prompt and launch-at-login changes land in the real app's `settings.json`.

`npm run dev` builds `dist/`, fetches the Electron binary once if npm skipped its install script, and starts `electron . --dev`. The arguments after `--` go to the app:

| Flag | Does |
| --- | --- |
| `--dev` | Runs the checkout's server TypeScript with `--import tsx` instead of the bundle |
| `--port <n>` | The server to attach to, or to start on that port |
| `--data-dir <dir>` | The server's data dir. The app attaches only to a server holding this dir's `api-token` |
| `--app-url <url>` | Loads the UI from here, such as Vite, for hot reload. Pairing still goes to the server |
| `--route '#/settings'` | Opens the first window on a hash route |

The server serves `apps/web/dist`, so a Web UI change shows only after `npm run build -w @omni/web`, or through Vite. Run a Vite on `127.0.0.1` in front of the stack and pass it as `--app-url http://127.0.0.1:<vite port>`. Use `127.0.0.1`, not `localhost`: the pairing cookie is set for `127.0.0.1`.

```sh
OMNI_PORT=4766 npx vite --config apps/web/vite.config.ts --host 127.0.0.1 --port 4786 --strictPort
```

Tests and types: `npx vitest run && npx tsc --noEmit` in this folder, or `npx turbo run test typecheck --filter=@omni/desktop`.

## QA harness

`scripts/qa.ts` drives the app with Playwright's Electron driver. It runs a JSON script against a QA stack's server and writes one PNG per screenshot step, plus `qa.json`, `main.log` (the main process's output) and the run's own Electron user-data folder to `--out`.

```sh
cd apps/desktop
npx tsx scripts/qa.ts --script run.json --out ~/.cache/omni-qa/run
npx tsx scripts/qa.ts --script run.json --out ~/.cache/omni-qa/run --app-url http://127.0.0.1:4786
npx tsx scripts/qa.ts --script run.json --out ~/.cache/omni-qa/run --app release/mac-arm64/Omni.app
```

- Without `--app` it builds `dist/` and launches this checkout's dev build. `--app` takes a packaged app: `Omni.app`, its binary, or an AppImage.
- It only attaches. It exits 2 before launching anything when the port is 4747, when the data dir is this checkout's or the main checkout's `data/`, or when no server on the port holds the data dir's token. Start the stack first.
- Each run gets its own `--user-data-dir` in the out folder. Its settings, Web tab logins and single-instance lock never touch the real app's, and a real app that is open does not swallow the launch.
- It exits 0 when every step passed and 1 when one failed or the first window never loaded. A failed step does not stop the run. Each step has a ceiling of twice its own timeout (or its wait) plus 30 seconds, so a call that never answers fails its step instead of holding the run. `qa.json` is rewritten after every step: `{ok, error, app, port, dataDir, steps: [{step, action, ok, ms, error, files}], facts: {route, windows: [{url, title, bounds, zoom}]}, pageErrors}`.
- `--script` takes a path or the JSON itself. `--port`, `--data-dir`, `--app-url`, `--appearance`, `--zoom` and `--size 1320x860` override the script's fields.

A script is a list of steps, or an object with the run's settings and `steps`:

```json
{
  "port": 4766,
  "dataDir": "/tmp/omni-qa-4766/data",
  "appUrl": "http://127.0.0.1:4786",
  "appearance": "dark",
  "zoom": 1,
  "size": [1320, 860],
  "steps": [
    {"route": "#/"},
    {"expect": "text=Sample thread 2"},
    {"snapshot": "home"},
    {"openThread": "<thread id>"},
    {"snapshot": "thread"},
    {"quit": true}
  ]
}
```

| Step | Does |
| --- | --- |
| `{"route": "#/c/inbox"}` | Sets the current window's hash route |
| `{"click": "<selector>"}` | Clicks the first match. Selectors are Playwright's: CSS, `text=...`, `role=button[name="Save"]` |
| `{"fill": {"selector": "textarea", "text": "hi"}}` | Fills a field |
| `{"type": "text"}`, `{"press": "Control+K"}` | Types into, or presses a key in, whatever has focus |
| `{"wait": 500}`, `{"wait": "<selector>"}`, `{"wait": {"for": "<selector>", "timeout": 30}}` | Waits for milliseconds, or until the selector is visible (10 seconds by default, `timeout` in seconds). The old SwiftUI harness's conditions are refused when the script is read, with the selector to use instead: `sidebarLoaded` is `[data-channel-id]`, `channel:<id>` is `[data-channel-id="<id>"]`, `thread:<id>` is `openThread` or a `route` and then a transcript selector, and `serverState:` and `connection:` always hold, since the harness only attaches to a running server |
| `{"sleep": 1.5}` | Seconds |
| `{"expect": "<selector>"}`, `{"expect": {"selector": "h1", "text": "General", "timeout": 5}}` | Fails unless the selector is visible and, when given, its text contains `text` |
| `{"command": "settings"}` | Sends a `DesktopCommand` to the current window on the event channel, as a menu item does: `new-thread`, `go-to`, `search`, `home`, `settings` |
| `{"menu": "View > Zoom In"}` | Clicks that item of the application menu for the current window. Labels match without `&`, a trailing ellipsis, or case |
| `{"window": "main"}`, `"quick-prompt"`, `"newest"` | Makes that window current, waiting for it to show. Quick Prompt's panel stays loaded while hidden, so this waits until it is on screen |
| `{"openThread": "<id>"}`, `{"openWindow": "#/settings"}` | Opens the route in a window of its own through the bridge, as Open in New Window does, and makes it current |
| `{"appearance": "dark"}` | Sets `nativeTheme` and the pages' color scheme |
| `{"zoom": 1.2}` | Sets the zoom through the bridge's settings, then on the window |
| `{"size": [1100, 800]}` | Resizes the current window. A tiling window manager may size it back |
| `{"snapshot": "home"}`, `{"screenshot": "home"}` | Writes `home.png` of the current window from the window's own capture. Fails when the page drew nothing, or at once when the window is hidden or minimized (Quick Prompt hides itself on Escape and on blur) |
| `{"quit": true}` | Ends the run |

Notes:

- A fresh QA stack opens on the onboarding dialog. Start with `{"click": "text=Skip setup"}`, which then leaves the window on the Conductor's welcome thread, or write `$QA_DIR/data/omni.config.json` with an `onboardedAt` first (see the verify skill).
- Screenshots come from `webContents.capturePage()`, so they need no screen-recording permission, and a zoomed window comes out whole. Playwright's own page screenshot crops a zoomed page.
- Steps the old SwiftUI harness had for its own controls (`scroll`, `expand`, `folder`, `annotate`, `quickPrompt` and the rest) have no counterpart here. Drive the same UI with `click`, `fill` and `press` on the Web UI's own elements.

## Stage and package

```sh
npx tsx scripts/dist.ts --platform mac --arch arm64      # or x64, universal; --dir for the .app only
npx tsx scripts/dist.ts --platform linux --arch x64      # the AppImage
```

`dist.ts` builds `dist/`, stages `build/omni` with `stage.ts` (the server and MCP bundles, `apps/web/dist`, `crew/`, `automations/`, `mods/`, `prototypes/activity-monitor/`, a `package.json` and a `node_modules` with only the bundle's external packages for that target), then runs electron-builder with `electron-builder.config.cjs`. Artifacts land in `release/` as `Omni-<version>-<os>-<arch>.<ext>`. It uploads them only with `--publish`, which only the release workflow passes ([RELEASE.md](RELEASE.md)). A Mac build signs with the keychain's Developer ID identity when there is one, and notarizes only when Apple's credentials are in the environment.

A Linux build ships `node-pty`'s compiled addon, which must load on glibc 2.28. When the checkout's own build needs a newer glibc (most current distros), `stage.ts` compiles it again in docker's `node:24-bullseye` image, so it needs a working docker, and stops with an error without one. `--host-glibc` skips that and ships this machine's build, which only runs on a glibc as new as this one: fine for a local test, not for a release.

On a Mac, `npm run build:desktop` (`scripts/build-desktop.sh`) builds the unpacked app for this Mac's arch, installs it to `~/Applications/Omni.app` and opens it. In the main checkout it first syncs to `main`. It signs with a Developer ID or Apple Development identity from the keychain, else ad hoc, and never notarizes. It refuses to replace an app with another bundle id, such as the old SwiftUI app: move that one away first. `build-desktop.sh` never replaces the app while it, or a server it started, still runs from the bundle.

## Updates

A downloaded update installs as the app quits, once the server it started has stopped. Keep Server Running in the quit question leaves the update for a later quit, because that server still runs from the files the update replaces. Relaunch to Update asks the same question without that choice: Update When They Finish, Stop Them and Update, or Cancel.

`scripts/update-check.ts` builds this checkout as two AppImages, 0.1.0 and 0.1.1, serves 0.1.1 from a local feed on port 47901 and runs each case on port 47911 against a copy of 0.1.0 with a fake-claude turn where the case needs one. It needs a display, takes a few minutes and keeps its folder in `$TMPDIR` when a case fails. `--old` and `--feed` reuse earlier builds, and `--only <text>` runs the cases whose names contain it. A Mac has no counterpart, as Squirrel.Mac installs only a signed app.

```sh
npx tsx scripts/update-check.ts
```

## Where things live

| | macOS | Linux |
| --- | --- | --- |
| Server data | `~/Library/Application Support/Omni/data` | `$XDG_DATA_HOME/omni-os/data` (`~/.local/share/omni-os/data`) |
| Server log | `~/Library/Logs/Omni/server.log` | `$XDG_STATE_HOME/omni-os/server.log` (`~/.local/state/omni-os/server.log`) |
| App settings (`settings.json`), the data-dir choice (`data-dir.json`) | `~/Library/Application Support/Omni` | `~/.config/Omni` |

On first launch, when the SwiftUI app (its `repoPath`, or `~/omni-os`) or the Linux launcher (the checkout in its `omni-os.desktop` entry) left an `omni.db` in a checkout's `data/`, the app asks once whether to use that folder in place or start fresh. It only reads the old folder to decide, and never copies or moves it. `--data-dir` and `--dev` skip the question. In development the default is the checkout's own `data/`. Server, Show Server Log opens the log.
