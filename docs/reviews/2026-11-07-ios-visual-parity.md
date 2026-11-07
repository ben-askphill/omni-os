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

## Suggested order

1. **Foundations, one PR:** an icon set (SF Symbols through `expo-symbols`, or `react-native-svg` with the web's icons; either one needs a new dev build), the status colours wired through `StatusDot` and the row trailing marks, a `MoAvatar` equivalent, and a grouped-card list component. Check the Claude Design system for each before building it, and add what is missing there.
2. **Shell:** large-title header with round icon buttons, the + button beside the tab bar, the PRs tab, Live line only when offline.
3. **Lists:** Activity rows, Channels cards, channel screen (segmented Active/Recent, bottom New button) and the channel data fix (list every thread, same "Active" rule as phone web).
4. **Thread:** header with status pill, chips into the menu, top-aligned transcript, Steps as cards (or its own screen), thread menu groups and icons, the post-turn "Ask the Conductor" / "New thread" row.
5. **Sheets:** New thread as a bottom sheet with the send button in the field.

## Open questions

- Native vs custom chrome. Copying phone web means giving up the native nav bar's look (iOS 27 glass pills). A custom header that keeps native swipe-back is the middle way. Decide this before step 2.
- Activity filter and usage meters: iOS has them and phone web does not. Keep them on iOS, add them to phone web, or drop them.
- Search: iOS opens on recent threads, phone web on an empty state. Which one wins?
- Settings scope stays as the README says, or grows toward phone web's list.

## Not covered

- PRs, Changes, Pull request, Actions, Artifact viewer, Devices, Servers and Notifications screens were not compared side by side.
- Live streaming states (a turn mid-stream, sending/failed bubbles, the handoff banner) were not captured.
- Phone web was rendered in desktop Chrome with mobile emulation, not iOS Safari, so safe areas and the home indicator are not exact.
