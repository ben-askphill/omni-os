# Mac app notes

Notes from the tracer, #62 (parts A to D), for whoever builds the next screens. The app is a client of the Omni server (see docs/adr/0002-mac-app-is-a-client.md): it talks HTTP and SSE to `/api`, like the Web UI.

## Layout

- `mac/Omni.xcodeproj`: hand-written, objectVersion 77, one app target `Omni`. Shared scheme `Omni`.
- `mac/Omni/`: the app's sources. A synchronized folder: a file dropped in here is in the target, no project edit needed. See "The app (part D)" below.
- `mac/Omni-Info.plist`: partial Info.plist, merged with the generated keys. Only ATS `NSAllowsLocalNetworking`. It sits outside `mac/Omni/` so the synced folder does not copy it as a resource. `scripts/build-mac.sh` adds `OmniGitCommit` to the built app's copy, not to this file.
- `scripts/build-mac.sh`: Release build, sign, install to `~/Applications/Omni.app`, open. See "Build and install".
- `mac/OmniKit/`: Swift package, linked to the app as a local package. Everything that can be tested without UI goes here.

| File in `Sources/OmniKit` | What |
| --- | --- |
| `JSON.swift` | `OmniJSON.decoder()` and `encoder()`, date parsing, `JSONValue`, `OpenEnum` |
| `Channel.swift` | `Channel`, `ChannelKind`, `ChannelWithRunning`, `ThreadStub` |
| `Thread.swift` | `OmniThread`, `ThreadStatus`, `ThreadSource`, `PendingMsg`, `ThreadDetail` |
| `Event.swift` | `EventRow`, `EventPayload` and its payload structs, `Artifact` |
| `Status.swift` | `Status`, `Usage`, `HarnessSlot`, `ServerInfo`, `HarnessInfo`, `ModelEntry`, `CrewRole` |
| `StreamMessage.swift` | `ThreadStreamMessage` and `FeedEvent`: one SSE `data:` message each |
| `Client.swift` | `OmniClient`, `HTTPTransport`, `OmniAPIError`, `NewThread`. `send` is internal so extensions in other files can use it |
| `Client+Secrets.swift` | `secrets()`, `setSecret(scope:name:value:)`, `deleteSecret(scope:name:)` on `OmniClient` |
| `Secrets.swift` | `SecretScope`, `SecretRow`, `SecretName` (the Web UI's name rules), `SecretGroup`, `SecretScopeOption`, `SecretsModel` (the Secrets tab) |
| `RelTime.swift` | `RelTime.label`: `relTime` in `web/src/format.ts` |
| `Appearance.swift` | `Appearance`, `AppearanceSettings` (in UserDefaults, `-appearance` for a run) |
| `SettingsTab.swift` | `SettingsTab`, `Route.settingsTab`, `AppModel.show(_:)` |
| `Client+Automations.swift` | `automations()`, `runAutomation(_:)`, `setAutomationEnabled(_:_:)` on `OmniClient` |
| `Automation.swift` | `Automation`, `AutomationRun`, `AutomationTrigger`, `AutomationBadge`, `NextRunText`, `AutomationSchedule` (`describeCron` and `nextRunLabel` in `web/src/format.ts`) |
| `AutomationsModel.swift` | `AutomationsModel` (the Automations page) |
| `Route.swift` | `Route`, parsed from and printed to the Web UI hash routes |
| `SSEParser.swift` | `SSEParser`, `SSEMessage`: the EventSource parsing rules, bytes in, messages out |
| `SSEClient.swift` | `SSEClient`, `SSEEvent`, `ConnectionState`, `SSETransport`, `URLSessionSSETransport`, and `feedEvents` and `threadEvents` on `OmniClient` |
| `Ticker.swift` | Internal. A `Clock` with its instant type erased, so tests can inject one |
| `WorkspaceStore.swift` | `WorkspaceStore`, `WorkspaceAPI`, `SidebarSections` |
| `Client+Thread.swift` | `ThreadAPI` (the calls `ThreadStore` makes), `artifactURL` and `uploadURL` on `OmniClient` |
| `ThreadStore.swift` | `ThreadStore` (one thread, live), `ThreadStoreRegistry` |
| `Transcript.swift` | `Transcript` (the Web UI's `buildItems`, incremental), `TranscriptItem`, `ToolGroup`, `ToolCall`, `Plan`, `Todo`, `TurnResult.line` |
| `ToolText.swift` | `ToolText`: a tool's label, one-line summary, SF Symbol and font, from `web/src/tool-summary.ts` and `Transcript.tsx`. Internal `JSONKeyOrder` |
| `StatusLine.swift` | `StatusLine.label` (`web/src/status-line.ts`) and `betweenTurns` |
| `Format.swift` | `Format`: `relTime`, `clock`, `shortDate`, `duration(ms:)`, `bytes`, `plural`, `shortPath`, from `web/src/format.ts` |
| `Markdown.swift` | `MarkdownDocument` and its blocks, `MarkdownText`, `MarkdownRun`, `MarkdownImage`, `MarkdownLink`. The only file that imports swift-markdown |
| `Autolink.swift` | Internal. `Autolink.pieces`: the Web UI's bare URL, email and thread id links in a run of text |
| `MarkdownCache.swift` | `MarkdownCache`: parsed markdown per event id and text |
| `ServerSettings.swift` | `ServerSettings` (port, repo path, Node override in UserDefaults), `ServerConfig` |
| `Spawn.swift` | Internal. posix_spawn in a new session (no controlling terminal, pgid is the pid), and `capture` for short commands with a timeout |
| `ServerLaunch.swift` | `ServerStartError`, `LoginShell`, `NodeResolver`, `NodeVersion`, `ServerEnvironment`, `ServerLauncher`, `ServerLaunch` |
| `ServerProcess.swift` | `ServerProcess` (spawn into the log, log tail, liveness, group stop), `SpawnedServer` |
| `ServerSupervisor.swift` | `ServerSupervisor` (the state machine), `ServerRecord` |
| `Navigation.swift` | `SidebarItem` (a sidebar row and its route), `Route.title(channelName:)`, `Route.newThreadRoute` |
| `AppModel.swift` | `AppModel` (settings, supervisor, client and store, the route), `ServerScreen`, `StartFailure`, `State.label` and `canStart` |
| `QAScript.swift` | Debug only. `QAScript`, `QAStep`, `QACondition`, `QAFacts`, `QAServer`, `QASnapshot.looksBlank` |

## Build and test

- `npm run test:mac`: `swift test --package-path mac/OmniKit`. Headless.
- `npm run test:all`: `npm test`, then `test:mac`.
- The app: `xcodebuild -project mac/Omni.xcodeproj -scheme Omni -configuration Debug -derivedDataPath mac/.xcode build`. It lands in `mac/.xcode/Build/Products/Debug/Omni.app`. `-configuration Release` builds `Release/Omni.app`, which has no QA code.
- In Xcode, open `mac/Omni.xcodeproj` to run the app. Its scheme has no tests: Xcode does not offer a local package's test target to the project's schemes. For Cmd-U on OmniKit, open `mac/OmniKit/Package.swift`.
- `mac/.xcode`, `mac/OmniKit/.build`, `mac/OmniKit/.swiftpm` and `xcuserdata` are gitignored.
- OmniKit's one dependency is swift-markdown (from 0.6.0), which brings swift-cmark. Two `Package.resolved` files pin them and are committed: `mac/OmniKit/Package.resolved` for `swift test`, and `mac/Omni.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` for xcodebuild and Xcode. Keep their pins the same: after `swift package update` in `mac/OmniKit`, copy its file over the Xcode one (or resolve in Xcode and copy back). The first build of a checkout fetches both from GitHub; later ones use the cache.

### Golden fixtures

`tests/mac-fixtures.test.ts` boots a real server with the fake claude CLI, makes channel `acme`, runs a thread through three turns (tool call, steer, queued message, rename, artifact) and keeps what the app reads: the JSON of each GET and the raw SSE of the thread stream and the feed. They live in `mac/OmniKit/Tests/OmniKitTests/Fixtures/`.

- A normal `npm test` writes nothing. It checks the server still sends the recorded shape: the same keys and value types, per event kind and per stream message. So a server change that would break the app fails `npm test`.
- To record again after a deliberate change: `OMNI_RECORD_MAC_FIXTURES=1 npx vitest run --config tests/vitest.config.ts tests/mac-fixtures.test.ts`, then `npm run test:mac` and fix the Swift types it breaks.
- Recording is stable: paths, UUIDs, times, pids, ports, the git head and durations are normalized, so recording twice gives the same files.
- `FixtureTests.swift` decodes every file, and fails if a file in the folder has no decoder in its table. Add a fixture in both places.
- `thread-rich.json` is a second thread, for the transcript. Its prompt has the fake CLI's `RICH` marker, which plays the calls a real turn is made of: a plan updated three times, a sub-agent (`Task`) with a nested `Grep` and `Read`, a status, a failing `Bash`, an MCP tool. Then a child's crew report, `/context` (a zero-turn result), and a turn that crashes (`FAKE_CLAUDE_CRASH_ON`), with an error and a dropped message. It is recorded last, so the other fixtures kept their UUIDs.
- Request fixtures (`secret-set-request.json`, `secret-delete-request.json`, `automation-enabled-request.json`) go the other way: the check run sends the recorded body to the server, so it must still take it, and `SecretsTests` checks the client encodes exactly that JSON.
- The secrets part runs with a `security` on PATH that stores nothing, so `npm test` never touches the Keychain.
- The automations part reads a folder of the test's own (`OMNI_AUTOMATIONS_DIR`, see `.env.example`): `daily-digest` (enabled, run once) and `broken` (a cron the server can't schedule). Toggling one writes its YAML file, so never point a test server at the repo's `automations/`.

## Conventions

- Decode with `OmniJSON.decoder()`, always. Its dates take ISO8601 with and without fractional seconds, and SQLite's `yyyy-MM-dd HH:mm:ss` as UTC.
- Field names follow the types in `web/src/api.ts`, the source of truth. Every type spells out its `CodingKeys`. No `convertFromSnakeCase`: it would also rewrite tool input and dictionary keys.
- String enums from the server are `OpenEnum` structs (`ThreadStatus`, `ChannelKind`, `HarnessID`, `ThreadSource`, `SendMode`, `PendingState`): a value the app does not know still decodes and round-trips. Compare with the constants, like `.running`.
- SQLite 0/1 ints decode as `Bool`. An empty `effort` is `nil`, meaning the model's default.
- The Web UI's `Thread` is `OmniThread` here, so it does not clash with `Foundation.Thread`.
- DTOs are `Decodable` only, with no public memberwise inits. Tests build values by decoding JSON (helpers at the top of `DecodingTests.swift`).
- `EventRow` keeps the raw `payload` string and a decoded `content: EventPayload`. Unknown kinds, and known kinds whose payload changed shape, become `.unknown(kind:payload:)` instead of throwing, so a transcript never loses a row.
- `OmniClient` methods use typed throws, `throws(OmniAPIError)`. `message` is short plain text for the UI. A 2xx answer that is not JSON is `.notJSON`: an unrouted GET can get the Web UI's index.html.
- Tests: Swift Testing only. HTTP goes through `StubTransport` in `ClientTests.swift`, SSE through `ScriptedSSETransport` in `TestSupport.swift`, never the network. `LiveServerTests` is the one exception, and it only runs when asked (see below).
- Swift 6 language mode, complete strict concurrency, macOS 27.0. The app target has no default MainActor isolation; SwiftUI views are MainActor anyway.
- User-visible strings: plain and short, no em dashes, no double dashes, no emojis.

## Decisions

- No App Sandbox, no hardened runtime. The project signs ad hoc (`CODE_SIGN_IDENTITY = "-"`, manual style); `scripts/build-mac.sh` signs the installed copy again (see below). The app talks to a local server and starts it; it is not distributed. Bundle id `com.omni-os.mac`.
- ATS: `NSAllowsLocalNetworking` only, for `http://127.0.0.1`.
- `OmniClient(host:port:)` defaults to `127.0.0.1:4747`.
- `Status.server` (`ServerInfo`) comes from the server change in #76, in the tree but not merged when this was written. It is optional in `Status`; the recorded `status.json` has it. If #76 lands with a different shape, the fixture test says so; record again. The supervisor works with and without it.

## Streams (part B)

What the server sends (see the `.sse` fixtures and `server/app.ts`):

- Framing: optional `event:`, one `data:` line of compact JSON, optional `id:`, blank line. Never `retry:`.
- The thread stream opens with `event: ping`, then the backlog of `EventRow`s after `after`, each with its SSE `id`, then live messages. The `thread` and `artifact` messages carry no id. A row can come twice where the backlog meets the live queue.
- The feed sends the usage of each harness that has some when it connects, then thread, usage and artifact messages, no ids. Both streams send `event: ping` after 20s of quiet.

`SSEParser` follows the EventSource spec: LF, CR or CRLF line ends, even split across chunks; multi-line `data:` joined with `\n`; comments; the `id:` and `retry:` rules; a leading BOM; UTF-8 split across chunks. It is pure: `feed(bytes)` returns the messages it completes. `sseData` in `FixtureTests.swift` now runs the fixtures through it.

`SSEClient<Message>` keeps one stream open, like the Web UI's `openSSE`:

- `events` is one ordered `AsyncStream` of `.state(ConnectionState)` and `.message(Message)`, so a reconnect shows up in line with the messages around it. `state` reads the latest state from any thread.
- States: `.connecting` for the first attempt only. `.reconnecting(attempt:nextDelay:)` each time an attempt fails or a connection ends; later attempts keep it until `.open`. `.closed` after `close()`, or once the task reading `events` is cancelled.
- A failed attempt is a transport error, a status other than 200, or a content type other than `text/event-stream`. Its body is dropped.
- Backoff 1, 2, 4, 8, then 15s, reset by every open. A connection with no byte for 50s is dropped and retried. Pings count as bytes.
- `reconnectNow()` drops the connection or attempt, or skips the wait, with a fresh backoff. Use it on a network change. On app activation use `reconnectNow(ifQuietFor: .seconds(25))`: a connection that had a byte in the last 25s is fine, since the server pings every 20s. The default clock is `ContinuousClock`, which counts system sleep, so after a wake the connection reads as quiet.
- Cursor: `lastEventID` is the last new id, handed to `request` on each connect. Messages with an id already sent are dropped, for the client's lifetime. Messages without an id are never dropped.
- `decode` runs in the client's reading task, off the main actor. `OmniClient.feedEvents()` and `threadEvents(_:after:)` decode JSON and drop pings and anything that does not decode. `threadEvents` resumes with `?after=` set to the last event id.
- `URLSessionSSETransport.shared` has its own ephemeral session (no cache, 32 connections per host), so held-open streams never queue with API calls.
- Tests inject the transport and a `TestClock`, so backoff and the watchdog run in no time.

## Workspace store (part B)

`WorkspaceStore` (`@MainActor @Observable`) holds what the sidebar and Home need: `channels` (with running counts and `active` threads), `status`, `usage`, `crew`, `recent` (60, newest update first) and `harnesses`. Each is its own observed property; `snapshot` puts them together. `loadState` is `.loading` until the first channel list comes back, and `.failed(error)` when the last channel load failed, with the old list kept, like the Web UI's `channelsError`. Other parts fail quietly and keep their last value. `connection` mirrors the feed.

- `WorkspaceStore(client:)` owns the feed's `SSEClient`. `start()` opens it and loads everything; `stop()` closes it. `reconnectNow(ifQuietFor:)` passes through.
- A feed thread event updates `recent` in place, and refetches channels and status 500ms after the first event of a burst. One that comes in while `recent` loads is laid over the answer, unless the answer has a newer copy of that thread (by `updatedAt`).
- A feed usage event replaces that harness's usage. A status load merges its usage in.
- Every feed open after the first refetches everything at once. So does the first open when the start load failed, which is the case when the server comes up after the app.
- The server sends no feed event when a channel is created, edited or archived. After the app does one, `await store.reloadChannels()`. Secrets and automations are not in this store; their screens reload themselves after their own changes.
- When loads of the same part overlap, the answer to the latest one wins.
- `SidebarSections(channels)` lays out the sidebar like `Sidebar.tsx`: Conductor, then Clients, Internal and Personal (empty groups left out), then any other kind. `SidebarSections.threads(of:open:)` gives the thread links: newest first, 5 at most, the open thread kept even after it stops, and the count for "N more".
- Differences from the Web UI: the reconnect refetch is immediate and includes recent and harnesses; the Web UI debounces channels and status and lets each list reload itself. Harnesses load at start and on reconnect only, since the call is slow; the Web UI loads them in the composer.

## Thread store (#63 part A)

`ThreadStore` (`@MainActor @Observable`, one per thread id) holds what the thread screen shows, kept current like `web/src/pages/Thread.tsx`:

- `start()` loads `GET /api/threads/:id`, then opens the stream with `after=` the last event id. A 404 is `.notFound` and opens no stream. A first load that fails is `.failed(error)`; `reload()` tries again and opens the stream once it works.
- `events` are kept once each, in id order, whatever order the stream sends them in. `transcript` follows them.
- Stream messages gather for `frame` (16ms) and are applied together. A connection change applies what came before it first.
- A thread row, from the stream or a load, replaces the one shown unless it is older (`updatedAt`). `merge(_:isReply:)` does the same for the answer to Ben's own request, which also loses a tie. `pending` and `warm` (the server's `live`) change only with a row that is applied.
- Every stream open after the first loads the thread again and merges it in: missing events are added, the row goes through the rule above, channel, parent and children are replaced. Artifacts the stream sent while the load was out are laid over the answer unless it has a newer copy. A refetch that fails sets `refreshError` and keeps everything.
- `isReconnecting` is the Web UI's Reconnecting label: loaded, and the stream is `.reconnecting`. It stays false during the first connection.
- `interrupt()` posts stop. `stopping` holds until the thread stops running, a new result comes or 15s pass; a failed stop sets `actionError`. `interrupting` also counts an "Interrupt and send" message the agent has not read.
- `workingLine` is the line under the transcript: the latest status, else "Working" when nothing came back since the last message. Only while the thread is `.running`; queued is not working yet.
- `arrivedHTML` is the newest HTML artifact that first came on the stream, which the Web UI selects when it lands. `defaultArtifact(_:)` is the one to show when the thread opens: the newest HTML page, else the newest file.
- `apply(feed:)` updates children and the parent from feed thread events. The thread's own row is left to its stream, which carries `pending` with it.
- Decoding happens off the main actor: stream messages in `SSEClient`'s reader, the snapshot in `OmniClient`, and the first transcript layout in a nonisolated function.
- `ThreadStoreRegistry` shares one store per thread id: `acquire` makes and starts it, the last `release` stops and drops it, `apply(feed:)` passes the event to every store. A store that is let go without `stop()` closes its stream in its deinit.

`Transcript` is `buildItems` from `web/src/components/Transcript.tsx`:

- Items: `.user`, `.text`, `.tools(ToolGroup)`, `.plan`, `.result`, `.error`, `.report`. A group gathers the calls between two breaking rows (user, text, result, error, crew report), with sub-agent calls nested under their parent by `parent_tool_use_id`. A result can come before its call.
- Ids are stable across updates: a group is `.event(first call's event id)`, the plan is `.plan`. The live plan is one item, updated in place, placed after the group of its latest `TodoWrite`.
- `update(_:)` works from the last item that can still change, so a streamed event costs the tail, not the thread. If the list does not extend the one it saw (an earlier event turned up), it lays everything out again. `TranscriptTests` checks piece by piece equals all at once, over random splits of the recorded threads and random turns.
- A zero-turn success result (a slash command) shows nothing and does not break the group, like the Web UI.
- Differences: a call that names itself as its parent is shown at the top, not dropped. A `tool_use` whose payload does not decode shows nothing.

`ToolText.summary` needs the input's keys in the order JavaScript gives them, for the "first string field" fallback: `ToolUse.inputKeys` keeps the top level's order (integer keys first, then as sent). Nested objects are not ordered, so part C's pretty JSON of an input will not match the Web UI's key order until that is solved (`JSONKeyOrder` can be extended).

`Format` spells month names out (en-GB, "Sept") instead of taking them from the system, so they match the Web UI.

## Thread screen handoff (#63 part C)

For the thread screen (part C). What parts A and B leave ready and what they do not:

- Wire-up: the app has no `ThreadStoreRegistry` yet. Make one next to the `WorkspaceStore` in `AppModel`, and pass feed thread events to `registry.apply(feed:)` (the `WorkspaceStore` reads the feed; give it a hook, or read `client.feedEvents()` once and fan out). The screen calls `acquire(id)` on appear and `release(id)` on disappear; S14 (#75) reuses it across windows.
- Pass the open thread to `SidebarSections.threads(of:open:)` so it stays in the sidebar after it stops.
- Rows, from `Transcript.tsx`: `UserBubble` (the `SOURCE_LABEL` table, "Steered", "Interrupted and sent", "Not sent" for a dropped message, attachments via `uploadURL`), `ToolGroup` (a lone call is just its row, `isSingle`; else "N tool calls" with `names`, or the `latest` call's label and summary while `isLive(_:running:)`, and "N failed" from `failures`), a call row ("N sub-calls", `ToolText.label`, `summary(cwd:)`, `icon`, `isMonospaced`, `isFailed`, `isStopped`), `ToolInput` (the full input as pretty JSON, see the key order caveat above), `PlanCard` (`Plan.done`, `active`, `allDone`, `Todo.label`), `ResultLine` (`TurnResult.line`, `isBad`), `ReportCard` (its text is markdown, "(no reply)" when empty), the error row. Assistant text and reports go through `MarkdownCache` (see "Markdown" below).
- Under the transcript: `workingLine`, then `QueuedMessages` (`pendingLabel` in `Transcript.tsx`) from `store.pending`, with `starting: store.betweenTurns`.
- Header: `isReconnecting` shows "Reconnecting", the status pill, `interrupting` turns the button into "Interrupting". Esc interrupts a running thread when nothing else wants Esc.
- Artifacts are chosen per window, not in the store: start from `ThreadStore.defaultArtifact(store.artifacts)`, switch to `arrivedHTML` when it changes, list `files` and `screenshots`, load with `client.artifactURL(_:)`.
- `cwd` for summaries is the last `init` event's cwd, else `thread.cwd`, as the Web UI does.
- Errors: `.failed` and `.notFound` for the whole screen, `refreshError` and `actionError` as notes with a retry (`reload()`).
- The transcript should be a lazy list keyed by `TranscriptItem.id`; items are `Hashable` so rows can skip redraws.

## Thread screen (#63 part C)

`ThreadScreen.swift` (screen, header, scroll pin, pill), `MessageViews.swift` (user bubble, result, error, report, working and queued lines), `ToolViews.swift` (groups, calls, plan, `TranscriptUI` open state), `MarkdownView.swift`, `ThreadStyle.swift`. `#/t/<id>` opens it from the sidebar, links and QA.

- QA: `{"wait": "thread:<id>"}` waits for the laid-out transcript and notes the open time; `{"scroll": "top"|"bottom"|"through"}` and `{"expand": true}` (opens tool groups and failed or nested calls) work on the open thread.
- Measured on this Mac: a 2,000-event thread opens in about 65 ms; a scroll through it ran 87 frames, mean 19 ms, worst 33 ms.
- Copy: right-click a row for Copy; Edit > Copy Thread as Markdown (Shift-Cmd-C).

## Markdown (#63 part B)

`MarkdownDocument(parsing:)` reads text the way `web/src/components/Markdown.tsx` shows it: react-markdown with remark-gfm, then its thread id links. swift-markdown (cmark-gfm) parses, smart punctuation off, and `Markdown.swift` turns its tree into plain `Sendable` values, so no swift-markdown type leaves OmniKit.

- Blocks: `.paragraph`, `.heading(level:)`, `.code(language:code:)` (the first word of the fence info; no trailing newline), `.quote`, `.list`, `.table`, `.thematicBreak`, `.html` (a raw HTML block, shown as the text it is).
- `MarkdownList`: `isOrdered`, `start`, `isLoose`, and items of blocks, so lists nest. `checked` is nil for an item that is not a task. `isLoose` is CommonMark's loose list (a blank line between items, or between two blocks of one item); the Web UI wraps each item in a `<p>` then, which spaces the list out.
- `MarkdownTable`: `alignments`, `head`, `rows`, each row padded or cut to the head's width. The alignment is in the model, but the Web UI's CSS left-aligns every cell; part C picks.
- `MarkdownText` is a list of `runs`: text with a `style` (emphasis, strong, strikethrough, code), maybe a `link`, maybe an `image` (its text is the alt text). Runs that look the same are joined. `attributed` is one `AttributedString` with `inlinePresentationIntent` and `link` set, for a SwiftUI `Text`, images as their alt text. `segments` splits it around images, for a view that loads them. `plain` is the text alone.
- A soft break is a space, a hard break a newline. Inline HTML is text. Link titles are dropped. No footnotes (remark-gfm has them).

Links, `MarkdownLink`:

- `#/...` is `.route(Route)`. A hash that is `Route.notFound` (`#top`) is not a link.
- http and https with a host, and mailto, are `.external(URL)`. Any other scheme (javascript, file, data, irc, xmpp) and relative paths are not links: the text shows plain. Images load from http and https only.
- The href is encoded like micromark's normalizeUri: what a URL cannot hold is percent encoded, escapes already there are kept. Where the web leaves a URL that cannot open, a second `#` and a `%` that starts no escape are encoded too, and an IPv6 host is kept.
- In `attributed`, a route rides as `omni:#/t/<id>`. In the view's `OpenURLAction`, `MarkdownLink(url:)` turns the URL back: `.route` sets `model.route`, `.external` goes to `NSWorkspace`.

Bare links, `Autolink.swift`, found in the web's order:

1. micromark's literal autolinks, found while it parses: `http(s)://`, `www.` and emails, with its trailing punctuation and parentheses rules. None while a `[` is open in the block (its `previousUnbalanced`); escaped brackets are read back from the source for that.
2. mdast-util-gfm-autolink-literal's URL and email passes over the text left. These also link after punctuation or a symbol.
3. Markdown.tsx's bare thread ids (lowercase UUIDs between word boundaries) link to `#/t/<id>` and show the first 8 characters. Inline code that is exactly an id does the same, in code style.

Code, link text and raw HTML are never linked. Every scan is linear in the text: `MarkdownSpeedTests` parses a 24 KB reply under 250ms, and long words that would make a naive scan quadratic.

To see what the web makes of a snippet, from the repo root:

```sh
node --import tsx --input-type=module -e '
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { Markdown } = await import("./web/src/components/Markdown.tsx");
console.log(renderToStaticMarkup(createElement(Markdown, { text: process.argv[1] })));
' 'see www.example.com, and **bold**'
```

Differences from the web, found by comparing 10,000 random and realistic snippets with that render. All rare in agent text:

- Emphasis around a URL: micromark finds a literal URL before it pairs `*`, `_` and `~`, cmark after. A delimiter in a URL that pairs with one outside splits the URL here; the web keeps it whole (`**https://x.com/a**/`, `_https://en.wikipedia.org/wiki/Foo_(bar)_`, `https://x.com/a-b_c~d~`). Fixing it takes a second parse with those delimiters escaped.
- `&amp;` right after a URL: cmark decodes it first, so the link takes the `&`. The web stops before it.
- A URL Foundation can't parse (a port that is not a number, as `https://x.com:443'}` or `www.x.co:y`, or no host, as `www.@`) stays plain. The web links it, to a page that can't open.
- A thread id inside a URL stays in the URL; the web links the id and breaks the URL. An id in `<...>` or `_..._` is linked here and not on the web (its regex runs on the source).
- A relative link (`[x](www.x.com)`, `[x](docs/a.md)`) is plain text here and a dead link on the web.

`MarkdownCache<Key>`: `document(for:text:)` parses once per key and text, and again when a key's text changes (a streaming reply). Past `limit` (2000) it drops the least recently used down to three quarters. It is thread safe and parses outside its lock, so a parse can run off the main actor. `cached(for:text:)` never parses. Use one `MarkdownCache<Int>` for the app keyed by event id (ids are unique across threads), shared by every thread window.

Tests: `MarkdownTests` (blocks, inline, `attributed`), `MarkdownLinkTests` (link rules, encoding, thread ids, bare links; the expected results were checked against the web render), `MarkdownCacheTests` (cache, speed).

## Server supervisor (part C)

`ServerSupervisor` (`@MainActor @Observable`) finds, starts and stops the server on the port from `ServerSettings`. Make it with `ServerSupervisor(settings:)`; it reads `settings.config` at each call, so a settings change applies at the next `refresh()`, `start()` or `stop()`. Calls run one at a time, in order.

- `state`: `.unknown`, `.checking`, `.notRunning`, `.starting`, `.running(startedByApp:server:)`, `.failed(message:logTail:)`, `.stopping`. `server` is the status's `ServerInfo`, nil for a server older than #76. `message` is plain text for the window; `logTail` is this run's last 40 log lines, when there are any.
- `canStop`: there is a process to stop. `port`: the port of the last check. `isRunning`.
- `refresh()` does GET /api/status on 127.0.0.1 with a 1.5s timeout. JSON that decodes as `Status` is a server, with or without the `server` object. No answer and the port free: `.notRunning`. No answer but the port taken: `.failed`, port in use. Anything else answering (HTML, a 404): `.failed`, not an Omni server. Only the first check, from `.unknown`, shows `.checking`. Later ones keep what shows (running, not running, failed) until the answer, so coming back to the app or waking does not blank the screen.
- `start()` never starts a server when something answers on the port: it attaches. Otherwise it resolves the launch, spawns, writes the record and polls status every 200ms. It is running once status answers with `server.pid` equal to the child's pid, or with no `server` object. The child exiting first gives `.failed` with its exit code and the log tail. No answer within 20s: the group is stopped (2s grace), then `.failed` with the tail. A child that is only stopped (SIGSTOP) has not exited: Darwin's `waitid` reports it too, so `Spawn.hasExited` checks the code, and reaping it would block the main actor.
- `stop()`: for a server the app started, SIGTERM to its process group, SIGKILL to the group after 8s (and always after, for leftovers), then the record is removed. For a server started some other way that reports its pid and whose process is named `node`: SIGTERM to that pid only, SIGKILL after 8s. A pid past Int32 counts as none. A server that does not say its pid (older than #76, not the app's) can't be stopped: `canStop` is false and `stop()` only checks again.
- An exit watch (a dispatch process source) on the server's pid refreshes the state when the server dies, whoever killed it.
- One server per app: `start()` refuses (`.failed`, "still runs on port N") while the app's recorded server runs on another port, as after a port change. Set the port back and stop it first.

How the server is started:

- `node --import tsx server/index.ts` in the repo root, not `npm start` or the tsx CLI. It is one process, so the spawned pid is the server's pid in `/api/status`, and `server/lock.ts` sees `node` as its name.
- Node: the Settings override if set (it must run and report 24 or later, or it is an error; there is no fallback). Otherwise the highest nvm Node 24 or later in `~/.nvm/versions/node`, then `node` on the login PATH, each checked with `node -v`.
- Environment: HOME, USER, LOGNAME, SHELL, TMPDIR and LANG from the app, PATH, `NODE_ENV=production`, `NODE_OPTIONS=--disable-warning=ExperimentalWarning`, `OMNI_PORT`. Nothing else. Keys that bill an API (`ANTHROPIC_*`, `*_API_KEY`, `*_AUTH_TOKEN`, `OPENAI_BASE_URL`) are dropped last, even from `extraEnvironment`.
- PATH: `/bin/zsh -ilc` runs a printf of `$PATH` between split markers with a random id (a shell that echoes the command can't fake them), 5s timeout, killed with its group at the timeout. The shell itself gets only the minimal environment. Nothing but PATH is read from it; Ben's zshrc exports a stale `ANTHROPIC_API_KEY`. No PATH: `~/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`. Node's own bin folder goes first.
- posix_spawn in a session of its own (`POSIX_SPAWN_SETSID`): no controlling terminal, and its pgid is its pid. With only its own group, `zsh -ilc` from an app started in a terminal took the terminal from a background group and SIGTTOU stopped it before any rc file ran, so the PATH fell back. Default signal handlers and mask, no inherited descriptors (`CLOEXEC_DEFAULT`), stdin `/dev/null`, stdout and stderr appended to `~/Library/Logs/Omni/server.log`. Each start writes an `[omni-app] <date> starting <command> in <dir>` line first; the tail is read from after it. Over 10MB the log moves to `server.log.1` at the next start.
- Nothing ties the server to the app: it keeps running when the app quits. It is never a LaunchAgent or login item.
- The record, `~/Library/Application Support/Omni/server.json`: `{pid, pgid, port, startedAt, repo}`. A later launch counts a server as started by the app when the record is for this port, its pid still runs in that group and started within 5s of `startedAt` (so a reused pid does not pass), and the answering server's pid is that pid (or it gives none). A record whose process is gone is removed at the next check.
- Before the start: `ServerStartError` for no `server/index.ts` in the repo, no `node_modules/tsx`, no usable Node.

Launch arguments override the settings for the run and turn saving off (`isVolatile`): `-serverPort 4757 -repoPath /path/to/omni-os -nodePath /path/to/node`. For QA, use them and a port other than 4747. Log and record paths are `Options` fields, for tests.

### Supervisor tests

- `ServerSettingsTests`, `ServerLaunchTests` (login shell, Node, environment, launcher): fakes only. The fake login shell prints junk and exports `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`; the tests show neither reaches the child.
- `ServerSupervisorTests`: real processes, run by default. They boot this checkout's server on a free port with a throwaway data folder, the fake claude CLI and `OMNI_BROWSER=0`, and fake servers (a script, a hung listener, an HTML responder, a Node one-liner with the old status shape). About 8s. `OMNI_SKIP_SUPERVISOR_TESTS=1` leaves them out. Each test kills what it recorded and the fake whose pid is in `fake.pid`, then removes its folder. The code under test clears the record, so a fake that a broken stop leaves running is only found by its pid file. A run cut short (killed by a timeout, a crash) skips that, and its server keeps running: look for a `supervisor-*` folder in `$TMPDIR` and stop the server whose `OMNI_DATA_DIR` is in it. Don't wrap `swift test` in a kill timer.
- `LiveLoginShellTests`: this Mac's real zsh and Node, only with `OMNI_LIVE_LOGIN_SHELL=1`. Prints nothing.
- A terminal: `runsTheServerInASessionOfItsOwn` checks the session anywhere. `runsTheShellWithoutATerminal` and `LiveLoginShellTests` only catch a shell that gets the terminal when `swift test` has one; from a script, run them under `script -q /dev/null`.

## Test support

In `ProcessTestSupport.swift`: `TempDir`, `fakeLoginShell`, `fakeNode`, `freePort`, `SilentListener` (accepts, never answers), `HTTPResponder` (one fixed answer), `realPath`, `processAlive`, `killGroup`, `environmentOf` (`ps -E`).

In `TestSupport.swift`:

- `TestClock`: moves only on `advance(by:)`. Clients take deadlines when they ask for a wait, so advancing right after an event is safe.
- `ScriptedSSETransport`: each connection waits for `accept(status:contentType:)` or `refuse()`, then takes `send(_:)` and `end()`. `isDropped` says the client let it go. `next()` waits for the next connection.
- `Recorder`: collects an `SSEClient`'s events; `next()` waits for the next one.
- `eventually` and `waitFor` (for main actor state) poll for up to 2s by default; `settle()` lets other tasks run before a check that something did not happen. `Gate` holds a fake call until opened.
- `FakeWorkspaceAPI` in `WorkspaceStoreTests.swift` answers with what the test set and counts calls. `holdNextChannels()` and `holdNextRecent()` hold the next call with a `Gate`.

`LiveServerTests` runs the SSE client, `URLSessionSSETransport`, the workspace store and a thread store (a `RICH` turn, then a reconnect and a second turn) against a real server, only when `OMNI_LIVE_PORT` is set (never 4747). Boot one from the repo root with the fake CLIs and a throwaway data dir, passing only PATH and HOME from your shell (the login shell exports a stale `ANTHROPIC_API_KEY`):

```sh
T=$(mktemp -d)
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$T" OMNI_DATA_DIR="$T/data" OMNI_PORT=4791 OMNI_HOST=127.0.0.1 \
  OMNI_CLAUDE_BIN="$PWD/tests/fixtures/fake-claude.mjs" OMNI_CODEX_BIN="$T/none" OMNI_CURSOR_BIN="$T/none" \
  OMNI_BROWSER=0 OMNI_BRAIN_DIR="$T/brain" OMNI_WEB_DIST="$T/none" \
  node --disable-warning=ExperimentalWarning --import tsx server/index.ts
OMNI_LIVE_PORT=4791 swift test --package-path mac/OmniKit --filter LiveServerTests
```

`LiveSecretsTests` saves and deletes a secret through `SecretsModel`, so it also needs `OMNI_LIVE_SECRETS=1`, and the server a `security` that stores nothing first on PATH, so it never writes to the Keychain: `mkdir "$T/bin"; printf '#!/bin/sh\n[ "$1" = "-i" ] && cat > /dev/null\nexit 0\n' > "$T/bin/security"; chmod +x "$T/bin/security"`, then boot with `PATH="$T/bin:$PATH"`.


## The app (part D)

`mac/Omni/` holds the app target. Everything testable lives in OmniKit; these files are views and glue.

| File in `mac/Omni` | What |
| --- | --- |
| `OmniApp.swift` | `@main`. One `Window("Omni", id: "main")`, the `Settings` scene, the menus. `AppDelegate` owns the one `AppModel`, calls `launch()`, and `didBecomeActive()` on activation. Closing the window quits the app; the server keeps running. |
| `MainWindow.swift` | `NavigationSplitView` of the sidebar and the detail, the toolbar, `RoutePlaceholder`, `Route.symbol` |
| `SidebarView.swift` | The sidebar, `ThreadRow`, `ThreadStatusIcon`, `StatusFooter` |
| `ServerView.swift` | The server screen, `ServerDetails`, `LogTail`, `ServerMenuItems`, `confirmStop` |
| `SettingsView.swift` | The Settings tabs (`model.settingsTab`), the Connection pane, `PathField`, the folder and file pickers |
| `SecretsSettingsView.swift` | The Secrets tab: `SecretsSettings` (a `SecretsModel` per client and visit), `SecretsForm`, `SecretRowView` |
| `AppearanceSettingsView.swift` | The Appearance tab, `Appearance.nsAppearance` |
| `AutomationsView.swift` | The Automations page: `AutomationsView` (an `AutomationsModel` per client and visit), `AutomationSection`, `RunStrip`, `RunRow`, `FlowRow` |
| `SystemEvents.swift` | Wake (`NSWorkspace.didWakeNotification`) to `didWake()`, `NWPathMonitor` changes (not the first update) to `networkChanged()` |
| `QARunner.swift` | Debug only. The QA harness, below |

`AppModel` (OmniKit) is the app's one connection to Omni: `ServerSettings`, the `ServerSupervisor`, an `OmniClient` and `WorkspaceStore` for the port in the settings, and `route`. `launch()` opens the feed, checks the server, and follows the settings with `Observations`: a port change swaps the client and store, any change checks the server again. The feed dropping or opening checks the server again too, so the window follows a server killed or started somewhere else. A failed start stays on screen (`startFailure`) until the server runs, Start is pressed again or the settings change.

Main window:

- The sidebar matches `Sidebar.tsx`: Home, Conductor, the channels by kind (Clients, Internal, Personal, then others), Add channel, and Workspace (Artifacts, Automations, Secrets). A channel's badge is its running count, hidden at 0. Under each channel, its active threads from `SidebarSections.threads(of:)`, with a spinner (running), a clock (queued) or a red mark (failed), and "N more", which opens the channel. It all comes from the store, so counts and threads move with the feed.
- The selection is `SidebarItem(route: model.route)`; picking a row sets `model.route`. Routes without a row (search) select nothing. Secrets is the exception: it opens Settings on the Secrets tab (`model.show`) and the window stays where it was. Any other write of `#/secrets` to the route does the same (`MainWindow`'s `onChange`), going back to the route last drawn.
- A red row under Home when the channel list fails to load while the server runs. With no server, the server screen says so instead.
- The footer: a dot (green running, orange running but the feed is retrying, red not running or failed), `State.label` ("Started by the app", "Started outside the app", "Not running"), the port, and an orange "Reconnecting".
- The detail is the server screen while `model.serverScreen` is set, else the screen for the route. Automations has its screen (below). The other routes show a `ContentUnavailableView` with their title and hash. Unknown routes show "Nothing here" and Go Home.
- The title follows the route (`#acme` on a channel), "Omni" while the server screen shows.
- Toolbar: "Reconnecting" with a spinner while the feed retries, a Server menu, New Thread. Menus: File > New Thread (Cmd-N, in place of New Window), a Server menu (Check Again is Cmd-R), and the sidebar commands in View.
- The standard macOS 27 look: `.listStyle(.sidebar)`, system materials, no custom glass or colors.

Server screen (`ServerScreen`):

- Looking, starting, stopping: a spinner and a line.
- Not running: Start Server, Check Again and Settings, with the port, repo and Node it would use.
- Failed: the message, the last lines of the log (as tall as the lines, scrolling from the bottom past 220 points), Try Again, Open Log (NSWorkspace, when the log exists), Stop Server when there is a process to stop, Check Again and Settings.
- Stop always asks first: running threads stop with the server.
- "Reconnecting" shows next to Not running: the feed keeps trying, which is how a server started in a terminal is found. That is on purpose (see `AppModelTests`).

Settings, Connection pane: Port, Repo (a field and a folder picker), Node (a field and a file picker; empty finds Node itself). The port and paths apply on Return, when the field loses focus or when Settings closes (closing a window does not end editing), and the paths on a pick too. Never per key: typing 4759 does not try 4, 47 and 475. A number that is not a port puts the current one back. A blank Repo is `~/omni-os` (`effectiveRepoPath`), in `config` and on the server screen. Everything applies at once, no relaunch. With launch arguments set, a note says changes last until the app quits. Status shows the server state, the feed, Open Log, and Build (the `OmniGitCommit` stamp) in an installed build.

Settings, Secrets tab (#72), like `Secrets.tsx`:

- The Keychain note, then Add or replace: Scope (Global, then `#name` per channel), Name (upper-cased and `_` for anything else as it is typed, per UTF-16 unit like the Web UI), Value (a `SecureField`). "Save secret", or "Replace secret" with the hint when the name exists in that scope. The Web UI's messages for a bad name, no value and a value with a line break, checked before sending; the server's own error shows the same way. After a save: "Saved NAME (#Acme)" or "Updated ...", name and value cleared, the list loads again.
- The list: Global first, then the channel scopes, each with its count; a row is the name, `RelTime` (the ISO time as a tooltip) and a trash button. Delete asks first (a confirmation dialog, not the Web UI's 5 second undo); a failure shows on the row. Loading, "No secrets yet", and the load error with Retry.
- The value: only in `SecretsModel.value` while typed and sent, in the POST body, and nowhere else. No UserDefaults, file or log. It is cleared after a save that succeeds and when the tab or Settings closes (`clearValue()`); a refused save keeps it so it can be sent again. A Swift `String` can't be wiped in memory, so "cleared" means the model drops it. `SecretsModelTests.holdsNoValueAfterSave` walks the model's stored properties and UserDefaults for it.
- The list loads when the tab shows, for a new port, and when the feed opens again.

Settings, Appearance tab: Match system, Light, Dark (radio buttons), saved as `appearance` in UserDefaults. `AppDelegate` applies it in `applicationWillFinishLaunching`, before any window, and on every change in the same call (`AppearanceSettings.follow` sets `NSApp.appearance`), so every window follows at once. `-appearance dark` sets it for one run and saves nothing, with a note in the tab.

Automations page (#73), like `Automations.tsx`. The Web UI has no create or edit: an automation is a YAML file in `automations/` that the server reads again on save. So the app has neither; the empty state says where the files go.

- One grouped section per automation, in the server's order. The head: a bolt, the name, a Paused or Invalid badge, then chips for the schedule in words (`AutomationSchedule.describe`, the cron and time zone as a tooltip), the cron, the channel (opens it), the role and the model. "Next run Tomorrow 08:00" only while enabled, valid and scheduled, in the automation's time zone, with the zone named when it is not the Mac's. Then Run now and the switch.
- `describe` and `nextRunLabel` are ports, down to the quirks: `61 8 * * *` reads "Every day at 08:61", Tomorrow is the day 24 hours from now, and months are Node's en-GB short names ("Sept"). The test cases were run through `web/src/format.ts` in Node.
- An invalid automation shows the server's error and "Fix it in <file>" (`shortPath`), and its Run now and switch are off, as in the Web UI.
- Run now opens the new thread. The switch shows its new value at once, turns back with the server's error if it refuses, and loads the list again when it takes it. Errors show on the automation until its next action.
- Prompt is a disclosure group. Last runs: the strip (oldest left, finished runs full height, colors of `RUN_TONE`, the running one pulses, "done · 5m ago" tooltips), then a row per run: the status dot (a ring for queued), the title or "Thread removed", "manual", `RelTime`. A row with a thread opens it.
- It loads when it shows and for a new port. The Web UI reloads a second after a feed event for an automation's thread; the app has no raw feed events, so `recentChanged` watches `store.recent` for automation threads that are new or changed, and reloads once, a second later. It also reloads a second after the feed opens again. Refresh in the toolbar, a spinner there while a reload runs.
## Thread inspector (#67)

`.inspector` on the thread screen (`ThreadScreen` adds `.threadInspector(model:store:)`), 340 to 760pt, toggled in the toolbar and View > Show Inspector (Opt-Cmd-I, with the artifact count). Open state is `@AppStorage("threadInspector.open")`, shared by all threads.

- OmniKit, all pure: `InspectorSelection` (initial pick: `?artifact`, else newest HTML, else newest file, else Details; `arrived` selects a new HTML even the first), `RequestPolicy` (blocks loopback, 100.64.0.0/10, `.ts.net` and the Omni port; `ruleListJSON` is the same policy as a WebKit content rule list, a test keeps them equal), `CSV`, `ThreadDetails` (resume command, MCP list, dates), `ArtifactRef` (Codable, the value of the artifact window) and `OmniClient.artifactData`.
- `mac/Omni`: `InspectorView` (modifier, panel, Artifacts tab), `InspectorTabs` (Browser, Details), `ArtifactViews` (viewer, native PDF/image/CSV/JSON/markdown/text, save panel, `ArtifactWindowView`), `ArtifactWebView` (HTML and SVG).
- The web view: non-persistent data store, page served by the `omni-artifact` scheme (only its own artifact), rule list on, no script message handlers, links and window.open go to the default browser (http, https, mailto, never a blocked host). The window scene is `WindowGroup(id: "artifact", for: ArtifactRef.self)` in `OmniApp`.
- QA steps: `{"inspector": "open|close|artifacts|browser|details"}` and `{"webTitle": "BLOCKED"}` (waits for the inspector web view's document.title). The check used an HTML artifact that no-cors fetches the local API and reports `BLOCKED` only when every local fetch failed and a control fetch to the internet worked.
- To seed a QA thread: write files into `<data>/threads/<id>/artifacts/` (and `browser/*.png` for screenshots); the server's watcher picks them up.

## Artifacts page (#69)

`#/artifacts` shows `ArtifactsScreen` (`DetailView` routes to it): a filter picker (All, Pages, Images, Docs, Data, with counts), a grid of cards (thumbnail, type icon and name, thread title, `#channel`, age) and a "New" badge for anything changed since the previous visit (`UserDefaults` `artifacts.seen`). A card sets `model.route = .thread(id:, artifact:)`, which opens the thread with the inspector on that file.

- OmniKit: `GalleryArtifact` (a row of `GET /api/artifacts`, fixture `artifacts.json`), `ArtifactFilter`, `ArtifactGallery` (pure; the upsert rules are in its doc comment) and `ArtifactsStore`. The store has a feed connection of its own, started and stopped with the page. A feed artifact of a known thread joins at once; an unknown thread, or a reconnect, refetches after 1.5s like the Web UI.
- `mac/Omni`: `ArtifactsScreen`, `ArtifactThumbnails`. Images are decoded small with ImageIO, SVG through `NSImage`, pages are loaded one at a time in the viewer's sandbox (`ArtifactWebHost`, `SandboxRules`) in an off-screen window and snapshotted. All are cached per artifact version.
- To recheck live updates in QA, write a file into `<data>/threads/<id>/artifacts/` during a `sleep` step.

## Quit, updates and banners (#74)

- Quit: `AppDelegate.applicationShouldTerminate` returns `.terminateLater`, asks `AppModel.quitDecision()` (`QuitRules` in `Quit.swift`, a pure function of the running turns from a fresh GET /api/status and whether the app started the server) and either quits or shows the `NSAlert` in `UpdateViews.swift`: Keep Server Running, Stop Them and Quit, Cancel. `prepareToQuit` stops queued then running threads, then the server if the app started it. A hand-started server is never stopped. A kept server is found by the record on the next launch (`ServerSupervisorTests`).
- `Updater` (`Updater.swift`, made by `AppDelegate`): `UpdateCheck.notices` compares `server.gitHead` and the app's `OmniGitCommit` with `git rev-parse main` in the repo (`RepoHead`). It checks when the server state changes and when the app becomes active. A commit it cannot know never shows a notice.
- Restart Server (`ServerRestart`, sequenced against `RestartHost`, tested with a fake host and `TestClock`): wait for no running turns (poll 2s), `node node_modules/vite/bin/vite.js build` (log `~/Library/Logs/Omni/web-build.log`), check idle again, stop, start. A server started outside the app asks first. Rebuild and Relaunch runs `scripts/build-mac.sh` in its own session (log `app-rebuild.log`); the script quits the installed copy itself.
- `UpdateBar` sits above the detail and shows the notice, progress and errors. Nothing runs without a click.
- Banners: `FinishTracker` mirrors `ThreadNotifier` in the Web UI (a thread seen queued or running that becomes done, failed or stopped, unless it is open in the front window). `AppModel.banners` is fed from the feed; `BannerStack` shows them bottom right, auto-dismiss 6.5s, paused on hover.

## Build and install

`scripts/build-mac.sh [--no-open] [-- app arguments]`:

1. Release build with xcodebuild into `mac/.xcode` (log in `mac/.xcode/build-release.log`; errors are printed on failure).
2. `git rev-parse HEAD` goes into the built app's Info.plist as `OmniGitCommit`.
3. Signs again (the stamp broke the build's signature): the first "Apple Development" identity from `security find-identity -v -p codesigning`, else ad hoc. `--timestamp=none`, then `codesign --verify --strict`. If the keychain asks whether codesign may use the key, the script waits for the answer.
4. Quits a running installed copy: processes whose command starts with `~/Applications/Omni.app/Contents/MacOS/Omni` only, SIGTERM, then SIGKILL after 5s. Debug builds and the server are left alone.
5. Moves the old `~/Applications/Omni.app` to the Trash (to `mac/.xcode/replaced/` when the Trash can't be written), after checking it is this app by bundle id. It refuses to replace anything else.
6. Copies the new app in with ditto, prints its path, and opens it, passing what follows `--`.

The installed app with no arguments talks to port 4747, the live server. For a check, run `scripts/build-mac.sh -- -serverPort 4759` (nothing listens there) and quit it after.

## QA harness (Debug only)

`QARunner` runs a script against the Debug app and snapshots its windows without screen recording permission. Nothing of it is in a Release build (`strings` finds no `OmniQA`).

```sh
S=<scratch dir>
mac/.xcode/Build/Products/Debug/Omni.app/Contents/MacOS/Omni -ApplePersistenceIgnoreState YES \
  -serverPort 4757 -repoPath "$PWD" -OmniQAScript "$S/qa/run.json" -OmniQAOut "$S/qa/run"
```

- `-OmniQAScript` takes the JSON itself or a path to it; `-OmniQAOut` the folder for PNGs and `qa.json`. They are read from the raw arguments: UserDefaults would parse a JSON value as a property list.
- Give every flag a value. A flag without one ahead of the others left the app with no window.
- It refuses to run (exit 2, reason in `qa.json` and stderr) unless launch arguments set `-serverPort` (every one given) to a port other than 4747. `QALaunch.serverPort` checks the raw arguments before the app model exists, so nothing has talked to a server yet. A `{"port": 4747}` step is rejected, and server steps refuse while the port is 4747. So a QA run never talks to the live server and never saves settings.
- A server a QA run starts keeps its data, brain folder, log and record in the out folder and runs the fake CLIs (`QAServer.environment`: `OMNI_DATA_DIR`, `OMNI_BRAIN_DIR`, `OMNI_CLAUDE_BIN`, `OMNI_CODEX_BIN`, `OMNI_CURSOR_BIN`, `OMNI_BROWSER=0`). The run stops it before quitting.
- The app exits at `quit` or when the steps run out: 0 when every step passed, 1 otherwise.
- `-appearance light` or `dark` sets the appearance for the run, to snapshot both.

Steps (a list, or an object with the list under `steps`):

| Step | Does |
| --- | --- |
| `{"route": "#/c/acme"}` | Sets the route |
| `{"wait": "sidebarLoaded"}`, `{"wait": {"for": "serverState:running", "timeout": 30}}` | Polls every 100ms, 10s by default. Conditions: `sidebarLoaded`, `serverState:<unknown, checking, notRunning, starting, running, failed, stopping>`, `connection:<connecting, open, reconnecting, closed>`, `channel:<id>` |
| `{"sleep": 1.5}` | Seconds |
| `{"snapshot": "home"}` | `home.png` for the main window, `home-settings.png` for Settings, `home-window<n>.png` for others. Fails on a blank image |
| `{"port": 4759}` | Sets the port, as Settings would. Never 4747 |
| `{"open": "settings"}` | Opens Settings |
| `{"settings": "secrets"}`, `"appearance"`, `"connection"` | Opens Settings on that tab |
| `{"server": "start"}`, `"stop"`, `"check"` | Start Server, Stop Server (no confirmation), Check Again. Waits for it to finish |
| `{"quit": true}` | Writes the report and exits |

`qa.json` is written after every step: `{ok, error, steps: [{step, action, ok, ms, error, files}], facts: {serverState, connection, sidebarLoaded, channels, route, windows}}`. A failed wait says what the server, feed and sidebar were.

Snapshots:

- `cacheDisplay` of the window's frame view, so the title bar and toolbar are in. On macOS 26 and later it leaves out the sidebar's rows (the list's scroll view inside the glass draws nothing), and a row's own selection and separator views come out black. So the harness draws each row's cells and headers on their own, clipped to the list's visible area, and lays them over the capture. The selected row's highlight is a plain rounded rect the harness draws (gray unless the window is key).
- The see-through glass is filled with the window background color; on screen the desktop shows through.
- Spinners are drawn still. The app is not activated, so its window is not key: prominent buttons and the selection draw as in a window in the back.
- A run takes 2 to 10 seconds. Keep the app from staying up: always end with `quit`, or let the steps run out. macOS has no `timeout`; to cap a run anyway, `perl -e 'alarm 60; exec @ARGV' <app binary> <args>`. A run killed that way leaves a server it started running, so only use it with scripts that start none.

A test server for QA. Start it with `node --import tsx` directly: `npm start` goes through the tsx CLI, whose IPC socket path is too long under a deep TMPDIR (EINVAL).

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$S/tmp" OMNI_DATA_DIR="$S/tmp/qa-data" OMNI_PORT=4757 \
  OMNI_CLAUDE_BIN="$PWD/tests/fixtures/fake-claude.mjs" OMNI_BROWSER=0 OMNI_BRAIN_DIR="$S/tmp/qa-brain" \
  node --disable-warning=ExperimentalWarning --import tsx server/index.ts > "$S/tmp/qa-server.log" 2>&1 &
```

For the Automations page, add `OMNI_AUTOMATIONS_DIR="$S/tmp/qa-automations"` with a YAML file or two in it (name, cron, channel, prompt, `enabled: true`). Without it the server reads and writes the repo's `automations/`, and the enabled ones run on their schedule.

A thread whose prompt is `TOOL:300000` keeps running for five minutes with the fake CLI, for spinners and running counts. The server runs four per harness at once; the rest queue.

What the tracer's QA run covered (each checked by eye in the PNGs): the sidebar with channels, badges, running and queued threads and "N more"; a count and a thread row showing up while the app ran; channel, thread and unknown routes; Settings; not running (4759); a foreign server (a plain HTTP server on 4758: "not an Omni server"); a start that failed, with short and long log tails; a start and stop by the app on 4758 with the QA environment; the server killed under a connected app (Reconnecting, then Not running).

## Slash menu (#66)

The slash grammar, ranking, hints and pills are the TypeScript in `shared/` that the Web UI also runs, through JavaScriptCore (ADR 0002). The engine imports from `shared/` only, never from `web/`; `tests/app-boundaries.test.ts` enforces it.

- `mac/slash-engine/entry.ts` is the entry; `npm run build:slash` bundles it (esbuild, `scripts/build-slash-engine.ts`) to `OmniKit/Sources/OmniKit/Resources/slash-engine.js`, which is checked in. `tests/slash-engine-bundle.test.ts` fails when it is stale. After changing `shared/slash.ts`, `slash-menu.ts`, `composer-slash.ts` or `slash-pills.ts`, run `npm run build:slash`.
- `SlashEngine.shared` (OmniKit): `query`, `sections`, `pick`, `reply`, `newThreadHint`, `pieces`, `omniCommands`. All offsets are UTF-16 units. `String.index(utf16Offset:)` and `utf16Offset(of:)` (in `SlashTypes.swift`) are the only place they become Swift indices; `AttributedString` has the same pair in `SlashMenuView.swift`.
- `SlashCommandsStore` (`@MainActor @Observable`): the list for a `CommandsSource` (`.thread(id)` or `.newThread(harness:channel:)`), fetched as `useCommands` does: cached, then `wait=1`; an older `fetchedAt` never replaces a newer list; a failure with no list is `.unavailable`. Set `source` when the new-thread picker changes.
- `SlashMenuModel`: open/closed, sections, highlight, Esc dismissal, keys, pick, `reply` (what Send does) and `hint`. It loads the list on focus and when the menu opens.
- `OmniCommands.run(action, in: thread, client:)` does `/clear`, `/new` (new thread, or `.openNewThread(preset)` when there is no prompt) and `/rename`. `/model`, `/effort` and `/fast` do nothing; offer `NewThreadPreset.otherModel(thread)`. Attachments on `/clear <prompt>` are not sent.
- Pills in user bubbles already use `SlashPiece.split` (native); a test pins it to the engine's `pieces`.

Wiring it into the composer (mac/Omni/SlashMenuDemo.swift is a working example, Debug only, `-OmniQASlashDemo YES`):

1. `let menu = SlashMenuModel(commands: SlashCommandsStore(api: client, source: .thread(id)), placement: .reply, harness: thread.harness.rawValue)`. For the new-thread composer use `placement: .newThread` and `.newThread(harness:channel:)`; update `menu.harness` and `commands.source` when the picker changes.
2. On the composer's container (the view around the text view): `.slashMenu(menu)` (`below: true` near the top of the page). It draws the menu and takes the arrows, Return, Tab and Esc while open.
3. Feed it: `menu.setFocused(focused)` and `menu.update(text:, caret:)` on every text or selection change (caret is a UTF-16 offset). Set `menu.onEdit = { text, caret in ... }` to write the picked text back and move the caret.
4. Under the text: `SlashHintView(model: menu) { open new thread on another model }`.
5. Send: `if let r = menu.reply, r.action != .send` then the button reads `r.label ?? "Send"`, is enabled by `r.armed`, and runs `OmniCommands.run(r.action, in: thread, client:)`; clear the draft after. For a plain send the button is enabled by non-empty text as before.

The overlay sits above the composer, like the Web UI's, not at the caret: `TextEditor` gives no caret rectangle. If the keys do not reach `.onKeyPress` because the text view takes them first, move the modifier's key closure to the text view's own handler and call `menu.handle(_:)`.
Wired (both composers):

- `ComposerCallbacks` got `slash` (arrows, Return, Tab from the text view's `doCommandBy`, Esc from `cancelOperation`; not while an input method composes) and `edited` (text and caret on every change, selection move and focus). `CaretRequest` sets the caret after a pick. `.slashMenu(menu)` is on the composer's shell for its overlay; its key handler never sees the keys because the AppKit text view takes them first.
- Reply box: `menu.reply` decides the Send button (`Rename`, `New thread`, ...) and Cmd-Return; `runOmni()` calls `OmniKit.OmniCommands.run` (qualified: the app has its own `OmniCommands: Commands`). `/model`, `/effort`, `/fast` show the hint with "New thread on another model".
- New thread: `.slashMenu(menu, below: true)`; `menu.commands.source` and `menu.harness` follow the pickers. `AppModel.openNewThread(preset)` puts the preset in `shell.newThreadPreset` and opens the channel; that channel's composer takes it (`NewThreadComposerModel.apply`) and opens the model list for `pickModel`.
- QA: `{"type": ...}` also focuses the box. In this environment, opening a thread with `{"route": "#/t/<id>"}` crashes the app (window constraint loop) on main too; use `{"openThread": "<id>"}` and read `-window1.png`.

## Home, Channel, Search and Go to (#68)

- Screens: `HomeScreen`, `ChannelScreen`, `SearchScreen`, `PaletteView` (⌘K overlay in `MainWindow`), `UsageCard` (sidebar footer). Shared rows and day groups in `ThreadListViews.swift`.
- Pure logic in OmniKit: `NavigationHistory` and `ShellState` (history, palette open, composer focus; `AppModel.shell`, `goBack`, `goForward`, `startNewThread`), `ThreadFilter` and `ThreadListing` (filter rules, day groups, channel list merge), `Palette` (items and ranking), `SearchHit` and `Snippet` (`<mark>` runs), `UsageMeter` (thresholds 70% warn, 90% bad).
- `AppModel.route` has a `didSet` that records history; Back and Forward set the route, which the history ignores as already current.
- `QuickComposer` is a stand-in: prompt, channel picker, send with ⌘↩. Swap it for the #65 new-thread composer in `HomeScreen` and `ChannelScreen`.
- Search opens the thread, not the match: `/api/search` returns no event id.
- Channel Settings and PRs tabs are placeholders. Go menu: Back ⌘[, Forward ⌘], Go to ⌘K.
- QA step `{"palette": "query"}` opens the palette (`false` closes). Close it before opening with a new query.

## Channel settings (#71)

- `ChannelForm` (OmniKit) holds the form, `slugify`, the validation messages and the PATCH and POST bodies. Empty text goes as `null`, so clearing a field clears it; the store domain is cut to the host; a system channel sends no `kind`. `OmniClient.createChannel`, `updateChannel`, `setChannelArchived`.
- `ChannelSettingsView.swift`: `ChannelSettingsForm` (create and edit, folder pickers for repo path and base dir, inline Archive confirm), `NewChannelScreen` (`#/new-channel`, a page as in the Web UI, not a sheet) and `MissingChannelView` (archived channel: Unarchive). The channel's Settings tab shows the form. After a save the store reloads channels.
- QA step `{"channel": "create"}` (or `edit`, `archive`, `unarchive`) runs the same client calls on channel `qa-channel`.

## Next

- No screen is built past the placeholders. `ThreadStore` and the markdown model are ready for the thread screen; see the handoff above.
- While the server is down the sidebar keeps the last channel list it had.
- The quit dialog (#74) can call `stopServer()` when `state` is `.running(startedByApp: true, _)`. Threads in their own windows are #75.
- `Route(hash:)` and `route.hash` mirror `parseHash` and `href` in the Web UI. Use them for deep links, open in browser and window restoration. PR and artifact numbers parse as `Int` only.
- New endpoints: add a method to `OmniClient`, a stub test in `ClientTests.swift` and, if the app depends on its shape, a fixture.

## Reply composer (#64)

- OmniKit: `SendRules` (steer/queue/interrupt per harness, `EscapeGate` for Esc), `Attachments.swift` (`StagedFile`, `AttachmentRules.add`: 10 files, `maxUploadMb`, empty files dropped, Web UI wording), `DraftStore` (one file per key in `~/Library/Application Support/Omni/Drafts`), `ReplyComposerModel` (text as draft, staged files, send, Open PR), `OmniClient.reply(to:prompt:mode:files:)` (JSON, or multipart with a `payload` field and `files` parts when there are files; an idle thread sends no `mode`).
- App: `ComposerTextView.swift` (AppKit text view: IME, spellcheck, undo, grows to 240pt, Cmd-Return and Shift-Cmd-Return in `performKeyEquivalent`, Esc in `cancelOperation`, file drop and paste, screenshot paste to a temp `image.png`), `ComposerView.swift` (`ReplyComposerHost` is the one line in the thread screen; split Steer button; paperclip; Open PR; toolbar Interrupt), `ThreadCommands.swift` (Thread > Interrupt, Cmd-period). If another slice adds a "Thread" menu, merge the two.
- QA steps: `{"type": "text"}` fills the reply box, `{"send": "reply"}` (or `steer`, `queue`, `interrupt`) sends it. `QARunner` also got a stub for `.expand`, which the tree did not handle (Debug build failed on it); replace it with the real one.
- Not built: the slash menu (Esc gating has a slot for it), scroll-to-bottom on send.

## New thread (#65)

- OmniKit: `NewThreadRules.swift` (`NewThreadChoice`, role/channel/model preset rules and the request body, `EffortRules`, `ModelSearch`, all mirroring `NewThreadComposer` and `ModelPicker` in the Web UI), `NewThreadComposerModel` (draft per channel in `DraftStore` under `new:<channel>` or `new:*`, staged files, send), `Client+NewThread.swift` (`createThread(_:files:)`, JSON or multipart with a `payload` field).
- App: `NewThreadView.swift`. `NewThreadComposerView(model:channelID:big:)` is the embeddable composer (`big` is Home's 96 to 360pt, else 60 to 260pt); `NewThreadScreen` wraps it. `DetailView` shows the screen for Home and a channel's Threads tab until those screens are built; when they are, embed `NewThreadComposerView` in them and drop the two branches.
- Sending opens the thread (`model.route = .thread`). Model changes reset effort to default; an effort the model does not take is never sent.
- QA: `{"type": "..."}` and `{"send": "reply"}` drive the new-thread box too (`QAComposerProbe`, which now has an `owner` so a box that leaves after its successor appeared does not clear the hooks).
- `ComposerTextView` got `heightRange` and `label`; `SendButton` a `title`; `AttachmentStrip` and `SendButton` are no longer private.
## PRs, diffs and merge (#70)

- `#/c/<id>/prs` and `#/c/<id>/prs/<n>` render `PullRequestsScreen` (list, detail), wired in `DetailView`. It has no tab bar of its own; the channel screen's tabs belong to the channel slice.
- OmniKit: `PullRequest.swift` (types, `OmniClient.pullRequests/pullRequest/merge`), `DiffParser.swift` (`parseDiff` and the open rule from `DiffViewer.tsx`: a file starts closed only when the diff has more than 12 files and the file has 200 or more changes; 1500 line cap per file). `OmniClient.send` is now internal so extensions can use it.
- Merge is a sheet with method and delete-branch. Neither button is the default one, so Return does not confirm. The body always carries `confirm: true`.
- QA without GitHub: `tests/fixtures/fake-gh.mjs` answers the `gh` calls of `server/github.ts`. Link it as `gh` in a folder first on the test server's PATH. `Fixtures/prs.json` and `pr.json` were recorded from that server.
- Debug launch args `-OmniPRTab Diff` and `-OmniPRMergeSheet YES` open a tab or the sheet, since QA scripts only pick routes.
- `QARunner` ignores the `expand` step for now (it was missing, so the Debug build did not compile).

## Thread in its own window (#75)

- `mac/Omni/ThreadWindow.swift`. `WindowGroup("Thread", id: "thread", for: String.self)` in `OmniApp`, value is the thread id. SwiftUI keeps one window per id (`openWindow(id:value:)` fronts the existing one) and restores them on relaunch.
- A thread window shows `ThreadScreen`, so it takes its store from `AppModel.threads` like the main window. The main window on a thread plus a thread window on it share one store and one stream; the last one to close stops it (`ThreadStoreRegistry`, already tested).
- Open in New Window: File menu (Option-Cmd-N, for the thread the focused window shows, off in a thread window), a toolbar button in the main window on a thread, and `.openInNewWindow(threadID)` on any view (context menu, Option-click). It is on sidebar thread rows; add it to thread rows in lists and channel pages as they land.
- `FocusedValues.shownThread` says which thread the focused window shows. Copy Thread as Markdown uses it too (`AppModel.threadMarkdown(_:)`).
- Buttons and links inside a thread window still set `model.route`, so they navigate the main window; the thread window brings it forward when it changes the route while key.
- QA: `{"openThread": "<id>"}` opens the window; snapshots write it as `<name>-window<n>.png`.
- The composer and inspector show in the thread window once #64 puts them in `ThreadScreen`.
