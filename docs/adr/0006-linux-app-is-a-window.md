# The Linux app is a desktop window on the Web UI

> Superseded by [ADR 0010](0010-desktop-app-is-electron.md) and deleted: one Electron app on the Web UI, with the server bundled inside it, replaced this launcher on Linux and the SwiftUI app on a Mac, and the cutover deleted `apps/linux` and its scripts. This record stays as the history of the launcher.

Omni on a Mac is a SwiftUI client ([ADR 0002](0002-mac-app-is-a-client.md)). That app does not run on Linux. Omarchy is a Hyprland desktop. The machine this was built for has GTK 4, libadwaita and Chromium, and not WebKitGTK 6.

A port of every Mac screen to GTK would be a second client to keep in step with the Web UI. ADR 0002 accepted that cost on the Mac because the native controls were the point. On Linux the Web UI is already the full client. What was missing is the part the Mac app does around it: start the server, stop it on quit when this launch started it, and a launcher entry that is not a browser tab.

## Decision

`apps/linux` is that launcher. `scripts/install-linux.sh` builds the Web UI and writes `~/.local/share/applications/omni-os.desktop`. Opening Omni runs `scripts/omni-linux.sh`. That script finds Node 24 or later (a desktop session often has a short PATH) and starts `node --import tsx apps/server/index.ts` from this checkout, the same command the Mac app uses. If `GET /api/auth/proof` shows this install already holds the port, the launcher attaches and does not stop that server when the window closes.

The window is Chromium's app mode, the same kind of window Omarchy uses for a web app, with its own profile under `~/.local/share/omni-os/browser`. The first page is `GET /api/auth/desktop-pair`. That route sets the pairing cookie for a request from this machine that did not come through a proxy, then redirects to `/`. The token is not in the URL or on the command line. A phone over Tailscale, and a browser on another machine, still pair with the token.

## Consequences

- A Web UI change is what the Linux app shows. Do not port screens into `apps/linux`.
- The Mac app, the phone layout and a remote browser do not call desktop-pair.
- Closing the window stops the server only when this launch started it. `npm run dev` on the same port keeps running.
- The app needs `apps/web/dist`. `scripts/install-linux.sh` builds it.

## Options turned down

- Porting the SwiftUI app to GTK. That is a second client, and the phone would still use the Web UI.
- A WebKitGTK window. WebKitGTK 6 is not installed here, and the Web UI is exercised in Chromium.
- `omarchy-webapp-install` on its own. That opens a URL and does not start or stop the server.
