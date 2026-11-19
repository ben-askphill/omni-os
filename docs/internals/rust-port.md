# Rust port

Which parts of Omni move to Rust, in what order, and which stay in TypeScript with the reason. Read it before you port a module, delete a TypeScript file that has a Rust twin, or change a ported module's behaviour.

## Rules

- **A slice at a time.** One slice is one module with one job, such as the helper servers a thread starts. A slice is three small pull requests: the Rust code with its parity tests, then shipping and using it with the TypeScript still there as a fallback, then deleting the TypeScript.
- **Parity before deletion.** The TypeScript module records what it does with a set of inputs into `packages/test-fixtures/native/`. The same record is replayed against the Rust build. TypeScript is deleted only after a released build has carried the Rust binary. From then on the record is the contract: a change in behaviour edits the scenario files by hand, with the Rust change.
- **Same contracts.** A port keeps the API it calls, the bytes it writes and the files it reads. A known difference is listed under [Known differences](#known-differences), with a test on the Rust side.
- **No port for its own sake.** A module moves when Rust gives it something it lacks today: a lower cost per process, a faster start, or a single file to ship. A module that mostly waits on the network or on a child process gains none of that.
- **`npm test` does not need Rust.** The Rust tests have their own command. A machine without `cargo` still passes `npm test`: the tests that need a ported binary skip and say so. After step 3 there is no TypeScript to fall back to, so a desktop build needs `cargo` (see [Without cargo](#without-cargo)).

## Audit

Lines are source lines, then test lines, counted on `main` at a336f918 (2026-11-16), before the port. Everything was TypeScript then: the repo had no Rust and no Swift. `apps/cli` and `ask.ts`, `render.ts` and `threads.ts` in `apps/mcp` have since been deleted (step 3 of slices 1 and 2).

| Module | Language | Lines (source / tests) | What it does |
| --- | --- | --- | --- |
| `apps/server` | TypeScript, Node | 47,766 / 49,785 | The daemon. Hono API on `node:sqlite`, owns every thread, harness process, secret and automation |
| `apps/web` | TypeScript, React 19 | 42,599 / 12,534 | The Web UI, desktop and phone layouts |
| `apps/ios` | TypeScript, React Native (Expo) | 24,427 / 9,886 | The iPhone app |
| `packages/shared` | TypeScript | 14,529 / 7,163 | Pure logic the web, desktop and iOS clients share: slash grammar, view models, status marks |
| `apps/desktop` | TypeScript, Electron | 6,756 / 3,319 | The desktop shell: shows the Web UI, runs the bundled server, native notifications, updates |
| `packages/client-core` | TypeScript | 2,169 / 2,208 | Typed HTTP and thread stream for the iOS app and the CLI |
| `apps/mcp` | TypeScript, Node | 1,931 / 0 | The MCP servers a thread starts (table below) |
| `apps/relay` | TypeScript, Cloudflare Worker | 1,671 / 883 | The sync relay: Durable Object SQLite and R2 |
| `apps/cli` | TypeScript, Node | 1,513 / 996 | The `omni` command, six commands over `/api` |
| `packages/test-fixtures` | TypeScript, JSON | fixtures | Fake CLIs, corpora and the wire fixtures the tests share |
| `packages/typescript-config` | JSON | config | The shared `tsconfig` |
| `scripts/` | Shell, JavaScript | 1,577 | QA stacks, desktop build, screenshots, daily docs |
| `crew/`, `mods/` | Markdown, TypeScript | 526 | Role charters, one Claude Code mod |
| `design-system/`, `prototypes/`, `docs/` | HTML, JSX, Markdown | not code that ships | The design system mirror, experiments and these docs |

### Inside `apps/server`

| Module | Files / lines | What it does |
| --- | --- | --- |
| Root (`*-api.ts`, `compose.ts`, `sandbox.ts`, `browser.ts`, `links.ts`, ...) | 161 / 24,157 | The HTTP routes and the services behind them: threads, channels, artifacts, PRs, secrets, the channel browser, link previews, push |
| `harness/` | 36 / 5,729 | One adapter per harness (Claude Code, Codex, Cursor Agent, Cursor Cloud, Hermes), Auto routing, the model catalog |
| `sync/` | 40 / 4,459 | Signed changes between machines, file plans, the handlers per entity |
| `runner/` | 21 / 4,327 | A thread's process: the controller, the queue, limits, questions, handover |
| `db/` | 26 / 3,810 | The SQLite connection, migrations and one repo per table |
| `scripts/` | 16 / 2,507 | Setup, history import, brain export, the server bundle, route benchmarks |
| `usage-scan/` | 6 / 798 | Finds repeated asks in past threads and masks secrets before a model reads them |
| `pr-watch/` | 5 / 718 | Polls watched pull requests through `gh` |
| `connect/` | 3 / 593 | Omni Connect: the tunnel to the relay and its tokens |
| `message-context/` | 7 / 412 | Diff lines, terminal excerpts, browser annotations and thread references on a message |
| `handoff/` | 2 / 350 | Moving a thread's worktree to another machine |

### Inside `apps/mcp`

| Module | Lines | What it does |
| --- | --- | --- |
| `omni.ts`, `pull-requests.ts` | 1,212 | The conductor's tools (about 60), one process per conductor thread |
| `external/tools.ts`, `external/http.ts`, `external/stdio.ts` | 479 | Omni as an MCP server for other clients (20 tools), over HTTP inside the server and over stdio |
| `ask.ts` | 79 | `ask_user_question`, one process per thread |
| `render.ts` | 41 | `html_render`, one process per thread |
| `threads.ts`, `referenced-thread.ts` | 58 | `read_referenced_thread`, one process per thread that is not a conductor |
| `api.ts` | 62 | The HTTP client those servers share |

## Where Rust fits

Omni's server spends its time waiting on a harness process, on SQLite or on GitHub, and Rust does not make waiting faster. Before the port, two parts of Omni paid for a whole runtime they barely used:

- **Helper processes.** Every thread starts three MCP servers, and each was a whole Node runtime (Electron's, in the desktop app) holding a few dozen lines of logic. A machine with four live threads had 12 of them at 22 to 28 MB of private memory each. The Rust build of the same server holds about 1 MB and answers `initialize` in 1 ms, against roughly 170 to 200 ms for the TypeScript one from a checkout.
- **The `omni` command.** Agents and people run it from a shell, often many times in one turn. `omni --version` took about 190 ms through the desktop app's shim, nearly all of it runtime start. The Rust build prints it in under 1 ms.

## Measured candidates

Measured on 2026-11-17, after slices 1 and 2, to pick the next slice by what it wins. One machine (Linux x64) and the 0.1.30 AppImage, so every Node process below is Electron's Node. The data was a copy of a real install: 1,702 threads, 309,807 events, 29 channels. "Private" is the memory a process holds alone, which is what one more of it adds to the machine.

Ranked by what one slice can win back:

| Rank | Candidate | Before | What a slice can win | Verdict |
| --- | --- | --- | --- | --- |
| 1 | The browser server (`@playwright/mcp`), one per thread that is not delegate-only | 61 MB private, `initialize` after 241 ms | All of it in a thread that never calls a browser tool: 311 of 466 threads in 14 days (67%) | Slice 3 |
| 2 | The conductor's server (`apps/mcp/omni.ts`), one per conductor thread | 28 MB private, `initialize` after 63 ms | About 27 MB and 60 ms per conductor thread: 179 threads in the same 14 days | Not next. See [Decisions for Ben](#decisions-for-ben) |
| 3 | `apps/server`, the process | First HTTP answer after 161 ms, 57 MB private after 15 s idle | Part of 57 MB, once per machine | Kept |
| 4 | `apps/server`, the read routes | 0.3 to 51 ms a request (p50) | The time outside SQLite: 0.2 to 14 ms a request | Kept |
| 5 | Transcript, stream and diff parsing (`packages/shared`, `apps/server/stream.ts`) | 10.1 ms to fold a 4,811-event thread, 38.8 ms to parse a 40.6 MB session log, 3.0 ms to parse a 3.3 MB diff | A few ms on the longest thread | Kept |
| 6 | `apps/mcp/external` over stdio | Not in the app, and no process of it on the machine | Nothing | Kept |
| 7 | `packages/client-core`, `apps/relay`, `apps/desktop` | No hot path on the machine: an iOS library, a Cloudflare Worker and a shell around Chromium | Nothing a slice reaches | Kept |

- **The browser server wins because most threads never use it.** Every Claude Code, Codex and Cursor Agent thread starts one, unless its role is delegate-only, as the conductor's is. The ones running on the machine held 47 to 49 MB each. Of the 466 threads of 14 days that were not a conductor's, 155 called a browser tool. That is 311 threads at about 48 MB against 179 conductor threads at 28 MB, three times the conductor server's saving. It is not a port: `@playwright/mcp` is not Omni's code, so slice 3 puts a small Rust process in front of it that starts it late.
- **The conductor's server** is the only module on the audit's list a slice can make cheaper. Rust would take it to about 1 MB and 1 ms, as it did `omni-mcp ask` (0.12 MB, 1.1 ms). It is one process per conductor thread, and `omni.ts` changed in 72 commits in the 30 days before the measurement, each of which would have needed the same change in Rust until step 3.
- **The server's routes wait on SQLite.** The three slowest are `/api/channels` (51 ms, 81% inside SQLite), a 4,811-event thread with every event (24 ms, 44%) and search (15 ms, 98%). The rest of each is `JSON.stringify`, which is native code already. `/api/channels` is slow because the `channels` table holds 16 MB in 29 rows and the route reads all of it. That is a query to change in TypeScript.
- **Nothing in `packages/shared` is compute bound.** Folding the longest thread on the machine takes 10 ms when it opens and 2 ms for each event after. That code runs in the browser and in React Native, so Rust would reach it as WebAssembly, for a gain under 10 ms.
- **The stdio build of the external server** (`apps/mcp/external/stdio.ts`) is not in the desktop app. Other clients reach Omni over HTTP, inside the server.

The routes, 100 rounds each in one process:

| Route | p50 | p95 | Inside SQLite | Answer |
| --- | --- | --- | --- | --- |
| `status` | 0.27 ms | 0.44 ms | 6% | 1.2 KB |
| Recent threads (60) | 4.72 ms | 5.2 ms | 72% | 112.8 KB |
| Thread list (50) | 4.26 ms | 4.71 ms | 76% | 93.9 KB |
| Channels | 51.22 ms | 55.78 ms | 81% | 839.8 KB |
| Needs you | 3.06 ms | 3.22 ms | 85% | 0 KB |
| Search "error" | 14.9 ms | 15.42 ms | 98% | 10.7 KB |
| A channel's threads (736) | 4.7 ms | 8.93 ms | 41% | 358.4 KB |
| Thread detail, newest page (of 4,811 events) | 8.63 ms | 10.73 ms | 67% | 158.2 KB |
| Thread detail, every event (4,811) | 24.26 ms | 27.89 ms | 44% | 6,980 KB |
| Thread history page (middle) | 3.41 ms | 4.32 ms | 17% | 155 KB |
| Thread summary | 2.14 ms | 2.28 ms | 86% | 4.2 KB |

Opening the database took 105 ms and loading the routes 206 ms, from a checkout through `tsx`.

The processes, medians:

| Process | `initialize` | `tools/list` | Private memory |
| --- | --- | --- | --- |
| `@playwright/mcp` `cli.js` | 240.9 ms | 246.4 ms (25 tools) | 61.04 MB |
| `apps/mcp/omni.mjs`, the conductor's server | 62.7 ms | 67.1 ms (61 tools) | 28.18 MB |
| `apps/mcp/ask.mjs`, the TypeScript server slice 1 replaced | 59.3 ms | 61.2 ms | 26.74 MB |
| `omni-mcp ask` | 1.1 ms | 1.3 ms | 0.12 MB |
| `apps/server/index.mjs`, the server | first HTTP answer after 161 ms | | 57 MB after 15 s idle |

### How to measure again

`<app>` is the folder of an unpacked desktop app (an AppImage's mount on Linux). The scripts take any command, so the same lines measure a checkout or a Rust build.

- **The read routes and the parsers.** Copy a data dir first, never read the live one: `sqlite3 -readonly data/omni.db "VACUUM INTO '<dir>/omni.db'"`. Then `OMNI_DATA_DIR=<dir> npx tsx apps/server/scripts/bench-hot-paths.ts --rounds 100 --transcript <a harness session log> --diff <a unified diff>`. It refuses a data dir a server runs on. The parser numbers above are from a run with `--rounds 30`.
- **A stdio MCP server.** `node scripts/bench-stdio-server.mjs --runs 5 --env ELECTRON_RUN_AS_NODE=1 -- <app>/omni-os <app>/resources/omni/node_modules/@playwright/mcp/cli.js --output-dir <dir> --headless --isolated`, and the same with `<app>/resources/omni/apps/mcp/omni.mjs` or `<app>/resources/omni/bin/omni-mcp ask` after the `--`. The server it starts gets `OMNI_URL` on a closed port and no token.
- **The server.** `node scripts/bench-server-boot.mjs --runs 3 --idle 15 --env ELECTRON_RUN_AS_NODE=1 -- <app>/omni-os <app>/resources/omni/apps/server/index.mjs`. Each run gets a new data dir, a free port and the fake CLIs.
- **How many threads call the browser.** On the copy: the threads of 14 days by role, and of those the ones with a `tool_use` event whose name starts with `mcp__omni-browser__`.
- Memory comes from `/proc/<pid>/smaps_rollup`, so those columns are Linux only.

## Plan

In this order. Each row is one slice.

| Slice | Crate | Why now |
| --- | --- | --- |
| 1. Per-thread MCP servers: `ask`, `render`, `threads` | `crates/omni-mcp`, `crates/omni-core` | Three processes per thread, smallest logic, largest saving. Also builds what later slices reuse: the JSON printer that matches `JSON.stringify`, the API client, the MCP stdio server |
| 2. The `omni` command | `crates/omni-cli` | Start time. Its tests already run against the wire fixtures, which become the parity record |
| 3. The browser server starts at a thread's first browser call | `crates/omni-mcp` | The largest cost per thread that is left, and two threads in three never use it ([Measured candidates](#measured-candidates)) |

The conductor's MCP server (`omni.ts`) was slice 3 before the measurement. It is not scheduled now: see [Decisions for Ben](#decisions-for-ben).

Per slice:

1. **Port.** The crate, the recorded fixtures, tests on both sides. Nothing runs the binary yet.
2. **Ship.** The desktop build compiles the binary for macOS (universal) and Linux and puts it beside the server. The server, or the app for the `omni` command, starts the binary when it is there and the TypeScript when it is not, and logs which.
3. **Remove.** After a release has carried the binary, delete the TypeScript twin, its bundle entry and the fallback.

## Status

`ported`: the Rust code is on `main` and passes parity. `in progress`: a pull request is open. `planned`: next in the order above. `kept`: stays as it is, with the reason.

| Module | Status | Reason or next step |
| --- | --- | --- |
| `apps/mcp` `ask.ts`, `render.ts`, `threads.ts` | ported | Slice 1, all three steps. `crates/omni-mcp` is the only build: 0.1.30 shipped it and the TypeScript is deleted. `referenced-thread.ts` and `api.ts` stay, because the conductor's `omni.ts` uses them |
| `apps/cli` | ported | Slice 2, all three steps. `crates/omni-cli` is the only build of the six commands ([ADR 0014](../adr/0014-omni-command-line.md)): 0.1.30 shipped it, and `apps/cli` and its bundle are deleted. `scripts/omni.sh` builds and runs it from a checkout |
| `apps/mcp` `omni.ts`, `pull-requests.ts` | kept | 28 MB and 63 ms per conductor thread to win, in a file that changes every day. Not scheduled: see the decision below |
| The browser server (`@playwright/mcp`) | ported | Slice 3, both steps. Not Omni's code, so the server itself is not ported: `omni-mcp lazy` in front of it starts it at a thread's first browser call. `OMNI_BROWSER_LAZY=0` turns that off |
| `apps/mcp` `external/` | kept | The HTTP transport runs inside the server and shares `tools.ts` with the stdio one. Porting only stdio would leave two copies of 20 tools. Moves with the server or not at all |
| `apps/server` `runner/`, `harness/` | kept | They start a CLI and wait on its stream. The adapters change with every harness release, and 50,000 lines of tests hold them in TypeScript. No runtime cost to win back |
| `apps/server` `db/` | kept | `node:sqlite` is SQLite's own C code already. The migrations and repos are the on-disk contract, and two implementations of a schema is the regression this port must not cause |
| `apps/server` root, `sync/`, `pr-watch/`, `connect/`, `message-context/`, `handoff/`, `usage-scan/`, `scripts/` | kept | Part of one process with the runner and the database. A route cannot move alone: it reads the same connection and in-memory state. See the decision below |
| `apps/server` terminal (`node-pty`) | kept | Already native code |
| `apps/web` | kept | React in a browser. Rust would reach it only as WebAssembly, and nothing in it is compute bound |
| `apps/ios` | kept | Expo and React Native. A Rust core through a native module would replace 2,169 lines of `fetch` and stream handling with a build step for two toolchains |
| `apps/desktop` | kept | Electron ([ADR 0010](../adr/0010-desktop-app-is-electron.md)). See the decision below |
| `packages/shared` | kept | The same TypeScript runs in React, React Native and Electron. Rust would need WebAssembly in all three for string and view-model logic |
| `packages/client-core` | kept | Used by the iOS app, its only client now that the CLI is Rust |
| `apps/relay` | kept | A Cloudflare Worker each user deploys. JavaScript is the platform's first language for Durable Object SQLite, and the Worker has no start cost to win back |
| `packages/test-fixtures`, `packages/typescript-config` | kept | Test data and config. `native/` holds the records the Rust tests replay |
| `scripts/`, `crew/`, `mods/`, `design-system/`, `prototypes/` | kept | Shell, Markdown and HTML. Nothing to port |

## How parity is checked

- **The record.** `packages/test-fixtures/native/` holds what the TypeScript module did: each scenario's input and the exact output. Until step 3, a TypeScript test replays every scenario against the TypeScript module on each `npm test`, so the record cannot drift from the code it describes, and rewrites it on request.
- **The Rust side.** A Rust integration test replays the same files against the Rust binary and compares byte for byte.
- **Both ways.** Until step 3, the TypeScript test also runs the Rust binary when it is named, so one runner has judged both implementations.
- **After step 3.** The TypeScript module and its runner are gone, and the Rust test alone holds the binary to the record. A change in behaviour edits the scenario it changes by hand, in the same pull request as the Rust change. The corpora of what Node did (`js-corpus.json`, `cli-corpus.json`) stay as they were recorded. `apps/mcp/tests/js-corpus.test.ts` still checks `js-corpus.json` against Node, which needs no twin.

## Working on the Rust code

- Toolchain: `rust-toolchain.toml` pins it. `rustup` or `mise` installs it on first use.
- `npm run test:rust` (or `cargo test --workspace --locked`), `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo fmt --all --check`.
- The workspace is `Cargo.toml` at the repo root, the crates are in `crates/`. `unsafe` is forbidden in the workspace lints.
- `omni-cli` needs a C compiler: its TLS library (`ring`) compiles C and assembly. `omni-mcp` and `omni-core` need none.
- Run the tests with Omni's own variables unset (`env -i PATH="$PATH" HOME="$HOME" cargo test ...`) when your shell is an Omni thread: `OMNI_URL` there points at the live server.

## Slice 1: the per-thread MCP servers

`omni-mcp ask`, `omni-mcp render` and `omni-mcp threads` are one binary (`crates/omni-mcp`) that speaks MCP over stdio the way the TypeScript servers did through the MCP SDK. It uses no MCP crate and no JSON crate. `crates/omni-core` has its own JSON reader and printer that match `JSON.parse` and `JSON.stringify`, because the record compares bytes. All three steps are done: the TypeScript servers were deleted after 0.1.30 shipped the binary.

- **The record** is `packages/test-fixtures/native/mcp/{ask,render,threads}.json`: 61 scenarios (32, 15 and 14), recorded from the TypeScript servers. A scenario is a scripted stand-in for Omni's API, the lines sent to the server's stdin, and what must come back: each answer, each API request with its headers and body, and the exit code. They cover the handshake in every protocol version, malformed lines, argument validation, cancelling a call, the token file changing, and every way the API can fail.
- **`crates/omni-mcp/tests/goldens.rs`** replays them against the binary, each stdout line and request body byte for byte.
- **`packages/test-fixtures/native/js-corpus.json`** holds 248 JSON texts with what Node made of each: whether it parses, how it prints, and `String()`, `Number()`, truthiness, `trim()`, code point count and `encodeURIComponent()`. `apps/mcp/tests/js-corpus.test.ts` checks the file against Node and `crates/omni-core/tests/node_parity.rs` holds the Rust code to it.
- **What the server shares with it.** The question limits in `ask.rs` and the html_render limits and theme variables in `render.rs` are copies of `packages/shared/question.ts` and `html-render.ts`, which the server parses calls with and the frame sets. `packages/shared/tests/question.test.ts` and `html-render.test.ts` read the Rust files and fail when the two disagree. `packages/shared/turbo.json` names the two Rust files as inputs of its tests, so a change to either alone reruns them.

### How it ships and runs

- **The build.** `apps/desktop/scripts/stage.ts` calls `native.ts`, which compiles `omni-mcp` for the app's target and puts it at `bin/omni-mcp` in the app root. Linux gets a static musl build, so it needs no glibc at all. A universal Mac build compiles both arches and joins them with `lipo`.
- **The server.** `apps/server/native-mcp.ts` decides once per server start. It runs the binary's `--version`, and when that prints a version, `buildMcpConfig` names it for `omni-ask`, `omni-render` and `omni-threads`. The log says `[mcp] ask, render and threads run on <path> (<version>)`. When it does not start, the server leaves those three servers out of every thread's config and logs one warning with the reason and how to build it.
- **Where it looks.** The desktop app's own `bin/omni-mcp`. A checkout's `target/debug/omni-mcp`, which `apps/server/scripts/native.ts` builds with `cargo build -p omni-mcp`: `npm run dev`, `npm start`, the desktop app's `--dev` run, `scripts/qa-stack.sh` and the server's tests run it first. `OMNI_NATIVE_MCP=<path>` names another binary, relative to the repo root.
- **Harnesses.** Claude Code, Codex and Cursor Agent threads get these servers from `buildMcpConfig`. Hermes and Cursor Cloud threads get no per-thread servers.
- The conductor's `omni` server still runs on TypeScript.

## Slice 2: the `omni` command

`crates/omni-cli` builds one binary, `omni`, with the six commands: `new`, `send`, `threads` and `show`, `status`, `doctor`, `open`. It prints what the TypeScript command printed, sends the same requests and exits with the same codes. All three steps are done: `apps/cli` was deleted after 0.1.30 shipped the binary.

- **How it is built.** It is synchronous and has no async runtime. HTTP is `ureq` with `rustls` and the Mozilla root certificates, because `OMNI_URL` can be an `https` address on another machine. API answers stay the JSON values of `omni-core`, so a field the command does not know prints as the TypeScript one printed it. Column widths and cut-off points count UTF-16 units, as JavaScript strings do.
- **The token.** On the install port, and on any address here when the token is a data folder's, the command first asks the server to prove it holds the token (an HMAC over a nonce) and sends the token only after that. A data folder's token never goes to another machine, and plain `http` goes off it only to a Tailscale address. With no token it sends nothing.
- **The record** is `packages/test-fixtures/native/cli/*.json`: 280 scenarios in ten files (`basics` 47, `connection` 47, `doctor` 26, `http` 26, `new` 25, `open` 22, `send` 18, `show` 23, `status` 32, `threads` 14), recorded from the TypeScript command. A scenario is the arguments, the environment, stdin, a scripted stand-in for Omni's API and the programs on `PATH`. It records stdout, stderr, the exit code, each request with its headers and body, and each program the command started with its arguments. Some stand-in answers are the server's own recorded replies in `packages/test-fixtures/wire/`, so a change to the server's answers reaches this test too.
- **`crates/omni-cli/tests/goldens.rs`** replays them against the binary. It compares requests in the order they were sent. It runs 16 scenarios at a time, because a Mac gives a process 256 open files.
- **`packages/test-fixtures/native/cli-corpus.json`** holds 2,728 inputs to the command's pure functions with what the TypeScript command made of each: "5m ago" and "Yesterday 14:05" at 44 offsets from six moments in eight time zones (2,112 cases), date texts, `toFixed` and rounding, sizes and durations, cutting and lining up text with wide characters, thread arguments, server addresses, the app launch line and the proof. `crates/omni-cli/src/corpus.rs` holds the Rust code to it.
- **On a Mac.** The Rust runner passes on macOS 27 (arm64) as on Linux.
- **Against a real server.** Before the TypeScript command was deleted, both ran against one throwaway Omni server (`scripts/qa-stack.sh`): 23 read commands in each of the two ways to find the server, and seven `new` and `send` runs with and without `--wait` and `--json`. The output and exit code were the same in all of them.

### How it ships and runs

- **The build.** `native.ts` compiles `omni-cli` beside `omni-mcp` and stages it as `bin/omni` in the app root, with the app's version compiled in (`OMNI_CLI_VERSION`), so `omni --version` names the app it came with.
- **A C compiler.** The command's TLS library (`ring`) compiles C. A Mac build needs Xcode's command line tools. The static Linux build needs `musl-gcc`, which the release workflow installs (`musl-tools`).
- **The app.** `apps/desktop/src/cli-shim.ts` decides once per launch (`nativeCommand`). It runs `bin/omni --version`, and when that prints a version it writes the shim that starts the binary. The main process log says `[omni] the omni command runs <path> (<version>)`. When the binary is missing or does not start, the log says why, and the app writes no shim and removes the ones an earlier launch wrote, so threads are not told about a command that fails.
- **An AppImage.** Its files sit in a mount that goes away when the app quits, and the command has to work then too. The app copies the binary to `native/omni` in its own folder (`~/.config/Omni`) at each launch and replaces the copy only when the build changed. A Mac app's shim names the binary inside `Omni.app`.
- **From a checkout.** `scripts/omni.sh` builds the command into `target/debug` with `cargo` (a no-op when it is current) and runs it. Without `cargo` it says to install Rust and exits 3.
- **Start time.** Through the shim of a packaged AppImage, `omni --version` took 1 ms on the Rust build and 190 ms on the bundled TypeScript command it replaced. `omni threads` against a local server took 2 ms and 245 ms.

## Slice 3: the browser server starts late

`omni-mcp lazy <answers.json> <command> [args...]` (`crates/omni-mcp/src/lazy.rs`) stands in front of a stdio MCP server. It answers the start of a session from a record of that server's own answers, and starts the server at the first message the record does not cover. From then on it copies bytes both ways, so the client talks to the server itself. It is made for the browser server, `@playwright/mcp`, which is not Omni's code. Nothing is ported: the server runs unchanged, later, or never in a thread that does not call it.

This slice has two steps and both are done. There is no TypeScript twin to delete: starting the server directly stays as the fallback.

- **What it answers itself.** `initialize` in a protocol version the record has, `ping`, `tools/list` without a cursor, and a method the record says the server does not have, with the server's own error. It keeps the client's `notifications/initialized` for the server and drops other notices, because nothing runs yet to hear them.
- **What starts the server.** Any other request, such as `tools/call` or `resources/list`. So does a handshake the record cannot answer: a protocol version it does not hold, an `initialize` slice 1's checks refuse, or a request that asks for a task.
- **Starting.** The server gets the client's own `initialize` line, then its `notifications/initialized`, then a `tools/list` from the front. Both answers stay with the front, because the client has them already. Then the message that needed the server goes in, and the front is a pipe. When the server's tools are not the recorded ones, the front sends the client `notifications/tools/list_changed`, so it asks again, and this time the server answers.
- **Ending.** It exits with the server's exit code, or 128 plus the signal that ended it. A client that closes stdin before any call gets exit code 0, and no server ran. A server that does not start fails the request that needed it (-32603, `The server did not start: ...`) and the front exits 1. A record it cannot read, or no command, is exit code 2 before it reads a line.
- **The record** is one JSON file: `initialize` (the server's result per protocol version), `tools` (its `tools/list` result) and `refused` (its error per method it does not have). The front only reads it. Omni's server makes it from the browser server itself ([How it ships and runs](#how-it-ships-and-runs-2)).
- **Why `refused`.** Claude Code asks a server `server/discover` before `initialize` (seen in 2.1.316). `@playwright/mcp` answers "method not found" and Claude Code goes on to `initialize`. A front that could not give that answer would start the server in every Claude Code thread at once.
- **How it is built.** Two threads from the standard library, no async runtime and no new crate. It reads lines only until the server starts. After that it copies bytes and reads nothing.

### How it is tested

- **`crates/omni-mcp/tests/lazy.rs`** runs the front before a shell script that notes when it started, what it read and when it ended. Ten tests: the handshake from the record with no server started, a method the record does not refuse going to the server, the handshake said again to the server at the first call, messages that arrive in one write, a server with other tools, the exit code, a killed front closing the server's input, a server that does not start, and a record that is not one.
- **`goldens.rs`** replays slice 1's record with each server behind the front: 60 of the 61 scenarios, byte for byte as without it. A client cannot tell `omni-mcp lazy ... omni-mcp ask` from `omni-mcp ask`. The scenario left out swaps the token file between two lines, which a server that starts later reads differently ([Known differences](#known-differences)).

### How it ships and runs

- **The record.** `apps/server/lazy-mcp.ts` makes it once the server listens (`prepareBrowserMcp` in `sandbox.ts`). It starts the browser server six times, headless and isolated so no browser opens: once to ask `server/discover`, then one handshake in each of the five protocol versions MCP has had. That takes about 0.9 s in the background, once per `@playwright/mcp` version. The flags a thread adds (`--cdp-endpoint`, `--user-data-dir`, `--output-dir`) change none of the answers.
- **Where it is kept.** `<data>/mcp-answers/playwright-mcp/<version>-<hash>.json`. The hash covers how the server was started to ask and the `PLAYWRIGHT_MCP_*` settings in the server's environment (hashed, never stored). A new version or setting makes a new record and removes the old one. So does each launch of an AppImage, whose files sit at a new path every time.
- **The proof.** Before any thread gets the front, the server runs `omni-mcp lazy` on the record and compares what it says to one handshake and to `server/discover` with the record. Only then does `buildMcpConfig` name `omni-mcp lazy <record> <node> <cli.js> ...` for `omni-browser`. The log says `[mcp] playwright-mcp <version> starts on a thread's first call to it, behind <path> lazy`.
- **The fallback** is the direct start, as before this slice, and the log says why: `[mcp] playwright-mcp starts with every thread, as before: <reason>`. It applies when the server does not answer, when its tools differ between two starts, when the front does not repeat the record, to a thread that starts before the record is ready, and when the record file is gone later. An install without `omni-mcp` gets the direct start and no new log line.
- **The switch.** `OMNI_BROWSER_LAZY=0` keeps the direct start for every thread.
- **Harnesses.** Claude Code, Codex and Cursor Agent get the front from `buildMcpConfig`. Checked on 2026-11-17 with the real CLIs (Claude Code 2.1.316, Codex 0.166.0, Cursor Agent): none started the server when the thread started, each started it once at its first browser call and got the tool's answer, and nothing stayed running after the turn. Hermes and Cursor Cloud threads get no per-thread servers.
- **What each harness opens with** is in `apps/server/tests/lazy-browser.test.ts`, as the lines each sent that day. Claude Code asks `server/discover` first. Codex sends `tools/list` with a progress token. Cursor Agent sends it with empty params. A harness that starts opening with a request the record does not cover starts the server with the thread: nothing breaks, and the saving is gone until the record learns that request (`OPENERS` in `lazy-mcp.ts`).
- **Clients.** No change to the Web UI, the phone layout or the desktop app's shell. The desktop app gets it through its bundled server and `bin/omni-mcp`.

### The server's tests

- **`apps/server/tests/lazy-mcp.test.ts`** (20 tests) runs the recording and the proof against a scripted stdio server: an error, a line that is not JSON, silence, an early exit, tools that change between starts, a front that says something else, and each fallback with its log line. It also checks the file name, that a new version removes the old record, and what `buildMcpConfig` writes with and without a proven front.
- **`apps/server/tests/lazy-browser.test.ts`** (8 tests) runs the real `@playwright/mcp` both ways and compares every answer of a scripted session: two protocol versions the record holds and one it does not. Then the three harness openings: no server process before the first call, one after.
- Both skip what needs the binary on a machine without `cargo` ([Without cargo](#without-cargo)).

### Before and after

The same benchmark, runtime and machine as [Measured candidates](#measured-candidates), five runs each, medians. The direct start measured 151 ms here and 241 ms in the ranking run, when the machine was busy writing to disk. The memory was the same both times.

`node scripts/bench-stdio-server.mjs --runs 5 --env ELECTRON_RUN_AS_NODE=1 [--then resources/list] -- [target/release/omni-mcp lazy <record>] <app>/omni-os <app>/resources/omni/node_modules/@playwright/mcp/cli.js --output-dir <dir> --headless --isolated --executable-path /opt/google/chrome/chrome`

| | Before: direct | After: behind the front |
| --- | --- | --- |
| `initialize` answered after | 150.8 ms | 1.4 ms |
| `tools/list` (25 tools) answered after | 153.8 ms | 1.7 ms |
| Private memory while it waits | 61.77 MB | 1.17 MB |
| `resources/list`, the first request only the server answers | 2.3 ms | 149.7 ms |
| Private memory after that request | 62.52 MB | 63.4 MB |

- A thread that never calls a browser tool holds 1.2 MB for the browser server where it held 62 MB, and its harness has the tool list 150 ms sooner.
- A thread that does call one pays the server's start at that call: 150 ms once, before a call that opens a browser. From then on it holds the server and the front, 0.9 MB more than before.

## Without cargo

The binaries have no TypeScript fallback any more, so each place that needs one says what happens without `cargo`:

| Where | Without `cargo` |
| --- | --- |
| Desktop build (`scripts/dist.ts`, `stage.ts`) | Fails at the native step: `cargo did not run`, then what to install (Rust from rustup.rs, and a C compiler for the `omni` command). `--native off` builds an app without the binaries: its threads get no `ask_user_question`, `html_render` or `read_referenced_thread`, and it writes no `omni` command. A Linux machine without `musl-gcc` fails the same way at the `omni` step |
| Release workflow | Passes `--native required`, which is the default now, and installs `musl-tools` |
| `npm run dev`, `npm start`, `scripts/qa-stack.sh` | `[mcp] cargo does not run ...`, then the server starts. Its threads get no `ask_user_question`, `html_render` or `read_referenced_thread`, and the server log says so once. Each thread starts its browser server at once, as before slice 3. A machine with `cargo` whose build fails (the crate, the lockfile) stops there instead, so no server starts on an old binary |
| `npm test` | Passes. `[tests] no omni-mcp build` at the top of the server run, and the tests that start a thread's MCP servers skip: the agent's `ask_user_question` round trips, the restart with a waiting question, `read_referenced_thread` over stdio, and the browser server behind `omni-mcp lazy`. A stand-in answers `--version`, so the config each harness gets is still checked. "Without cargo" means `cargo --version` does not run, which includes a version manager's shim with no Rust set. With `cargo`, a build that fails fails the run |
| `scripts/omni.sh` | `omni: running it from a checkout needs cargo`, exit 3 |
| `npm run test:rust`, clippy, fmt | Need `cargo`, as before |

## Known differences

What the Rust build does differently on purpose. None of these has been seen from a harness or from Omni's API.

The first two lists were measured against the TypeScript builds before they were deleted.

### The per-thread MCP servers

- **A question poll that answers without `text`.** The TypeScript server answers with the SDK's validation dump, about 3,300 characters. Rust answers the same error code (-32602) with `MCP error -32602: Invalid tools/call result: the tool answered without text`. The API never sends that answer. Covered by a test in `goldens.rs`.
- **`initialize` with rare capabilities.** The SDK checks the shape of `experimental`, `elicitation`, `tasks`, `extensions` and `clientInfo.icons`. Rust checks `sampling`, `roots`, and the name, title, version, website and description of `clientInfo`, and accepts the rest unchecked.
- **A thread id or `OMNI_URL` that cannot be sent.** For a thread id with characters outside Latin-1, or an `OMNI_URL` that is not a URL, both servers answer the tool call with an error. The wording differs, because it comes from each HTTP client.
- **An object that hides `toString`.** `String({"toString": 1})` throws in JavaScript. Rust prints `[object Object]`. It can only reach an error message built from an API answer with that shape.
- **A cancel notice in the same write as a `ping` or `tools/list`.** The SDK can drop the answer to a request that is cancelled before its handler's first tick. Rust answers `ping`, `initialize` and `tools/list` at once and honours a cancel only for tool calls.
- **JSON nested deeper than 1,000 levels** is refused as invalid, where Node's limit is its stack.
- **`Number()` of a hex string above 2^53** may round to a neighbouring value. It can only reach the same kind of error message.

### The front of the browser server

What a client sees differently with `omni-mcp lazy` in front of a server.

- **What a server reads when it starts, it reads at the first call.** A token file or a setting that changes between the start of a thread and its first call is read as it is at the call. This is the one scenario of slice 1's record the front does not replay.
- **Notices before the first call are dropped**, all but `notifications/initialized`. A server that acts on a notice it got before any request would miss it. The browser server asks the client for what it needs, its roots, when it starts.
- **The front writes to stderr** when the server does not start, or does not answer as the record says, each line starting `omni-mcp lazy:`.
- **A setting only one thread has.** The record is made in the server's environment. A thread whose own environment changes the browser server's tools, such as a channel secret named `PLAYWRIGHT_MCP_CAPS`, gets the recorded list until its first call. The front then sees the server's list differ and sends `notifications/tools/list_changed`.
- **The first browser call waits for the server to start**, about 150 ms on the machine measured, which the thread's start no longer pays.

### The `omni` command

- **A server answer in a shape the command does not expect.** The TypeScript command can stop with a JavaScript stack trace, for example when a list of threads arrives as text. Rust prints one line and exits 3. A list that is not a list reads as empty.
- **A link with a malformed id.** `omni show '#/t/%zz'` ends in a `URIError` stack in TypeScript. Rust says `#/t/%zz is not a link this command can read` and exits 3. Covered by a test in `goldens.rs`.
- **A switch named after a JavaScript object method.** The TypeScript parser looks a switch up in a plain object, so `omni threads --constructor` passes as a known switch and `--toString=1` answers "--toString takes no value". Rust says `unknown option --constructor` and exits 64. Covered by a test in `goldens.rs`.
- **Dates.** Rust reads ISO 8601 dates, which is all the API sends. Texts only V8's older parser reads ("16 Nov 2026", "2026-1-6", a lower-case `z`) and years past 262,142 read as no date, so the line shows no time where TypeScript shows one.
- **The words for a failure below HTTP.** An answer that is not JSON, a dropped connection or a failed TLS handshake give the same line and exit code, but the detail in brackets comes from each HTTP client (`Unexpected token ...` against `... at byte 12`).
- **Requests go out one after another.** Where TypeScript sends two or three requests at once (`status`, `show`, each poll of `--wait`), Rust sends them in the order the code lists them. After a dropped connection on the install port it asks for a fresh proof before it sends the token again.
- **`OMNI_URL` forms.** A port that is not a number or is out of range gives `OMNI_URL is not an http(s) address` where Node says `Invalid URL`. Numeric loopback forms such as `http://2130706433`, host names outside ASCII and unusual characters in the path are not rewritten as Node's URL parser rewrites them.
- **Ports `fetch` refuses.** Node's `fetch` does not connect to the ports browsers block (1, 7, 9, 6000, 6665 to 6669 and others), so the TypeScript command reports an Omni server there as unreachable or as another program. Rust connects to any port.
- **`NODE_EXTRA_CA_CERTS`** is not read. An `https` server with a private certificate authority is refused.
- **`omni open`** starts the app in its own process group. TypeScript gives it its own session. Both let the command exit while the app stays open.

## Decisions for Ben

- **The conductor's MCP server.** Not scheduled. Porting it saves about 27 MB and 60 ms per conductor thread, a third of what slice 3 saves, and `omni.ts` changed in 72 commits in 30 days, so until its step 3 every one of those changes would be made twice. Say so if you want it anyway: slice 1 built the parts it needs.
- **The server.** It stays in TypeScript under this plan. A full port is possible, and the wire fixtures in `packages/test-fixtures/wire/` would be its parity record, but it is 47,766 lines with 49,785 lines of tests, and until the last route moved there would be two implementations of the schema side by side. It buys lower idle memory (57 MB today, once per machine) and one binary to ship. It does not make threads faster: the read routes spend most of their time inside SQLite ([Measured candidates](#measured-candidates)). Say so if you want it anyway and it becomes slice 4, route group by route group behind the same port.
- **The desktop shell.** Tauri would replace Electron's Chromium with the system web view and make the download much smaller. It cannot run the bundled Node server, so it needs either a separate Node in the app or the server port above. It also trades one Chromium for WebKit on macOS and WebKitGTK on Linux, which the Web UI has never been tested on. Kept on Electron until the server decision is made.
- **The iOS app.** No Rust planned. Say so if you want a shared native core for a later Android app.
- **Rust as a build requirement.** The release workflow needs a Rust toolchain, which GitHub's runners have, and its Linux job installs `musl-tools` for the `omni` command's C code. Since step 3 a local desktop build needs them too, and a checkout needs `cargo` for its threads' `ask_user_question`, `html_render` and `read_referenced_thread` and for `scripts/omni.sh` ([Without cargo](#without-cargo)). `npm test` still passes without it.
