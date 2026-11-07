# iOS app vs phone web: visual parity audit (2026-11-07)

Both clients ran against the same throwaway server (`scripts/qa-stack.sh`, port 4801, fake CLIs) with the same seeded data: 4 channels, 14 threads, one pinned, one asking 4 questions, one long Bash turn, one RICH turn with 9 steps and a failed test.

- Phone web: Chrome via Playwright at 390x844, 2x, light and dark.
- iOS: dev client (`OmniOS.app`, Debug build from 2 Nov, JS from this checkout's Metro) on the iPhone 17e simulator (390x844 pt), iOS 27, light and dark.
- Side-by-side images are in [2026-11-07-ios-visual-parity/](2026-11-07-ios-visual-parity/), phone web on the left, iOS on the right.

## Summary

The iOS app has the same features and mostly the same words as phone web, but it looks like a stock iOS settings app, while phone web looks like Omni. The gap comes from six things that repeat on every screen:

1. **Headers.** iOS uses the native nav bar: small centred title and text pills ("Search", "Settings", "New", "< Back"). Phone web uses a large left-aligned title and round icon-only buttons (search, refresh, avatar), with ⋯ for screen menus.
2. **No icons.** iOS has no icon set. Buttons are words and the thread menu uses emoji (📌 ✏️ 📁 🗄) and text glyphs (▶, ⑂). Phone web uses one line-icon set everywhere.
3. **No colour.** `theme.ts` already has `needs` (vermilion), `done` (lime) and `live` (blue), but screens draw everything in black and grey. `StatusDot.tsx` still says "the theme has no success or danger colour yet". Phone web uses the red diamond for needs-you, the blue dot for running, the lime ring and the lime Done pill for finished, and the red "Needs your input" pill.
4. **No avatars.** Phone web rows lead with a channel monogram circle (I, V, O, Conductor mark) with a status badge on its corner. iOS rows lead with a bare 8pt dot.
5. **Flat rows instead of grouped cards.** Phone web puts list rows in rounded `surface` cards with inset dividers (Channels, Settings, menus). iOS uses full-bleed rows with hairlines on Channels and in channels, and cards only in Settings and the menu.
6. **Density.** The iOS Activity tab shows about 2.5 threads per screen, phone web shows 11.

## Shell and navigation

| | Phone web | iOS | Change |
|---|---|---|---|
| Tabs | Activity, Channels, Library, **PRs** | Activity, Channels, Library | Add the PRs tab |
| New | Floating black + button beside the tab bar, on every tab root | "New" text button in the Channels and channel headers only | Add the + button next to the tab bar; drop the header "New" |
| Activity badge | Red dot | Red count bubble ("12") | Decide which; phone web's dot is quieter |
| Tab root header | Large title (34pt, bold) + subtitle line, round buttons top right: Search, Refresh, avatar "Y" (opens Settings) | Small centred title, "Search" pill left, "Settings" pill right | Large title layout and round icon buttons; avatar for Settings |
| Pushed screen header | Round back chevron, title + subtitle stacked left ("#Volero / Client", "Fix cart drawer upsell / #Volero · Claude Code"), status pill, round ⋯ | Native "< Channels" / "< Back" pill, centred title, "New" or ⋯ pill | Custom header matching phone web; keep swipe-back |
| Connection line | Hidden while live | "● Live" under every header | Show it only when not live |
| Brand | Conductor mark + "Conductor" row at the top of Activity | None | Add it |

## Activity

![Activity](2026-11-07-ios-visual-parity/01-activity.png)

- Phone web is one list of thread rows: avatar, title, channel, a status word or age on the right, then trailing pin and check buttons. Pinned threads sit at the top with a pin mark.
- iOS has a segmented filter (All / Needs you / Running / Done), usage meters (Claude, Codex, Cursor), uppercase section headers, a reply preview ("ack: ...") and two big pill buttons per row ("Open", "Mark read", or a black "Answer").
- The iOS segmented control cuts off "Needs you..." at 390pt.
- To match: drop the per-row Open/Mark read pills for phone web's trailing check icon (tapping the row already opens it), use avatar rows, and move or drop the filter and the meters. The usage meters are not on phone web's Activity; decide whether they stay on iOS or move to both.

## Channels

![Channels](2026-11-07-ios-visual-parity/03-channels.png)

- Phone web: Conductor in its own card with the Conductor mark; sentence-case group labels with counts ("Clients 1"); each group is a rounded card; rows have a monogram, a "#" name and coloured counts (red diamond needs, blue dot running).
- iOS: full-bleed rows, uppercase labels without counts, no "#", no monograms, black ring and dot counts.

## Channel

![Channel](2026-11-07-ios-visual-parity/04-channel-volero.png)

- Phone web: Active / Recent segmented control with counts, a "Needs you and running" label, avatar rows whose subtitle says what is happening ("#Volero · 4 questions wait on your answer"), a ⋯ channel menu, and a full-width black "+ New thread in #Volero" button at the bottom.
- iOS: Active and Recent as two stacked sections, rows say only "Running · 4m", no channel menu, "New" in the header.
- **Data gap, not only looks:** iOS builds the channel list from `/channels` `active` + `recent` (`apps/ios/src/live/channel-model.ts:173`), and the server caps `recent` at 5 per channel (`RECENT_PER_CHANNEL`, `apps/server/channels-api.ts:80`). #Inbox shows 8 threads on phone web and 5 on iOS (threads 4, 5 and 7 are missing). The two also disagree on "Active": phone web counts unread finished threads, iOS only running ones.

![Inbox](2026-11-07-ios-visual-parity/13-channel-inbox.png)

## Thread

![Thread](2026-11-07-ios-visual-parity/05-thread-rich-top.png)

- Header: phone web has the title, "#Volero · Claude Code" under it and a lime **Done** pill. iOS has the title in the nav bar, then "● Live", "Done · Volero" and three chips (model, Changes, Pull request) under it, which take about 130pt before the transcript starts.
- To match: put the status pill in the header. Move model, Changes and PR into the ⋯ menu or a single row, the way phone web does (Details, Browser, Terminal, Actions in the menu).
- Transcript: phone web starts at the top. iOS bottom-aligns a short thread under a "Start of thread" label, which leaves a large gap under the chips.
- Turn footer: phone web's "Done in 0s" dot is lime and "1 failed" has a red diamond and a wrench icon. On iOS both are grey.
- Under the composer, phone web offers "Ask the Conductor" and "+ New thread" after a finished turn; iOS has neither.
- Composer: phone web has a mic button (dictation) in the field; iOS has a grey send arrow in the field.

### Steps

![Steps](2026-11-07-ios-visual-parity/06-thread-steps-open.png)

- Phone web opens Steps as its own screen: each step a rounded card, tool name in bold and the argument in mono on one line, nesting by indent, a lime ring per step and a red diamond on the failed one.
- iOS expands the steps inline in the transcript. Tool name and argument sit on two lines, the dots are grey, and the failed step is marked with a black ring and the word "Failed".

### Question card

![Question](2026-11-07-ios-visual-parity/08-thread-question.png)

- Closest screen of the lot. Differences: phone web has a "Q4 focus" tag chip and a "1 of 4" pager with arrows in the card header; iOS has the tag as plain text and no pager. Phone web options are rows with dividers; iOS options are separate bordered cards with a heavier selected border. Phone web shows the red "Needs your input" pill in the header and under the card.

### Thread menu

![Thread menu](2026-11-07-ios-visual-parity/07-thread-menu.png)

- Phone web: a bottom sheet titled with the thread name, three groups (top: Details, Browser, Terminal, Actions; "Organize": Pin, Mark as done, Rename, Move to folder, Archive; "Continue": Fork, Reference a thread), line icons, chevrons on rows that open more.
- iOS: a full-height page titled "Thread" with Done, emoji icons, two unnamed groups, and no Details, Browser, Terminal or Reference a thread.

## New thread

![New](2026-11-07-ios-visual-parity/09-new-sheet.png)

- Phone web: a bottom sheet over the screen with a grab handle, channel chips with monograms, the message field, + / model chip (with the Auto mark) / mic in the field's footer, and a line under it ("Runs in #Volero with its repo, store and browser profile.").
- iOS: a full page with Cancel / Start in the nav bar, chips without monograms, the field and the + / model chip outside it. Start sits top right instead of a send button in the field.

## Library, Search, Settings

![Library](2026-11-07-ios-visual-parity/10-library.png)

- Library: close already. iOS needs the large title and to drop the Live line. The filter control is wider and taller on iOS.

![Search](2026-11-07-ios-visual-parity/11-search.png)

- Search: phone web has a large title, a one-line description, a field with a search icon, and an empty state ("Search everything" with an icon and a prefix tip). iOS opens with the keyboard up and a "Recent" list. Pick one; iOS's recent list is arguably more useful, so this may be a change to phone web instead.

![Settings](2026-11-07-ios-visual-parity/12-settings.png)

- Settings: phone web has a "Search settings" field, icons on every row, the machine name under the title, and many more sections. iOS has four rows without icons. The extra sections are left out on purpose (README: they stay on the computer), so the visual fix is icons, sentence-case group labels and the header; the content gap is a separate decision.

## Dark mode

![Thread dark](2026-11-07-ios-visual-parity/17-thread-dark.png)

- Backgrounds and surfaces match (`#121316`, `#191b1e`). The same gaps show, and missing colour stands out more in dark: phone web's lime Done pill and dots are the only accent on the screen, and iOS has none.
- The iOS nav bar pills render as dark grey glass, which phone web has no equivalent for.

## Second pass: PRs, Changes, Pull request, Actions, Artifact, Settings pages, streaming, offline

Same stack, plus an `Acme Shop` channel backed by a throwaway git repo (`use_worktree`, `github_repo` acme/shop), the fixture `gh` (`packages/test-fixtures/fake-gh.mjs`, linked into the stack's `bin/`) for PR data, two channel actions (Theme dev on a port, Lint), a thread whose turn edits 4 files and publishes `size-guide-notes.md`, and a RICH turn held open by a 30-minute Bash call.

### PRs tab

![PRs](2026-11-07-ios-visual-parity/30-prs.png)

- iOS has no PR list at all. Phone web has a PRs tab: large title, "3 open across 1 repo", a search field (`label:bug`), Open first / Filters / repo chips, and rows grouped as Authored, Review requested and Others, each with a draft or blue open pill.
- iOS only reaches a PR from a thread's "Pull request" chip. Adding the tab is new screen work, not a restyle.

### Finished thread with changes and an artifact

![Thread with artifact](2026-11-07-ios-visual-parity/20-thread-artifact.png)

- Phone web puts three things under a finished turn that iOS lacks: a large artifact card (preview area, file name, channel and age), a **Changes 4** card listing each file with +/- counts, and a row of follow-up chips ("Open report", "Review #12 +71 −4", "Ask the Conductor").
- iOS shows the artifact as a small "md / markdown" row and nothing about the changes; it relies on the Changes and Pull request chips at the top.

### Changes

![Changes](2026-11-07-ios-visual-parity/21-changes.png)

- Close in structure: Since base / This turn, the base line, Unstaged and Untracked groups, file headers with M/A and counts, coloured add and remove rows.
- Phone web: two line-number columns, no wrapping (long lines cut off at the edge), each file in a rounded card, a refresh button, sentence-case group labels.
- iOS: one line-number column, wrapped lines, full-bleed file sections, uppercase labels, and a "Tap a line to pick it" hint. Wrapping reads better on a phone; decide which one both should use.

### Pull request

![Pull request](2026-11-07-ios-visual-parity/22-pr.png)

- The closest screen after the question card. Same title block, branch line, Watch PR card and slide-to-merge.
- Phone web: round back and open-in-browser buttons, grey "Open" pill, an "Ask builder to review" button, checks as a card with lime / red / blue marks, then a Files card.
- iOS: "Thread" and "GitHub" text pills, a blue "open" pill, a red "1 of 4 checks failing" line with a "Fix checks" button, a Reviews card (phone web shows no reviews here), uppercase labels.
- Phone web's "Ask builder to review" button renders squashed (about 26px tall, icon and text touching the edges). That is a phone web bug.

### Actions

![Actions](2026-11-07-ios-visual-parity/23b-actions-running.png)

- Same layout on both. Differences: phone web's Run and Stop buttons have play and stop icons, and the run status is a coloured pill (lime "Succeeded", blue "Running"). iOS writes the status as grey text under the name with a grey or black dot.
- Phone web collapses the running run's log; iOS opens both.

### Artifact viewer

![Artifact](2026-11-07-ios-visual-parity/24-artifact.png)

- Phone web: a sheet with a round × close button, the file name in mono with "#Acme Shop" under it, and a round share icon.
- iOS: a pushed page with a round back chevron, the file name truncated, "claude.ai" and "Share" text pills, and a meta line ("markdown · 249 B · published 2m ago").
- Markdown styling differs: phone web uses a smaller heading and a light table (muted header, row lines only); iOS a larger heading and a fully bordered table with a bold header.
- The first time it opened, the iOS back button drew as an empty circle with no chevron and no accessibility label, and the simulator could not go back. Reopening it later, in light and dark, showed a working chevron. Seen once, not reproduced; worth a look if it shows up on a device.

### Turn while streaming

![Streaming](2026-11-07-ios-visual-parity/25-streaming.png)

- Phone web: blue "Running" pill in the header; a status line with a spinner ring, the agent's status text in vermilion ("Looking for the cart code") and the elapsed time (5m 11s); plan items with lime rings; "10 steps so far · ◆ 1 failed" with a wrench icon; and "Review #12" / "New thread" chips above the composer.
- iOS: "Running · Acme Shop" as grey text under the header; a "● Running `sleep 1800` · step 3/3" line that shows the raw command instead of the status and no elapsed time; plan items struck through in grey; no chips.
- Both swap the send button for a black stop button.
- Neither client can show a half-written answer: the server never asks the CLI for partial messages (no `include-partial-messages` in `apps/server/`), so a reply lands whole. The tool-running state above is what streaming looks like in Omni.

![Steer while running](2026-11-07-ios-visual-parity/33b-steer-settled.png)

- A message sent during the turn (a steer, sent from the iOS composer). Phone web shows it as the user's own bubble, right-aligned with a dashed border, under "Sent, waiting for the agent". iOS shows a full-width grey card titled "Sent, the agent reads it next". Same state, different wording and a different shape.
- The iOS keyboard stayed up after sending; synthetic drags in the simulator did not trigger the transcript's interactive dismiss, so check this by hand on a device before calling it a bug.

![Streaming steps](2026-11-07-ios-visual-parity/25b-streaming-steps.png)

- Same gaps as the finished Steps screen (cards vs inline, colour). While running, phone web marks the live step with a blue dot; iOS writes "Running" after the tool name with a black dot.

### Settings pages

iOS's four settings pages have no direct phone web twins. The closest sections are compared.

![Servers vs Machines](2026-11-07-ios-visual-parity/26-servers.png)

- iOS Servers showed only "Add server" and "Notifications" buttons, because the app ran on the dev shortcut with no paired server. Recapture it after pairing a real one. Phone web's Machines has a large title, a one-line description, and a key/value card (Machine, Sync, Address, Feed, Threads) with coloured status dots.

![Notifications](2026-11-07-ios-visual-parity/27-notifications.png)

- Phone web: large title, a Scope picker, the device card with a toggle and a status row, and a collapsed "Channels 5 of 5 notify" row.
- iOS: one card with "Turn on notifications". No per-channel list. Visually the card style matches; the title and description treatment does not.

![Devices vs Sharing and access](2026-11-07-ios-visual-parity/28-devices.png)

- Different content: iOS Devices lists signed-in devices (empty here, no owner signed in); phone web's nearest page is Sharing & access (Google account, Omni Connect, Omni for iOS pairing). Only the page frame can match: large title and description, cards.

![Automations](2026-11-07-ios-visual-parity/29-automations.png)

- Phone web: large title, description with `automations/*.yaml`, refresh button, "Run automations on" card, and an empty state with an icon in a circle. iOS: a plain "No automations" heading and line, left-aligned, no icon.

### Offline and a failed send

The QA server kept running. Phone web lost it through blocked `/api` requests plus Playwright's offline mode. The iOS app reached the server through a small proxy, and the proxy was stopped once the thread had loaded.

![Offline](2026-11-07-ios-visual-parity/34-offline.png)

- Phone web shows nothing while the server is gone (checked for 8 seconds): same header, same Done pill, no banner.
- iOS replaces "Live" with "Offline, retrying" (ring dot) under the header right away.

![Failed send](2026-11-07-ios-visual-parity/35-send-failed.png)

- Phone web: a "Cannot reach the Omni server. Is it running?" row with a red diamond above the composer. The text stays in the composer and no bubble is added to the transcript.
- iOS: the message becomes a right-aligned grey bubble with "Cannot reach the server. Your message is kept here. Retry when you are connected.", a black Retry button and an Edit link. The composer is cleared.
- With the proxy back, the iOS header went to "Live" within seconds and Retry sent the message (the turn ran and replied).
- With the API back, phone web still showed the error row 10 seconds later, with the text in the composer. Pressing Send again sent it and cleared the row. Nothing tells the user the server is back.
- iOS is ahead here. The parity work should keep iOS's failed-send bubble and offline line, and phone web should get them too (see Open questions).

### What the second pass adds to the list

- **Settings pages share one frame on phone web**: round back button, small title in the bar, then a large title and a one-line description in the page. iOS uses the native bar title and no in-page title. One shared page header component on iOS fixes all four.
- **Status pills**: Running (blue), Done and Succeeded (lime), Open, draft. iOS writes these as grey text. Same fix as the status colours in the first pass.
- **Under-turn cards and chips**: artifact card, Changes card, follow-up chips. iOS has none of these.
- **Bugs found on the way**: phone web's squashed "Ask builder to review" button. Possibly the iOS artifact viewer's back button (seen blank once, not reproduced).
- **Where iOS is ahead**: the offline line under the header and the failed-send bubble with Retry and Edit. Keep both through the redesign.

### Dark mode, second pass

![Steer dark](2026-11-07-ios-visual-parity/33b-steer-settled-dark.png)

- Backgrounds and surfaces match. As in the first pass, phone web's lime, blue and vermilion are the only colour on screen and iOS has none: the plan's lime dots, the vermilion status line and the blue Running pill have no iOS counterpart.
- iOS's stop button inverts to white in dark, like phone web's.

![Changes dark](2026-11-07-ios-visual-parity/21-changes-dark.png)

- Diff colours match in dark (dark red and olive rows on both).

![Pull request dark](2026-11-07-ios-visual-parity/22-pr-dark.png)

- Matches closely; the check marks (lime, red diamond, blue) are on both here. iOS's "1 of 4 checks failing" line is vermilion, one of the few places iOS already uses a status colour.

![Actions dark](2026-11-07-ios-visual-parity/23b-actions-running-dark.png)

- The Theme dev run had finished by the time of this capture. Phone web's lime "Succeeded" pills stand out; iOS writes "Succeeded" as grey text. iOS Run buttons invert to light pills, like phone web's.

![Artifact dark](2026-11-07-ios-visual-parity/24-artifact-dark.png)

- Phone web shows the document on a lighter raised sheet (`surface`), iOS on the page background, so the iOS viewer reads flatter.

![PRs dark](2026-11-07-ios-visual-parity/30-prs-dark.png)

- Phone web only (iOS has no PR list).

![Servers vs Machines dark](2026-11-07-ios-visual-parity/26-servers-dark.png)

![Notifications dark](2026-11-07-ios-visual-parity/27-notifications-dark.png)

![Devices vs Sharing and access dark](2026-11-07-ios-visual-parity/28-devices-dark.png)

![Automations dark](2026-11-07-ios-visual-parity/29-automations-dark.png)

- The Settings pages hold up in dark: page background, card surface and the secondary button fill match. The light-mode gaps (no in-page title or description, plain empty states, no icon) carry over unchanged.
- Phone web's only colour here is the lime "Connected" dot on Machines. iOS has no status row to put one on.
- The iOS back button on Notifications reads "Back" while Servers, Devices and Automations read "Settings" (`headerBackTitle: 'Back'` in `apps/ios/src/navigation/detail-screens.tsx`, likely because Servers opens it too). Phone web shows an icon-only round back button on every page, so this goes away with the shared page header.

## Suggested order

1. **Foundations, one PR:** an icon set (SF Symbols through `expo-symbols`, or `react-native-svg` with the web's icons; either one needs a new dev build), the status colours wired through `StatusDot` and the row trailing marks, a `MoAvatar` equivalent, and a grouped-card list component. Check the Claude Design system for each before building it, and add what is missing there.
2. **Shell:** large-title header with round icon buttons, the + button beside the tab bar, the PRs tab (a new screen: list, search, filters, groups), Live line only when offline, and one page header (large title + description) for every Settings page.
3. **Lists:** Activity rows, Channels cards, channel screen (segmented Active/Recent, bottom New button) and the channel data fix (list every thread, same "Active" rule as phone web).
4. **Thread:** header with status pill, chips into the menu, top-aligned transcript, Steps as cards (or its own screen), thread menu groups and icons, the artifact and Changes cards and follow-up chips under a turn, and the running line with status text and elapsed time.
5. **Sheets:** New thread as a bottom sheet with the send button in the field; the artifact viewer as a sheet with a × button.
6. **Detail screens:** Changes, Pull request and Actions need the shared parts above (icons, pills, cards) and little else.

## Open questions

- Native vs custom chrome. Copying phone web means giving up the native nav bar's look (iOS 27 glass pills). A custom header that keeps native swipe-back is the middle way. Decide this before step 2.
- Activity filter and usage meters: iOS has them and phone web does not. Keep them on iOS, add them to phone web, or drop them.
- Search: iOS opens on recent threads, phone web on an empty state. Which one wins?
- Settings scope stays as the README says, or grows toward phone web's list.
- Offline and failed sends: iOS's offline line and failed-send bubble with Retry and Edit beat phone web's composer error and silent offline state. Port them to phone web, or treat this as a place where iOS keeps its own design.

## Not covered

- iOS Servers with a real paired server (the dev shortcut leaves the list empty).
- The handoff banner (needs two synced servers).
- Phone web was rendered in desktop Chrome with mobile emulation, not iOS Safari, so safe areas and the home indicator are not exact.
