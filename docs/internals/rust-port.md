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
| `crew/`, `automations/`, `mods/` | Markdown, YAML, TypeScript | 748 | Role charters, automation definitions, one Claude Code mod |
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

## Plan

In this order. Each row is one slice.

| Slice | Crate | Why now |
| --- | --- | --- |
| 1. Per-thread MCP servers: `ask`, `render`, `threads` | `crates/omni-mcp`, `crates/omni-core` | Three processes per thread, smallest logic, largest saving. Also builds what later slices reuse: the JSON printer that matches `JSON.stringify`, the API client, the MCP stdio server |
| 2. The `omni` command | `crates/omni-cli` | Start time. Its tests already run against the wire fixtures, which become the parity record |
| 3. The conductor's MCP server (`omni.ts`) | `crates/omni-mcp` | One more Node process per conductor thread. About 60 tools, so it waits until slice 1 has run in a release |

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
| `apps/mcp` `omni.ts`, `pull-requests.ts` | planned | Slice 3 |
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
| `scripts/`, `crew/`, `automations/`, `mods/`, `design-system/`, `prototypes/` | kept | Shell, Markdown, YAML and HTML. Nothing to port |

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
- The conductor's `omni` server is slice 3 and still runs on TypeScript.

## Slice 2: the `omni` command

`crates/omni-cli` builds one binary, `omni`, with the six commands: `new`, `send`, `threads` and `show`, `status`, `doctor`, `open`. It prints what the TypeScript command printed, sends the same requests and exits with the same codes. All three steps are done: `apps/cli` was deleted after 0.1.30 shipped the binary.

- **How it is built.** It is synchronous and has no async runtime. HTTP is `ureq` with `rustls` and the Mozilla root certificates, because `OMNI_URL` can be an `https` address on another machine. API answers stay the JSON values of `omni-core`, so a field the command does not know prints as the TypeScript one printed it. Column widths and cut-off points count UTF-16 units, as JavaScript strings do.
- **The token.** On the install port the command first asks the server to prove it holds the token (an HMAC over a nonce) and sends the token only after that. With no token it sends nothing.
- **The record** is `packages/test-fixtures/native/cli/*.json`: 275 scenarios in ten files (`basics` 47, `connection` 42, `doctor` 26, `http` 26, `new` 25, `open` 22, `send` 18, `show` 23, `status` 32, `threads` 14), recorded from the TypeScript command. A scenario is the arguments, the environment, stdin, a scripted stand-in for Omni's API and the programs on `PATH`. It records stdout, stderr, the exit code, each request with its headers and body, and each program the command started with its arguments. Some stand-in answers are the server's own recorded replies in `packages/test-fixtures/wire/`, so a change to the server's answers reaches this test too.
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

## Without cargo

The binaries have no TypeScript fallback any more, so each place that needs one says what happens without `cargo`:

| Where | Without `cargo` |
| --- | --- |
| Desktop build (`scripts/dist.ts`, `stage.ts`) | Fails at the native step: `cargo did not run`, then what to install (Rust from rustup.rs, and a C compiler for the `omni` command). `--native off` builds an app without the binaries: its threads get no `ask_user_question`, `html_render` or `read_referenced_thread`, and it writes no `omni` command. A Linux machine without `musl-gcc` fails the same way at the `omni` step |
| Release workflow | Passes `--native required`, which is the default now, and installs `musl-tools` |
| `npm run dev`, `npm start`, `scripts/qa-stack.sh` | `[mcp] cargo does not run ...`, then the server starts. Its threads get no `ask_user_question`, `html_render` or `read_referenced_thread`, and the server log says so once. A machine with `cargo` whose build fails (the crate, the lockfile) stops there instead, so no server starts on an old binary |
| `npm test` | Passes. `[tests] no omni-mcp build` at the top of the server run, and the tests that start a thread's MCP servers skip: the agent's `ask_user_question` round trips, the restart with a waiting question, and `read_referenced_thread` over stdio. A stand-in answers `--version`, so the config each harness gets is still checked. "Without cargo" means `cargo --version` does not run, which includes a version manager's shim with no Rust set. With `cargo`, a build that fails fails the run |
| `scripts/omni.sh` | `omni: running it from a checkout needs cargo`, exit 3 |
| `npm run test:rust`, clippy, fmt | Need `cargo`, as before |

## Known differences

What the Rust build does differently on purpose. None of these has been seen from a harness or from Omni's API.

These were measured against the TypeScript builds before they were deleted.

### The per-thread MCP servers

- **A question poll that answers without `text`.** The TypeScript server answers with the SDK's validation dump, about 3,300 characters. Rust answers the same error code (-32602) with `MCP error -32602: Invalid tools/call result: the tool answered without text`. The API never sends that answer. Covered by a test in `goldens.rs`.
- **`initialize` with rare capabilities.** The SDK checks the shape of `experimental`, `elicitation`, `tasks`, `extensions` and `clientInfo.icons`. Rust checks `sampling`, `roots`, and the name, title, version, website and description of `clientInfo`, and accepts the rest unchecked.
- **A thread id or `OMNI_URL` that cannot be sent.** For a thread id with characters outside Latin-1, or an `OMNI_URL` that is not a URL, both servers answer the tool call with an error. The wording differs, because it comes from each HTTP client.
- **An object that hides `toString`.** `String({"toString": 1})` throws in JavaScript. Rust prints `[object Object]`. It can only reach an error message built from an API answer with that shape.
- **A cancel notice in the same write as a `ping` or `tools/list`.** The SDK can drop the answer to a request that is cancelled before its handler's first tick. Rust answers `ping`, `initialize` and `tools/list` at once and honours a cancel only for tool calls.
- **JSON nested deeper than 1,000 levels** is refused as invalid, where Node's limit is its stack.
- **`Number()` of a hex string above 2^53** may round to a neighbouring value. It can only reach the same kind of error message.

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

- **The server.** It stays in TypeScript under this plan. A full port is possible, and the wire fixtures in `packages/test-fixtures/wire/` would be its parity record, but it is 47,766 lines with 49,785 lines of tests, and until the last route moved there would be two implementations of the schema side by side. It buys lower idle memory and one binary to ship. It does not make threads faster. Say so if you want it anyway and it becomes slice 4, route group by route group behind the same port.
- **The desktop shell.** Tauri would replace Electron's Chromium with the system web view and make the download much smaller. It cannot run the bundled Node server, so it needs either a separate Node in the app or the server port above. It also trades one Chromium for WebKit on macOS and WebKitGTK on Linux, which the Web UI has never been tested on. Kept on Electron until the server decision is made.
- **The iOS app.** No Rust planned. Say so if you want a shared native core for a later Android app.
- **Rust as a build requirement.** The release workflow needs a Rust toolchain, which GitHub's runners have, and its Linux job installs `musl-tools` for the `omni` command's C code. Since step 3 a local desktop build needs them too, and a checkout needs `cargo` for its threads' `ask_user_question`, `html_render` and `read_referenced_thread` and for `scripts/omni.sh` ([Without cargo](#without-cargo)). `npm test` still passes without it.
