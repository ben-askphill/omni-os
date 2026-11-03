# Omni OS for iOS

This development client pairs with an Omni server, reads its channels and threads, follows them live, starts new threads, sends messages to them, and pins, marks done, renames, moves and archives a thread from its menu or by swiping its row. Expo Go is not supported.

A thread has a composer pinned above the keyboard. While a turn runs, a message steers the agent when its harness can take input mid-turn and otherwise queues for after the turn, and the placeholder and the send button's label say which. A message shows in the thread as sending, and if the network fails it stays there with Retry, which sends it again under the same request id so the server answers with the first acceptance instead of taking the message twice, and Edit, which puts the text back in the box and focuses it. If the server got the message but its answer was lost, the failed row goes as soon as the thread stream shows it, so it never appears twice. Stop replaces Send when the box is empty and a turn can be stopped. Messages held after a server restart show Resume, which sends the ones that never reached the agent, and Discard on each. A message that may have reached the agent also shows Send again, as on the web.

The plus button beside a composer, in a thread and in the New sheet, attaches photos from the library, a photo from the camera, or files from Files and iCloud Drive. Up to 10 files go with one message, each within the server's upload cap (25 MB unless the server sets `OMNI_MAX_UPLOAD_MB`, which `GET /status` reports). Each choice shows as a chip with a remove button, and the files travel as multipart with the message, as on the web, so Send is the one request and Retry repeats it under the same request id. While the files upload, the sending row shows a progress bar and Cancel upload. A file the server refuses, a file over the cap, an unreadable pick, a denied camera or photo permission (with a button to Settings) and a lost connection all say what happened and keep the text and the files. A sent message shows its images as thumbnails that open full screen with Share, and its other files as rows that open in Quick Look. Both fetch with the bearer token, so a paired phone needs no extra sign-in. Photos arrive as JPEG or PNG, never HEIC. The Simulator has no camera, so the Camera choice can only be checked on a device.

New starts a thread, from the Channels screen (the Conductor is the first choice) or from inside a channel (that channel is). The sheet picks where it goes, takes the first message, and shows the model that channel or the Conductor role defaults to, the same as the phone web's New sheet. Tap the model to pick another model, an effort or Auto. Start creates the thread and opens it live. The app picks the thread's id, so if the network drops and Start is tried again, the server hands back the thread it already made and the first message goes once. Change the text, the channel or the model between tries and it is a new thread. A server that cannot be reached or that answers with an error keeps what you typed and offers Try again. A channel the server does not have comes back as a refusal with the server's message. A phone the server no longer accepts goes back to Connect.

What waits on you shows in the thread: answer a question the agent asked, retry a setup that failed, schedule or cancel a resume after a usage limit, and resume or discard messages the server held. Opening a thread marks its result read.

## Machines and continue

The app talks to whichever server it is paired with, and that server decides what the machines are. The phone only shows and sends. How to set up several machines for testing is documented elsewhere.

The thread menu has a Runs on row when the thread has a machine to pick. It opens the list of synced machines as a page of the menu. Picking another machine hands the thread off at once, as on the phone web, and the answer shows in the thread before the stream repeats it. An offline machine is greyed out with its last seen time. When another machine holds the thread, the list names it and picking this machine opens the Take over confirm, in the same words the web uses. The list loads only while the thread is this machine's to give away.

Between the header and the transcript, a banner shows a handoff while it is under way or went wrong, with Cancel handoff or Cancel request until the other machine takes it, and one quiet line once it settled. A thread another machine holds shows a Take over note with a button, greyed out with the server's reason when it cannot be taken over now. A request the server refuses stays on screen as a sentence, and a phone the server no longer accepts says so and goes back to Connect.

New asks for a machine too. With another synced machine, a Run on chip next to the model chip picks where the thread starts. Until one is picked the request leaves it out, so the default from Settings on the computer applies. The phone cannot read that setting yet, so the chip says Run on until a machine is picked.

Fork thread in the thread menu opens Continue, a modal over the thread. It picks another local harness and model, lists the source's attachments with a switch each, takes the first message, and shows what the new thread will be given (goal, constraints, changed files, checks, recent history, what was left out, and the exact text). A thread that is not idle shows why, with Close terminal when an open shell is the reason. Start opens the new linked thread in place of the screen. Fork is greyed out, with the reason, for a harness whose files are not on the machine (Hermes, Cursor Cloud).

Not built: a machine picker in the composer of an open thread (the menu row is the only entry), the default machine in Settings, and a slide to confirm for Take over (the phone web slides, here it is a button).

A thread with a branch has Changes and Pull request links under its header. Changes lists the files in the thread's worktree as a collapsible unified diff, since the base or for the last turn. Long files show their first lines with a Show more row, and the list is virtualized. Tap a line to pick it and tap another in the same hunk to extend the pick. The bar that appears takes a note and Add to message, which puts the selection in the composer as a chip. Send carries the chips as the message's context, the same as the phone web, and removing a chip drops it. A message that only has chips shows them as Attached lines while it sends. The chips are kept in memory, so they do not survive closing the app.

Pull request shows the branch's PR with its status line, a Watch toggle, review comments, checks and files. Fix checks and Fix conflicts ask the agent, and GitHub opens the PR in the browser. Merging is a slide to squash and merge, which deletes the branch, and it warns first when a check fails or is still running. A refusal from GitHub (conflicts, blocked, draft, closed) shows its reason and leaves the slider ready. A lost reply reloads the PR and says to check it before trying again. The screen turns off swipe-back so the slide cannot be mistaken for it. A thread with no branch, a branch with no PR, a channel with no GitHub repo, a failed load and a revoked phone each get their own message.

## Run on the iOS simulator

Install Xcode, an iOS simulator runtime, Node 24.3 or later in the 24.x line or Node 26 or later, npm 11.19.0, and CocoaPods. From the repository root:

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

Make a pairing code on your computer, then scan its QR code or type the server address and code. The app trades the code for a session token and keeps the token in the Keychain, one entry per server. Pair several servers and switch between them from the Servers screen.

The app accepts only an `https://` server origin. It checks the server's capabilities after pairing and whenever it returns to the foreground. The contract is in `packages/shared/app-pairing.ts`.

With no server paired the app shows Connect. Once one is, the app opens on three native tabs, Activity, Channels and Library, in phone web's order. Activity is home: it shows what needs you, what runs, your pins, the latest threads and what finished today, and its tab carries the needs-you count. Each tab keeps its own stack, so a thread opens inside the tab you tapped it in, and the tab bar hides on pushed screens. Search (left of each tab's header) and Settings (right) open from every tab root. Settings reaches Servers, which switches or removes servers and reaches Add server. The channel list, Activity, the thread view and the connection line come from `src/live/`, which talks to the active server through `@omni/client-core` with the token from the Keychain. Pairing's own calls use the same client.

A channel's threads list as phone web's Channel screen does. A folder is a header with its thread count and how many run; tap it to close or open it. The server keeps that state, so the phone, the desktop and the Mac follow each other, and the row answers before the server does and goes back with an alert if the server refuses. The Conductor nests the threads it delegated under their parent, with a "3 delegated · 1 running" button to hide them; whether each parent is open is a choice of this phone, kept in the Keychain next to the pairing, open by default. A thread's header has an Actions button: the channel's named commands run in that thread's checkout, with each run's state and output, Stop and Retry. A run belongs to the thread and is not a new thread, as on phone web.

A 401 anywhere, on a request or on a stream, makes the app ask the server whether it still accepts this phone. If it does not (the phone was revoked in Settings on the computer), the app forgets that server and shows Connect with a notice. Another paired server, if any, becomes active.

Requests never follow a redirect. `@omni/client-core` sends `redirect: 'manual'` and refuses a 3xx or an answer that came from another origin. On iOS, React Native's fetch ignores `redirect` and follows the redirect itself, but its redirect handler drops every request header, the token included, so what the client-core check adds there is that nothing from the other origin is read.

The Simulator has no camera, so use Enter code there.

## Search and Settings

Search lists the latest threads until you type. After 200 ms of quiet it asks the server's `/search`, which matches every word as a prefix in thread titles and messages, and shows matching channels above the thread hits. A hit opens its thread. It does not scroll to the matching message yet, because the Thread screen takes only an id.

Settings is a grouped list. Servers is the pairing screen. Notifications opens the per-server alert choices (`NotificationSettings`). Devices lists who is signed in to the active server and revokes one. The server decides who may revoke a device, and its refusal is shown as it is. Automations lists the server's automations and pauses or resumes one, as phone web does. Sign out of a server is the same as removing it: the phone tells the server, then forgets the token. The footer shows the app version.

These screens call the server through `hub.call` (`src/live/hub.ts`), which retries once after a 401 like the live lists, and `useRemote` (`src/live/use-remote.ts`) for lists the live feed does not carry. Appearance follows the system theme. Workspace, Machines, Sync, Integrations, Harness config, Secrets and About stay in the Web UI and the desktop app.

## Library and artifacts

The Library tab lists the 60 newest files the agents made, as phone web does, with the same filters (All, Pages, Images, Docs, Data, from `@omni/shared/artifacts.ts`). It loads when a server opens, refetches once after a burst of changed files (1.5 seconds of quiet), and again after a reconnect or a return to the foreground. A failed refresh keeps the list on screen and says so. Pull down to refresh.

Tapping a file opens the Artifact screen. `openArtifact(navigation, artifact)` in `src/navigation/open-artifact.ts` is the one entry the thread body calls. The route is registered in every tab's stack, so it opens inside the tab you are in. The screen follows the newest version of the file from the Library's live list.

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
- Markdown shows raw HTML as text and drops links and image sources that are not web, mail or `https`.

`tests/sandbox.test.ts` and `tests/markdown.test.ts` hold these rules. Manual check on a throwaway server: publish an HTML artifact that reads `window.ReactNativeWebView`, `localStorage` and `document.cookie`, calls `fetch` on the server and `/api`, sets `location`, submits a form and adds an iframe, and prints each result. Every call must fail or be undefined.

### Development shortcut

A development build (`__DEV__`) with both `EXPO_PUBLIC_OMNI_DEV_URL` (for example `http://127.0.0.1:4757`) and `EXPO_PUBLIC_OMNI_DEV_TOKEN` set in the environment that starts Metro uses them as its session, but only while no server is paired. A release build ignores them. Expo inlines the token into the JavaScript bundle, so use a throwaway server's token, never a live one, and do not commit it.

## Push notifications

The server alerts a paired phone when a thread needs an answer, finishes or fails, or a crew member reports back. The server side is in `docs/internals/app-pairing.md`. The code here is in `src/notifications/`.

- **Permission.** After the first server is paired, a sheet explains the alerts once and offers "Turn on notifications". Only that button triggers the iOS prompt. "Not now" leaves iOS unasked, and Settings, then Notifications, turns them on later. A denied permission shows "Open Settings".
- **Registration.** Once allowed, the app sends the native APNs device token (not an Expo token) to every paired server with `PUT /api/auth/push-token`. It does so again on launch, when the app returns to the foreground, when a server is paired and when APNs announces a new token. Removing a server deletes the token first, then signs out.
- **Environment.** A development client (`__DEV__`) registers `sandbox` tokens and every other build `production`. An EAS `development` build is signed ad hoc and gets production tokens, so start Metro with `EXPO_PUBLIC_PUSH_ENVIRONMENT=production` to register under the right name. `app.config.ts` sets the `aps-environment` entitlement through the `expo-notifications` plugin (`production` for the `preview` and `production` EAS profiles).
- **Taps.** A tap opens the thread from a cold start, from the background and while the app is open. The alert names a thread and a channel but no server, so with several servers paired the app asks each one for the thread, active server first. A banner for the thread already on screen is suppressed.
- **Choices.** Settings, then Notifications, shows the four kinds per server. Each switch sends only its own key.

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

For example, run `eas build --platform ios --profile development-simulator` to build for the simulator. Physical devices and TestFlight need Apple Developer signing and an Expo account. See [RELEASE.md](RELEASE.md) before you build for either.

## Reference setup

The Expo, React Native, React Navigation, Effect, Uniwind, development client, and EAS setup follows T3 Code's mobile app at `c65f8d552baca1b51e15b5fb4737f07e18cce177`. Omni uses npm workspaces rather than T3's pnpm catalog. The navigation screens package uses the public 4.x release rather than T3's private 5.x fork. T3's unrelated native modules, authentication, widgets, and product-specific Expo configuration are not included in this placeholder app.
