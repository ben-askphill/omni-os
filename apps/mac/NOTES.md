# Mac app notes

Notes from the tracer, #62 (parts A to D), for whoever builds the next screens. The app is a client of the Omni server (see docs/adr/0002-mac-app-is-a-client.md): it talks HTTP and SSE to `/api`, like the Web UI.

## Layout

- `apps/mac/Omni.xcodeproj`: hand-written, objectVersion 77, one app target `Omni`. Shared scheme `Omni`.
- `apps/mac/Omni/`: the app's sources. A synchronized folder: a file dropped in here is in the target, no project edit needed. See "The app (part D)" below.
- `apps/mac/Omni/Assets.xcassets/AppIcon.appiconset`: the app icon, all ten macOS sizes. `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` in the target's build settings.
- `apps/mac/Omni-Info.plist`: partial Info.plist, merged with the generated keys. Only ATS `NSAllowsLocalNetworking`. It sits outside `apps/mac/Omni/` so the synced folder does not copy it as a resource. `scripts/build-mac.sh` adds `OmniGitCommit` to the built app's copy, not to this file.
- `scripts/build-mac.sh`: Release build, sign, install to `~/Applications/Omni.app`, open. See "Build and install".
- `apps/mac/OmniKit/`: Swift package, linked to the app as a local package. Everything that can be tested without UI goes here.

| File in `Sources/OmniKit` | What |
| --- | --- |
| `JSON.swift` | `OmniJSON.decoder()` and `encoder()`, date parsing, `JSONValue`, `OpenEnum` |
| `Channel.swift` | `Channel`, `ChannelKind`, `ChannelWithRunning`, `ThreadStub` |
| `Folders.swift` | `Folder`, `FolderWithThreads`, `FolderRules`, `FolderEdits`, `FolderAPI`, `FolderModel` |
| `Thread.swift` | `OmniThread`, `ThreadStatus`, `ThreadSource`, `PendingMsg`, `ThreadDetail` |
| `Event.swift` | `EventRow`, `EventPayload` and its payload structs, `Artifact` |
| `Status.swift` | `Status`, `Usage`, `HarnessSlot`, `ServerInfo` (with optional `secretStore`), `DeviceInfo`, `HarnessInfo`, `ModelEntry`, `CrewRole` |
| `StreamMessage.swift` | `ThreadStreamMessage` and `FeedEvent`: one SSE `data:` message each |
| `Client.swift` | `OmniClient`, `HTTPTransport`, `OmniAPIError`, `NewThread`. `send` is internal so extensions in other files can use it |
| `Client+Secrets.swift` | `secrets()`, `setSecret(scope:name:value:)`, `deleteSecret(scope:name:)` on `OmniClient` |
| `Client+GrokBot.swift` | `sendThreadToGrokBot(threadID:)` on `OmniClient`. Posts the thread id. The server sends the text |
| `Secrets.swift` | `SecretScope`, `SecretRow`, `SecretName` (the Web UI's name rules), `SecretGroup`, `SecretScopeOption`, `SecretsModel` (the Secrets tab) |
| `SecretStore.swift` | `SecretStore` (`keychain` / `file` / `libsecret` from `packages/shared/secret-store.ts`), the label Status and Secrets show |
| `RelTime.swift` | `RelTime.label`: `relTime` in `apps/web/src/format.ts` |
| `Appearance.swift` | `Appearance`, `AppearanceSettings` (in UserDefaults, `-appearance` for a run) |
| `Zoom.swift` | `ZoomSettings`: the zoom level (80% to 160%, in UserDefaults, `-zoom` for a run), Zoom In, Zoom Out, Actual Size |
| `SettingsTab.swift` | `SettingsTab`, `Route.settingsTab`, `AppModel.show(_:)` |
| `Client+Automations.swift` | `automations()`, `runAutomation(_:)`, `setAutomationEnabled(_:_:)`, `setAutomationWebhookSecret(_:value:)`, `removeAutomationWebhookSecret(_:)`, `automationDeliveries(_:limit:before:)`, `delivery(_:)`, `retryDelivery(_:attempt:)`, `skipDelivery(_:attempt:)` on `OmniClient` |
| `Automation.swift` | `Automation`, `AutomationEvent`, `AutomationWebhook`, `AutomationRun`, `AutomationTrigger`, `AutomationBadge`, `NextRunText`, `AutomationSchedule` (`describeCron` and `nextRunLabel` in `apps/web/src/format.ts`), `TriggerDelivery` (a `DeliveryView`), `TriggerDeliveryState` (with `rank`, as `DELIVERY_RANK`) and `DeliveryPage` (`packages/shared/automation-triggers.ts`) |
| `DeliveryStages.swift` | `DeliveryStage` and `TriggerDelivery.stages`: `deliveryStages` ported. `DeliveryStagesTests` runs the cases in `packages/test-fixtures/delivery-stages.json`, which the TypeScript test shares |
| `DeliveryDetail.swift` | `TriggerDelivery.contextFields`, `webLink`, `sourceLabel`, `receivedLabel`, `expiresLabel` (`inTime`), and `merge` (`mergeDeliveries`: a late copy never takes a row back) |
| `AutomationsModel.swift` | `AutomationsModel` (the Automations page) |
| `Route.swift` | `Route`, parsed from and printed to the Web UI hash routes |
| `SSEParser.swift` | `SSEParser`, `SSEMessage`: the EventSource parsing rules, bytes in, messages out |
| `SSEClient.swift` | `SSEClient`, `SSEEvent`, `ConnectionState`, `SSETransport`, `URLSessionSSETransport`, and `feedEvents` and `threadEvents` on `OmniClient` |
| `Ticker.swift` | Internal. A `Clock` with its instant type erased, so tests can inject one |
| `WorkspaceStore.swift` | `WorkspaceStore`, `WorkspaceAPI`, `SidebarSections` |
| `LinkPreviews.swift` | `LinkPreview`, `LinkIconLayer`, `LinkPreviewAPI` (`resolveLinks`, `linkIcons` on `OmniClient`), `LinkPreviewStore` (batched asks, `AppModel.links`), `MarkdownDocument.externalURLs`. The app draws them in `LinkChips.swift`: `SelectableMarkdown` swaps a link run for the mark, id and title (`ExternalLink` in `LinkChip.tsx`) |
| `PublishedPage.swift` | `PublishedPage`: a page a thread published to claude.ai (`publishedFrom` in `packages/shared/published.ts`), `byGroup` for the transcript cards, and `checkComments(threadID:url:)` on `OmniClient` |
| `PRWatch.swift` | `PRWatch` (`PRWatchView` in `packages/shared/pr-watch.ts`), `PRWakeItem` (what a wake lists, read from the user message's `items`; drawn by `PRWakeListView.swift` in the bubble), `watchLine`, `PRWatch.copy` (the menu row, `watchCopy` in apps/web), and `prWatch`, `startPRWatch`, `stopPRWatch` on `OmniClient`. The reply box's PR menu draws it (`PRWatchMenu.swift`). Fixtures `pr-watch.json`, `pr-watch-stopped.json`, `pr-watch-none.json` |
| `Client+Thread.swift` | `ThreadAPI` (the calls `ThreadStore` makes), `artifactURL` and `uploadURL` on `OmniClient` |
| `History.swift` | `History` (the pages of a thread held, joined; `packages/shared/history.ts`), `HistorySpan`, `HistoryHead`, `HistoryPage`, `HistoryCursor` (its `query` is `historyQuery`), `HistoryEdge`, `Clipped` |
| `Client+History.swift` | `threadOpen` (`?history=recent`), `threadHistory(_:_:)` (one page) and `threadEvent(_:eventID:)` (one row whole) on `OmniClient` |
| `ToolOutput.swift` | The client half of `packages/shared/tool-output.ts` (#225): `ToolOutputMeta` (`ToolResult.output`), `OutputChunk`, `TailMessage`, `LoadedOutput` (`applyChunk`), `LiveTail` and `ToolOutput.applyTail` (capped in UTF-16 units), `ToolOutputSource`, `ToolOutputAPI`, `ToolOutputModel` (one open row's output) |
| `Client+ToolOutput.swift` | `toolOutputChunk(threadID:eventID:offset:)` and `toolTail(threadID:toolUseID:)` (an `SSEClient` that ends after `end`) on `OmniClient` |
| `ThreadStore.swift` | `ThreadStore` (one thread, live), `ThreadStoreRegistry` |
| `Transcript.swift` | `Transcript` (the Web UI's `buildItems`, incremental), `TranscriptItem`, `ToolGroup`, `ToolCall`, `Plan`, `Todo`, `TurnResult.line` |
| `RunSwitch.swift` | `Run`, `RunName`, `SwitchP`, `HandoverP`, `RunSwitch` (`switchText` and `handoverNote` from `packages/shared/run-switch.ts`, the pickers' run, `queued`, `shown`, `describe`), `SwitchRow` (a transcript switch row), `switchRun` on `OmniClient` |
| `ToolText.swift` | `ToolText`: a tool's label, one-line summary, SF Symbol and font, from `web/src/tool-summary.ts` and `Transcript.tsx`. Internal `JSONKeyOrder` |
| `StatusLine.swift` | `StatusLine.label` (`apps/web/src/status-line.ts`) and `betweenTurns` |
| `Format.swift` | `Format`: `relTime`, `clock`, `shortDate`, `duration(ms:)`, `bytes`, `plural`, `shortPath`, from `apps/web/src/format.ts` |
| `Markdown.swift` | `MarkdownDocument` and its blocks, `MarkdownText`, `MarkdownRun`, `MarkdownImage`, `MarkdownLink`. The only file that imports swift-markdown |
| `Autolink.swift` | Internal. `Autolink.pieces`: the Web UI's bare URL, email and thread id links in a run of text |
| `MarkdownCache.swift` | `MarkdownCache`: parsed markdown per event id and text |
| `ServerSettings.swift` | `ServerSettings` (port, repo path, Node override in UserDefaults), `ServerConfig` |
| `Spawn.swift` | Internal. posix_spawn in a new session (no controlling terminal, pgid is the pid), and `capture` for short commands with a timeout |
| `ServerLaunch.swift` | `ServerStartError`, `LoginShell`, `NodeResolver`, `NodeVersion`, `ServerEnvironment`, `ServerLauncher`, `ServerLaunch` |
| `ServerProcess.swift` | `ServerProcess` (spawn into the log, log tail, liveness, group stop), `SpawnedServer` |
| `ServerSupervisor.swift` | `ServerSupervisor` (the state machine), `ServerRecord` |
| `ActivityMonitor.swift` | `ActivityMonitor`: starts `prototypes/activity-monitor/sampler.mjs` (port 4791) with the app, attaches to one already answering, stops its own on quit |
| `Navigation.swift` | `SidebarItem` (a sidebar row and its route), `Route.title(channelName:)`, `Route.newThreadRoute(threadChannel:)` |
| `AppModel.swift` | `AppModel` (settings, supervisor, client and store, the route), `ServerScreen`, `StartFailure`, `State.label` and `canStart` |
| `SVGPath.swift` | `SVGPath.cgPath`: SVG path data to a `CGPath` (every command, compact numbers, packed arc flags) |
| `BrandPaths.swift` | `BrandPaths`: the Web UI's icon paths (`ui.tsx`), harness logos and wordmark (`brand.tsx`), generated from those files; `BrandPathsTests` keeps them in step |
| `ContextMeter.swift` | `ContextUsage`, `ContextView`, `ContextMeter` (the math in `packages/shared/context-meter.ts`), `ContextAPI` (`threadContext`, `compactThread` on `OmniClient`), `ContextModel` (one thread's meter and its Compact) |
| `QuickPrompt.swift` | `QuickPromptShortcut` (the fixed choices and their Carbon key code and modifiers), `QuickPromptSettings` (on, shortcut, Wispr Flow, in UserDefaults), `QuickPromptAPI`, `QuickPromptModel` (text, target channel, phase, `awaitDictation`) |
| `Handoff.swift` | `Device`, `Reachability`, `HandoffView`, `HandoffPhase`, `PrepareStep`, `HandoffBanner`, `Takeover`, `HandoffAnswer`, `DevicesAPI`, `DevicesModel` (`AppModel.devices`), and `devices`, `handOff`, `takeOver`, `cancelHandoff` on `OmniClient`. The shapes and text are `packages/shared/handoff.ts`; when to offer it, the picker and the banner follow `apps/web/src/handoff.ts`. `ClientPolicyTests` runs `packages/test-fixtures/policies/handoff.json`, which the web test shares |
| `WorktreeBase.swift` | `BasePick`, `BaseOptions`, `ThreadBaseView` (`packages/shared/worktree-base.ts`), `BaseRules` (the Base picker's rows, pill text, when it shows, what `base` is sent), `BaseOptionsModel`. `Client+WorktreeBase.swift` has `channelBases`, `threadBase`; the app draws the picker in `BasePicker.swift` and the setup card's "Branching from" line in `SetupCard.swift` |
| `ChannelActions.swift` | `ChannelAction`, `ChannelActionInput`, `SetupMode`, `ActionRun`, `ActionRunState`, `ThreadActions` (`packages/shared/channel-actions.ts`), `ChannelActions.portLabel`, a run's `summary` and `outputNote`, `keepPolling`, `ChannelActionDraft` (the settings form), and `PreparationStep` (the setup card's checkout, setup and agent steps, #211). `Client+ChannelActions.swift` has the channel CRUD and a thread's run, stop and retry. The app's `SetupCard.swift` draws the preparing card and, on a ready thread, the strip of a setup run alongside the agent; `SetupRuns` there holds each thread's actions, so the transcript asks it before drawing either |
| `Continue.swift` | Continuing an idle thread on another local harness (#221): the Carryover and preview shapes, `ContinueBody`, `ContinueError`, `ContinueLink`, `CarriedStats` (`packages/shared/continue.ts`), `ContinueRules` (`continueRefusal`, `carriedText`, the size line, the slash hint), `ContinueTargets` (the local harnesses and the run the sheet opens on), `ContinueModel` (the sheet: preview per run and per set of ticked attachments (#222: `picked`, `toggle`, `ask`), request id kept across retries, the three 409s, closing the shell a `terminal` block waits on), `CarryoverAttachment` and the `ContinueRules` attachment lines (type, size, how it arrives, why it cannot). Debug builds tick attachments by name from `-OmniContinuePick "a.png,b.txt"` for QA. `ClientPolicyTests` runs `packages/test-fixtures/policies/continue.json`, which the web test shares |
| `Client+Continue.swift` | `ContinueAPI`, and `continuePreview`, `startContinue` on `OmniClient`. A 409 comes back as `.busy`, `.changed` (with the fresh preview) or `.requestReused` through `deliver`, which reads an answer whatever its status |
| `QAScript.swift` | Debug only. `QAScript`, `QAStep`, `QACondition`, `QAFacts`, `QAServer`, `QASnapshot.looksBlank` |
| `MessageContext.swift` | `MessageContext` (a record), `MessageContextList` (a message's `context`, never fails to decode), `MessageContextKind`, `ContextReading` (`readContextsWith` in `packages/shared/message-context.ts`) |
| `BrowserAnnotationContext.swift`, `BrowserAnnotateModel.swift`, `Client+Capture.swift` | The `browser_annotation` kind (`message-context-browser.ts`: parse, label, `dragToRect`, `rectInImage`, `cleanTitle`, `BrowserCapture`, `stylesOf`, the live geometry `livePointToCapture`, `liveToCapture`, `captureToLive`), the Annotate flow's model, and `captureBrowser`, `discardCapture`, `pickElement` and `inspectElement` on `OmniClient`, `Element` (with its `Styles`), `ElementPickReply`, `InspectedElement`, `ElementInspectReply` and `CSSColor` (#216) |
| `BrowserLiveAnnotateModel.swift` | Live Annotate on the agent's browser: the hover inspector (one request at a time, the newest point next, answers from before a leave or scroll dropped), a click or drag that captures at once (taken again twice at most when the page moved), the card's Send, Add to Message, Close and Draw (`handOff`), and the capture deleted when nothing was made of it |
| `DiffSelectionContext.swift` | The `diff_selection` kind (`packages/shared/message-context-diff.ts`): body, parse with the TypeScript's errors, `select`, `clampToHunk`, `blobIds`, `range` and `sourceLine` (the web's `rangeText` and `sourceText`), and `LinePick` (a click or Shift-click on a line number) |
| `DraftContextModel.swift` | `DraftContextModel`: the records waiting in a thread's reply box (`ThreadStore.draftContext`), in `DraftStore` under `context:<thread id>` |

## Build and test

- `npm run test:mac`: `swift test --package-path apps/mac/OmniKit`. Headless.
- `npm run test:all`: `npm test`, then `test:mac`.
- The app: `xcodebuild -project apps/mac/Omni.xcodeproj -scheme Omni -configuration Debug -derivedDataPath apps/mac/.xcode build`. It lands in `apps/mac/.xcode/Build/Products/Debug/Omni.app`. `-configuration Release` builds `Release/Omni.app`, which has no QA code.
- In Xcode, open `apps/mac/Omni.xcodeproj` to run the app. Its scheme has no tests: Xcode does not offer a local package's test target to the project's schemes. For Cmd-U on OmniKit, open `apps/mac/OmniKit/Package.swift`.
- `apps/mac/.xcode`, `apps/mac/OmniKit/.build`, `apps/mac/OmniKit/.swiftpm` and `xcuserdata` are gitignored.
- OmniKit's one dependency is swift-markdown (from 0.6.0), which brings swift-cmark. Two `Package.resolved` files pin them and are committed: `apps/mac/OmniKit/Package.resolved` for `swift test`, and `apps/mac/Omni.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` for xcodebuild and Xcode. Keep their pins the same: after `swift package update` in `apps/mac/OmniKit`, copy its file over the Xcode one (or resolve in Xcode and copy back). The first build of a checkout fetches both from GitHub; later ones use the cache.
- Run `npm install --include=dev` before building the app. Its resource phase copies the pinned `mermaid/dist/mermaid.min.js` from the root `node_modules` for offline diagram rendering.
- The app target, not OmniKit, also depends on SwiftTerm (the Terminal tab), so the Xcode `Package.resolved` has a swiftterm pin that OmniKit's file lacks. That difference is deliberate; the swift-markdown and swift-cmark pins must still match. SwiftTerm is held at `upToNextMinorVersion 1.11.2`: 1.12 and later compile Metal shaders (xcodebuild fails without the Metal Toolchain component), and 1.19 and later add a build plugin that needs a trust prompt, which a headless build cannot answer.

### Golden fixtures

`apps/server/tests/mac-fixtures.test.ts` boots a real server with the fake claude CLI, makes channel `acme`, runs a thread through three turns (tool call, steer, queued message, rename, artifact) and keeps what the app reads: the JSON of each GET and the raw SSE of the thread stream and the feed. They live in `apps/mac/OmniKit/Tests/OmniKitTests/Fixtures/`.

- A normal `npm test` writes nothing. It checks the server still sends the recorded shape: the same keys and value types, per event kind and per stream message. So a server change that would break the app fails `npm test`.
- To record again after a deliberate change: `OMNI_RECORD_MAC_FIXTURES=1 npx vitest run --config apps/server/vitest.config.ts apps/server/tests/mac-fixtures.test.ts`, then `npm run test:mac` and fix the Swift types it breaks.
- Recording is stable: paths, UUIDs, times, pids, ports, the git head and durations are normalized, so recording twice gives the same files.
- `FixtureTests.swift` decodes every file, and fails if a file in the folder has no decoder in its table. Add a fixture in both places.
- Bounded history (#223): `thread-open.json` (`?history=recent`: the head page, its anchor and `history`), `thread-history.json` (the page above it), `thread-history-at.json` (the page a reveal of the first message loads), `thread-event.json` (that message whole) and `search.json` (hits with `event_id`). The server records them under `OMNI_HISTORY_BUDGET=6:8192:1024` (rows, bytes, row bytes), so a short thread still has a head, an older page, a reveal and a clipped row. `HistoryTests.joinsTheRecordedPages` joins them as the app does.
- `thread-rich.json` is a second thread, for the transcript. Its prompt has the fake CLI's `RICH` marker, which plays the calls a real turn is made of: a plan updated three times, a sub-agent (`Task`) with a nested `Grep` and `Read`, a status, a failing `Bash`, an MCP tool. Then a child's crew report, `/context` (a zero-turn result), and a turn that crashes (`FAKE_CLAUDE_CRASH_ON`), with an error and a dropped message. It is recorded last, so the other fixtures kept their UUIDs.
- Request fixtures (`secret-set-request.json`, `secret-delete-request.json`, `automation-enabled-request.json`) go the other way: the check run sends the recorded body to the server, so it must still take it, and `SecretsTests` checks the client encodes exactly that JSON.
- The secrets part runs with a `security` on PATH that stores nothing, so `npm test` never touches the Keychain.
- The automations part reads a folder of the test's own (`OMNI_AUTOMATIONS_DIR`, see `.env.example`): `daily-digest` (enabled, run once) and `broken` (a cron the server can't schedule). Toggling one writes its YAML file, so never point a test server at the repo's `automations/`.

## Conventions

- Decode with `OmniJSON.decoder()`, always. Its dates take ISO8601 with and without fractional seconds, and SQLite's `yyyy-MM-dd HH:mm:ss` as UTC.
- Field names follow the types in `apps/web/src/api.ts`, the source of truth. Every type spells out its `CodingKeys`. No `convertFromSnakeCase`: it would also rewrite tool input and dictionary keys.
- String enums from the server are `OpenEnum` structs (`ThreadStatus`, `ChannelKind`, `HarnessID`, `ThreadSource`, `SendMode`, `PendingState`): a value the app does not know still decodes and round-trips. Compare with the constants, like `.running`.
- SQLite 0/1 ints decode as `Bool`. An empty `effort` is `nil`, meaning the model's default.
- The Web UI's `Thread` is `OmniThread` here, so it does not clash with `Foundation.Thread`.
- DTOs are `Decodable` only, with no public memberwise inits. Tests build values by decoding JSON (helpers at the top of `DecodingTests.swift`).
- `EventRow` keeps the raw `payload` string and a decoded `content: EventPayload`. Unknown kinds, and known kinds whose payload changed shape, become `.unknown(kind:payload:)` instead of throwing, so a transcript never loses a row.
- `OmniClient` methods use typed throws, `throws(OmniAPIError)`. `message` is short plain text for the UI. A 2xx answer that is not JSON is `.notJSON`: an unrouted GET can get the Web UI's index.html.
- Tests: Swift Testing only. HTTP goes through `StubTransport` in `ClientTests.swift`, SSE through `ScriptedSSETransport` in `TestSupport.swift`, never the network. `LiveServerTests` is the one exception, and it only runs when asked (see below).
- Swift 6 language mode, complete strict concurrency, macOS 27.0. The app target has no default MainActor isolation; SwiftUI views are MainActor anyway.
- User-visible strings: plain and short, no em dashes, no double dashes, no emojis.
- Zoom: text sizes go through `Font.omni(size:)` and fixed sizes (icons, padding, spacing, corner radii) through `z(_:)`, both in `Omni/Zoom.swift`. They read `UIZoom.settings`, so a body that uses them redraws at a new level. AppKit views (`SelectableMarkdown`, the composer, the terminal) take `scale` from the parent's body. Window minimums stay fixed. View > Zoom In (⌘=), Zoom Out (⌘-), Actual Size (⌘0), and a picker in Settings > General.

## Decisions

- No App Sandbox, no hardened runtime. The project signs ad hoc (`CODE_SIGN_IDENTITY = "-"`, manual style); `scripts/build-mac.sh` signs the installed copy again (see below). The app talks to a local server and starts it; it is not distributed. Bundle id `com.omni-os.mac`.
- ATS: `NSAllowsLocalNetworking` only, for `http://127.0.0.1`.
- `OmniClient(host:port:)` defaults to `127.0.0.1:4747`.
- `Status.server` (`ServerInfo`) comes from the server change in #76, in the tree but not merged when this was written. It is optional in `Status`; the recorded `status.json` has it. If #76 lands with a different shape, the fixture test says so; record again. The supervisor works with and without it.

## Streams (part B)

What the server sends (see the `.sse` fixtures and `apps/server/app.ts`):

- Framing: optional `event:`, one `data:` line of compact JSON, optional `id:`, blank line. Never `retry:`.
- The thread stream opens with `event: ping`, then its catch-up (#224, `apps/server/stream-catch-up.ts`): the `EventRow`s after `after`, each with its SSE `id`, then one `sync` (`ThreadStreamMessage.sync`), the detail with no events. When those rows do not fit one page, or `after` is stale, no rows come and the sync is a snapshot: its `events` and `history` are the newest page, and its SSE `id` is that page's newest row (none when that row is at or below `after`), so the cursor moves past it. Then live messages. The `thread` and `artifact` messages carry no id. The server sends no row twice on one connection.
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
- Archived threads: a channel's Threads tab ends with a closed "Archived" list (`ArchivedThreadsSection` in ChannelScreen.swift, `OmniClient.channelThreads(_:archived:)`), each row with Restore; an archived thread's header has Restore too. `recent` holds no archived threads, so `WorkspaceStore.archiveEpoch` bumps when the feed archives a thread or shows one not in `recent` (a restore), and the channel refetches both lists on it.
- The server sends no feed event when a channel is created, edited or archived. After the app does one, `await store.reloadChannels()`. Secrets and automations are not in this store; their screens reload themselves after their own changes.
- When loads of the same part overlap, the answer to the latest one wins.
- `SidebarSections(channels)` lays out the sidebar like `Sidebar.tsx`: Conductor, then Clients, Internal and Personal (empty groups left out), then any other kind. `SidebarSections.threads(of:open:)` gives the thread links: newest first, 5 at most, the open thread kept even after it stops, and the count for "N more".
- Differences from the Web UI: the reconnect refetch is immediate and includes recent and harnesses; the Web UI debounces channels and status and lets each list reload itself. Harnesses load at start and on reconnect only, since the call is slow; the Web UI loads them in the composer.

## Thread store (#63 part A)

`ThreadStore` (`@MainActor @Observable`, one per thread id) holds what the thread screen shows, kept current like `apps/web/src/pages/Thread.tsx`:

- `start()` loads `GET /api/threads/:id?history=recent` (the newest page, #223), then opens the stream with `after=` the newest row held (`history.tailID`). A server that sends no `history` sent every row. A 404 is `.notFound` and opens no stream. A first load that fails is `.failed(error)`; `reload()` tries again and opens the stream once it works.
- `history` (`History.swift`, the client half of `packages/shared/history.ts`) holds the rows and the spans of ids held whole; a row outside every span is an anchor, which informs the transcript and never shows. `events` is `history.rows`: once each, in id order, whatever order the stream sends them in. Every change is a join, so pages that land late or twice change nothing more. `HistoryTests` replays `packages/test-fixtures/history/spans.json`.
- `loadEarlier(_:)`, `loadLater(after:)`: one page at an edge, one request per edge at a time (`loadingEdges`), a failure in `edgeErrors`. A page lays the transcript out again off the main actor, as the first load does, and bumps `pagesLaidOut`; live rows still update it in place.
- `reveal(_:)` loads the page holding an event (a search hit) and sets `revealTarget` to its row; before the first load it waits for it. `ThreadStoreRegistry.reveal(_:at:)` hands a reveal to a store, or to the next `acquire`. `showAll(_:)` reads a clipped row whole (`clipped`, `clippedResults` by call id, `showingAll`, `showAllErrors`).
- Stream messages gather for `frame` (16ms) and are applied together. A connection change applies what came before it first.
- A thread row, from the stream or a load, replaces the one shown unless it is older (`updatedAt`). `merge(_:isReply:)` does the same for the answer to Ben's own request, which also loses a tie. `pending` and `warm` (the server's `live`) change only with a row that is applied.
- Every stream open, the first too, ends its catch-up with a sync, applied in line with the rows around it. Nothing is fetched again. The row goes through the rule above with its `pending` and `live`; blocked, handoff, takeover, channel, parent, children, team and artifacts are replaced. A snapshot closes the head span into an island (`History.detachHead`) and joins the newest page as the head, so the gap between them gets its controls and older pages load as before.
- `isReconnecting` is the Web UI's Reconnecting label: loaded, and the stream is `.reconnecting`. It stays false during the first connection.
- `interrupt()` posts stop. `stopping` holds until the thread stops running, a new result comes or 15s pass; a failed stop sets `actionError`. `interrupting` also counts an "Interrupt and send" message the agent has not read.
- `workingLine` is the line under the transcript: the latest status, else "Working" when nothing came back since the last message. Only while the thread is `.running`; queued is not working yet.
- `arrivedHTML` is the newest HTML artifact that first came on the stream, which the Web UI selects when it lands. `defaultArtifact(_:)` is the one to show when the thread opens: the newest HTML page, else the newest file.
- `apply(feed:)` updates children and the parent from feed thread events. The thread's own row is left to its stream, which carries `pending` with it.
- Decoding happens off the main actor: stream messages in `SSEClient`'s reader, the snapshot in `OmniClient`, and the first transcript layout in a nonisolated function.
- `ThreadStoreRegistry` shares one store per thread id: `acquire` makes and starts it, the last `release` stops and drops it, `apply(feed:)` passes the event to every store. A store that is let go without `stop()` closes its stream in its deinit.

`Transcript` is `buildItems` from `apps/web/src/components/Transcript.tsx`:

- Items: `.user`, `.text`, `.tools(ToolGroup)`, `.plan`, `.result`, `.error`, `.report`. A group gathers the calls between two breaking rows (user, text, result, error, crew report), with sub-agent calls nested under their parent by `parent_tool_use_id`. A result can come before its call.
- Ids are stable across updates: a group is `.event(first call's event id)`, the plan is `.plan`. The live plan is one item, updated in place, placed after the group of its latest `TodoWrite`.
- `update(_:spans:)` works from the last item that can still change, so a streamed event costs the tail, not the thread. If the list does not extend the one it saw (an earlier event turned up, or the spans changed), it lays everything out again. `TranscriptTests` checks piece by piece equals all at once, over random splits of the recorded threads and random turns.
- A call nests under its parent call wherever that is, even turns back (a background agent's calls), as the web fold's `byId`; only a call whose parent is not laid out is an orphan.
- With spans (`ThreadStore` passes `history.spans`), every held row is folded, anchors too, with the web fold's three rules: a span edge closes the open group and the run of mod lines; only items keyed inside a span show (`items`); the plan shows only when its group is in the last span. The `span-floor-break` and `span-gap` corpus cases keep it in step.
- A zero-turn success result (a slash command) shows nothing and does not break the group, like the Web UI.

`ToolText.summary` needs the input's keys in the order JavaScript gives them, for the "first string field" fallback: `ToolUse.inputKeys` keeps the top level's order (integer keys first, then as sent). Nested objects are not ordered, so a nested tool input's keys can differ from the Web UI.

`Format` spells month names out (en-GB, "Sept") instead of taking them from the system, so they match the Web UI.

## Thread screen handoff (#63 part C)

For the thread screen (part C). What parts A and B leave ready and what they do not:

- Wire-up: the app has no `ThreadStoreRegistry` yet. Make one next to the `WorkspaceStore` in `AppModel`, and pass feed thread events to `registry.apply(feed:)` (the `WorkspaceStore` reads the feed; give it a hook, or read `client.feedEvents()` once and fan out). The screen calls `acquire(id)` on appear and `release(id)` on disappear; S14 (#75) reuses it across windows.
- Pass the open thread to `SidebarSections.threads(of:open:)` so it stays in the sidebar after it stops.
- Rows, from `Transcript.tsx`: `UserBubble` (the `SOURCE_LABEL` table, "Steered", "Interrupted and sent", "Not sent" for a dropped message, attachments via `uploadURL`), `ToolGroup` (a lone call is just its row, `isSingle`; else "N tool calls" with `names`, or the `latest` call's label and summary while `isLive(_:running:)`, and "N failed" from `failures`), a call row ("N sub-calls", `ToolText.label`, `summary(cwd:)`, `icon`, `isMonospaced`, `isFailed`, `isStopped`), `ToolInput` (the full input as pretty JSON, see the key order caveat above), `PlanCard` (`Plan.done`, `active`, `allDone`, `Todo.label`; a tap cycles a step pending → in progress → completed via `PATCH /api/threads/:id/plan/steps/:index`, folded as `plan_step_update`), `ResultLine` (`TurnResult.line`, `isBad`), `ReportCard` (its text is markdown, "(no reply)" when empty), the error row. Assistant text and reports go through `MarkdownCache` (see "Markdown" below).
- Under the transcript: `workingLine`, then `QueuedMessages` (`pendingLabel` in `Transcript.tsx`) from `store.pending`, with `starting: store.betweenTurns`.
- Header: `isReconnecting` shows "Reconnecting" and the status pill. While a turn runs and the reply box is empty, its send button is Stop; `interrupting` turns it into "Stopping". Esc interrupts a running thread when nothing else wants Esc.
- Artifacts are chosen per window, not in the store: start from `ThreadStore.defaultArtifact(store.artifacts)`, switch to `arrivedHTML` when it changes, list `files` and `screenshots`, load with `client.artifactURL(_:)`.
- `cwd` for summaries is the last `init` event's cwd, else `thread.cwd`, as the Web UI does.
- Errors: `.failed` and `.notFound` for the whole screen, with a retry (`reload()`); `actionError` as a note.
- The transcript should be a lazy list keyed by `TranscriptItem.id`; items are `Hashable` so rows can skip redraws.

## Thread screen (#63 part C)

`ThreadScreen.swift` (screen, header, scroll pin, pill), `MessageViews.swift` (user bubble, result, error, report and working lines), `PendingMessageViews.swift` (queued, parked and unsent-edit rows), `ToolViews.swift` (groups, calls, plan, `TranscriptUI` open state), `MarkdownView.swift`, `ThreadStyle.swift`. `#/t/<id>` opens it from the sidebar, links and QA.

- QA: `{"wait": "thread:<id>"}` waits for the laid-out transcript and notes the open time; `{"scroll": "top"|"bottom"|"through"|"nudge"}` (`nudge`: a short trackpad swipe up from the bottom, then opens the tool groups so the content grows, noting how far from the bottom the view is after each) and `{"expand": true}` (opens tool groups and failed or nested calls) work on the open thread. On a channel screen, `{"expand": true}` opens its Archived list.
- Measured on this Mac: a 2,000-event thread opens in about 65 ms; a scroll through it ran 87 frames, mean 19 ms, worst 33 ms.
- Copy: right-click a row for Copy; Edit > Copy Thread as Markdown (Shift-Cmd-C), which reads the full detail (`AppModel.threadMarkdown`) unless the store holds every row.
- History (#223): "Earlier messages" sits above the first row shown and loads by itself once it scrolls into view (`onScrollVisibilityChange`), again after each page while it stays in view. A gap left by a reveal gets Show later and Show earlier, never by itself. `ScrollPin` reacts to growth at the tail (`history.tailID`), so an earlier page never shows New activity. `.scrollTargetLayout()` alone did not hold the reading position: at the top edge the lazy stack keeps its offset and the page pushes the row down. So `holdsTopRow` keeps each row's frame (`tracksTopRow`) and, when `pagesLaidOut` changes while the view does not follow the bottom, scrolls the row that was at the top back to its height (`scrollTo(id:anchor:)` with the anchor point that puts its top there). A reveal centres its row instead and stops following the bottom. A clipped user message, reply, tool input or tool output shows `ClippedNote`; Show all calls `showAll`. The team card goes above "Earlier messages" until the thread's first row is held (`history.atStart`).
- Tool output (#225, docs/internals/thread-history.md "Tool output"): a compact `tool_result` (`ToolResult.output` set) carries only its first 1,024 characters. `ToolOutputView` reads nothing until its row opens. Then its `.task(id: ToolOutputSource)` runs `ToolOutputModel.run`: a compact result shows its preview, swaps in the first chunk and offers "Load more (N characters left)" while some is left; a call with no result in a running thread follows its tail, with "older output not shown" once anything was dropped. The result landing changes the source, which closes the tail and reads the saved output. Closing the row cancels the task and drops the model. A failed chunk keeps the preview and shows the reason with Retry. A whole result renders as before, with `ClippedNote` for an old server's clipped row. A failed call reads "error · exit N" when its text starts with an exit code. The wording matches the Web UI's `ToolOutput.tsx`. QA: `{"expand": true}` also opens compact and pending calls; a Codex thread whose prompt has `NOISY` gives a live tail, then a compact result.
- Durable sends (CONTEXT.md, Request): `ReplyComposerModel` keeps one request id per message across failed retries (`PendingRequest`, as apps/web/src/requests.ts). Messages a restart parked (`PendingMsg.isParked`, `delivery` recovered or uncertain) leave `QueuedMessagesView` for `ParkedMessagesView` in PendingMessageViews.swift: Resume (every recovered one, in order), Send again (one uncertain one) and Discard, through `OmniClient.resumeRequests` and `discardRequests`. Fixtures: `thread-recovered.json`, `requests-resumed.json`, `message-queued-request.json`.
- Unsent messages (`PendingEdits.swift`, as apps/web/src/pending-edits.ts): queued, held and parked rows (`PendingMsg.isEditable`) get up, down, Edit and Remove (`PendingRow` in PendingMessageViews.swift), and a held one on a harness that steers gets Steer now (`PendingMsg.canSteerNow`, `steerRequests`). `ThreadStore.edits` (`PendingEditsModel`) holds the open edits apart from the reply box and reconciles them with every pending list: an edit whose message was sent meanwhile, or that the server refused with a 409, turns stale and shows in `StaleEditsView` with Copy, Send as new and Dismiss. Remove is `cancelRequests` (a cancelled record, nothing in the transcript); Discard is no longer shown. Fixtures: `request-edited.json`, `requests-reordered.json`, `requests-cancelled.json`, `requests-record.json`, `error-already-sent.json`, `request-edit-request.json`.
- Crew reports (CONTEXT.md, Crew report): saved on the parent as Requests, so a report held for a stopped parent or after a restart shows in `ParkedMessagesView` (`PendingMsg.isOmnis`: no Edit or moves, Discard instead of Remove; `ParkedMessages.heading`). `PendingMsg.threadID` names the child, and `PendingMsg.reportNotes` puts where an unread report is on that child's delegation row (`DelegationCard.reports`). Fixture: `thread-report-held.json`.
- Context meter (`ContextMeterView.swift`), as `ContextMeter.tsx`: a ring before the status pill in Claude Code and Codex threads, amber from 70%, vermilion from 90%, used and window on hover. `ThreadStore.context` is the stream's latest `context` reading; `ContextModel` loads GET /context when the thread opens and each time a turn ends, the newer of the two wins. A click opens a popover with the split, tools, largest results, memory files and Compact (asks first; a focus line for Claude Code; off with the server's reason). QA step `{"meter": true}` opens it; snapshots draw an open popover over its window.
- Mods (`ModViews.swift`): a mod's `$.ui.log` lines are `.mod` transcript rows, dim with the plugin's name, consecutive lines in one row. `$.ui.status` is `WorkspaceStore.mods` (the feed's `mods` event, one per plugin per live thread), shown under the header's title and as a chip on thread list rows. `$.ui.toast` is `ThreadStore.toasts` (the stream's `mod_toast`, never stored), stacked top right for its `timeout_ms` (1.5 to 15s, 4s by default), three at most; a click dismisses one.

## Markdown (#63 part B)

`MarkdownDocument(parsing:)` reads text the way `apps/web/src/components/Markdown.tsx` shows it: react-markdown with remark-gfm, then its thread id links. Mermaid fences leave the selectable text flow and render SVG in a non-persistent WKWebView with the bundled renderer, existing theme tokens and source fallback. Other code stays selectable.

The swift-markdown parser (cmark-gfm) reads the source, smart punctuation off, and `Markdown.swift` turns its tree into plain `Sendable` values, so no swift-markdown type leaves OmniKit.

- Blocks: `.paragraph`, `.heading(level:)`, `.code(language:code:)` (the first word of the fence info; no trailing newline), `.quote`, `.list`, `.table`, `.thematicBreak`, `.html` (a raw HTML block, shown as the text it is).
- `MarkdownList`: `isOrdered`, `start`, `isLoose`, and items of blocks, so lists nest. `checked` is nil for an item that is not a task. `isLoose` is CommonMark's loose list (a blank line between items, or between two blocks of one item); the Web UI wraps each item in a `<p>` then, which spaces the list out.
- `MarkdownTable`: `alignments`, `head`, `rows`, each row padded or cut to the head's width. The alignment is in the model, but the Web UI's CSS left-aligns every cell; part C picks.
- `MarkdownText` is a list of `runs`: text with a `style` (emphasis, strong, strikethrough, code), maybe a `link`, maybe an `image` (its text is the alt text). Runs that look the same are joined. `attributed` is one `AttributedString` with `inlinePresentationIntent` and `link` set, for a SwiftUI `Text`, images as their alt text. `segments` splits it around images, for a view that loads them. `plain` is the text alone. `hasImages` is true when a run holds an image that can load: `MarkdownView` then takes that paragraph out of the shared text view and lays out its text and images in order (`MarkdownImageView`: natural size up to the column, rounded, hairline edge, click opens it or its link, alt text when it fails).
- A soft break is a space, a hard break a newline. Inline HTML is text. Link titles are dropped. No footnotes (remark-gfm has them).

Links, `MarkdownLink`:

- `#/...` is `.route(Route)`. A hash that is `Route.notFound` (`#top`) is not a link.
- http and https with a host, and mailto, are `.external(URL)`. Any other scheme (javascript, file, data, irc, xmpp) and relative paths are not links: the text shows plain. Images load from http and https only, and from a root-relative path like `/api/...` when the document is parsed with `imageBase` (the server's URL). The PR screen passes it: the server rewrites GitHub image URLs in PR bodies and comments to `/api/channels/:id/prs/:n/image` (`apps/server/github-images.ts`) so private repo files and uploads load with gh's login.
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

- `node --import tsx apps/server/index.ts` in the repo root, not `npm start` or the tsx CLI. It is one process, so the spawned pid is the server's pid in `/api/status`, and `apps/server/lock.ts` sees `node` as its name.
- Node: the Settings override if set (it must run and report 24 or later, or it is an error; there is no fallback). Otherwise the highest nvm Node 24 or later in `~/.nvm/versions/node`, then `node` on the login PATH, each checked with `node -v`.
- Environment: HOME, USER, LOGNAME, SHELL, TMPDIR and LANG from the app, PATH, `NODE_ENV=production`, `NODE_OPTIONS=--disable-warning=ExperimentalWarning`, `OMNI_PORT`. Nothing else. Keys that bill an API (`ANTHROPIC_*`, `*_API_KEY`, `*_AUTH_TOKEN`, `OPENAI_BASE_URL`) are dropped last, even from `extraEnvironment`.
- PATH: `/bin/zsh -ilc` runs a printf of `$PATH` between split markers with a random id (a shell that echoes the command can't fake them), 5s timeout, killed with its group at the timeout. The shell itself gets only the minimal environment. Nothing but PATH is read from it; Ben's zshrc exports a stale `ANTHROPIC_API_KEY`. No PATH: `~/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`. Node's own bin folder goes first.
- posix_spawn in a session of its own (`POSIX_SPAWN_SETSID`): no controlling terminal, and its pgid is its pid. With only its own group, `zsh -ilc` from an app started in a terminal took the terminal from a background group and SIGTTOU stopped it before any rc file ran, so the PATH fell back. Default signal handlers and mask, no inherited descriptors (`CLOEXEC_DEFAULT`), stdin `/dev/null`, stdout and stderr appended to `~/Library/Logs/Omni/server.log`. Each start writes an `[omni-app] <date> starting <command> in <dir>` line first; the tail is read from after it. Over 10MB the log moves to `server.log.1` at the next start.
- Nothing ties the server to the app: it keeps running when the app quits. It is never a LaunchAgent or login item.
- The record, `~/Library/Application Support/Omni/server.json`: `{pid, pgid, port, startedAt, repo}`. A later launch counts a server as started by the app when the record is for this port, its pid still runs in that group and started within 5s of `startedAt` (so a reused pid does not pass), and the answering server's pid is that pid (or it gives none). A record whose process is gone is removed at the next check.
- Before the start: `ServerStartError` for no `apps/server/index.ts` in the repo, no `node_modules/tsx`, no usable Node.

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
export OMNI_TOKEN=$(openssl rand -hex 32)
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$T" OMNI_TOKEN="$OMNI_TOKEN" OMNI_DATA_DIR="$T/data" OMNI_PORT=4791 OMNI_HOST=127.0.0.1 \
  OMNI_CLAUDE_BIN="$PWD/tests/fixtures/fake-claude.mjs" OMNI_CODEX_BIN="$T/none" OMNI_CURSOR_BIN="$T/none" \
  OMNI_BROWSER=0 OMNI_BRAIN_DIR="$T/brain" OMNI_WEB_DIST="$T/none" \
  node --disable-warning=ExperimentalWarning --import tsx apps/server/index.ts
OMNI_LIVE_PORT=4791 swift test --package-path apps/mac/OmniKit --filter LiveServerTests
```

The live tests send `OMNI_TOKEN` as the API token, so run them in the shell that exported it.

`LiveSecretsTests` saves and deletes a secret through `SecretsModel`, so it also needs `OMNI_LIVE_SECRETS=1`, and the server a `security` that stores nothing first on PATH, so it never writes to the Keychain: `mkdir "$T/bin"; printf '#!/bin/sh\n[ "$1" = "-i" ] && cat > /dev/null\nexit 0\n' > "$T/bin/security"; chmod +x "$T/bin/security"`, then boot with `PATH="$T/bin:$PATH"`.


## The app (part D)

`apps/mac/Omni/` holds the app target. Everything testable lives in OmniKit; these files are views and glue.

| File in `apps/mac/Omni` | What |
| --- | --- |
| `OmniApp.swift` | `@main`. One `Window("Omni", id: "main")`, the `Settings` scene, the menus. `AppDelegate` owns the one `AppModel`, calls `launch()`, and `didBecomeActive()` on activation. Closing the window quits the app; the server keeps running. |
| `MainWindow.swift` | `NavigationSplitView` of the sidebar and the detail, the toolbar, `RoutePlaceholder`, `Route.symbol` |
| `SidebarView.swift` | The sidebar, `ThreadRow`, `ThreadStatusIcon`, `StatusFooter` |
| `SidebarFolders.swift` | Folder rows, the inline name field, folder and Move to Folder menus, drops, the delete confirm |
| `ServerView.swift` | The server screen, `ServerDetails`, `LogTail`, `ServerMenuItems`, `confirmStop` |
| `SettingsView.swift` | The Settings tabs (`model.settingsTab`), the Connection pane, `PathField`, the folder and file pickers |
| `SecretsSettingsView.swift` | The Secrets tab: `SecretsSettings` (a `SecretsModel` per client and visit), `SecretsForm`, `SecretRowView` |
| `AppearanceSettingsView.swift` | The Appearance tab, `Appearance.nsAppearance` |
| `NotificationSettingsView.swift` | The Notifications tab: this Mac's switch, the macOS permission, a switch per channel |
| `AutomationsView.swift` | The Automations page: `AutomationsView` (an `AutomationsModel` per client and visit), `AutomationSection`, `RunStrip`, `RunRow`, `FlowRow` |
| `DeliveryViews.swift` | An automation's Deliveries: `DeliveryList`, its rows, the open detail and Retry |
| `DeliveryStagesView.swift` | `DeliveryStagesView`: the Trigger, Run and Execution lines of a delivery |
| `SystemEvents.swift` | Wake (`NSWorkspace.didWakeNotification`) to `didWake()`, `NWPathMonitor` changes (not the first update) to `networkChanged()`. Both also `POST /api/sync/now`, ignoring a 409 (sync off) or 502 |
| `SystemNotifications.swift` | UserNotifications for `AttentionCenter`: posts, withdraws, opens the thread on a click |
| `LayerAnimations.swift` | `LayerAnimation`: animations that run while something works (the Loader with a `color`, the running dot's ping, the active plan step's pulse), drawn once into layers and moved by Core Animation. A repeating SwiftUI animation redraws the whole window every frame: four running threads kept the app at about 40 to 55% CPU, 1% after |
| `QARunner.swift` | Debug only. The QA harness, below |
| `QAWindowRender.swift`, `QALivePage.swift` | Debug only. The harness's window rendering (`extension QARunner`) and the live-page event helper with `FrameClock` |
| `HistoryEdgeRow.swift` | "Earlier messages" and a gap's Show later and Show earlier (`HistoryEdgeRow`), `ClippedNote` ("Trimmed for loading · Show all"), the `threadStore` environment value |
| `TranscriptAnchor.swift` | `holdsTopRow`: puts the row Ben reads back in place when a page lands above it, and scrolls a reveal to its row. `TopRows`, `tracksTopRow` |
| `ToolOutputView.swift` | The output under an open tool row (#225) and the `toolOutputAPI` environment value. See "Thread screen" |

`AppModel` (OmniKit) is the app's one connection to Omni: `ServerSettings`, the `ServerSupervisor`, an `OmniClient` and `WorkspaceStore` for the port in the settings, and `route`. `launch()` opens the feed, checks the server, and follows the settings with `Observations`: a port change swaps the client and store, any change checks the server again. The feed dropping or opening checks the server again too, so the window follows a server killed or started somewhere else. A failed start stays on screen (`startFailure`) until the server runs, Start is pressed again or the settings change.

Main window:

- The sidebar matches `Sidebar.tsx`: Home, Conductor, the channels by kind (Clients, Internal, Personal, then others), Add channel, and Workspace (Artifacts, Automations, Secrets). A channel's badge is its running count, hidden at 0. Under each channel, its active threads from `SidebarSections.threads(of:)`, with the Loader (running) or the status glyph, and "N more", which opens the channel. A thread's running sub-agents (`store.tasks`, keyed by `hostID`: the thread, or a team member's lead) nest under it on a tree line, and keep it listed past the limit and after its turn ends; there is no separate Agents section. Conductor handoffs (`parent_id` / `source`) nest the same way under their parent in Running and the channel list (`ThreadHandoffs` on web; Mac uses `WorkspaceStore` children). It all comes from the store, so counts and threads move with the feed.
- Collapse all: the button right of the wordmark (as `Sidebar.tsx`) closes every channel and every open folder (saved on the server through `FolderModel.collapseAll`) while any channel is open; once all are closed it reads Expand all and opens the channels, leaving the folders closed. `SidebarSections.collapsesAll` decides which, as `foldAllAction` in `apps/web/src/sidebar-fold.ts`. The channel state is the same `sidebar.collapsedChannels` a single channel's click saves. A closed channel still shows the open thread.
- Folders (#177 on the web): under each channel, its folders (`SidebarSections.folders(of:open:)`, manual order then name), then the ungrouped threads. A folder row has the chevron (collapsed is saved on the server), name, count and a Loader while a thread in it runs; an open folder shows 8 threads then "N more", a closed one still shows the open thread, an empty one "No threads yet". The folder-plus on a channel row (on hover, and in its right-click menu) makes "New folder" in an inline field: Return saves, Escape leaves nothing. A folder's right-click and "..." menu: New Thread Here (the new-thread composer with a folder chip), Rename (also double-click or F2), Duplicate, Delete (a confirm that says the threads go back to ungrouped). A thread's right-click has Move to Folder. Drag a thread onto a folder to file it, onto the channel name to ungroup it; drag a folder onto another to put it just above. `FolderModel` makes every edit at once and puts the list back with an alert when the server refuses. Edits from the web or the conductor arrive through the feed's `channel` event, like any channel change.
- Pinned (as the web's Pinned section): under Conductor, above the channels, the threads Ben pinned from any channel, the latest pin first (`store.pinned`, `GET /api/pinned`, loaded with the channels). A row is the status, title and channel name; on hover the name gives way to a pin that unpins. Pin or unpin from a thread's right-click (Pin thread, Unpin thread) and the pin button in the thread header (`AppModel.setThreadPinned`, shown at once, put back by the next load if the server refuses). The section folds on its own (`sidebar.pinnedCollapsed`), apart from the channels, and is hidden when nothing is pinned. A pinned thread still shows under its channel, and the thumb stays there; the pinned copy reads bold. Archiving unpins.
- Running (as the web's): Running sits above Pinned and lists every thread at work in any channel, newest first (`SidebarSections.running`: each channel's `active` list, which is its running and queued threads plus any whose sub-agents still run). It is hidden when nothing runs and moves with the feed like the channel badges. It uses Pinned's caption and row without the unpin pin, folds on its own (`sidebar.runningCollapsed`), and leaves the thread under its channel as well. The sidebar has no Recent threads section (#396); Home and Cmd-K list the latest threads. `SidebarSections.recent` stays in OmniKit, matching the phone web's Activity list.
- The channel's Threads tab groups its threads by the same folders (`ThreadListing.byFolder`, as `groupByFolder` in `apps/web/src/folder-groups.ts`) once the channel has any: each folder in the sidebar's order with its count, empty ones too, then "No folder". A thread sits where the sidebar shows it (`SidebarSections.folder(of:in:)`). A header opens and closes the folder with the sidebar's saved state, right-click is the folder's menu, and a thread dropped on it files there (on "No folder", ungroups). Rows have Move to Folder. Without folders the tab keeps its day groups.
- The selection is `SidebarItem(route: model.route)`; picking a row sets `model.route`. Routes without a row (search) select nothing. Settings is the exception: `Route.settings(tab)` opens the Settings window on that tab (`model.show`) and the main window stays where it was. Any other write of a settings route (`#/settings/secrets` from a script, or the old `#/secrets`, `#/sync` and `#/storage`, which parse to the tab that holds them now) does the same (`MainWindow`'s `onChange`), going back to the route last drawn. The sidebar's Workspace group is Artifacts, Automations and Settings, as on the web.
- An error note under Home when the channel list fails to load while the server runs. With no server, the server screen says so instead.
- Under the usage card, the footer: a dot (volt running, grey while the feed retries, vermilion not running or failed), `State.label` ("Started by the app", "Started outside the app", "Not running"), then `"<device name> · Port N"` from `Status.device` (#372) and "Reconnecting". It opens the Server menu.
- The detail is the server screen while `model.serverScreen` is set, else the screen for the route. Automations has its screen (below). Unknown routes show "Nothing here" and Go Home.
- The title follows the route (`#acme` on a channel), "Omni" while the server screen shows.
- Toolbar (transparent, no title): the sidebar toggle, back and forward, "Reconnecting" while the feed retries, Open in New Window on a thread. The Activity Monitor button (chart icon) opens the monitor's dashboard in the browser, or starts the monitor first when it is not running; Server > Open Activity Monitor does the same. The monitor starts in `AppModel.launch()` and, unlike the Omni server, stops in `prepareToQuit`. New thread and search are in the sidebar, as on the web. Menus: File > New Thread (Cmd-N, in place of New Window), a Server menu (Check Again is Cmd-R), View > Hide Sidebar (Ctrl-Cmd-S, `SidebarToggleCommand`).
- The look is the Web UI's, not the stock macOS one: the design system's tokens (`apps/web/src/index.css`) are `Tok` in `Theme.swift`, with its pill buttons, `SegmentedPill`, fields, chips and card shadows. `Brand.swift` draws the web's icons, wordmark, mark, Loader and harness logos from `BrandPaths`. Give a Loader that can stay on screen a `color` (see `LayerAnimations.swift`); one without takes the foreground style, for a button's brief busy state. The window is a white canvas with a custom sidebar (not a `List`), 252pt by default and 200 to 420pt by dragging its right edge (`SidebarResizeHandle`, saved as `sidebar.width`; double-click resets), as the web's `SidebarPane`, and the screen in a card inset 8pt, as the web's pane, its corners concentric with the window's (`ConcentricRectangle`, 8pt at least; the web uses 22px). Status is the only color: ultramarine running, vermilion needs you, volt done; vermilion is never text.

Server screen (`ServerScreen`):

- Looking, starting, stopping: a spinner and a line.
- Not running: Start Server, Check Again and Settings, with the port, repo and Node it would use.
- Failed: the message, the last lines of the log (as tall as the lines, scrolling from the bottom past 220 points), Try Again, Open Log (NSWorkspace, when the log exists), Stop Server when there is a process to stop, Check Again and Settings.
- Stop always asks first: running threads stop with the server.
- "Reconnecting" shows next to Not running: the feed keeps trying, which is how a server started in a terminal is found. That is on purpose (see `AppModelTests`).

Settings (#404): four tabs, General, Workspace, Machines and Secrets (`SettingsTab`), the same four sections in the same order as the web's Settings nav and the phone's Settings list. ⌘, and the sidebar's Settings row both open General (`AppModel.settingsTab`). `SettingsTab(named:)` still takes the eight old tab names (server, profile, sync, storage, notifications, appearance, quickPrompt, and connection) for QA scripts, mapping each to the tab that holds that page now. General: `ProfileSettings(part: .general)` (You, Save, Run setup again), then the Appearance, Notifications and Quick Prompt cards that were tabs. Workspace: `ProfileSettings(part: .workspace)` (folders, GitHub owner, integrations); each part PUTs only its own fields. Machines (`MachinesSettingsPage`, was the Server tab): three cards, then Sync and Storage under `SettingsPart` headings. Run new threads on: the default machine for new threads (`RunOnModel` on `AppModel.runOn`, user config `runOn.device` through GET and PUT /api/setup, saved on pick), with `RunOnMenu` listing This Mac and the other synced machines from `DevicesModel`, an offline one not pickable. With no other machine the pill is disabled and a line says so, unless a saved machine has dropped out of sync: then This Mac stays pickable. This Mac's server: Port, Repo (a field and a folder picker), Node (a field and a file picker; empty finds Node itself). The port and paths apply on Return, when the field loses focus or when Settings closes (closing a window does not end editing), and the paths on a pick too. Never per key: typing 4759 does not try 4, 47 and 475. A number that is not a port puts the current one back. A blank Repo is `~/omni-os` (`effectiveRepoPath`), in `config` and on the server screen. Everything applies at once, no relaunch. With launch arguments set, a note says changes last until the app quits. Then the Status card: the server state, the feed, Open Log, and Build (the `OmniGitCommit` stamp) in an installed build.

Settings, General's You part (was the Profile tab), like the web's Settings, General (`Settings.tsx`): the name Omni calls you by (`Status.profile`, `PUT /api/profile`), saved on Return or Save, then the store refreshes so the greeting follows. First run: `OnboardingSupport` on the main window shows `OnboardingSheet` while the status has a profile with no name (as `Onboarding.tsx`); Skip or closing it hides it on this Mac (`onboarding.skipped` in UserDefaults). The sidebar's Settings item and `#/settings` open this tab.

Settings, Machines, Storage (#213, #214; a tab of its own before #404), like the web's Settings, Machines, Storage: the inventory of `data/worktrees` from `GET /api/worktrees/scan`, and its cleanup (`WorktreeInventory.swift`, `WorktreeCleanup.swift`, `Client+Worktrees.swift`, `StorageSettingsView.swift`). Nothing scans until Scan is pressed; `WorktreeInventoryModel` polls every second while a scan or a cleanup run (manual or retention) runs and stops on Cancel, when both leave running, and when the tab closes. Folders group as Eligible, Kept and Unknown with the server's reasons, one per line; stale registrations (git lists them, the folder is gone) sit apart, since pruning them frees no space. Clean Up opens a Review sheet of the server's manual preview, kept as it was when the sheet opened, and Remove posts exactly those ids; a 409 shows in the card that asked (`WorktreeInventoryModel.ActionError`). Retention on This Mac sends only the field that changed (`PUT /api/worktrees/retention`), so the toggle and the After picker never write back each other's stale value. QA: `{"settings": "machines"}` (`"storage"` still works). The Settings window's tab bodies snapshot blank on macOS 27 (Connection too), so check this tab with a throwaway window that hosts `StorageSettings`.

Settings, Secrets tab (#72), like `Secrets.tsx` (the web's Settings, Secrets):

- The secret-store note (which store this server uses, from `Status.server.secretStore`), then Add or replace: Scope (Global, then `#name` per channel), Name (upper-cased and `_` for anything else as it is typed, per UTF-16 unit like the Web UI), Value (a `SecureField`). "Save secret", or "Replace secret" with the hint when the name exists in that scope. The Web UI's messages for a bad name, no value and a value with a line break, checked before sending; the server's own error shows the same way. After a save: "Saved NAME (#Acme)" or "Updated ...", name and value cleared, the list loads again.
- The list: Global first, then the channel scopes, each with its count; a row is the name, `RelTime` (the ISO time as a tooltip) and a trash button. Delete asks first (a confirmation dialog, not the Web UI's 5 second undo); a failure shows on the row. Loading, "No secrets yet", and the load error with Retry.
- The value: only in `SecretsModel.value` while typed and sent, in the POST body, and nowhere else. No UserDefaults, file or log. It is cleared after a save that succeeds and when the tab or Settings closes (`clearValue()`); a refused save keeps it so it can be sent again. A Swift `String` can't be wiped in memory, so "cleared" means the model drops it. `SecretsModelTests.holdsNoValueAfterSave` walks the model's stored properties and UserDefaults for it.
- The list loads when the tab shows, for a new port, and when the feed opens again.

Settings, General, Appearance card (a tab before #404): Match system, Light, Dark (radio buttons) and the zoom picker, saved as `appearance` in UserDefaults. `AppDelegate` applies it in `applicationWillFinishLaunching`, before any window, and on every change in the same call (`AppearanceSettings.follow` sets `NSApp.appearance`), so every window follows at once. `-appearance dark` sets it for one run and saves nothing, with a note in the tab.

Quick Prompt (`QuickPrompt.swift`, `QuickPromptSettingsView.swift` in the app): a system-wide shortcut (Ctrl-Option-Space by default) opens a floating panel over whatever app is in front, starts Wispr Flow hands-free in it, and starts a Conductor thread with what was said or typed. The Web UI has no counterpart: a browser tab cannot take a shortcut while it is in the background.

- The shortcut is Carbon's `RegisterEventHotKey` (`GlobalHotKey`), which needs no Accessibility permission. The choices are fixed (`QuickPromptShortcut`), all Space with modifiers macOS does not keep for itself. When another app holds the keys, registering fails and the tab says so.
- The panel is an `NSPanel` with `.nonactivatingPanel`, like Spotlight: it takes typing while the app you were in stays active, and Omni's windows stay behind. It opens on the screen under the pointer, grows downward with the text (`setContentSize` keeps the top edge), and keeps an unsent draft between opens.
- Wispr Flow pastes into the focused field, so the field takes focus before `WisprFlow.setListening(true)`, one runloop turn later, as the composer's mic does. Flow pastes a moment after it stops, so Return while it listens stops it and `QuickPromptModel.awaitDictation` waits for the text to change and settle (600ms quiet, 5s at most) before sending. The shortcut again while it listens stops Flow; otherwise it closes the panel. Esc closes.
- A send is `POST /api/threads` with `channel: conductor`, `role: conductor` and `source: capture` (typed by Ben outside Omni, as claude-bar's captures). The header's menu sends this one prompt to another channel instead, with no role. Return sends and closes after a moment; Cmd-Return (or Open) sends and opens the thread in the main window, reopening it if every window was closed (`QuickPromptController.openMain`, captured by `MainWindow`). A failed send keeps the text and shows the reason.
- With the Quick Prompt on, closing the last window no longer quits the app (`applicationShouldTerminateAfterLastWindowClosed`). Settings, General, Quick Prompt cards: the switch, the shortcut, Wispr Flow, Try It, and Open Omni at login (`SMAppService.mainApp`). File > Quick Prompt opens it too.
- A QA run never registers the shortcut, so it can't take it from the real app. `{"quickPrompt": "text"}` opens the panel with that text and Flow off, `{"quickPrompt": {"send": true}}` sends, `false` closes. Snapshots include the panel as `<name>-window<n>.png`.

Automations page (#73), like `Automations.tsx`. The Web UI has no create or edit: an automation is a YAML file in `automations/` that the server reads again on save. So the app has neither; the empty state says where the files go.

- One grouped section per automation, in the server's order. The head: a bolt, the name, a Paused or Invalid badge, then chips for the schedule in words (`AutomationSchedule.describe`, the cron and time zone as a tooltip), the cron, the channel (opens it), the role and the model. "Next run Tomorrow 08:00" only while enabled, valid and scheduled, in the automation's time zone, with the zone named when it is not the Mac's. Then Run now and the switch.
- `describe` and `nextRunLabel` are ports, down to the quirks: `61 8 * * *` reads "Every day at 08:61", Tomorrow is the day 24 hours from now, and months are Node's en-GB short names ("Sept"). The test cases were run through `apps/web/src/format.ts` in Node.
- An invalid automation shows the server's error and "Fix it in <file>" (`shortPath`), and its Run now and switch are off, as in the Web UI.
- Run now opens the new thread. The switch shows its new value at once, turns back with the server's error if it refuses, and loads the list again when it takes it. Errors show on the automation until its next action.
- Prompt is a disclosure group. Last runs: the strip (oldest left, finished runs full height, colors of `RUN_TONE`, the running one pulses, "done · 5m ago" tooltips), then a row per run: the status dot (a ring for queued), the title or "Thread removed", "manual", `RelTime`. A row with a thread opens it.
- A `github_webhook` automation (#227) shows its repo, events and " · anyone" for `trust: any` in the second chip, then a panel: the endpoint path (selectable, with Copy), whether this Mac holds the signing secret (a warning when not) and "Set secret…" or "Replace secret…", which opens a sheet with a SecureField. Save sends the value with PUT `/api/automations/:id/webhook-secret` and reloads; Remove asks first, then DELETEs it. The server sends the secret's store account name and `secret_set`, never the value, and the app never keeps it past the sheet.
- Deliveries (#228): a row is a chevron, the state chip, the summary with its reason or why it waits, a dot for the thread (grey once it is removed) and the time. A click opens the detail under it: the three stages (`DeliveryStagesView`), when it came, the attempt past the first, when its age limit skips it, the source and its id, the context fields by key (a web link is a link, anything else text) and the actions. Retry sits on the collapsed row of a failed one that can go again; Skip asks first. The server decides what can be done (`can_retry`, `can_skip`, `retry_blocked`) and the app only shows it. Each action sends the attempt the row showed and takes the answer back into the row; a refusal (409) shows the server's reason and fetches the row with GET /api/deliveries/:id, since `OmniClient` keeps only the message of a failed call. `AutomationsModel` holds the open rows and the rows each automation shows (the latest five of every load merged by id with history from Show older), so a reload keeps both. Context fields are by key because Foundation's decoder keeps no key order.
- It loads when it shows and for a new port. The Web UI reloads a second after a feed event for an automation's thread; the screen subscribes to the feed and hands each message to `AutomationsModel.feed`. It also reloads a second after the feed opens again. Refresh in the toolbar, a spinner there while a reload runs.
## Thread inspector (#67)

The thread screen adds `.threadInspector(model:store:)`, a trailing panel that docks beside the thread until the thread reaches 560pt wide, then overlaps it as the panel grows. It reaches 80% of the center pane, including in a separate thread window; its 340pt minimum gives way to that cap in very narrow panes. Dimensions follow UI zoom. The shared `SidebarResizeHandle` resizes it, with double-click to reset to 360pt and accessibility increment/decrement actions. Width and open state are saved as `threadInspector.width` and `threadInspector.open`. Toggle it in the toolbar or View > Show Inspector (Opt-Cmd-I, with the artifact count).

- OmniKit, all pure: `InspectorSelection` (initial pick: `?artifact`, else newest HTML, else newest file, else Details; `arrived` selects a new HTML even the first), `RequestPolicy` (blocks loopback, 100.64.0.0/10, `.ts.net` and the Omni port; `ruleListJSON` is the same policy as a WebKit content rule list, a test keeps them equal), `CSV`, `ThreadDetails` (resume command, MCP list, dates), `ArtifactRef` (Codable, the value of the artifact window) and `OmniClient.artifactData`.
- `apps/mac/Omni`: `InspectorView` (modifier, panel, Artifacts tab), `InspectorTabs` (Browser, Web, Details), `LiveBrowserView` (the live channel browser in a Chrome-like frame: `BrowserTabStrip` with favicons, toolbar with a centred address (host dark, path grey), loading bar, and `BrowserCanvas`, an NSView that decodes frames off the main thread into a layer and sends mouse, scroll, keys and Chrome's Cmd shortcuts; the view reports its size so the page lays out to fit; model in OmniKit's `ChannelBrowser.swift`, which batches input and merges moves and scrolls), `ArtifactViews` (viewer, native PDF/image/CSV/JSON/markdown/text, save panel, `ArtifactWindowView`), `ImageZoom` (an image preview's zoom, as `ImageZoom.tsx`: fit to the pane's width by default, click, pinch or Cmd-scroll to zoom up to 800%, drag to pan, Esc to fit, and the header's minus, level, plus and Fit; an `NSScrollView` with magnification does the zooming), `ArtifactWebView` (HTML and SVG).
- Web tab (`NativeBrowserModel.swift`, `NativeBrowserView.swift`, OmniKit `NativeBrowser.swift`): Ben's own browser, its own inspector tab (`InspectorSelection.Tab.web`, globe icon) beside the agent's Browser tab. #351 put the same browser behind a "My browser" / "Agent's browser" switch inside the Browser tab, which Ben did not want. Both tabs draw `BrowserChrome.swift` (tab strip, toolbar with the #363 address bar, loading rule). A `WKWebView` per tab, popups as tabs, downloads to ~/Downloads (only from the top frame, and only after an alert naming the file and site, since a script can start one), JS dialogs, the file picker; `mailto:` and `tel:` open another app only on a click in the top frame. State: one model per channel for the app's run (`NativeBrowsers`), so switching threads or tabs keeps the pages; the open addresses are saved per channel in UserDefaults (`nativeBrowser.tabs.<channel>`) and reopen next launch; cookies and logins are the app's default `WKWebsiteDataStore`, shared by every channel and kept across launches (artifact, thumbnail and Mermaid web views are non-persistent, so they never see them). A web view lives in one window: the Web tab that appears last claims it, and another window showing the same channel's Web tab says so with Show here. A new HTML artifact leaves the Web tab open, as it does Terminal. The agent drives the server Chrome through the omni-browser MCP and cannot see this one. Annotate is live here too (see Live Annotate below), reading the page in the web view itself. Web and phone have no Web tab: a web page cannot embed a native web view.
- Annotate (#215, as `browser-annotation.tsx` and `LiveBrowser.tsx` on the web): the Browser tab's Annotate button (disabled unless the browser runs a web page) asks the server for a capture (`OmniClient.captureBrowser`, OmniKit's `Client+Capture.swift`), which screenshots the channel's own Chrome and answers a retryable "stale" result when the page navigated, switched tab, resized or scrolled meanwhile. `BrowserAnnotateModel` (OmniKit) holds the flow: the screenshot replaces the live page in the view (`BrowserAnnotateLayer`, which takes no input from the page and never navigates it), Ben drags a rectangle (`BrowserAnnotationContext.dragToRect`, page pixels), writes a note and Add to Message puts a `browser_annotation` (`BrowserAnnotationContext`, the port of `message-context-browser.ts`) on `store.draftContext`. Cancel deletes the screenshot. `BrowserAnnotationView` is the chip's detail: the screenshot from the thread's uploads (`omniClient` environment), the area outlined, the page and viewport; a screenshot that is not on this Mac (a synced thread) says so and keeps the rest. Unlike the web's terminal and diff panels, the Mac reply box takes no focus after an add.
- Live Annotate (`BrowserLiveAnnotateLayer.swift`, OmniKit `BrowserLiveAnnotateModel`, as `LiveBrowser.tsx` on the web): on the Browser tab, Annotate is a toggle, and the page stays live under it. `BrowserCanvas` takes a `LiveInput` while it is on: moves still go to the page and also hover (`inspectElement`, `POST .../browser/inspect`), a press that moves under 3 points picks, a drag draws a band, scrolling goes to the page and asks again, Escape clears the card and then turns it off, and Option makes the overlay step aside (clicks go to the page without Alt). A pick or drag captures at once, maps the point or rectangle into the capture with the frame's scroll (`BrowserFrame.scrollX`/`scrollY`), and docks a card at the bottom in place of the hint: the crop, `PickedElementView` (now with the element's computed styles) or the area, a note, Draw (the screenshot editor, `BrowserAnnotateModel.open`, on this capture), Add to Message and Send. Send is the reply box's call (`reply`, `SendRules.mode`, `store.merge`, built in `InspectorView`): the note is the text and the record goes without one. The outline follows the page's scroll (`captureToLive`) and goes when the page navigates. Both tabs draw the same layer and card from the same model; what they share of the input is `LiveAnnotateInput` (with `.driving(_:pointer:frame:)` and `LivePointer`) and OmniKit's `LiveAnnotateGesture` (press, band, Option, Escape).
- Live Annotate in the Web tab (`NativeBrowserView.swift`, `NativeBrowserModel.liveModel`): the same model and layer, fed from the web view. `LiveInputView` sits over the web view while it is on: it forwards moves to the page and hovers, takes presses through `LiveAnnotateGesture`, passes an Option-click to the page without Option, lets scrolling, right clicks and other buttons reach the page by hit testing, and keeps the keys with the page except Escape (a local key monitor while the page has them). Zoom is reset to 100% when it turns on, since one point is one CSS pixel. Hover and pick read the page with OmniKit's `BrowserPickEngine`: the page scripts and readers from `packages/shared/browser-pick-script.ts` and `browser-pick-read.ts` (the server's own, bundled to `Resources/browser-pick.js` by `npm run build:pick`; `apps/mac/tests/browser-pick-bundle.test.ts` fails when it is stale). The scripts run in the `omni-pick` content world, the readers in JavaScriptCore, so nothing goes through the server but the capture (`captureNative`). A pick is answered only while the page still matches the capture, before and after it is asked. `ScrollRelay`, a user script in the same world, reports the page's scroll (and any box scrolling in it) so the outline follows. A frame from another site is opaque here as in Chrome. `packages/test-fixtures/browser-pick.json` holds page answers and the replies they must give, read by the shared vitest and by `BrowserPickEngineTests`.
- Picked elements (#216, `PickedElementView.swift`, `picked-element.tsx` on the web): a tap on the screenshot (a press that moves under 3 points) calls `BrowserAnnotateModel.tap`, which asks `pickElement` what is there and marks its box; a drag clears it. The QA step is `{"annotate": {"tap": [x, y], "note": "..."}}`, in fractions of the shown screenshot. See [Message context](../../docs/internals/message-context.md#picked-elements).
- Marks (`BrowserMarks.swift`, `BrowserMarkToolbar.tsx` and `browser-marks-canvas.ts` on the web): the toolbar over the screenshot (select, pen, a shapes popover, text, color, line width, undo, delete) draws `BrowserMarks.Mark`s through the model (`drawShape`, `drawStroke`, `drawText`, `grab`/`moveGrabbed`, `undo`); the layer paints them with `BrowserMarks.draw` in a `Canvas`, the same call `render` uses to burn them into the screenshot. `add(to:)` is async: with marks it renders, uploads (`Client.uploadMarkedScreenshot`) and only then makes the record. Geometry is checked against the TypeScript through the corpus `marks` cases (`BrowserMarksTests`).
- Thread references (#218, `ThreadReferenceView.swift`, `ThreadReferencePickerView.swift`, OmniKit `ThreadReferenceContext` and `ThreadReferencePicker`, `thread-reference.tsx` and `ThreadReference.tsx` on the web): a speech bubble button in the thread header (after the context meter) opens a popover under it, anchored to a strip as wide as the list that ends at the button so it opens inside the window. In a narrow thread window the strip shrinks with the button's room from the left edge (#343), so the list's left edge stays inside the window instead of hanging past it. The reply box's branch button, `ForkButton` in `ContinueViews.swift`, opens `ContinueSheet` as Fork thread. QA steps: `{"referenceThread": "open"}` (or `close`, `all`, `channel`, `{"search": "text"}`, `{"pick": 0}`). `TerminalExcerptContext.validTime` compares to the second, since a `Date` cannot hold most milliseconds exactly and a body made at the current time failed to read back. See [Message context](../../docs/internals/message-context.md#thread-references).
- The web view: non-persistent data store, page served by the `omni-artifact` scheme (only its own artifact), rule list on, no script message handlers, links and window.open go to the default browser (http, https, mailto, never a blocked host). The window scene is `WindowGroup(id: "artifact", for: ArtifactRef.self)` in `OmniApp`.
- QA steps: `{"inspector": "open|close|artifacts|browser|web|terminal|actions|details"}` and `{"webTitle": "BLOCKED"}` (waits for the inspector web view's document.title). The check used an HTML artifact that no-cors fetches the local API and reports `BLOCKED` only when every local fetch failed and a control fetch to the internet worked.
- To seed a QA thread: write files into `<data>/threads/<id>/artifacts/` (and `browser/*.png` for screenshots); the server's watcher picks them up.

### Terminal tab

The inspector's fourth tab, like the Web UI's `TerminalView.tsx`: the thread's shell (`apps/server/terminal.ts`), in its cwd. `Client+Terminal.swift` has the API (`TerminalMessage`, `terminalEvents`, `TerminalInputQueue` for ordered keystrokes); `Omni/TerminalTab.swift` hosts a SwiftTerm `TerminalView` in a plain container NSView (handed to SwiftUI directly it keeps its first frame). Every (re)connection starts with a snapshot the server serialized from a headless xterm at this client's size, so the view resets and feeds it. A new artifact does not pull the inspector off the Terminal tab (`InspectorSelection.arrived`).

- `cacheDisplay` draws a SwiftTerm view shifted and clipped, so the QA snapshot draws each one on its own and lays it over the capture. On screen it is fine.

### Actions tab (#210)

The inspector's Actions tab (`Omni/ActionsTab.swift`): the channel's actions with Run (Stop while one runs in this thread), the server's `blocked` reason, and the thread's runs newest first with their bounded output, the newest open. Run, Stop and Retry refusals (a taken fixed port is a 409) show inline. A live action keeps its worktree from cleanup; Run on a removed worktree restores the thread's branch before the command starts. No push events: it polls GET /api/threads/:id/actions every second while a run runs, from a `.task` that ends when the tab leaves the screen. A new HTML artifact does not pull the inspector off it.

## Artifacts page (#69)

`#/artifacts` shows `ArtifactsScreen` (`DetailView` routes to it): a filter picker (All, Pages, Images, Docs, Data, with counts), a grid of cards (thumbnail, type icon and name, thread title, `#channel`, age) and a "New" badge for anything changed since the previous visit (`UserDefaults` `artifacts.seen`). A card sets `model.route = .thread(id:, artifact:)`, which opens the thread with the inspector on that file.

- OmniKit: `GalleryArtifact` (a row of `GET /api/artifacts`, fixture `artifacts.json`), `ArtifactFilter`, `ArtifactGallery` (pure; the upsert rules are in its doc comment) and `ArtifactsStore`. The store has a feed connection of its own, started and stopped with the page. A feed artifact of a known thread joins at once; an unknown thread, or a reconnect, refetches after 1.5s like the Web UI.
- `apps/mac/Omni`: `ArtifactsScreen`, `ArtifactThumbnails`. Images are decoded small with ImageIO, SVG through `NSImage`, pages are loaded one at a time in the viewer's sandbox (`ArtifactWebHost`, `SandboxRules`) in an off-screen window and snapshotted. All are cached per artifact version.
- To recheck live updates in QA, write a file into `<data>/threads/<id>/artifacts/` during a `sleep` step.

## Quit, updates and banners (#74)

- Quit: `AppDelegate.applicationShouldTerminate` returns `.terminateLater`, asks `AppModel.quitDecision()` (`QuitRules` in `Quit.swift`, a pure function of the running turns from a fresh GET /api/status and whether the app started the server) and either quits or shows the `NSAlert` in `UpdateViews.swift`: Keep Server Running, Stop Them and Quit, Cancel. `prepareToQuit` stops queued then running threads, then the server if the app started it. A hand-started server is never stopped. A kept server is found by the record on the next launch (`ServerSupervisorTests`).
- `Updater` (`Updater.swift`, made by `AppDelegate`): `UpdateCheck.notices` compares `server.gitHead` and the app's `OmniGitCommit` with `git rev-parse main` in the repo (`RepoHead`). It checks when the server state changes and when the app becomes active. A commit it cannot know never shows a notice.
- Restart Server (`ServerRestart`, sequenced against `RestartHost`, tested with a fake host and `TestClock`): wait for no running turns (poll 2s), `node node_modules/vite/bin/vite.js build` (log `~/Library/Logs/Omni/web-build.log`), check idle again, stop, start. A server started outside the app asks first. Rebuild and Relaunch runs `scripts/build-mac.sh` in its own session (log `app-rebuild.log`); the script quits the installed copy itself.
- `UpdateBar` sits above the detail and shows the notice, progress and errors. Nothing runs without a click.
- Banners: `FinishTracker` mirrors `ThreadNotifier` in the Web UI (a thread seen queued or running that becomes done, failed or stopped, unless it is open in the front window). `AppModel.banners` is fed from the feed; `BannerStack` shows them bottom right, auto-dismiss 6.5s, paused on hover.

## Build and install

`scripts/build-mac.sh [--no-open] [-- app arguments]`:

1. Release build with xcodebuild into `apps/mac/.xcode` (log in `apps/mac/.xcode/build-release.log`; errors are printed on failure).
2. `git rev-parse HEAD` goes into the built app's Info.plist as `OmniGitCommit`, and a build number (`YYYYMMDD.HHMMSS`) as `CFBundleVersion`. Every Debug build, worktree build and temp build registers with LaunchServices under the same bundle id; with `CFBundleVersion` 1 everywhere, the Dock could take its icon from an old copy with no icon and show a blank tile. The build number keeps the installed copy the newest one.
3. Signs again (the stamp broke the build's signature): the first "Apple Development" identity from `security find-identity -v -p codesigning`, else ad hoc. `--timestamp=none`, then `codesign --verify --strict`. If the keychain asks whether codesign may use the key, the script waits for the answer.
4. Quits a running installed copy: processes whose command starts with `~/Applications/Omni.app/Contents/MacOS/Omni` only, SIGTERM, then SIGKILL after 5s. Debug builds and the server are left alone.
5. Moves the old `~/Applications/Omni.app` to the Trash (to `apps/mac/.xcode/replaced/` when the Trash can't be written), after checking it is this app by bundle id. It refuses to replace anything else. The moved copy is unregistered from LaunchServices (`lsregister -u`), which otherwise follows it into the Trash.
6. Copies the new app in with ditto, touches it (ditto keeps the build folder's date, which the icon cache reads), registers it with `lsregister -f` and unregisters the build product in `apps/mac/.xcode`. Prints its path, and opens it, passing what follows `--`.

If the Dock tile is blank anyway, list the registered copies with `lsregister -dump | grep -B30 'identifier: *com.omni-os.mac' | grep '^path:'` (lsregister lives in `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/`), `lsregister -u` the stale ones, then `killall Dock`. Restarting the Dock alone does not help: it asks LaunchServices again and gets the same stale copy.

The installed app with no arguments talks to port 4747, the live server. For a check, run `scripts/build-mac.sh -- -serverPort 4759` (nothing listens there) and quit it after.

## QA harness (Debug only)

`QARunner` runs a script against the Debug app and snapshots its windows without screen recording permission. Nothing of it is in a Release build (`strings` finds no `OmniQA`).

```sh
S=<scratch dir>
apps/mac/.xcode/Build/Products/Debug/Omni.app/Contents/MacOS/Omni -ApplePersistenceIgnoreState YES \
  -serverPort 4757 -repoPath "$PWD" -OmniQAScript "$S/qa/run.json" -OmniQAOut "$S/qa/run"
```

- `-OmniQAScript` takes the JSON itself or a path to it; `-OmniQAOut` the folder for PNGs and `qa.json`. They are read from the raw arguments: UserDefaults would parse a JSON value as a property list.
- Give every flag a value. A flag without one ahead of the others left the app with no window.
- It refuses to run (exit 2, reason in `qa.json` and stderr) unless launch arguments set `-serverPort` (every one given) to a port other than 4747. `QALaunch.serverPort` checks the raw arguments before the app model exists, so nothing has talked to a server yet. A `{"port": 4747}` step is rejected, and server steps refuse while the port is 4747. So a QA run never talks to the live server and never saves settings.
- A server a QA run starts keeps its data, brain folder, log and record in the out folder and runs the fake CLIs (`QAServer.environment`: `OMNI_DATA_DIR`, `OMNI_BRAIN_DIR`, `OMNI_CLAUDE_BIN`, `OMNI_CODEX_BIN`, `OMNI_CURSOR_BIN`, `OMNI_BROWSER=0`). The run stops it before quitting.
- The harness's activity monitor runs on port 4891 (`QARunner.monitorPort`), so it never meets one started by hand on 4791; its log is `monitor.log` in the out folder and `end()` stops it.
- The app exits at `quit` or when the steps run out: 0 when every step passed, 1 otherwise.
- `-appearance light` or `dark` sets the appearance for the run, to snapshot both.
- `-threadInspector.width 340` sets the inspector's width for the run, to snapshot a panel at its narrowest (340) or wide (about 680 in the 1100-point window). The argument wins over the saved width.
- `-OmniQAManualHistory YES` stops "Earlier messages" loading by itself, to snapshot the control.
- `-OmniQALoadMore YES` presses an open tool row's Load more once, after its first chunk, to snapshot a press.
- A long thread to page through: `OMNI_DATA_DIR=<the QA server's data dir> npx tsx apps/server/scripts/seed-long-thread.ts` prints its id; `pelican` searches to its oldest turn.

Steps (a list, or an object with the list under `steps`):

| Step | Does |
| --- | --- |
| `{"route": "#/c/acme"}` | Sets the route |
| `{"wait": "sidebarLoaded"}`, `{"wait": {"for": "serverState:running", "timeout": 30}}` | Polls every 100ms, 10s by default. Conditions: `sidebarLoaded`, `serverState:<unknown, checking, notRunning, starting, running, failed, stopping>`, `connection:<connecting, open, reconnecting, closed>`, `channel:<id>` |
| `{"sleep": 1.5}` | Seconds |
| `{"meter": true}` | Opens the open thread's context meter panel |
| `{"modelPicker": true}`, `{"modelPicker": "cursor"}` | Opens the new thread box's model list, with that in its search. Draw it with `screen`: it is a popover |
| `{"foldAll": true}` | Presses the sidebar's collapse-all (or expand-all) button |
| `{"editPending": "text"}` | Opens the edit of the open thread's first editable unsent message, with this text in it |
| `{"scroll": "earlier"}` | Scrolls the open thread up with trackpad events until "Earlier messages" starts a page, and notes the row at the top then and once the page is laid out ("held" when it kept its height) |
| `{"scroll": "gap"}` | Centres the first gap a reveal left |
| `{"searchHit": 0}` | Opens the search screen's hit at that index as a click does, and notes where its row landed |
| `{"subagent": 0}` | Presses the Details tab's Running subagents row at that index as a click does, and notes where the row that started it landed. Open the tab with `{"inspector": "details"}` first; a `BG:<ms>` thread has agents to list |
| `{"snapshot": "home"}` | `home.png` for the main window, `home-settings.png` for Settings, `home-window<n>.png` for others. Fails on a blank image |
| `{"port": 4759}` | Sets the port, as Settings would. Never 4747 |
| `{"open": "settings"}` | Opens Settings |
| `{"settings": "secrets"}`, `"appearance"`, `"server"` | Opens Settings on that tab (`"connection"` still opens Server) |
| `{"server": "start"}`, `"stop"`, `"check"` | Start Server, Stop Server (no confirmation), Check Again. Waits for it to finish |
| `{"folder": {"new": "acme"}}` | The new folder field under a channel. With `"name"` it makes the folder, as Return would |
| `{"folder": {"rename": "Specs"}}`, `{"delete": "Specs"}`, `{"here": "Specs"}` | A folder's name field, its delete confirm, or New Thread Here |
| `{"folder": {"drag": "<thread title>", "over": "Specs"}}` | A thread dragged over a folder, with the drop highlight |
| `{"folder": {"file": "<thread title>", "into": "Specs"}}` | Files the thread there, as a drop does |
| `{"folder": {"menu": "Specs", "shot": "menu"}}` | Right-clicks the folder and writes `menu.png` while its menu is open |
| `{"folder": "reset"}` | Ends any of the above |
| `{"webhookSecret": "ci-fixer"}` | On the Automations page, opens that webhook automation's Set secret form. Draw it with `screen`: it is a sheet |
| `{"deliveries": "ci-fixer"}`, `{"deliveries": {"automation": "ci-fixer", "open": "failed", "older": true}}` | On the Automations page, scrolls that automation's Deliveries into view, opens its first delivery in that state (or with that id) and loads the next page of older ones |
| `{"imageZoom": 2}`, `{"imageZoom": "fit"}` | Zooms the artifact image preview to that scale, or back to fit |
| `{"screen": "name"}` | The main window with the app's windows over it (a sheet, a menu) drawn in place |
| `{"quickPrompt": "text"}`, `{"quickPrompt": {"send": true}}`, `{"quickPrompt": false}` | Opens the Quick Prompt with this text (Wispr Flow off), sends it, or closes it |
| `{"handoffMenu": "name"}` | Clicks the open thread's Hand Off button and writes `name.png` while its menu is open |
| `{"prMenu": "name"}` | Clicks the reply box's PR button and writes `name.png` while its menu is open |
| `{"handOff": "<device id>"}` | Hands the open thread to that Mac, as picking it in Hand Off to does |
| `{"takeOver": "name"}` | Presses the Take Over pill over the reply box (through its probe, as the pill's action), writes `name.png` while the confirm sheet shows, then presses Take Over in it. The open thread must be one another Mac holds, so it needs two synced servers |
| `{"selectLines": {"file": "src/cart.ts", "from": 1, "to": 3}}` | In the Changes tab's shown view, clicks the numbers of row `from` (an index into the file's diff rows, hunk rows counted, from 0) of the first file at that path, then Shift-clicks row `to`. The dock shows under the diff |
| `{"addContext": "note"}` | Writes the note in the dock and presses Add to Message. Fails with the reason when the reply box refuses the lines |
| `{"selectTerminal": true}` | In the Terminal tab, selects everything the terminal shows. The selection panel opens over its foot. The shell lives on the server, so put output in it first, with `POST /api/threads/:id/terminal/input` |
| `{"addTerminal": "note"}` | Writes the note in the terminal selection's panel and presses Add to Message. Fails with the reason when the reply box refuses it |
| `{"wait": "browserFrame"}` | Waits until the Browser tab shows a frame of the page. Open the tab with `{"inspector": "browser"}` first |
| `{"annotate": "start"}` | Presses Annotate in the Browser tab and waits for the screenshot. Fails with the server's words when the capture fails. The harness's own server has the browser off, so run these against a `-serverPort` server started with `QA_BROWSER=1 scripts/qa-stack.sh up`, with a page already open in the channel's browser (`POST /api/channels/:id/browser/action`) |
| `{"annotate": {"drag": [0.1, 0.2, 0.6, 0.5], "note": "text"}}` | Draws a rectangle on the shown screenshot, as fractions of it from 0 to 1, and writes the note. Fails when it is too small |
| `{"annotate": {"shape": "arrow", "from": [x, y], "to": [x, y]}}` | Draws a `rect`, `ellipse`, `arrow` or `line` on the shown screenshot, in fractions from 0 to 1 |
| `{"annotate": {"pen": [[x, y], ...]}}`, `{"annotate": {"text": "words", "at": [x, y]}}` | A pen stroke through two or more points, or words set down at a point |
| `{"annotate": {"color": "#3b82f6", "stroke": 8}}`, `{"annotate": {"move": [x, y], "by": [dx, dy]}}` | Sets the color and line width (or recolors the selected mark), or grabs the mark at a point and drags it |
| `{"annotate": "undo"}`, `{"annotate": {"note": "text"}}` | Removes the last mark, or writes the note for a marks-only annotation |
| `{"annotate": "add"}`, `{"annotate": "cancel"}` | Presses Add to Message (renders and uploads the marked screenshot first; fails with the reason when that or the reply box refuses it), or Cancel, which deletes the screenshot |
| `{"annotate": "live"}` | Turns live Annotate on in the Web tab when it shows (open a page with `nativeBrowser` first; any stack), else in the Browser tab, which needs a `QA_BROWSER=1` stack with a web page open, as `start` does. The live steps below drive whichever tab it is |
| `{"annotate": {"hover": [0.85, 0.18]}}` | Moves the pointer to that fraction of the shown page, through the page view's own mouse handling, and waits for the inspector's tooltip |
| `{"annotate": {"livePick": [x, y], "note": "text"}}`, `{"annotate": {"liveDrag": [x0, y0, x1, y1], "note": "text"}}` | Clicks or drags on the shown page, waits until the card has its capture (fails with the card's reason) and writes the note. `{"annotate": {"note": "text"}}` writes it later |
| `{"annotate": "send"}` | Presses the card's Send. Fails with the reason when the send is refused |
| `{"annotate": "escape"}` | Presses Escape with the page holding the keys, through the page view's own key handling. Fails unless it cleared the card (or, with none, turned live Annotate off) |
| `{"annotate": {"optionClick": [x, y]}}` | An Option-click on the shown page through the page view. Fails when it marked anything; the page should get a plain click |
| `{"annotate": {"pageScroll": 120}}` | Scrolls the Web tab's page by that many CSS pixels, as a script on the page would, then lets it draw a frame |
| `{"nativeBrowser": "<url>"}` | Loads the URL in the Web tab and waits for the page to finish. Open the tab with `{"inspector": "web"}` first. Needs no server browser, so a plain QA run works. A QA run starts the Web tab empty, with its own defaults suite and no stored data, so it never reads or writes Ben's own pages and logins |
| `{"browserAddress": "example.com"}`, `{"browserAddress": {"type": "example.com", "escape": true}}` | In the Web tab when it shows, else the Browser tab, clicks the page (the Web tab's page is given the keys directly: a web view takes no first click in a window that is not key, and the harness's window can't become key while another app is in front), then the address bar, with mouse events through the window's hit testing, types the text key by key and presses Return (or Escape). Fails unless the bar takes the keys and Return or Escape hands them back to the page; Return must also reach the address. Focus needs the key window, so this step brings the app to the front. Needs a `QA_BROWSER=1` stack, as Annotate does |
| `{"attach": "<path>"}` | Stages that file in the reply box (or the new-thread box), as the paperclip, a drop or a paste does |
| `{"send": {"mode": "reply", "wait": false}}` | Sends without waiting for the answer, so the next steps can snapshot the message on its way (the "Sending" bubble). A proxy that holds `POST .../messages` for a few seconds in front of the QA server keeps it on screen |
| `{"openContext": 0}` | Clicks the reply box's context chip at that index, which opens or closes its inspector |
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
  node --disable-warning=ExperimentalWarning --import tsx apps/server/index.ts > "$S/tmp/qa-server.log" 2>&1 &
```

For the Automations page, add `OMNI_AUTOMATIONS_DIR="$S/tmp/qa-automations"` with a YAML file or two in it (name, cron, channel, prompt, `enabled: true`). Without it the server reads and writes the repo's `automations/`, and the enabled ones run on their schedule.

A thread whose prompt is `TOOL:300000` keeps running for five minutes with the fake CLI, for spinners and running counts. The server runs four per harness at once; the rest queue.

What the tracer's QA run covered (each checked by eye in the PNGs): the sidebar with channels, badges, running and queued threads and "N more"; a count and a thread row showing up while the app ran; channel, thread and unknown routes; Settings; not running (4759); a foreign server (a plain HTTP server on 4758: "not an Omni server"); a start that failed, with short and long log tails; a start and stop by the app on 4758 with the QA environment; the server killed under a connected app (Reconnecting, then Not running).

## Slash menu (#66)

The slash grammar, ranking, hints and pills are the TypeScript in `packages/shared/` that the Web UI also runs, through JavaScriptCore (ADR 0002). The engine imports from `packages/shared/` only, never from `apps/web/`; `turbo boundaries` enforces it (`npm test` runs it).

- The Web tab's page reader is bundled the same way: `apps/mac/browser-pick/entry.ts`, `npm run build:pick`, `Resources/browser-pick.js`, checked by `apps/mac/tests/browser-pick-bundle.test.ts`. Run it after changing `packages/shared/browser-pick-script.ts` or `browser-pick-read.ts` (or what they import).
- `apps/mac/slash-engine/entry.ts` is the entry; `npm run build:slash` bundles it (esbuild, `apps/mac/scripts/build-slash-engine.ts`) to `OmniKit/Sources/OmniKit/Resources/slash-engine.js`, which is checked in. `apps/mac/tests/slash-engine-bundle.test.ts` fails when it is stale. After changing `packages/shared/slash.ts`, `slash-menu.ts`, `composer-slash.ts` or `slash-pills.ts`, run `npm run build:slash`.
- `SlashEngine.shared` (OmniKit): `query`, `sections`, `pick`, `reply`, `newThreadHint`, `pieces`, `omniCommands`. All offsets are UTF-16 units. `String.index(utf16Offset:)` and `utf16Offset(of:)` (in `SlashTypes.swift`) are the only place they become Swift indices; `AttributedString` has the same pair in `SlashMenuView.swift`.
- `SlashCommandsStore` (`@MainActor @Observable`): the list for a `CommandsSource` (`.thread(id)` or `.newThread(harness:channel:)`), fetched as `useCommands` does: cached, then `wait=1`; an older `fetchedAt` never replaces a newer list; a failure with no list is `.unavailable`. Set `source` when the new-thread picker changes.
- `SlashMenuModel`: open/closed, sections, highlight, Esc dismissal, keys, pick, `reply` (what Send does) and `hint`. It loads the list on focus and when the menu opens.
- `OmniCommands.run(action, in: thread, client:)` does `/clear`, `/new` (new thread, or `.openNewThread(preset)` when there is no prompt) and `/rename`. `/model`, `/effort` and `/fast` return nil: the composer opens its model picker (`ModelPickerButton.openRequest`), whose pick switches the next turn. Attachments on `/clear <prompt>` are not sent.
- Pills in user bubbles already use `SlashPiece.split` (native); a test pins it to the engine's `pieces`.

Wiring it into the composer (apps/mac/Omni/SlashMenuDemo.swift is a working example, Debug only, `-OmniQASlashDemo YES`):

1. `let menu = SlashMenuModel(commands: SlashCommandsStore(api: client, source: .thread(id)), placement: .reply, harness: thread.harness.rawValue)`. For the new-thread composer use `placement: .newThread` and `.newThread(harness:channel:)`; update `menu.harness` and `commands.source` when the picker changes.
2. On the composer's container (the view around the text view): `.slashMenu(menu)` (`below: true` near the top of the page). It draws the menu and takes the arrows, Return, Tab and Esc while open.
3. Feed it: `menu.setFocused(focused)` and `menu.update(text:, caret:)` on every text or selection change (caret is a UTF-16 offset). Set `menu.onEdit = { text, caret in ... }` to write the picked text back and move the caret.
4. Under the text: `SlashHintView(model: menu)`.
5. Send: `if let r = menu.reply, r.action != .send` then the button reads `r.label ?? "Send"`, is enabled by `r.armed`, and runs `OmniCommands.run(r.action, in: thread, client:)`; clear the draft after. For a plain send the button is enabled by non-empty text as before.

The overlay sits above the composer, like the Web UI's, not at the caret: `TextEditor` gives no caret rectangle. If the keys do not reach `.onKeyPress` because the text view takes them first, move the modifier's key closure to the text view's own handler and call `menu.handle(_:)`.
Wired (both composers):

- `ComposerCallbacks` got `slash` (arrows, Return, Tab from the text view's `doCommandBy`, Esc from `cancelOperation`; not while an input method composes) and `edited` (text and caret on every change, selection move and focus). `CaretRequest` sets the caret after a pick. `.slashMenu(menu)` is on the composer's shell for its overlay; its key handler never sees the keys because the AppKit text view takes them first.
- Reply box: `menu.reply` decides the Send button (`Rename`, `New thread`, ...) and Return; `runOmni()` calls `OmniKit.OmniCommands.run` (qualified: the app has its own `OmniCommands: Commands`). `/model`, `/effort`, `/fast` arm Send as "Pick model", which clears the text and opens the model picker.
- New thread: `.slashMenu(menu, below: true)`; `menu.commands.source` and `menu.harness` follow the pickers. `AppModel.openNewThread(preset)` puts the preset in `shell.newThreadPreset` and opens the channel; that channel's composer takes it (`NewThreadComposerModel.apply`) and opens the model list for `pickModel`.
- QA: `{"type": ...}` also focuses the box. In this environment, opening a thread with `{"route": "#/t/<id>"}` crashes the app (window constraint loop) on main too; use `{"openThread": "<id>"}` and read `-window1.png`.

## Home, Channel, Search and Go to (#68)

- Screens: `HomeScreen`, `ChannelScreen`, `SearchScreen`, `PaletteView` (⌘K overlay in `MainWindow`), `UsageCard` (sidebar footer). Shared rows and day groups in `ThreadListViews.swift`.
- Pure logic in OmniKit: `NavigationHistory` and `ShellState` (history, palette open, composer focus; `AppModel.shell`, `goBack`, `goForward`, `startNewThread`), `ThreadFilter` and `ThreadListing` (filter rules, day groups, channel list merge), `Palette` (items and ranking), `SearchHit` and `Snippet` (`<mark>` runs), `UsageMeter` (thresholds 70% warn, 90% bad).
- `AppModel.route` has a `didSet` that records history; Back and Forward set the route, which the history ignores as already current.
- Search opens the thread on the match: a hit with `event_id` goes through `ThreadStoreRegistry.reveal`, then the route. `Route` has no `at`, so a pasted web link with `?at=` opens at the bottom.
- Go menu: Back ⌘[, Forward ⌘], Go to ⌘K.
- QA step `{"palette": "query"}` opens the palette (`false` closes). Close it before opening with a new query.

## Needs you (#203)

- `GET /api/needs-you` lists each thread's newest unread result (done, failed, stopped) and its blockers (failed Setup, recovered and uncertain requests), across every thread not archived. `NeedsYou` in OmniKit decodes it and holds the Web UI's rules (`apps/web/src/needs-you.ts`): the reason a row shows, a channel's part, the result an open thread shows, and the inbox once one is read.
- Mark as done (`threads.done_at`, `PATCH /api/threads/:id {done}`): Ben dismisses a thread whatever it waits on. The server leaves it out of Needs you while it is set; a new message, a run starting or a setup retry clears it. `AppModel.setThreadDone` drops it at once (`WorkspaceStore.editDone`, a load already out cannot put it back) from the check on a Needs you row's hover, Mark as done in a thread's right-click and the check in the thread header; Mark as not done reopens it. A running thread cannot be marked done. In its channel, folder and the sidebar it stays, with a grey check for its dot, a muted title and a Done chip; Needs a look leaves it out.
- `WorkspaceStore.needsYou` loads with everything, again with channels and status after thread events, and at once on the feed's `needs_you` event (a read on another client, or a result or read the other Mac's sync brought, #204). A sync sends those in bursts, so one load runs at a time and one more follows if events came meanwhile, as `coalesced` in `apps/web/src/needs-you.ts` does. `readResult(_:)` drops the result at once, posts it, and loads again: a newer result that came in meanwhile stays unread.
- `NeedsYouViews.swift`: the section under the composer on Home (all clear when empty) and in a channel's Threads tab (hidden when empty). `readsShownResult` on the thread view reads the result Needs you listed for the open thread, only while it is not running and the app is active.

## Notifications (#205)

- Mac notifications come from the same state as Needs you: `AttentionTracker` (OmniKit, `Attention.swift`) reads each `WorkspaceStore.needsYou` list and alerts a done or failed result the first time a list has it, under the result's uid. The first list after launch or a port change only records what is there, a result older than 10 minutes when it first shows never alerts (a sync after a day away, a long sleep), and a reconnect or sync that lists a result again is no news. The thread on screen in the front window is recorded, not alerted. An alert whose result leaves the list (read here, on the other Mac or in the Web UI) is withdrawn from Notification Center.
- `AttentionCenter` holds `NotificationSettings` (UserDefaults, never synced: on or off, and muted channel ids; off until Ben turns it on) and the macOS permission. Turning on asks macOS; a denial keeps the switch on and Settings, General, Notifications says so with Open System Settings. `-notifications YES` turns them on for one run (QA) and saves nothing.
- The app target's `SystemNotifications.swift` is the UserNotifications side: it posts (thread grouped by channel, a sound for failures), withdraws, shows alerts in front as list only (the window's banner already says it), and on a click shows the thread with `Route(notification:)`. The thread screen then reads the result through `readsShownResult`, the normal read flow.
- QA step `{"settings": "notifications"}` opens the tab.

## Channel settings (#71)

- `ChannelForm` (OmniKit) holds the form, `slugify`, the validation messages and the PATCH and POST bodies. Empty text goes as `null`, so clearing a field clears it; the store domain is cut to the host; a system channel sends no `kind`. `OmniClient.createChannel`, `updateChannel`, `setChannelArchived`.
- `ChannelSettingsView.swift`: `ChannelSettingsForm` (create and edit, folder pickers for repo path and base dir, inline Archive confirm), `NewChannelScreen` (`#/new-channel`, a page as in the Web UI, not a sheet) and `MissingChannelView` (archived channel: Unarchive). The channel's Settings tab shows the form. After a save the store reloads channels.
- `snapshot` leaves out sheets and menus; `screen` and the folder `menu` step draw them in from the app's own windows, so neither needs screen recording or an unlocked screen.
- QA step `{"channel": "create"}` (or `edit`, `archive`, `unarchive`) runs the same client calls on channel `qa-channel`.
- An existing channel's settings have an Actions card (`ChannelActionsView.swift`) after Code: add, edit and delete (inline confirm) save each action at once, not with the form's Save. Debug launch arg `-OmniActionForm new` (or an action's name) opens its form for a snapshot.

## Next

- While the server is down the sidebar keeps the last channel list it had.
- The quit dialog (#74) can call `stopServer()` when `state` is `.running(startedByApp: true, _)`. Threads in their own windows are #75.
- `Route(hash:)` and `route.hash` mirror `parseHash` and `href` in the Web UI. Use them for deep links, open in browser and window restoration. PR and artifact numbers parse as `Int` only.
- New endpoints: add a method to `OmniClient`, a stub test in `ClientTests.swift` and, if the app depends on its shape, a fixture.

## Reply composer (#64)

- OmniKit: `SendRules` (steer/queue/interrupt per harness, `EscapeGate` for Esc), `Attachments.swift` (`StagedFile`, `AttachmentRules.add`: 10 files, `maxUploadMb`, empty files dropped, Web UI wording), `DraftStore` (one file per key in `~/Library/Application Support/Omni/Drafts`), `ReplyComposerModel` (text as draft, staged files, send, Open PR), `OmniClient.reply(to:prompt:mode:files:)` (JSON, or multipart with a `payload` field and `files` parts when there are files; an idle thread sends no `mode`).
- App: `ComposerTextView.swift` (AppKit text view: IME, spellcheck, undo, grows to 240pt, Return sends in `doCommandBy`, Cmd-Return newline and Shift-Cmd-Return interrupt in `performKeyEquivalent`, Esc in `cancelOperation`, file drop and paste, screenshot paste to a temp `image.png`), `ComposerView.swift` (`ReplyComposerHost` is the one line in the thread screen; split Steer button; paperclip; Open PR; Stop in send's place while a turn runs and the box is empty), `ThreadCommands.swift` (Thread > Interrupt, Cmd-period). If another slice adds a "Thread" menu, merge the two.
- Model and effort: `ModelPickerButton` (`offersAuto: false`, `autoReason` so a thread Auto started reads "Auto · <model>" until it switches) and `EffortMenu`, bound to the thread's run. A pick posts `switchRun` (`/api/threads/:id/run`), which switches the next turn (same harness: settings; other harness: a handover). `RunSwitch.picking` gives nil for the run already shown and resets effort on a new model; an effort pick keeps the stored model, empty for the harness default. Nothing changes until the server answers; its refusal shows above the box. While a turn runs the server queues the pick (`queuedHarness`, `queuedModel`, `queuedEffort` on `OmniThread`): the pickers show `RunSwitch.shown` ringed in live after a `NextTurnChip`, whose click posts `RunSwitch.current` to drop it, and nothing steers (the box queues) until the turn ends.
- Switch rows: `TranscriptItem.runSwitch(SwitchRow)`, drawn by `SwitchLineView` (MessageViews.swift) as a quiet divider with `handoverNote` under it and a loader while a handover waits and the thread runs. A `handover` event completes the pending handover row; a later handover or back switch marks it superseded. The `run-switch` corpus case keeps it in step with the Web UI.
- QA step `{"run": {"harness": "codex", "model": "gpt-6.1", "effort": "high"}}` uses the reply box picker callback to switch the next run. Effort is optional.
- QA steps: `{"type": "text"}` fills the reply box, `{"send": "reply"}` (or `steer`, `queue`, `interrupt`) sends it. `QARunner` also got a stub for `.expand`, which the tree did not handle (Debug build failed on it); replace it with the real one.
- Not built: the slash menu (Esc gating has a slot for it), scroll-to-bottom on send.

## New thread (#65)

- OmniKit: `NewThreadRules.swift` (`AutoRun`, the one home of Auto's `model: "auto"`, `NewThreadChoice`, role/channel/model preset rules and the request body, `EffortRules`, `ModelSearch`, all mirroring `NewThreadComposer` and `ModelPicker` in the Web UI), `NewThreadComposerModel` (draft per channel in `DraftStore` under `new:<channel>` or `new:*`, staged files, send), `Client+NewThread.swift` (`createThread(_:files:)`, JSON or multipart with a `payload` field).
- App: `NewThreadView.swift`. `NewThreadComposerView(model:channelID:big:)` is the embeddable composer (`big` is Home's 96 to 360pt, else 60 to 260pt). Home and a channel's Threads tab embed it.
- Sending opens the thread (`model.route = .thread`). Model changes reset effort to default; an effort the model does not take is never sent.
- QA: `{"type": "..."}` and `{"send": "reply"}` drive the new-thread box too (`QAComposerProbe`, which now has an `owner` so a box that leaves after its successor appeared does not clear the hooks).
- `ComposerTextView` got `heightRange` and `label`; `SendButton` a `title`; `AttachmentStrip` and `SendButton` are no longer private.
## PRs, diffs and merge (#70)

- `#/c/<id>/prs` and `#/c/<id>/prs/<n>` render `PullRequestsScreen` (list, detail), wired in `DetailView`. It has no tab bar of its own; the channel screen's tabs belong to the channel slice.
- OmniKit: `PullRequest.swift` (types, `OmniClient.pullRequests/pullRequest/merge`), `DiffParser.swift` (`parseDiff` and the open rule from `DiffViewer.tsx`: a file starts closed only when the diff has more than 12 files and the file has 200 or more changes; 1500 line cap per file). `OmniClient.send` is now internal so extensions can use it.
- Merge is a sheet with method and delete-branch. Neither button is the default one, so Return does not confirm. The body always carries `confirm: true`.
- QA without GitHub: `packages/test-fixtures/fake-gh.mjs` answers the `gh` calls of `apps/server/github.ts`. Link it as `gh` in a folder first on the test server's PATH. `Fixtures/prs.json` and `pr.json` were recorded from that server.
- Debug launch args `-OmniPRTab Diff` and `-OmniPRMergeSheet YES` open a tab or the sheet, since QA scripts only pick routes.
- `QARunner` ignores the `expand` step for now (it was missing, so the Debug build did not compile).

## Thread in its own window (#75)

- `apps/mac/Omni/ThreadWindow.swift`. `WindowGroup("Thread", id: "thread", for: String.self)` in `OmniApp`, value is the thread id. SwiftUI keeps one window per id (`openWindow(id:value:)` fronts the existing one) and restores them on relaunch.
- A thread window shows `ThreadScreen`, so it takes its store from `AppModel.threads` like the main window. The main window on a thread plus a thread window on it share one store and one stream; the last one to close stops it (`ThreadStoreRegistry`, already tested).
- A thread's right-click (`OpenInNewWindow` in `ThreadWindow.swift`): Open in New Window, then the shared thread menu of `packages/shared/thread-actions.ts` (the Web UI's right-click and the phone's thread options render the same list). `SlashEngine.threadMenu` runs it from the slash engine bundle, so a label or condition changed there needs `npm run build:slash`. The menu passes `ThreadMenuFacts` from the row (sidebar stub, pinned row, or the open thread's store) and the store's hand off and take over state, and maps each `ThreadActionID` to its action. Groups are `Section`s: Organize, Continue, Send to. Fork fetches the thread and opens `ContinueSheet`; Reference a thread opens `ThreadReferencePanel` in a popover on the row, writing to the open store's draft or the saved draft. `thread-menu.json` is the shared menu with every action, checked by `ThreadMenuTests`.
- Open in New Window: File menu (Option-Cmd-N, for the thread the focused window shows, off in a thread window), a toolbar button in the main window on a thread, and `.openInNewWindow(threadID)` on any view (context menu, Option-click). It is on sidebar thread rows; add it to thread rows in lists and channel pages as they land.
- `FocusedValues.shownThread` says which thread the focused window shows. Copy Thread as Markdown uses it too (`AppModel.threadMarkdown(_:)`).
- Buttons and links inside a thread window still set `model.route`, so they navigate the main window; the thread window brings it forward when it changes the route while key.
- QA: `{"openThread": "<id>"}` opens the window; snapshots write it as `<name>-window<n>.png`.
- The composer and inspector show in the thread window once #64 puts them in `ThreadScreen`.

## Changes tab (#207)

- The inspector's Changes tab (`Omni/ChangesTab.swift`), as the Web UI's `ChangesTab.tsx`: GET /api/threads/:id/changes (`apps/server/changes.ts`), the thread's checkout against the base commit Omni recorded (`thread_bases`, local), in committed, staged, unstaged and untracked groups. Loads when opened, when a turn ends and on Refresh. A thread with no checkout here (Hermes, no repo, another Mac) shows the server's reason.
- OmniKit: `Changes.swift` (`BranchChanges`, `ChangesView`, `OmniClient.changes(forThread:)`); `DiffParser.swift` now numbers lines (`DiffLine`, `FileDiff.rows`), the same model as `apps/web/src/diff.ts`. `DiffFileView` in `DiffView.swift` draws one file for the PR page and the Changes tab (label, status badge, notice). Fixtures `changes.json`, `changes-unavailable.json`.
- The inspector's tabs scroll sideways when the panel is too narrow to show them all.
- QA step: `{"inspector": "changes"}`.

## This turn (#208)

- The Changes tab has two views: Since base (#207) and This turn. This turn reads GET /api/threads/:id/turns (`apps/server/turns.ts`): a worktree thread's saved turns, newest first, and one turn's diff between the snapshots Omni saved before and after it (hidden refs `refs/omni/turns/<thread>/<turn>/before|after`, rows in the local `turn_snapshots` table). A picker chooses the turn; the header shows HEAD moving during it and says the diff is a before/after snapshot (commits and pulls included, ignored files not saved). A turn still saving polls every 1.5s; a failed save shows its reason, never a failed Result.
- OmniKit: `TurnChanges`, `TurnView`, `TurnSide`, `TurnState`, `TurnChangesView`, `OmniClient.turns(forThread:turn:)` in `Changes.swift`. Fixtures `turns.json`, `turns-unavailable.json`.
- QA step: `{"inspector": "turn"}` opens the Changes tab on This turn.

## Hand off to another Mac

- A new thread can start on another synced machine (`RunOn.swift`, `Omni/RunOnPicker.swift`, server `apps/server/run-on.ts`). The new-thread box shows a Run on pill after effort while `DevicesModel` lists another machine: This Mac, then each machine, an offline one not pickable. It starts on Settings' default while that machine is listed, even asleep (the server then refuses the send), else This Mac, and follows the default until Ben picks. A machine sync no longer lists is named This Mac, where the server runs it. `ClientPolicyTests` runs `packages/test-fixtures/policies/run-on.json`, which `apps/web/src/run-on.ts` shares. `NewThread.device` carries the id or `"here"`, and nothing while no machine is listed, so the server's default applies. The box refreshes the devices every 30s while it shows.
- A thread, running or idle, moves to another synced Mac over synced kv (the shapes in `packages/shared/handoff.ts`). The Mac app offers it in three places, all from `Omni/HandoffViews.swift`: the Hand Off button in the thread header, Hand off to… in the thread's right-click, and Hand Off to in the Thread menu. Each lists GET /api/devices in picker order with Tailscale's reachability under the name; an asleep Mac is disabled. An idle handoff sets `idle` on the offer so the banner says the next message continues there.
- It shows only while `DevicesModel.targets(store)` is non-nil: the thread's store is open, `ThreadStore.canHandOff` (no `blocked`, no `takeover`, no handoff under way; idle between turns is fine), sync can carry the offer and there is another Mac. Only the Mac that holds a thread hands it off; the server refuses the others with a 409. A sidebar row whose thread is not open has no store, so its right-click leaves it out: only the thread's detail says where it runs.
- The header button refreshes the device list every 30s while the thread could go.
- `ThreadDetail` and the thread stream's thread message carry `blocked` and `handoff`; the server leaves each out when there is none. `blocked` shows above the reply box as in the Web UI. The handoff is a card at the end of the transcript (`HandoffCard`), with Cancel on the giving Mac while it prepares or is offered, and one quiet line once taken or cancelled. A failed handoff hides once the thread runs again. An offer goes stale on screen 90s after `at` without waiting for the server.
- A refused handoff or cancel (409 with the server's sentence) shows as `store.actionError` above the reply box, like a failed interrupt.

### Take over

- The other direction: the Mac Ben sits at asks the Mac that holds the thread (running it now, or between turns the one that ran it last) to hand it here. `ThreadDetail` and the stream's thread message carry `takeover` (`Takeover`: `from`, `to`, `running`, `refused`), left out while this Mac holds it, while no Mac is known to and while a handoff is under way.
- `TakeoverNote` (`Omni/HandoffViews.swift`) sits over the reply box while `takeover` is set: the running glyph (a quiet dot when idle there), `takeoverNote`'s sentence, and a Take Over pill, or the server's `refused` reason as a quiet second line with no pill. It replaces the `blocked` note of a thread running on another Mac, which says the same.
- Take Over is also in the Thread menu ("Take Over from <Mac>…", disabled unless `store.canTakeOver`) and the thread's right-click ("Take over from <Mac>", only while it can be taken). All three call `store.askTakeOver()`, which bumps `takeOverAsks`; the note answers with one `.confirmationDialog` worded by `takeoverConfirm`, since it cuts a turn on the other Mac. Its Take Over posts `/api/threads/:id/takeover` (empty body), applied like a handoff's answer.
- `canTakeOver`: `takeover` set, `refused` nil, no handoff in flight, no call pending. The answer's in-flight handoff clears `takeover` at once rather than waiting for the stream.
- `HandoffCard` shows the new phases: `requested` (waiting, an alert once 90s pass, on screen as an offer does; Cancel calls `cancelHandoff`, the same route), `declined` and `expired` (alert, no Cancel). `requested` counts as in flight. `HandoffView.requested` words a taken-over thread ("Taken over from …"). A phase this app does not know leaves `handoff` nil on the detail and on the stream, never the whole message.

## Lines of a diff in a message (#209)

- The record and its rules are [docs/internals/message-context.md](../../docs/internals/message-context.md), including terminal excerpts, browser annotations with picked elements, and thread references. OmniKit ports the client half; `MessageContextTests` runs the shared corpus (`packages/test-fixtures/message-context.json`) through it, so the Swift reader and line picker can't drift from the TypeScript.
- Changes tab: `LinePicking` (LineSelectionDock.swift) wraps each view of the tab. A click on a line's numbers picks it, a Shift-click picks up to it within the hunk, a click on the only picked line clears it. `DiffFileView` takes the pick as `picking`; the PR page passes none and is unchanged. The dock (`LineSelectionDock`) shows the label, a note, Cancel and Add to Message (Return or Cmd-Return in the note, Esc cancels). Since base names the base sha and HEAD; This turn names the snapshots before and after the turn and its id. A reload that changes the picked file's lines drops the pick.
- `ThreadStore.draftContext` is shared by the Changes tab, the reply box and every window on the thread. The reply box shows it in `DraftContextStrip` above the files; text or records alone can be sent, and a send settles only the records it carried.
- Chips (`MessageContextChips.swift`) over sent and queued messages and in the reply box; a click opens the kind's detail and the note in a popover. Inline under the strip, it grew the reply box and pushed the window's content up under the title bar. A record this app can't read is a fallback chip: its label (or "Context from a newer Omni") and "This Omni can't show <kind> v<v>. Update Omni to see it." A message of context alone shows no empty bubble.
- A new kind: `<Kind>Context.swift` in OmniKit, `<Kind>View.swift` in the app, and one line in `contextViews` (ContextViews.swift), which the kinds the app reads come from. Add its records to the corpus; nothing checks the Mac has every kind the server knows.
