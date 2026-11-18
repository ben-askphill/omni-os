# The omni command is a thin client the desktop app puts on PATH

> From the release after 0.1.30, the command is the Rust binary `crates/omni-cli` and the shim starts it ([rust-port.md](../internals/rust-port.md)). The TypeScript CLI in `apps/cli`, its bundle and the shim's `ELECTRON_RUN_AS_NODE` boot below were removed once 0.1.30 had shipped the binary, and `scripts/omni.sh` builds and runs the binary with `cargo`. The rest of this record stands.

Agents in Codex and Cursor threads, and crew roles without the Conductor's MCP tools, reach Omni by hand-writing `curl -H "Authorization: Bearer $OMNI_TOKEN" $OMNI_URL/api/...`. Nothing tells Ben why Omni will not start when the server is down, because the agents that could tell him live inside it. `scripts/omni.sh` started threads, but only from a checkout, with no wait or read-back. On omarchy `~/.local/bin/omni` was a different script for the old Linux service, dead since #528. The research for T-OMNICLI compared the CLIs of Orca, cloudroom, T3 Code, Claude Code, Codex, Cursor, Conductor, Zed and VS Code. The agent workspaces closest to Omni ship their CLI inside the desktop app and put it on PATH from there.

## Decision

- **Six commands, no more:** `new`, `send`, `threads` with `show`, `status`, `doctor` and `open`. `apps/cli` holds them. Automations, secrets, PRs, devices and updates stay with the Web UI and the Conductor's MCP tools. There is no `update` command (the app updates itself and Settings > Update all machines reaches every machine) and no headless server mode (the desktop app is the server, ADR 0010).
- **A thin client over `/api`.** The commands call the server through `@omni/client-core`, the typed client the iOS app uses, and its tests run against the recorded wire fixtures, which `apps/server/tests/wire-fixtures.test.ts` pins to the real server. `GET /api/machines` gained a client-core call and a fixture. No new server routes.
- **Auth is the agents' own.** `OMNI_URL`, then `OMNI_TOKEN` or `OMNI_TOKEN_FILE`, then the install's `data/api-token`. Inside a thread the server sets them already. A data folder's token (`OMNI_DATA_DIR` or the install's) never goes to another machine: one there needs `OMNI_TOKEN` or `OMNI_TOKEN_FILE`. Plain `http` leaves this machine only for a Tailscale address. A command run inside a thread acts as that thread: `new` files the thread under it, `send` sends as the Conductor, and `parent` names the thread that started it.
- **The install's port proves itself first.** Without `OMNI_URL`, the command asks `GET /api/auth/proof` before a request that carries the token, unless a proof passed within the last 250 ms on a monotonic clock and the connection has not dropped since. A `--wait` drops the proof before each poll, so every poll proves the server again. `open --pair` proves it before it prints a link that carries the token. With no token found there is nothing to prove with, so nothing is sent. Another install or another program on the port gets neither the token nor a prompt: the command exits 3. An address in `OMNI_URL` with a token named for it is trusted as given, since a proxy or tunnel signs a different port. With a data folder's token, an address on this machine proves itself first, and `open --pair` through another address checks the proof against the install's own port.
- **`doctor` needs no server.** It probes the port with `GET /api/auth/proof` as the desktop app does, and reads the token file, the data folder, disk space, `claude auth status`, `codex login status`, `gh auth status` and the end of the server log.
- **`open` goes through the app.** A second launch used to only focus the window. Now it hands its `--route` or `omni://` link to the running app through the single-instance lock, macOS's `open-url` does the same, and electron-builder registers the `omni` scheme. Without the app, `open` uses the browser.

## How it gets on PATH

- **The desktop app writes a shim on every launch.** The shim is a `/bin/sh` script that runs `<app> -e <boot> -- "$@"` with `ELECTRON_RUN_AS_NODE=1`. The boot imports `<resources>/omni/apps/cli/omni.mjs`, which `scripts/stage.ts` bundles beside the server, and calls its `run`. The command updates with the app and needs no Node on the machine, as the server does.
- **On Linux it runs the AppImage file, not the binary.** The binary lives in a FUSE mount that changes on every launch and goes away when the app quits. Running the `.AppImage` with `ELECTRON_RUN_AS_NODE=1` and `-e` works (checked against 0.1.24 on omarchy: Node 24.22.1, `process.resourcesPath` set, arguments after `--` intact). The boot finds the script through `process.resourcesPath`, so the shim never names a mount path.
- **Two copies.** One goes in the app's `bin` folder, next to the `node` shim. The server already appends that folder to its PATH, so every local harness's thread has `omni` even when the user's PATH lacks `~/.local/bin`. It comes last, so an `omni` earlier on the user's PATH wins, and then threads are not told about the command. The other goes in `~/.local/bin/omni` for terminals. Claude Code's native installer uses that folder too, and T3 Code and cloudroom write their shims there. `/usr/local/bin` would need admin rights on Apple silicon Macs.
- **An existing file.** The app writes when nothing is there, rewrites its own shim (marked `# omni-cli-shim`), and replaces Omni's old launchers: the dead Linux control script and a link to or copy of `scripts/omni.sh`. It replaces a link rather than writing through it. Anything else stays, and the server log says so. It writes beside the file and renames over it, so a running `omni` never reads half a script.
- **Only the installed app claims `~/.local/bin`.** A dev run, the QA harness, a `--data-dir`, `--port` or `--user-data-dir` launch, and a Mac app run from its disk image or App Translocation never write it, so a throwaway server never takes over Ben's command.
- **The shim carries the install's facts:** `OMNI_APP`, `OMNI_INSTALL_DATA_DIR`, `OMNI_INSTALL_LOG` and `OMNI_INSTALL_PORT`. The CLI never guesses a platform path, and `doctor` finds the token and log even with the server down.
- **Agents learn it from their system prompt.** A local thread whose role lacks the omni MCP gets one paragraph naming `omni send parent`, `omni new` and `omni show`. It gets the paragraph only when the `omni` that PATH finds is the app's shim.
- **`scripts/omni.sh` becomes a wrapper** that runs the CLI from a checkout with tsx, for a machine without the app.

## The CLI is exempt from "every surface"

CLAUDE.md asks every feature to reach desktop web, phone web and the desktop app. That rule does not extend to the CLI: a feature does not grow a command. The CLI covers the six commands above, and the MCP tools cover everything else. A change to an API the CLI reads keeps its tests passing, as it does for the iOS app.

## Considered

- **Only clean up:** delete the dead launcher and teach `scripts/omni.sh` the app's data dir and `--wait`. That fixes starting a thread from a terminal and nothing else: still no `doctor` when the server is down, and agents outside the Conductor keep writing curl.
- **Mirror the MCP tools as commands.** That would give 59 commands to keep in step with the MCP server and the Web UI.
- **A standalone install (npm, a curl script).** That is a second thing to update, and it would drift from the app's API.
- **A shim that runs the binary inside the AppImage mount.** The mount path dies with the app, and `doctor` matters most when the app is not running.

## Consequences

- A fourth client of `/api`. Its tests read the wire fixtures, so a shape change breaks them where the iOS app's would break.
- On a Mac, `~/.local/bin` may not be on PATH. The docs say how to add it. Agents get the app's own copy regardless.
- The signed Mac app running `-e` with `ELECTRON_RUN_AS_NODE`, and `process.resourcesPath` there, are checked on Linux only so far. The server already runs on the packaged Mac app with `ELECTRON_RUN_AS_NODE=1`, so the fuse is on.
- After an AppImage update that renames the file, the shim points at a missing file until the next launch, and says so.
