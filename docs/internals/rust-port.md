# Rust port

Which parts of Omni move to Rust, in what order, and which stay in TypeScript with the reason. Read it before you port a module or delete a TypeScript file that has a Rust twin.

## Rules

- **A slice at a time.** One slice is one module with one job, such as the helper servers a thread starts. A slice is three small pull requests: the Rust code with its parity tests, then shipping and using it with the TypeScript still there as a fallback, then deleting the TypeScript.
- **Parity before deletion.** The TypeScript module records what it does with a set of inputs into `packages/test-fixtures/native/`. The same record is replayed against the Rust build. TypeScript is deleted only after a released build has carried the Rust binary.
- **Same contracts.** A port keeps the API it calls, the bytes it writes and the files it reads. A known difference is listed under [Known differences](#known-differences), with a test on the Rust side.
- **No port for its own sake.** A module moves when Rust gives it something it lacks today: a lower cost per process, a faster start, or a single file to ship. A module that mostly waits on the network or on a child process gains none of that.
- **`npm test` does not need Rust.** The Rust tests have their own command. A machine without `cargo` still passes `npm test`, and a build without the binaries still runs on the TypeScript.

## Audit

Lines are source lines, then test lines, counted on `main` at a336f918 (2026-11-16). Everything was TypeScript before the port: the repo had no Rust and no Swift.

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

Omni's server spends its time waiting on a harness process, on SQLite or on GitHub, and Rust does not make waiting faster. Two parts of Omni pay for a whole runtime they barely use:

- **Helper processes.** Every thread starts three MCP servers, and each is a whole Node runtime (Electron's, in the desktop app) holding a few dozen lines of logic. A machine with four live threads had 12 of them at 22 to 28 MB of private memory each. The Rust build of the same server holds about 1 MB and answers `initialize` in 1 ms, against roughly 170 to 200 ms for the TypeScript one from a checkout.
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
2. **Ship.** The desktop build compiles the binary for macOS (universal) and Linux and puts it beside the server. The server starts the binary when it is there and the TypeScript when it is not, and logs which.
3. **Remove.** After a release has carried the binary, delete the TypeScript twin and its bundle entry.

## Status

`ported`: the Rust code is on `main` and passes parity. `in progress`: a pull request is open. `planned`: next in the order above. `kept`: stays as it is, with the reason.

| Module | Status | Reason or next step |
| --- | --- | --- |
| `apps/mcp` `ask.ts`, `render.ts`, `threads.ts`, `referenced-thread.ts`, `api.ts` | in progress | Slice 1. Steps 1 and 2 are done: `crates/omni-mcp` passes the record, the desktop build ships it and the server starts it when it is there. The TypeScript stays as the fallback until step 3, after a release has carried the binary |
| `apps/cli` | in progress | Slice 2. Step 1 is done: `crates/omni-cli` passes the record of all six commands ([ADR 0014](../adr/0014-omni-command-line.md)). Nothing runs it yet. Step 2 makes the desktop app's shim start it |
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
| `packages/client-core` | kept | Used by the iOS app. The CLI's Rust port stops using it. The iOS app still does |
| `apps/relay` | kept | A Cloudflare Worker each user deploys. JavaScript is the platform's first language for Durable Object SQLite, and the Worker has no start cost to win back |
| `packages/test-fixtures`, `packages/typescript-config` | kept | Test data and config. The fixtures gain a `native/` folder that both languages read |
| `scripts/`, `crew/`, `automations/`, `mods/`, `design-system/`, `prototypes/` | kept | Shell, Markdown, YAML and HTML. Nothing to port |

## How parity is checked

- **The record.** `packages/test-fixtures/native/` holds what the TypeScript module did: each scenario's input and the exact output. A TypeScript test replays every scenario against the TypeScript module on each `npm test`, so the record cannot drift from the code it describes. `OMNI_RECORD_NATIVE_FIXTURES=1` on that test rewrites the record.
- **The Rust side.** A Rust integration test replays the same files against the Rust binary and compares byte for byte.
- **Both ways.** The TypeScript test also runs the Rust binary when `OMNI_NATIVE_MCP=<path to the binary>` is set (`OMNI_NATIVE_CLI` for the `omni` command), so one runner has judged both implementations.

## Working on the Rust code

- Toolchain: `rust-toolchain.toml` pins it. `rustup` or `mise` installs it on first use.
- `npm run test:rust` (or `cargo test --workspace --locked`), `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo fmt --all --check`.
- The workspace is `Cargo.toml` at the repo root, the crates are in `crates/`. `unsafe` is forbidden in the workspace lints.
- `omni-cli` needs a C compiler: its TLS library (`ring`) compiles C and assembly. `omni-mcp` and `omni-core` need none.
- Run the tests with Omni's own variables unset (`env -i PATH="$PATH" HOME="$HOME" cargo test ...`) when your shell is an Omni thread: `OMNI_URL` there points at the live server.

## Slice 1: the per-thread MCP servers

`omni-mcp ask`, `omni-mcp render` and `omni-mcp threads` are one binary (`crates/omni-mcp`) that speaks MCP over stdio the way the TypeScript servers do through the MCP SDK. It uses no MCP crate and no JSON crate. `crates/omni-core` has its own JSON reader and printer that match `JSON.parse` and `JSON.stringify`, because the record compares bytes.

- **The record** is `packages/test-fixtures/native/mcp/{ask,render,threads}.json`: 61 scenarios (32, 15 and 14). A scenario is a scripted stand-in for Omni's API, the lines sent to the server's stdin, and what must come back: each answer, each API request with its headers and body, and the exit code. They cover the handshake in every protocol version, malformed lines, argument validation, cancelling a call, the token file changing, and every way the API can fail.
- **`apps/mcp/tests/native-fixtures.test.ts`** replays them against the TypeScript servers.
- **`crates/omni-mcp/tests/goldens.rs`** replays them against the Rust binary, each stdout line and request body byte for byte.
- **`packages/test-fixtures/native/js-corpus.json`** holds 248 JSON texts with what Node made of each: whether it parses, how it prints, and `String()`, `Number()`, truthiness, `trim()`, code point count and `encodeURIComponent()`. `apps/mcp/tests/js-corpus.test.ts` checks the file against Node and `crates/omni-core/tests/node_parity.rs` holds the Rust code to it.

### How it ships and runs

- **The build.** `apps/desktop/scripts/stage.ts` calls `native.ts`, which compiles `omni-mcp` for the app's target and puts it at `bin/omni-mcp` in the app root. Linux gets a static musl build, so it needs no glibc at all. A universal Mac build compiles both arches and joins them with `lipo`. `--native auto` (the default) leaves the binary out when the machine has no `cargo`, `--native required` fails instead, and the release workflow passes `required`.
- **The server.** `apps/server/native-mcp.ts` decides once per server start. It runs `bin/omni-mcp --version`, and when that prints a version, `buildMcpConfig` names the binary for `omni-ask`, `omni-render` and `omni-threads`. Otherwise it names the TypeScript servers as before. The server log says which: `[mcp] ask, render and threads run on the Rust build: <path> (<version>)`, or a warning with the reason the binary did not start. A desktop build without the binary logs nothing and runs the TypeScript.
- **Harnesses.** Claude Code, Codex and Cursor Agent threads get these servers from `buildMcpConfig`, so all three get the same choice. Hermes and Cursor Cloud threads get no per-thread servers.
- **`OMNI_NATIVE_MCP`.** `0` keeps a machine on the TypeScript servers. A path names a binary to use, which is how a checkout tries one (`OMNI_NATIVE_MCP=target/release/omni-mcp`, relative to the repo root). Unset, the desktop app uses its own and a checkout uses none, because a `target/` build can be older than the TypeScript beside it. The desktop app reads it from the `.env` in its data folder.
- The conductor's `omni` server is slice 3 and still runs on TypeScript.

The tool descriptions and limits in `ask.rs` and `render.rs` are copies of `packages/shared/question.ts` and `html-render.ts`. The `tools/list` scenarios compare them byte for byte, so a change to the TypeScript text fails the Rust test until the copy follows.

## Slice 2: the `omni` command

`crates/omni-cli` builds one binary, `omni`, with the six commands of `apps/cli`: `new`, `send`, `threads` and `show`, `status`, `doctor`, `open`. It prints the same text, sends the same requests and exits with the same codes. Nothing runs it yet: the desktop app's shim still starts the TypeScript command.

- **How it is built.** It is synchronous and has no async runtime. HTTP is `ureq` with `rustls` and the Mozilla root certificates, because `OMNI_URL` can be an `https` address on another machine. API answers stay the JSON values of `omni-core`, so a field the command does not know prints as the TypeScript one prints it. Column widths and cut-off points count UTF-16 units, as JavaScript strings do.
- **The token.** On the install port the command first asks the server to prove it holds the token (an HMAC over a nonce) and sends the token only after that, as the TypeScript command does. With no token it sends nothing.
- **The record** is `packages/test-fixtures/native/cli/*.json`: 275 scenarios in ten files (`basics` 47, `connection` 42, `doctor` 26, `http` 26, `new` 25, `open` 22, `send` 18, `show` 23, `status` 32, `threads` 14). A scenario is the arguments, the environment, stdin, a scripted stand-in for Omni's API and the programs on `PATH`. It records stdout, stderr, the exit code, each request with its headers and body, and each program the command started with its arguments.
- **`apps/cli/tests/native-fixtures.test.ts`** replays them against the TypeScript command, and against the Rust binary with `OMNI_NATIVE_CLI=<path>`. `apps/cli/tests/scenarios.ts` is the runner both use.
- **`crates/omni-cli/tests/goldens.rs`** replays them against the Rust binary with a runner written in Rust, so `cargo test` needs no Node. It compares requests in the order they were sent.
- **`packages/test-fixtures/native/cli-corpus.json`** holds 2,728 inputs to the command's pure functions with what Node made of each: "5m ago" and "Yesterday 14:05" at 44 offsets from six moments in eight time zones (2,112 cases), date texts, `toFixed` and rounding, sizes and durations, cutting and lining up text with wide characters, thread arguments, server addresses, the app launch line and the proof. `apps/cli/tests/native-corpus.test.ts` checks the file against Node and `crates/omni-cli/src/corpus.rs` holds the Rust code to it.
- **Against a real server.** Both commands ran against one throwaway Omni server (`scripts/qa-stack.sh`): 23 read commands in each of the two ways to find the server, and seven `new` and `send` runs with and without `--wait` and `--json`. The output and exit code were the same in all of them. `status --json` differed only in the server's own `since` time, which changed between the two requests.

### What step 2 needs

- **A C compiler for the static Linux build.** `native.ts` builds `omni-mcp` for `x86_64-unknown-linux-musl`. `ring` needs `musl-gcc` for that target, so the release job installs `musl-tools` first. A Mac needs nothing more than Xcode's command line tools.
- **A path outside the AppImage.** The shim in `~/.local/bin/omni` starts the app's own Node today. A binary inside a mounted AppImage has no path a shim can name, so the Linux app copies `omni` into its `bin` folder at start. The Mac app's shim can name the binary inside `Omni.app`.
- **The fallback.** The shim starts the binary when it is there and the TypeScript command when it is not, as the server does for the MCP servers.

## Known differences

What the Rust build does differently on purpose. None of these has been seen from a harness or from Omni's API.

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
- **`NODE_EXTRA_CA_CERTS`** is not read. An `https` server with a private certificate authority is refused.
- **`omni open`** starts the app in its own process group. TypeScript gives it its own session. Both let the command exit while the app stays open.

## Decisions for Ben

- **The server.** It stays in TypeScript under this plan. A full port is possible, and the wire fixtures in `packages/test-fixtures/wire/` would be its parity record, but it is 47,766 lines with 49,785 lines of tests, and until the last route moved there would be two implementations of the schema side by side. It buys lower idle memory and one binary to ship. It does not make threads faster. Say so if you want it anyway and it becomes slice 4, route group by route group behind the same port.
- **The desktop shell.** Tauri would replace Electron's Chromium with the system web view and make the download much smaller. It cannot run the bundled Node server, so it needs either a separate Node in the app or the server port above. It also trades one Chromium for WebKit on macOS and WebKitGTK on Linux, which the Web UI has never been tested on. Kept on Electron until the server decision is made.
- **The iOS app.** No Rust planned. Say so if you want a shared native core for a later Android app.
- **Rust as a build requirement.** The release workflow now needs a Rust toolchain, which GitHub's runners have. A local desktop build without `cargo` still works and ships the TypeScript servers only. Development from a checkout needs no Rust. Say so if you would rather the release also fell back without Rust.
