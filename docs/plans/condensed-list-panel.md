# Condensed list panel

Build spec for collapsing the channel rail's list panel into a 48px icon strip, so the page beside it gets 216px more width. No product code lands with this file.

- Design: option **A+C**, the first tab of the Condensed Inbox Panel artifact (https://claude.ai/artifact/NFkWbiAp3qHjicZKwn5ZdV, v2), from designer thread 55e9b4b7 (T-55E9). Options A, B and C on its other tabs are reference only.
- Screenshots from that thread (light and dark, both states, 1440px wide) are in that thread's `browser/` folder on the MacBook: `page-2026-11-26T14-11-{09-060Z,12-506Z,24-451Z,27-378Z}.png`.
- Base: `main` at 1ca23363.

## What it does

- The list panel beside the channel rail (`ListPanel`) has two states: **expanded** (264px, as now) and **collapsed** (48px).
- A toggle button in the panel header and the shortcut ⌘\ (Ctrl+\ off macOS) switch between them. The rail itself does not change.
- Collapsed, every row keeps its status mark and avatar, centred in the strip. Its title, time and counts hide. Hovering a row, or focusing it with the keyboard, shows a card with the full row beside it.
- In both states rows use the C sizing: one 30px line each. Search and New thread are rows of the same height, so nothing moves up or down when the panel collapses. Collapsing only hides each row's text.
- It applies to every list the panel shows: the Inbox, a channel's threads and folders, and Settings' sections.

## Sizes

All values come from the A+C build spec. All tokens already exist in `apps/web/src/index.css` (`--elev`, `--shadow-menu`, `--fg`, `--fg-3`, `--line-strong`). There are no new tokens.

| Part | Expanded | Collapsed |
|---|---|---|
| Panel width | 264px | 48px |
| List padding | 4px 8px | 4px |
| Row | 30px tall, padding 0 10px, gap 6px, radius 9px | 30px tall, padding 0 6px, same radius |
| Status mark | 8px | 8px |
| Avatar | 14px, radius 5px | 14px |
| Title | 12.5px / 500 | hidden |
| Time | 11.5px, `fg-3` | hidden |
| Shelf caption | 26px tall, caption text and count | 26px tall, a 16px `--line-strong` rule centred in it |
| Header buttons | 28px | 28px |
| Search row | 14px search icon, "Search or jump to", `⌘K` hint | icon only |
| New thread row | 14px `--fg` tile holding a 10px plus, "New thread" | tile only |
| Hover card | 250px card too (same card, so toggling does not shift detail) | 250px wide on `--elev` with `--shadow-menu`, 8px right of the row |

- The width animates over 0.28s with `--ease-out`. With reduced motion it switches at once (`@media (prefers-reduced-motion: reduce)` on the rule itself, as the W12 motion work did: no `!important`).
- Collapsed, the list scrolls with no bar drawn (`.scroll-none`, already in `index.css`), so the scrollbar never takes width from the strip and pushes the icons off centre. Expanded keeps `.scroll-thin`. The fade from `useScrollFade` stays in both states.
- In a channel's list the collapsed avatar slot shows the thread's agent avatar as today (`ThreadAvatar`), and falls back to the thread's initials when it has no agent and no channel icon. The A+C artifact draws initials for every channel row; the code's `ThreadAvatar` already covers most rows, so initials are only the fallback.

## Rows, per list

The rail panel gets its own compact rows. The Classic sidebar keeps its current rows and the Inbox's three-line cards; nothing in `Sidebar.tsx` changes.

### Inbox (`InboxList` in `ListPanel.tsx`, shelves from `InboxView.tsx`)

- Add a `variant: 'card' | 'row'` prop to `InboxView` (default `'card'`, which the Classic sidebar keeps). `ListPanel` passes `'row'`, plus `collapsed`.
- In `'row'` the pinned, Needs you, Finished and Working shelves render a new `InboxRow` in place of `InboxCard`: mark, avatar, title, time (or the status word while it runs, as the card's top right does now).
  - Mark: the same `mark` the card works out now (`blockerMark` / `markOf` / `threadPhase`), drawn with `StatusDot` at 8px. A group thread at work draws `AvatarMark` faces in the avatar slot, as `RowLead` does.
  - Avatar: `ChannelRollup` / `ChannelLead` at 14px, the same lead the card has.
  - Pinned rows keep the pin glyph after the title, expanded only.
  - Row actions (Unpin, Done) keep their hover and focus reveal, expanded only, and `E` keeps marking the focused row done in both states (`useDoneKey` reads `[data-inbox-thread]`, so keep that attribute on the row).
- A job's tree (`useJobTree`, `TreeRows`) and sub-agent rows (`AgentRows`) stay under their row while expanded, at the same 30px rhythm. Collapsed they hide, and the row's hover card lists the tally instead (`treeLabel`).
- `DoneRow` already is a one-line row: restyle it to the row sizes. "Show N more" becomes a 30px row; collapsed it shows the chevron only.
- `ShelfLabel` and `Shelf` render the 26px caption; collapsed they render the rule. A collapsed `Shelf` keeps its button (so `aria-expanded` and the toggle still work by keyboard) with the label in `aria-label`; `FoldTrees` hides.
- "Nothing is waiting on you." hides when collapsed.
- The footer (`UpdateNotice`, `DiskNotice`, `AccountNotice`, `UsageCard`) shows only expanded. Collapsed, any notice that is up shows as one 30px row with the `alert` icon whose hover card holds the notice's text, and clicking it expands the panel. `UsageCard` hides; Overview shows usage.

### Channel (`ChannelList` in `ListPanel.tsx`)

- `ChannelThreadEntry` / `ThreadLink` (`SidebarRows.tsx`) gain a `size: 'nav' | 'compact'` prop. `'compact'` uses the 30px row, a 14px avatar (`ROW_AVATAR` becomes a per-size value) and the 8px mark through `RowDot`'s `size`. The Classic sidebar keeps `'nav'`.
- Collapsed: hide the title and the harness logo, keep `RowLead` and `RowEnd`. Both marks stay visible: the avatar's eyes and the dot. Tree lines (`TREE_AT`) and `AgentLink` rows hide.
- Folder rows (`FolderRow`): compact size; collapsed shows the folder icon with its open threads under it as icon rows. Clicking the icon folds or unfolds as now. Renaming (double-click, F2) is expanded only.
- New folder (`folderPlus` in the header) and the new-folder name field show only expanded. Collapsing while the field is open cancels it.
- "See all threads" becomes a row with a `grid` icon; collapsed it is icon only with its label in the hover card.

### Settings (`SettingsList`, `SettingsNav.tsx`)

- `SettingsNav` rows take the compact size in the rail. Collapsed they show each section's icon only, with its name in the hover card. If a section has no icon in `settings-catalog.ts`, add one there (shared, so iOS's Settings list can use it too, but iOS need not change).

## Header and toggle

- `PanelHeader` gains the toggle: an `IconButton` with the `sidebar` icon, 28px, `aria-label` "Collapse list" / "Expand list", `aria-expanded`, `aria-controls` the panel's list id, `aria-keyshortcuts="Meta+Backslash"` on macOS and `"Control+Backslash"` elsewhere, and a `useTooltip` tip naming the shortcut.
- Expanded: title on the left, the channel's New folder button and the toggle on the right. Collapsed: only the toggle, centred in the 48px column. The header keeps its 62px height and `.rail-panel-top` class, so the macOS window drag region and the traffic-light rules in `index.css` (`[data-desktop="darwin"] .rail-shell .rail-panel-top`) are untouched.
- Search and New thread move out of the header block into the top of the list as rows (`SearchRow`, `NewThreadRow`), replacing today's 36px pill buttons. The channel list gets the New thread row too.

## State and persistence

- One flag for the whole panel, not per list: `omni.rail.listCollapsed` in localStorage, read and written through `readPref` / `writePref` (`store.tsx`).
- Put it in `layout-pref.ts` beside `layout` and `railColor`: `readListCollapsed`, `setListCollapsed`, `useListCollapsed` on the same listener set, so every `ListPanel` and the shortcut read one value.
- Per browser and per desktop app, like the layout and the Classic sidebar width. It does not sync: how wide a window is differs per machine, and the other prefs in this file do not sync either. No handler in `apps/server/sync/handlers/`, no server state, no API change.
- `index.html`'s head script sets `data-layout` before the first paint (`tests/head-script.test.ts`). Do the same for `data-list="collapsed"` on `<html>` so a collapsed panel does not paint 264px wide and then shrink. The CSP hash for the head script is computed automatically (wave 3 notes), but rerun `tests/head-script.test.ts`.

## Keyboard

- ⌘\ on macOS, Ctrl+\ elsewhere, toggles the flag. Handle it in `Shell` (`App.tsx`) next to the ⌘K handler, only while `layout === 'rail'` and `listMode(selection).kind !== 'none'`. Match `e.code === 'Backslash'` as well as `e.key === '\\'`, so a non-US layout still works.
- Conflicts checked on `main`:
  - No web handler in `apps/web/src` and no desktop menu accelerator in `apps/desktop/src/menu-template.ts` uses Backslash. Quick Prompt's global shortcuts are all Space chords (`QUICK_PROMPT_ACCELERATORS`).
  - **Ctrl+\ is SIGQUIT in a terminal.** Skip the key when the target is inside `.xterm` and Ctrl (not Meta) is held, as the ⌘K handler already does for Ctrl+K.
  - The composer (`MessageEditor`, ui-sdk Token Input) types no character for ⌘\ or Ctrl+\. Leave the key alone while `e.isComposing` (IME), as `inbox-key.ts` does.
  - Leave it alone while a modal is up (`layerOpen()` from the dismiss stack), so it never changes the layout behind a dialog.
- Desktop app: add **View > Collapse List** / **Expand List** with accelerator `CmdOrCtrl+\` to `menu-template.ts`. The menu sends a new `DesktopCommand` `'toggle-list'` (`packages/shared/desktop-bridge.ts`), handled in `DesktopHooks.tsx`'s `run`. When the menu owns the accelerator, Electron eats the key before the page sees it, so the page handler only fires on desktop web; the menu path covers the app. Add `'toggle-list'` to `QA_COMMANDS` in `apps/desktop/scripts/qa.ts`.
- Collapsing while focus is inside something that hides (a row action, the folder name field, the New folder button) moves focus to the toggle button.

## Hover card

- Build it on the existing `useTooltip` (`components/ui/tooltip.tsx`) with `side: 'right'`, not a new popover: it already handles interest invokers (desktop app), the anchored and placed fallbacks (Safari, Firefox), touch (no tip on touch), keyboard focus (opens at once), the 500ms open delay, the 120ms close delay so the pointer can cross onto it, and its place on the dismiss stack as a `hint` layer (Escape closes the card alone; a press or focus move belongs to the layer below).
- Add a `variant: 'tip' | 'card'` option to `useTooltip`. `'card'` adds a `.tip-card` class in `index.css`: 250px wide, `--elev` background, `--fg` text, `--shadow-menu`, 10px radius, 10px 12px padding, `white-space: normal`, 8px gap (`GAP` becomes per variant; `.tip`'s margin too). The rest of `.tip` stays.
- Expanded and collapsed rows both get the card (Ben's answer 1), so the detail a one-line row leaves out is one hover away in either state and nothing jumps on toggle.
- Content per row kind:
  - Inbox row: channel (with its avatar) and the time or status word on the first line, the full title, the step line when there is one, then the machine line from `ranOnLine` with the run time (`RunElapsed`) and the harness logo. A job adds its tree tally.
  - Channel thread row: title, status text (`threadStatusText`), harness.
  - Folder, Settings section, See all threads, Search, New thread, notice: the name (and the shortcut for Search).
- `describes: true` for thread rows (the card adds detail beyond the row's name); `describes: false` for rows whose card only repeats the name.
- The card holds no buttons. Row actions stay expanded-only, so nothing in the card needs focus.
- Pointer moving from one collapsed row to the next swaps the card without the open delay (the fallback's single `shown` tip already closes the previous one; add a warm-up window: if a card closed less than 300ms ago, open the next at once). Check the interest-invoker path does the same with `interest-delay` and set `--interest-delay-start: 0s` on rows while one card is open if it does not.

## Accessibility

- Collapsed rows are links whose accessible name is the full title plus the status word (`aria-label`), since their text is hidden. Hide the text with the existing `sr-only`-style approach or keep the text in the DOM visually hidden, so find-in-page and screen readers still reach it; do not unmount it.
- The panel is an `aside` with `aria-label` "Inbox list", "<channel> threads" or "Settings sections", so its state change is announced through the toggle's `aria-expanded`.
- Focus rings (`focus-ring` classes from W11) must fit the 30px rows and stay inside the 48px strip without clipping: use an inset ring when collapsed.
- Status marks keep their shape per state (diamond for needs you, dot for running, and so on), not color alone; the existing `StatusDot` already does this. Check contrast of the 8px marks on `--surface` in both themes with the helper in `apps/web/tests/token-contrast.test.ts`.
- Roving focus: none today in the panel list (Tab moves through rows). Keep that; do not add arrow-key navigation in this work.

## Surfaces

- **Desktop web**: all of the above. Only in the rail layout. The Classic sidebar has its own drag-to-resize (`SidebarPane`) and is out of scope.
- **Phone web** (`apps/web/src/mobile/`): does not apply. The phone shell has no rail and no list panel; `MobileShell` is its own layout. Say so in the PR.
- **Landscape iPhone and iPad**: the rail shell shows from 844px wide (`safe-x` note in `App.tsx`), so iOS Safari does reach the panel. Touch has no hover: the card never opens on touch (`useTooltip` skips `pointerType === 'touch'`), the toggle button works by tap, and collapsed rows still navigate by tap. Check it at 844x390 in the iOS simulator or Safari's responsive mode.
- **Desktop app** (`apps/desktop/`): shows the Web UI, so it gets the panel as is. Adds the View menu item and `'toggle-list'` command above. The traffic lights sit in the rail, not the panel, so `windows.ts` and `RAIL_WIDTH` do not change. No other `window.omniDesktop` change.
- **iOS app** (`apps/ios/`): no rail, no change.
- **Harnesses, sync, wire**: nothing. No API or stream shape changes, so no wire fixture in `packages/test-fixtures/wire/` moves.
- **Conductor** (`apps/mcp/omni.ts`): no tool. A per-browser view pref is not something an agent sets.
- **`omni` CLI**: nothing (ADR 0014).

## Browser support

- Floor: iOS Safari 18.0, Baseline widely available otherwise.
- Width transition on a fixed px width: fine everywhere. Do not use `interpolate-size` or `calc-size()`; px values need neither.
- `.scroll-none` already carries the `::-webkit-scrollbar` rule for Safari before 18.2.
- The card's interest-invoker path is Chromium-only progressive enhancement already wrapped by `useTooltip`; Safari gets the anchored path on 26 and the placed path on 18. Nothing new to gate.
- `e.code` for the shortcut: widely available.
- PR must name which browsers get the card's fallback (Safari and Firefox: the script-placed or CSS-anchored manual popover).

## ui-sdk

- Read `node_modules/@ui-sdk/react/docs/llms.txt` and the `ui-sdk` skill first. If ui-sdk ships a hover card or preview card that registers on Omni's dismiss stack and supports `interestfor`, prefer it for the card; otherwise use `useTooltip` as above. Omni's tooltip is already the app's one hint layer, so a second one would break the one-Escape rule.
- The toggle is a plain `IconButton` with `aria-expanded`; ui-sdk's toggle button adds nothing here.

## Design system

- Claude Design project (https://claude.ai/design/p/a7120f6b-8577-40e3-9087-e512ce20d673), in the same PR's task, via the Claude Design MCP (read `readme.md` and `SKILL.md`, `finalize_plan`, then `write_files`):
  - `components/rail/ListPanel` gains the collapsed state and the header toggle.
  - New `components/rail/CompactRow` (the 30px row: mark, avatar, title, time; collapsed form) with `.jsx`, `.d.ts`, `.prompt.md` and a `*.card.html` preview in light and dark.
  - New `components/rail/RowCard` (the hover card), or a `card` variant on the existing Tooltip component if the project has one.
  - Styles in `components/omni.css`: `.tip-card`, the compact row, the collapsed strip.
- Tokens: none new, so `apps/web/src/index.css`, `apps/ios/src/theme.ts` and `--chrome` in `apps/desktop/src/windows.ts` do not change. If the builder finds a value that needs one, it goes into all three and the design system together.
- If `/design-login` is needed, flag it in the PR as open, as earlier rail PRs did.

## Files

- `apps/web/src/components/rail/ListPanel.tsx`: width by state, header toggle, Search and New thread rows, collapsed footer, `aside` label, pass `variant`/`collapsed` down.
- `apps/web/src/components/sidebar/InboxView.tsx`: `variant` and `collapsed`, `InboxRow`, compact `DoneRow`, shelf caption/rule.
- `apps/web/src/components/sidebar/SidebarRows.tsx`: `size: 'compact'` and `collapsed` on `ThreadLink`, `ChannelThreadEntry`, `NavLink`; per-size avatar.
- `apps/web/src/components/sidebar/FolderRows.tsx`: compact and collapsed folder row.
- `apps/web/src/components/SettingsNav.tsx` and `packages/shared/settings-catalog.ts` (icons, if missing).
- `apps/web/src/components/ui/tooltip.tsx`: `variant: 'card'`, per-variant gap, warm-up swap.
- `apps/web/src/layout-pref.ts`: the flag.
- `apps/web/src/App.tsx`: shortcut handler.
- `apps/web/index.html` head script: `data-list`.
- `apps/web/src/index.css`: `.tip-card`, compact row, collapsed strip, width transition, reduced motion.
- `apps/web/src/components/DesktopHooks.tsx`, `packages/shared/desktop-bridge.ts`: `'toggle-list'`.
- `apps/desktop/src/menu-template.ts`: View menu item. `apps/desktop/scripts/qa.ts`: `QA_COMMANDS`.
- `apps/web/src/rail-model.ts`: no change; `listMode` already says when the panel shows. If the builder wants the width as a pure value for tests, add `listPanelWidth(collapsed)` there.

## Tests

- `apps/web/tests/layout-pref.test.ts` (new, or in `channel-rail.test.ts`): the flag reads false by default, round-trips, and notifies subscribers.
- `apps/web/tests/list-panel.test.ts` (new, `renderToStaticMarkup` as `channel-rail.test.ts` does): expanded and collapsed markup for Inbox, channel and Settings modes; collapsed hides titles visually but keeps them as accessible names; toggle carries `aria-expanded` and `aria-keyshortcuts`; Search and New thread are rows in both states; footer swaps to the notice row.
- `apps/web/tests/inbox.test.ts` / `inbox-status.test.ts`: the row variant shows the same mark and status word as the card for each status.
- `apps/web/tests/tooltip-browser.test.ts` (Chromium): the card variant opens on hover and focus, Escape closes it alone with a menu open under it, and moving across rows swaps the card without the delay.
- A shortcut test: ⌘\ / Ctrl+\ toggles, does nothing inside `.xterm` with Ctrl, while composing, or with a modal open.
- `apps/desktop/tests/menu.test.ts`: View has the item with `CmdOrCtrl+\` and sends `'toggle-list'`.
- `apps/web/tests/head-script.test.ts`: the head script sets `data-list`.
- Run `npm test`, `npm run typecheck`, knip, and the `verify` skill.

## Proof in the PR

- Screenshots per `docs/pr-screenshots.md`, against a `scripts/qa-stack.sh` server, light and dark: desktop web expanded, collapsed, collapsed with the card; desktop app (QA harness script: `route` to `#/inbox`, `command` `toggle-list`, hover a row, screenshot); 844px landscape on iOS Safari collapsed. Phone web: one line in the PR saying it has no panel.
- Crop Overview's real usage out of the shots (it reads the real `~/.claude`).

## Docs and words

- `docs/user/configuration.md`, the Appearance paragraph on the rail: add the collapse toggle, ⌘\ / Ctrl+\, the View menu item, that it is stored per browser or desktop app, and that touch has no card.
- `docs/user/threads.md`: the line "an 18px avatar in a 32px row" and "The Inbox cards in the rail's panel keep the channel on their first line" become wrong for the rail. Say the rail's panel uses 30px one-line rows with a 14px avatar, the channel moved into the card shown on hover when collapsed, and the Classic sidebar keeps the cards.
- `docs/user/entry-points.md`: add View > Collapse List.
- `GLOSSARY.md`: the panel is already the "list panel" under **Channel rail**. Add **Collapsed list** ("The channel rail's list panel narrowed to a strip of marks and avatars; _Avoid_: mini sidebar, compact mode, icon mode") and use those words in UI labels and docs. Use **Inbox**, **Needs you**, **Overview** as defined; never "notifications".

## Decisions (Ben's answers)

1. **Expanded rows get the hover card too.** Expanded and collapsed share the same 30px rows and cards.
2. **Per machine.** The collapsed state is stored per browser and desktop app, never synced.
3. **Toggle only.** No auto-collapse at narrow widths.

## Built differently from this spec

- The View menu item has a static label ("Collapse or Expand List"): the main process does not know the page's collapsed state, and this plan keeps `window.omniDesktop` as it is.
- `layerOpen()` (`dismiss-stack.ts`) ignores the toasts' live-region popover (`[aria-live]`), which otherwise swallowed the shortcut while a toast showed.
