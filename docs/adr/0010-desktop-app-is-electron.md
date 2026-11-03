# The desktop app is an Electron window on the Web UI, with the server inside it

> Done: the cutover deleted `apps/mac` and `apps/linux`, with their scripts. The desktop app is the third surface.

Omni has two desktop apps. On a Mac it is a native SwiftUI client of `/api` ([ADR 0002](0002-mac-app-is-a-client.md)): about 78,000 lines of Swift, with presentation rules ported from TypeScript and pinned by mirror tests. On Linux it is a launcher that opens the Web UI in Chromium's app mode ([ADR 0006](0006-linux-app-is-a-window.md)). Every feature is written twice, once in React and once in Swift, and the Swift half is the one that slips (folders in #177 never reached the Mac app). Both apps also need a repo checkout and Node 24 on the machine, so neither can be handed to someone as a download.

T3 Code (pingdotgg/t3code, `apps/desktop`) ships one Electron 44 shell for macOS, Linux and Windows. The shell loads the React web app and runs a bundled server on Electron's own Node (`ELECTRON_RUN_AS_NODE=1`). It builds Mac apps for arm64, x64 and universal.

## Decision

`apps/desktop` is that shell for Omni, in plain TypeScript, without Effect.

- **The UI is `apps/web`, unchanged in framework.** It is already React 19, Vite and Tailwind v4. Moving it to T3's TanStack Router, Base UI or Zustand is a separate decision. Desktop-only behavior goes through one bridge, `window.omniDesktop`. Its types are in `packages/shared/desktop-bridge.ts`, the preload exposes it, and the Web UI reads it only through `apps/web/src/desktop.ts`. In a browser or on a phone the bridge is absent, and every caller checks for it.
- **The server is bundled and runs on Electron's Node.** `apps/server/scripts/bundle.ts` writes the server and the MCP scripts as `.mjs` files. The app stages them with `crew/`, `automations/`, `mods/`, `prototypes/activity-monitor/`, the built Web UI and the two external packages (`node-pty`, `@playwright/mcp`) and their dependencies, and starts the server as `<app binary> <resources>/omni/apps/server/index.mjs` with `ELECTRON_RUN_AS_NODE=1` and `OMNI_SUPERVISOR=desktop`. The staged folder mirrors the repo's layout, so the server finds its root from its own location (`apps/server/config.ts`), as it does in a checkout. No checkout and no system Node are needed. In development the app runs the checkout's TypeScript with `--import tsx` on the same binary.
- **The app owns the server as the old apps did.** It attaches when this install's server already holds the port (the `/api/auth/proof` check from the Linux launcher), otherwise starts one and stops it on quit. After Update the server exits with 75, and the app starts it again. The window pairs through `GET /api/auth/desktop-pair`, as the Linux launcher did.
- **Linux folds into the same app.** One codebase builds a DMG and zip per Mac arch and a Linux AppImage. `apps/linux` and its scripts go once the AppImage replaces them.
- **The SwiftUI app is replaced, then deleted.** The Electron app reaches parity with the Mac app's own features (menus, quit hold, notifications, wake nudges, zoom, appearance, thread windows, Quick Prompt, launch at login, Wispr Flow, activity monitor, the native Web tab). Ben switches to it. `apps/mac` is deleted once he has used the new app daily, not before. Until then both build, and a Mac surface change still ships to `apps/mac`.
- **The third surface becomes the desktop app.** Its QA harness is `apps/desktop/scripts/qa.ts`, Playwright's Electron driver against a `scripts/qa-stack.sh` server. It replaces the Debug app's `QARunner`, keeps its step names where they carry over, and refuses port 4747 in the same way.

## What is given up

- **Native SwiftUI controls.** ADR 0002 chose SwiftUI for the native feel at Ben's desk and turned down a web view around the React UI for that reason. This ADR reverses that trade. Omni gets one client to keep correct instead of two, plus a downloadable app, and in exchange the desktop app looks and behaves like the Web UI. It is not an AppKit app. A Mac detail the Web UI cannot draw (the window's traffic lights, menus, the Dock, notifications) comes from Electron.
- **The mirror tests.** The Swift ports of transcript grouping, tool labels and the status line, the JavaScriptCore slash bundle and `mac-fixtures.test.ts` lose their reason to exist. They go with `apps/mac`.
- **A small app.** The download carries Chromium and Node, so it is several times the size of the SwiftUI app.

## Spike results

Measured on Linux x64 with Electron 44.10.1:

- Electron 44.10.1 bundles Node 24.22.1, which meets the server's `engines` field (`>=24`).
- `node:sqlite` loads and runs under `ELECTRON_RUN_AS_NODE=1`.
- `node-pty` is an N-API module (node-addon-api). Its package carries prebuilds for darwin-arm64, darwin-x64 and win32, so a Mac build needs no rebuild for Electron. On Linux it compiles at install.
- The bundled server boots from a copy of the repo layout with no checkout and answers `/api/status` (`apps/server/tests/bundle-boot.test.ts`).
- The Electron window pairs with a server through `/api/auth/desktop-pair`, loads the Web UI, and `window.omniDesktop` answers.

Still open: the secret store's Keychain calls (`security`) from the server running as an Electron-Node child of a signed app. This needs a Mac. Check it on the first signed build before the cutover.

## Options turned down

- **Keep the SwiftUI app and add an Electron app for Linux only.** Every feature would still be written twice, and the Mac app would still need a checkout.
- **Tauri or a WKWebView shell.** Either one is smaller, but the server would need Node beside it, and the Web UI is built and tested in Chromium. T3 Code already proves the Electron route.
- **Move the Web UI to T3's stack first.** That is a large change unrelated to shipping a desktop app, and nothing in this decision needs it.
- **Windows builds.** T3 ships them. Omni has no Windows user yet, so they can be added later.
