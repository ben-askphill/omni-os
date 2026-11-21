# Omni OS for iOS

This development client pairs with an Omni server, reads its channels and threads, follows them live, starts new threads, sends messages to them, and pins, marks done, renames, moves and archives a thread from its menu or by swiping its row. Expo Go is not supported.

A thread has a composer pinned above the keyboard. While a turn runs, a message steers the agent when its harness can take input mid-turn and otherwise queues for after the turn, and the placeholder and the send button's label say which. A message shows in the thread as sending. If the network fails, it stays there with Retry and Edit. Retry sends it again under the same request id, so the server answers with the first acceptance instead of taking the message twice. Edit puts the text back in the box and focuses it. If the server got the message but its answer was lost, the failed row goes as soon as the thread stream shows it, so it never appears twice. Stop replaces Send when the box is empty and a turn can be stopped. Messages held after a server restart show Resume, which sends the ones that never reached the agent, and Discard on each. A message that may have reached the agent also shows Send again, as on the web.

The plus button beside a composer, in a thread and in the New sheet, attaches photos from the library, a photo from the camera, or files from Files and iCloud Drive. Up to 10 files go with one message, each within the server's upload cap (25 MB unless the server sets `OMNI_MAX_UPLOAD_MB`, which `GET /status` reports). Each choice shows as a chip with a remove button, and the files travel as multipart with the message, as on the web, so Send is the one request and Retry repeats it under the same request id. While the files upload, the sending row shows a progress bar and Cancel upload. A file the server refuses, a file over the cap, an unreadable pick, a denied camera or photo permission (with a button to Settings) and a lost connection all say what happened and keep the text and the files. A sent message shows its images as thumbnails that open full screen with Share, and its other files as rows that open in Quick Look. Both fetch with the bearer token, so a paired phone needs no extra sign-in. Photos arrive as JPEG or PNG, never HEIC. The Simulator has no camera, so the Camera choice can only be checked on a device.

New starts a thread, from the New item at the end of the tab bar on Activity, Channels and Artifacts (the Conductor is the first choice) or from the + in a channel's header (where that channel is the first choice). Tapping New opens the sheet and leaves the current tab selected. It hides with the tab bar on pushed screens. The sheet picks where it goes, takes the first message, and shows the model that channel or the Conductor role defaults to, the same as the phone web's New sheet. Tap the model to pick another model, an effort or Auto. Start creates the thread and opens it live. The app picks the thread's id, so if the network drops and Start is tried again, the server hands back the thread it already made and the first message goes once. Change the text, the channel or the model between tries and it is a new thread. A server that cannot be reached or that answers with an error keeps what you typed and offers Try again. A channel the server does not have comes back as a refusal with the server's message. A phone the server no longer accepts goes back to Connect.

What waits on you shows in the thread: answer a question the agent asked, retry a setup that failed, schedule or cancel a resume after a usage limit, and resume or discard messages the server held. Opening a thread marks its result read.

## Machines and continue

The app talks to whichever server it is paired with, and that server decides what the machines are. The phone only shows and sends.

The thread menu has a Runs on row when the thread has a machine to pick. It opens the list of synced machines as a page of the menu. Picking another machine hands the thread off at once, as on the phone web, and the answer shows in the thread before the stream repeats it. An offline machine is greyed out with its last seen time. When another machine holds the thread, the list names it and picking this machine opens the Take over confirm, in the same words the web uses. The list loads only while the thread is this machine's to give away.

Between the header and the transcript, a banner shows a handoff while it is under way or went wrong, with Cancel handoff or Cancel request until the other machine takes it, and one quiet line once it settled. A thread another machine holds shows a Take over note with a button, greyed out with the server's reason when it cannot be taken over now. A request the server refuses stays on screen as a sentence, and a phone the server no longer accepts says so and goes back to Connect.

New asks for a machine too. With another synced machine, a Run on chip next to the model chip picks where the thread starts. Until one is picked the request leaves it out, so the default from Settings on the computer applies. The phone cannot read that setting yet, so the chip says Run on until a machine is picked.

Fork thread in the thread menu opens Continue, a modal over the thread. It picks another local harness and model, lists the source's attachments with a switch each, takes the first message, and shows what the new thread will be given (goal, constraints, changed files, checks, recent history, what was left out, and the exact text). A thread that is not idle shows why, with Close terminal when an open shell is the reason. Start opens the new linked thread in place of the screen. Fork is greyed out, with the reason, for a harness whose files are not on the machine (Hermes, Cursor Cloud).

Not built: a machine picker in the composer of an open thread (the menu row is the only entry), the default machine in Settings, and a slide to confirm for Take over (the phone web slides, here it is a button).

A thread with a branch has Changes and Pull request links under its header. Changes lists the files in the thread's worktree as a collapsible unified diff, since the base or for the last turn. Long files show their first lines with a Show more row, and the list is virtualized. Tap a line to pick it and tap another in the same hunk to extend the pick. The bar that appears takes a note and Add to message, which puts the selection in the composer as a chip. Send carries the chips as the message's context, the same as the phone web, and removing a chip drops it. A message that only has chips shows them as Attached lines while it sends. The chips are kept in memory, so they do not survive closing the app.

Pull request shows the branch's PR with its status line, a Watch toggle, review comments, checks and files. Fix checks and Fix conflicts ask the agent, and GitHub opens the PR in the browser. Merging is a slide to squash and merge, which deletes the branch, and it warns first when a check fails or is still running. A refusal from GitHub (conflicts, blocked, draft, closed) shows its reason and leaves the slider ready. A lost reply reloads the PR and says to check it before trying again. The screen turns off swipe-back so the slide cannot be mistaken for it. A thread with no branch, a branch with no PR, a channel with no GitHub repo, a failed load and a revoked phone each get their own message. A thread that delegated work, such as a Conductor thread, lists From delegated threads under it: the open and merged PRs its delegated threads opened, at any depth. Without a PR of its own, the screen shows the first open one with its merge slide and a row that opens the delegated thread. A tap on another row shows that one. A delegated PR is read and merged through its own thread's channel, and its Watch and Fix buttons stay on that thread.

## Agents in a thread

A thread can hold more than one agent ([ADR 0019](../../docs/adr/0019-group-threads.md), [Threads](../../docs/user/threads.md#agents-in-a-thread)). The app reads the members, authors and flags from the same wire shapes as the Web UI, through `@omni/client-core`, and folds them with the shared view models (`thread-view.ts`, `lanes.ts`, `members.ts`, `agent-avatar.ts`):

- Each reply opens with its author's line: the agent's avatar in a 24px gutter, its name and the time, and with Show technical details the harness and model. The reply sits beside the avatar. The avatar is the image uploaded in Settings > Agents on the computer, read with the session's token from the agent's own `/api/crew/<id>/avatar` path, else its icon or emoji on its color, else its crew character ([ADR 0021](../../docs/adr/0021-crew-avatars.md)): its shape filled with its color and outlined in the theme's foreground, drawn with react-native-svg from the shared `agentFace()`. A character shows its agent's state in its eyes where the app knows it (the member sheet, the header's avatars, lanes and a group thread's second line in the lists); a photo or icon avatar shows it in the Working or Needs you ring instead. The app reloads the agents whenever the server's feed says an agent file changed, so an avatar set on another Mac arrives with its crew file.
- "Designer joined" and "Designer left" lines, the To line over a message for each agent it went to that its text does not name, and a team lead's messages to its members under the lead's name.
- A message several agents answered shows one lane at a time, a tab per agent whose avatar shows its lane's state, and a warning mark when it edited a file another agent edited. The lane holds that agent's reply, steps and the files it changed. Collision flags sit above the tabs with Dismiss, and Changes lists the flags still up over the diff and marks each flagged file.
- The composer's placeholder names the lead. Typing `@` at the start of a word lists the agents, members first; picking one puts its name in the text and an agent mention on the message, and a line under the box says who gets it and who joins. A message only to other agents neither steers nor queues behind the lead's turn. A read-only thread takes no message.
- The header shows the members' avatars, the busy ones first, and no Working label, and opens the member sheet: each member's state and run, Remove on every member but the lead, and Add an agent (also in the thread menu). The title's sub line draws the lead's avatar.
- Channel and Activity rows take the busiest state among a thread's agents and, while one asks or works, say who on their second line with their faces ("Designer asks you · Builder working").
- Remote agents (ADR 0020): a remote lead's sub line says "talks only", its composer says who changes files and has no model button, and its replies end with a lock line while the channel keeps its work closed. Channel settings carry **Remote agents can see this channel's work**. The run and New sheets and Settings > Models list local harnesses only, and Models lists the remote agents read-only with whether each is connected.

Not built yet: the Machines and Files tabs of the `@` menu, a run switch per member, the Commit button and Open PR of a remote-led thread, and Settings > Agents (crew plan S8).

## Run on the iOS simulator

Install Xcode, an iOS simulator runtime, Node 24.3 or later in the 24.x line or Node 26 or later, npm 11.19.0 or later in the 11.x line, and CocoaPods. From the repository root:

```sh
npm ci --include=dev
npm run ios --workspace @omni/ios
```

Expo generates the native project and opens a development build in the simulator. For later sessions, start Metro with:

```sh
npm run dev --workspace @omni/ios
```

Open the installed Omni OS development client and select the Metro server. If the simulator cannot reach Metro, run Metro on the Mac and use its loopback address.

## Connect to a server

Make a pairing code on your computer (Settings > Sharing & access > Omni for iOS), then scan its QR code or type the server address and code. The app trades the code for a session token and keeps the token in the Keychain, one entry per server. Pair several servers and switch between them from the Servers screen.

The app accepts only an `https://` server origin. It checks the server's capabilities after pairing and whenever it returns to the foreground. The contract is in `packages/shared/app-pairing.ts`.

With no server paired the app shows Connect. Once one is, the app opens on three native tabs, Activity, Channels and Artifacts, in phone web's order. Activity is the home tab, the counterpart of phone web's Inbox. It lists your pins, then the threads waiting on you with the latest back first, then the Working and Done shelves, which fold. A thread that delegated work, such as a Conductor thread or a team lead, shows the threads under it as a tree below its row, as phone web's Activity does (rules in `@omni/shared/thread-tree.ts`): a tally of needs you, failed, running and done with a chevron on the row's second line, open while anything under the job runs and closed once all of it finished, a closed tree still listing what needs you or failed, and on the Working shelf one "n agents running" row under each thread that runs sub-agents. A tree you open or close holds until the job moves between running and finished; the choice is kept on this phone. Marking a job done while a thread under it still runs, failed or waits on you asks first, from the Activity check, a swipe and the thread menu. Its header opens the Conductor, and its tab carries the needs-you count. Each tab keeps its own stack, so a thread opens inside the tab you tapped it in, and the tab bar hides on pushed screens. Search (left of each tab's header, beside the Conductor on Activity) and Settings (right) open from every tab root. Settings reaches Servers, which switches or removes servers and reaches Add server. The channel list, Activity, the thread view and the connection line come from `src/live/`, which talks to the active server through `@omni/client-core` with the token from the Keychain. Pairing's own calls use the same client. While a thread's first page loads, the lists the hub refetches by itself (channels, Needs you, Activity, Artifacts, tasks) wait, and one already on its way is cut off and sent again once the page is in (`@omni/shared/yield-gate.ts`, as on phone web): the channel list can be close to a megabyte, and on a phone it used to hold the thread on Loading for seconds. Control Center, Notification Center and the app switcher leave the streams open; only going to the background pauses them, and coming back refetches the lists.

A channel's threads list as phone web's Channel screen does. A folder is a header with its thread count and how many run. Tap it to close or open it. The server keeps that state, so the phone, the desktop and the Mac follow each other, and the row answers before the server does and goes back with an alert if the server refuses. The Conductor nests the threads it delegated under their parent, with a "3 delegated · 1 running" button to hide them. Whether each parent is open is a choice of this phone, kept in the Keychain next to the pairing, and parents start open. A thread's header has an Actions button. It runs the channel's named commands in that thread's checkout and shows each run's state and output, with Stop and Retry. A run belongs to the thread and is not a new thread, as on phone web.

A 401 anywhere, on a request or on a stream, makes the app ask the server whether it still accepts this phone. If it does not (the phone was revoked in Settings on the computer), the app forgets that server and shows Connect with a notice. Another paired server, if any, becomes active.

Requests never follow a redirect. `@omni/client-core` sends `redirect: 'manual'` and refuses a 3xx or an answer that came from another origin. On iOS, React Native's fetch ignores `redirect` and follows the redirect itself. Its redirect handler drops every request header, the token included. What the client-core check adds there is that the app reads nothing from the other origin.

The Simulator has no camera, so use Enter code there.

## Search and Settings

Search lists the latest threads until you type. After 200 ms of quiet it asks the server's `/search`, which matches every word as a prefix in thread titles and messages, and shows matching channels above the thread hits. A hit opens its thread. It does not scroll to the matching message yet, because the Thread screen takes only an id.

Settings opens with Servers, then a search over every setting and the same groups and sections as the Web UI and phone web, drawn from `@omni/shared/settings-catalog.ts`, then Signed-in devices, Automations and Sign out. A search hit opens its section. Each section edits what the Web UI's section edits, through the same calls, so a value saved on the phone shows on the computer and the other way round:

- General: name, pronouns, timezone and email (`PUT /setup`). The fields come from `@omni/shared/settings.ts`, as on the web.
- Appearance: Match system, Light or Dark, kept on this phone only.
- Notifications: the per-server alert choices (`NotificationSettings`).
- Models: each harness with whether it can run and how to fix it, each channel's default model, and the server's `.env` options.
- Threads: the machine new threads run on, the session and usage-limit options from `.env`, and Automations.
- Channels: every channel, New channel, and the archived ones with Unarchive.
- Workspace: the GitHub owner. Folders show their value, since they are paths on the server's machine.
- Worktrees: automatic cleanup and its idle days (`PUT /worktrees/retention`).
- Machines: the server's machine, read-only, and Update all machines, which checks, downloads and updates every synced machine through `/update/fleet` as the Web UI's card does.
- Sync: what the server reports, plus each machine's signing key (paired machines are trusted with their first key; Confirm new key when a machine's key changed, with how many of its actions wait, and Trust this machine only for one still not trusted) and the changes this server refused.
- Sharing & access: Signed-in devices, Rotate install token and the MCP clients that reached `/mcp` (Approve, Remove).
- Extras: Wispr Flow (a switch in the Mac app only), whether Grok Bot is on, and the Hermes URL and notes folder (`PUT /setup`; the folder shows its value).
- About: what the server reports, read-only.
- Secrets: names by scope, add or replace a value, delete one. A value is never shown again.

Channel Settings opens from the gear on a channel's header, from holding a channel in Channels, and from Settings › Channels. It edits the fields the Web UI's channel settings edit: name, icon (an emoji or one of the design system's icons), kind, default model, notes, the design system file (picked from Files), the GitHub repo, worktree per thread, the browser window, store domain, portal slug, the channel's actions (each saved on its own), its secrets, and Archive. Save sends `PATCH /channels/:id` with the body `@omni/shared/channel-form.ts` builds, the same one the Web UI sends. The repo path and the base directory show their value, because they are paths on the server's machine. The phone shows an uploaded SVG icon and can clear it, but uploading one happens on the computer.

What stays on the computer: running setup again, text size (the app follows iOS Text Size), the worktree disk scan and a hand-picked cleanup, Sync sign-in, pause and the path map, Google sign-in, Omni Connect and pairing, the network fields only the config file sets, folder paths, and the desktop app's own section.

These screens call the server through `hub.request` (`src/live/hub.ts`), which retries once after a 401 like the live lists, and `useRemote` (`src/live/use-remote.ts`) for what the live feed does not carry.

## Artifacts

The Artifacts tab lists the 60 newest files the agents made, as phone web does, with the same filters (All, Pages, Images, Docs, Data, from `@omni/shared/artifacts.ts`). It loads when a server opens, refetches once after a burst of changed files (1.5 seconds of quiet), and again after a reconnect or a return to the foreground. A failed refresh keeps the list on screen and says so. Pull down to refresh. Its **claude.ai** switch lists your Artifacts on claude.ai from the server's cache ([claude.ai Artifacts](../../docs/user/claude-artifacts.md)): search, Mine, Shared or All, the freshness line, and List or Grid (kept in the Keychain; columns follow the width, two on a phone). Opening the switch asks the server for a listing unless one ran in the last ten minutes, and pulling down always asks. A tap opens the https page with `Linking.openURL`. claude.ai's universal links hand it to the Claude app when it is installed and to Safari otherwise, so the app needs no `LSApplicationQueriesSchemes` entry.

Tapping a file opens the Artifact screen. `openArtifact(navigation, artifact)` in `src/navigation/open-artifact.ts` is the one entry the thread body calls. Every tab's stack registers the route, so it opens inside the tab you are in. The screen follows the newest version of the file from the Library's live list.

| Kind | Shown as |
| --- | --- |
| html | A sandboxed web view, scripts on |
| svg | An image in a web view, so no script runs |
| markdown | Rendered by `marked` in a web view, scripts off |
| image, screenshot | Native, pinch to zoom |
| pdf | A web view on the cached file, scripts off |
| csv | A native grid of the first 500 rows |
| json, text | Selectable text, JSON pretty-printed, cut at 200,000 characters |
| anything else | A Quick Look button |

Share sends a copy under the file's real name. "claude.ai" shows for a published file and opens its page. There is no "open raw URL in browser" because that URL needs the bearer token.

### How the web view is kept apart from the app

The app fetches the file in native code with the token (`hub.fetchArtifactFile`, over `requestBytes`) and writes it to the cache. The web view gets the content and nothing else. All web views are `src/components/artifact/SandboxWebView.tsx`, with props from `src/artifacts/sandbox.ts`.

- No `onMessage`. react-native-webview adds `window.ReactNativeWebView` and a message handler only when it is set, so a page has no way to call the app.
- No injected script, `baseUrl` or request headers. The page has no origin on the server and the token is never in the web view's memory.
- A Content-Security-Policy meta goes first in the document. It sets `connect-src 'none'`, `frame-src 'none'`, `form-action 'none'` and `base-uri 'none'`, so a page cannot call out or post.
- `onShouldStartLoadWithRequest` decides every move. A tapped http(s) link opens in the system browser. Redirects, script navigation, frames and other schemes are blocked.
- Incognito, no cache, no cookies, no file access.
- Markdown shows raw HTML as text and drops links that are not web or mail, and image sources that are not `https` or an inline picture or that point at an Omni `/api` route on any host. An agent reply in a thread gets the same image rule (`src/thread/images.ts`): a refused image shows as "[image: alt]", since the reply renderer cannot hold an image back for a tap.

`tests/sandbox.test.ts` and `tests/markdown.test.ts` hold these rules. Manual check on a throwaway server: publish an HTML artifact that reads `window.ReactNativeWebView`, `localStorage` and `document.cookie`, calls `fetch` on the server and `/api`, sets `location`, submits a form and adds an iframe, and prints each result. Every call must fail or be undefined.

### Development shortcut

A development build (`__DEV__`) with both `EXPO_PUBLIC_OMNI_DEV_URL` (for example `http://127.0.0.1:4757`) and `EXPO_PUBLIC_OMNI_DEV_TOKEN` set in the environment that starts Metro uses them as its session, but only while no server is paired. A release build ignores them. Expo inlines the token into the JavaScript bundle, so use a throwaway server's token, never a live one, and do not commit it.

## Push notifications

The server alerts a paired phone when a thread needs an answer, finishes or fails, a crew member reports back, or a watched PR has failing checks or new review feedback. The server side is in `docs/internals/app-pairing.md`. The code here is in `src/notifications/`.

- **Permission.** After the first server is paired, a sheet explains the alerts once and offers "Turn on notifications". Only that button triggers the iOS prompt. "Not now" leaves iOS unasked, and Settings, then Notifications, turns them on later. A denied permission shows "Open Settings".
- **Registration.** Once allowed, the app sends the native APNs device token (not an Expo token) to every paired server with `PUT /api/auth/push-token`. It does so again on launch, when the app returns to the foreground, when a server is paired and when APNs announces a new token. Removing a server deletes the token first, then signs out.
- **Environment.** A development client (`__DEV__`) registers `sandbox` tokens and every other build `production`. An EAS `development` build is signed ad hoc and gets production tokens, so start Metro with `EXPO_PUBLIC_PUSH_ENVIRONMENT=production` to register under the right name. `app.config.ts` sets the `aps-environment` entitlement through the `expo-notifications` plugin (`production` for the `preview` and `production` EAS profiles).
- **Taps.** A tap opens the thread from a cold start, from the background and while the app is open. The alert names a thread and a channel but no server, so with several servers paired the app asks each one for the thread, active server first. A banner for the thread already on screen is suppressed.
- **One per thread, cleared once read.** Registration declares `features: ['collapse', 'prAttention']`; the server sends pull request alerts and the per-thread collapse only to builds that declare them. The server collapses alerts per thread (`apns-collapse-id`), so a newer one replaces the older. `src/notifications/clear.ts` clears an alert once Ben has dealt with it: opening its thread here clears it at once, and when the app comes to the front or Needs you changes it asks each paired server which delivered alerts are settled (`POST /api/auth/push-settled`, in batches of 100), and only the server that sent an alert answers for it, so one read on the Mac goes too. With the app closed they stay until it next opens.
- **Choices.** Settings, then Notifications, shows the kinds per server (Needs your answer, Finished, Failed, Crew reports, Pull requests), only those the server reports. Each switch sends only its own key. A server without an APNs key says so above its switches, naming the missing secrets (`push.problem` from `GET /api/capabilities`).

To try a tap without Apple, drop a payload on the Simulator:

```sh
xcrun simctl push <UDID> app.omni-os.ios payload.apns
```

where `payload.apns` is `{"aps":{"alert":{"title":"Omni OS","body":"A thread needs your answer."},"sound":"default"},"omni":{"kind":"needsInput","threadId":"<thread id>","channelId":"<channel id>"}}`. Real delivery needs the server's APNs key and a build signed with the Push Notifications capability, which the Simulator cannot prove.

## EAS builds

Run EAS commands from `apps/ios`. The one-time Apple and Expo setup, the store build and submit commands, the TestFlight steps and the unsigned Release archive check are in [RELEASE.md](RELEASE.md). The profiles in `eas.json` are:

- `development` builds an internal development client.
- `development-simulator` builds the development client for the simulator.
- `preview` builds an internal distribution build.
- `production` builds a production release and increments its build number.

A merge to `main` that touches the app releases it through the EAS workflow in `.eas/workflows/ios-release.yml`: a native change gets a new TestFlight build, and a JavaScript-only change goes out as an EAS Update. See [RELEASE.md](RELEASE.md).

For example, run `eas build --platform ios --profile development-simulator` to build for the simulator. Physical devices and TestFlight need Apple Developer signing and an Expo account. See [RELEASE.md](RELEASE.md) before you build for either.

## Reference setup

The Expo, React Native, React Navigation, Effect, Uniwind, development client, and EAS setup follows T3 Code's mobile app at `c65f8d552baca1b51e15b5fb4737f07e18cce177`. Omni uses npm workspaces rather than T3's pnpm catalog. The navigation screens package uses the public 4.x release rather than T3's private 5.x fork. This placeholder app leaves out T3's unrelated native modules, authentication, widgets, and product-specific Expo configuration.

## Icons

`src/ui/Icon.tsx` renders the web app's 76 line drawings and Grok mark from `@omni/shared/icons.ts` with native SVG paths. `ui/symbols.ts` only translates older iOS names. New screens can use any shared icon name directly. Vendor logos and crew marks come from `@omni/shared/brand.ts`. `LinkBrand` draws the existing shared link marks.

UIKit tab items use generated template PNGs because they require images rather than SVG nodes. After changing a tab drawing, run `npx tsx packages/shared/scripts/build-tab-icons.ts` from the repo root. The shared tests check their source hash and dimensions.

UIKit still owns system back indicators and share sheets. App icons no longer use SF Symbols. Keep the unused `expo-symbols` native dependency until the next native release so removing it does not force a new build for this JavaScript update. The liquid OmniMark animation and the status dot's phases (`Phase` in `@omni/shared/status.ts`) remain web-only. iOS uses the exact static Omni mark and native activity indicators.
