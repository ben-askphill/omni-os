# Omni OS modern web audit

2026-11-19 · task T-MWGAUDIT · audit only, no code changed · repo at `1dac40d3` (main)

## Summary

58 findings across the web UI (desktop and phone layouts), the desktop app's own pages, the relay Connect page, the server-rendered HTML and the Activity Monitor prototype.

| Impact | Count |
|---|---|
| High | 5 |
| Medium | 29 |
| Low | 24 |

### Do these first

1. **H2: Rebuild the shared `Modal` on `<dialog>` + `showModal()`.** One primitive, 16 call sites. Focus currently leaves every modal and the page behind stays live. It also gives Escape and backdrop handling to the browser, which sets up M2, M3 and M4.
2. **H1: Put a Content-Security-Policy on the Web UI shell.** Start report-only. Use a hash for the one inline script and add `frame-ancestors 'none'` and `nosniff`. It is one middleware in `apps/server/app.ts`, and it backstops an app that renders agent output and can run commands.
3. **H3: Stop iPhone Safari zooming on every Settings field.** Make `.field` at least 16px under `(pointer: coarse)`, then clean up the `!text-[13px]` overrides.
4. **H4: Fix the shared `Picker` (42 call sites) and `ModelPicker`.** Add combobox + `aria-activedescendant` so screen readers follow the cursor, Escape for ModelPicker, and a top-layer popover so lists stop getting clipped inside modals (M13).
5. **M1: `content-visibility: auto` on transcript rows, `content-visibility: hidden` on hidden phone tabs.** A few lines of CSS on the hottest render path, up to 1,500 to 6,000 held rows per thread. Progressive enhancement, no fallback needed.

H5 (browser tab strip not keyboard reachable) is high impact but sits only in the desktop Browser panel, so it ranks sixth.

## Targets used for support caveats

- **Desktop app**: Electron 44 (current Chromium). Any Chromium feature is usable.
- **Desktop web**: Chrome, Safari, maybe Firefox.
- **Phone web**: iPhone Safari, mostly as a home-screen app at about 390px. This is the binding constraint for `apps/web/src/mobile/` and every shared component the phone shell renders.
- The repo has no written browser support policy. Worth adding one line to `CLAUDE.md`, for example: "Electron: any Chromium feature. Phone web: iOS Safari 18+, newer features only as progressive enhancement with a fallback of at most a few lines."

## Coverage

| Package / dir | Covered |
|---|---|
| `apps/web/src` (desktop + `mobile/`) | Full: components, pages, hooks, `index.css` |
| `apps/web/index.html`, `public/manifest.webmanifest` | Head, theme bootstrap, PWA meta |
| `packages/shared` | Dates, formatting, status marks, `html-render.ts` frame script, JS patterns |
| `apps/desktop/src` | `server-screen.ts` page, window `webPreferences`, quick prompt and monitor windows |
| `apps/relay/src/page.ts` | Omni Connect page and its headers |
| `apps/server` (HTML only) | SPA shell (`app.ts`), paired page (`auth-api.ts`), artifact, design-system and GitHub page CSPs |
| `prototypes/activity-monitor` | Dashboard page |

Method:

- `legacy-scan` ran on every package above. It covers about 20% of the guidance catalog and found 13 hits in web, 10 in shared, 2 in the prototype and 0 in desktop and relay.
- Each topic in the brief got a `search` and a `retrieve`, and each claim was checked against the code. In total 70+ guides were read.
- Four parallel reviewers covered overlays, layout and motion, forms and accessibility, and performance and dates. I covered security, theming, the non-web pages and drag-and-drop, then spot-checked the high findings and several medium ones in the code (marked confirmed below).

---

## High

### H1. The Web UI shell has no CSP, clickjacking guard or `nosniff`
- **Where**: `apps/server/app.ts:148-156` (serveStatic + `index.html` fallback; only `Cache-Control` is set). Inline script: `apps/web/index.html:17-22`.
- **Now**: The main page has no `Content-Security-Policy`, no `frame-ancestors`/`X-Frame-Options`, no `X-Content-Type-Options` and no `Referrer-Policy`. The artifact, design-system, GitHub, paired and relay pages all set one; the page that holds the session does not. The UI renders agent Markdown, Mermaid SVG through `innerHTML` and search snippets through `innerHTML`, and it can start shell work through the API. One sanitizer slip becomes code execution.
- **Modern**: `security`: "For static/cached HTML (SPAs) where a per-response nonce is not possible, use hash-based CSP". Mandatory directives: `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`. Run `Content-Security-Policy-Report-Only` with `Reporting-Endpoints` first. Add `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.
- **Scope**: One middleware for `text/html` shell responses only. Artifact routes keep their own sandbox CSP, and `frame-ancestors` must not reach them or the artifact iframes break. Either hash the theme script or move it to a classic `/theme.js` so `script-src 'self'` is enough. The Vite dev server injects inline scripts, so leave dev out. Style attributes need `style-src 'unsafe-inline'`, which the guide accepts.
- **Support**: CSP3 and `frame-ancestors` work in every target, iOS Safari included.
- **Confidence**: confirmed

### H2. The shared `Modal` is not modal
- **Where**: `apps/web/src/components/ui/modal.tsx:30-69`, `components/CommandPalette.tsx:24,39,60-61,99`, `components/Onboarding.tsx:226`
- **Now**: It is a fixed `div role="dialog" aria-modal`. Focus moves in and returns on close, but Tab walks out into the rail and page behind, and the background is not inert. CommandPalette never returns focus, and its ~40 `role="option"` buttons are each a Tab stop beside the `aria-activedescendant` combobox. Stacking is hand-managed z-indexes (scrim z-50, toasts/menus z-60, sheets z-40).
- **Modern**: `dialog`: `<dialog>` + `showModal()`. "The browser provides: inert page, focus containment, top layer, `::backdrop`, `Esc` and back-gesture dismissal, and focus return to the invoker." Palette options get `tabindex="-1"`.
- **Scope**: One primitive (8 `Modal` + 8 `ConfirmDialog` uses in 12 files), plus CommandPalette and Onboarding. `SCRIM` becomes `::backdrop`. In the desktop app, check that `-webkit-app-region:no-drag` still works on `::backdrop` with `apps/desktop/scripts/qa.ts`.
- **Support**: `<dialog>` is Baseline widely, including iOS Safari. `closedby` has no Safari support, so keep the backdrop-click fallback.
- **Confidence**: confirmed

### H3. iPhone Safari zooms in on almost every Settings field
- **Where**: `apps/web/src/index.css:263-272` (`.field { font-size: 14px }`), `components/ui/folder-input.tsx:21`, `pages/Settings.tsx:722`, `pages/Secrets.tsx:113,135`, `pages/Sync.tsx:236`, `components/Pair.tsx:207`, `components/ui/picker.tsx:172`, and 27 more `.field !text-[12.5px|13px]`
- **Now**: The phone renders Settings through `PageScreen` (`mobile/registry.tsx:22`), so it uses the desktop pages. Their inputs are 13 or 14px with no phone override, so iOS zooms on focus and stays zoomed. The phone-only inputs already use 16px (`MoComposer.tsx:219`, `SearchSheet.tsx:80`).
- **Modern**: `forms`: "DO set `font: inherit` and `font-size: max(1rem, 1em)` on form controls to scale with larger containers while staying at least `1rem`(16px) to prevent iOS zoom."
- **Scope**: One rule in `.field` under `@media (pointer: coarse)`. It has to beat the `!text-[..px]` utilities, or those become a `.field-mono` modifier.
- **Support**: `max()` is Baseline widely. The zoom only happens on iOS, so desktop is unaffected.
- **Confidence**: confirmed

### H4. Custom listboxes can't be followed by keyboard or screen reader (`Picker`, `ModelPicker`)
- **Where**: `apps/web/src/components/ui/picker.tsx:97-113,163-189`, `components/ModelPicker.tsx:110-118,171-206`, `components/model-picker/ModelList.tsx:32-100`
- **Now**: Picker moves a visual `data-cursor` with the arrow keys, but focus stays on the list or the search box. There is no `aria-activedescendant` and no combobox role, so nothing is announced. The cursor wash is about 1.1:1. ModelPicker has no key handling at all: no arrow keys and no Escape. Its `role="listbox"` also holds headers and notes.
- **Modern**: Searchable pickers should use the combobox + `aria-activedescendant` pattern the repo already has (`CommandPalette.tsx:82-85`, `composer/menus.tsx:108`). For short pickers with no search, `branded-select-styling`: "With `appearance: base-select`, you get a custom look while the browser handles focus management, top-layer rendering, and accessibility bindings."
- **Scope**: One shared primitive (42 call sites, all three surfaces), plus ModelPicker and ModelList. Do it together with M13 (top-layer placement).
- **Support**: `aria-activedescendant` works everywhere. `base-select` works in Electron; other browsers fall back to a plain `<select>`. On the phone, keep the native iOS wheel.
- **Confidence**: confirmed

### H5. Browser tab strip and annotation toolbar are not keyboard operable
- **Where**: `apps/web/src/components/LiveBrowser.tsx:273-312`, `components/BrowserMarkToolbar.tsx:77-140`, `components/ui/primitives.tsx:75`
- **Now**: Each browser tab is a `div role="tab"` with only `onClick` and no `tabIndex`, so keyboard users can't switch tabs. A Close button sits inside each tab, and New tab sits inside the tablist. In `role="toolbar"`, every control is a Tab stop with no arrow keys, and the selected tool shows only through `data-on` with no `aria-pressed`.
- **Modern**: `tabs`: "Prefer `<button>` for the tabs to avoid needing to reimplement button-like behavior." and "A tablist may only contain tabs." `toolbar`: "MANDATORY: Only one item is in the tab order at a time." Toggle tools use `aria-pressed`.
- **Scope**: The LiveBrowser TabStrip and BrowserMarkToolbar. Making `IconButton active` set `aria-pressed` touches a shared primitive, so check its other callers. Desktop panel only.
- **Support**: `focusgroup` is Chromium 150+ only. Use a roving tabindex, or the polyfill for Safari and Firefox.
- **Confidence**: confirmed

---

## Medium

### M1. Off-screen content still lays out (transcript rows, hidden phone tabs) · in top 5
- **Where**: `apps/web/src/components/Transcript.tsx:379`, `mobile/ThreadScreen.tsx:239`, `packages/shared/history.ts:287` (keeps 1,500 rows, up to 6,000 while reading back). `mobile/MobileShell.tsx:146,162` (visited tabs and covered layers sit under `visibility: hidden`).
- **Now**: Every held row gets style and layout, though most are above the viewport. Hidden phone tabs and covered layers still lay out on every live update.
- **Modern**:
  - `defer-rendering-heavy-content`: "You MUST pair `content-visibility: auto` with `contain-intrinsic-size`" (use `auto none auto <estimate>`).
  - `faster-spa-view-transitions`: `content-visibility: hidden` on inactive views, which "retains its cached rendering state".
- **Scope**: One rule on the two row wrappers. Skip the newest rows, and check shadows at row edges, since paint containment clips them. Two style changes in MobileShell: hide covered layers only after the 420 ms push ends. The ResizeObservers in `useScrollAnchor.ts:63` and `useTranscriptScroll.ts:74` already correct for placeholders that resolve.
- **Support**: Baseline newly available. Older iOS ignores it, so it is pure enhancement.
- **Confidence**: confirmed pattern; perf gain not measured

### M2. One Escape closes several layers at once
- **Where**: `components/ui/use-dismissable.ts:31-35` (listener on `window`, no stop or `defaultPrevented` check), `components/ui/inline-confirm.tsx:78` inside `pages/SettingsCrew.tsx:131`, `components/ModelPicker.tsx:116` inside `ContinueSheet.tsx:139`, `mobile/parts.tsx:280` stacked in `mobile/NewSheet.tsx:186`, `ContextMenuParts.tsx:58-77`, `composer/ReplyControls.tsx:35-52`
- **Now**: Each overlay adds its own window keydown and mousedown listener. Escape on the inline "Delete role" confirm also closes the crew editor. Escape in Fork's model list closes the Fork modal. One Escape closes NewSheet together with the sheet stacked on it. The Esc-to-interrupt guard looks for `[aria-modal],[role=dialog],[role=menu]` in the DOM (`pages/useThreadInterruptKey.ts:21`, `inbox-key.ts:10`).
- **Modern**: `menu`: popover nesting "lets the browser keep the parent open, close sibling submenus, close child submenus when the root menu closes, and handle outside-click light dismiss". Modals get `<dialog>` close requests (H2). Guards become `:modal, :popover-open`.
- **Scope**: `use-dismissable.ts` and `useMenuDismiss` (shared), plus ModelPicker, ReplyControls, MoSheet and CommandPalette.
- **Support**: Popover is Baseline newly available (iOS 18.3+).
- **Confidence**: confirmed

### M3. A backdrop press or Escape throws away unsaved form edits
- **Where**: `components/ui/modal.tsx:33,50`, `components/AutomationEditor.tsx:49`, `pages/SettingsCrew.tsx:131`, `components/ContinueSheet.tsx:139`
- **Now**: A mousedown on the scrim or an Escape calls `onClose` straight away. No form modal guards dirty state.
- **Modern**: `dialog`: for "a form with unsaved changes", use `closedby="none"` with a confirmation path, and "Keep the unsaved-changes guard in a `cancel` handler".
- **Scope**: A dismiss-mode prop on `Modal`, set by three form callers.
- **Support**: The `cancel` event works everywhere. `closedby` is Chromium and Firefox only.
- **Confidence**: confirmed

### M4. Phone sheets set `aria-modal` but are not modal
- **Where**: `mobile/parts.tsx:273-321`, `mobile/MobileShell.tsx:146,163,180`, 14 `MoSheet` uses (`NewSheet.tsx:186`, `ThreadMenuSheet.tsx:125,161,214,241`, `PlusSheet.tsx:47`, ...)
- **Now**: Focus never moves into a sheet or back to its trigger. The layers and tab bar under an open sheet are not inert. In stacked sheets the lower sheet stays reachable.
- **Modern**: `navigation-drawer`: "Mark the rest of the page `inert` while the drawer is open", with focus moved in and returned.
- **Scope**: The `MoSheet` primitive, plus one line in MobileShell to set `inert` while `sheet` is set.
- **Support**: Don't move NewSheet into a top-layer `<dialog>` on iOS. The top layer follows the layout viewport, which iOS keeps under the keyboard, and MobileShell already sizes itself from `visualViewport` (`:35-56`) for that reason. Fix it in the shell instead.
- **Confidence**: confirmed

### M5. The context menu drops focus and puts form fields inside `role="menu"`
- **Where**: `components/ContextMenu.tsx:84-90,147-171`, `ContextMenuParts.tsx:58-91`, triggers `thread/HeaderActions.tsx:74-79`, `sidebar/FolderRows.tsx:139-145`
- **Now**: Opened from a "…" button, the menu leaves focus on `body` when it closes. Tab moves on while it stays open. The same `role="menu"` holds a rename text field and the whole ThreadReferencePanel. The triggers set no `aria-expanded`. The rail More menu already does all of this correctly (`rail/ChannelRail.tsx:122-125,182-186`).
- **Modern**: `menu`: "Escape in a top-level menu. Closes it and restores focus to its trigger." Close on `focusin` outside. Rename and reference become a non-modal dialog.
- **Scope**: ContextMenu + ContextMenuParts (shared with the rail), plus two trigger buttons.
- **Support**: Plain DOM, all browsers.
- **Confidence**: confirmed

### M6. Enter handlers submit during IME composition
- **Where**:
  - No check at all: `components/SettingsNav.tsx:27`, `sidebar/FolderRows.tsx:32`, `thread/ContextMeter.tsx:432`, `pages/Settings.tsx:744` (legacy-scan), plus `ContextMenu.tsx:169`, `CommandPalette.tsx:75`, `ui/picker.tsx:104`, `thread/QuestionCard.tsx:132`.
  - `isComposing` only, without the 229 check: `Onboarding.tsx:318`, `onboarding-parts.tsx:396`, `thread/OwnerField.tsx:52`, `thread/OpenItemsCard.tsx:131`, `BrowserAnnotate.tsx:324,363`, `BrowserAnnotationOverlay.tsx:535`, `TerminalSelection.tsx:126`.
- **Now**: Japanese, Chinese or Korean input commits half-composed text in rename, search, the palette and Settings. Only `composer/controls.tsx:93`, `composer/menus.tsx:77` and `FileMenu.tsx:77` handle it correctly.
- **Modern**: `ime-safe-enter-submit`: "Pairing `event.isComposing` with `event.keyCode === 229` reliably catches Safari's out-of-order confirming `Enter` keydown."
- **Scope**: Export one `isImeEnter(e)` helper from `composer/controls.tsx` and use it at 16 sites.
- **Support**: The 229 check is the part that matters on Safari and iPhone.
- **Confidence**: confirmed

### M7. Focus indicators that are faint or missing
- **Where**: `index.css:271,277-279` (`.field` sets `outline: none`; focus is the same 1px `--line-strong` inset as hover, about 1.4:1), `components/ui/feedback.tsx:182` (SearchField), `pages/Search.tsx:38`, `SettingsNav.tsx:20`, `ImageZoom.tsx:135-152`, `LiveBrowser.tsx:486-498`, `App.tsx:79-82`
- **Now**: Keyboard users can't tell which field has focus. ImageZoom and LiveBrowser are `tabIndex=0` surfaces with `outline-none` and no replacement, and ImageZoom can't zoom from the keyboard.
- **Modern**: `accessibility`: when using `outline: none`, "provide an equivalent custom focus indicator that has a contrast ratio of at least `3:1`". Reuse the global `:focus-visible` ring (`index.css:243`).
- **Scope**: The `.field` class and SearchField (shared), plus 5 one-off surfaces.
- **Support**: `:focus-visible` is Baseline widely.
- **Confidence**: confirmed

### M8. `Segmented` claims tab or radio roles without the keyboard pattern; page links use `role="tab"`
- **Where**: `components/ui/segmented.tsx:14-84` (~25 uses incl. phone), `pages/Channel.tsx:116-119,164`, `thread/ThreadPanel.tsx:99-121`, `mobile/LibraryScreen.tsx:86`, `sidebar/SidebarTop.tsx:78`, `ModelPicker.tsx:189-206`, `ChannelSettings.tsx:115-131`
- **Now**: Every item is its own Tab stop, arrow keys do nothing and no tabpanels are linked. Filters are announced as tabs, and Channel's route links are `<a role="tab">`. The selected item differs only by background wash, which forced colors removes.
- **Modern**:
  - `tabs`: "DO NOT use this or the WAI-ARIA tabs pattern for page navigation". Draw the indicator with a border, not a background.
  - `navbar`: use `aria-current="page"`.
  - `forms`: for 2 to 5 exclusive options, use `<input type="radio">`.
- **Scope**: The shared primitive, a nav variant for Channel, and tabpanel wrappers where it switches content.
- **Support**: Native radios and `aria-current` work everywhere. `focusgroup` is Chromium-only.
- **Confidence**: confirmed

### M9. Unlayered `.md` rules beat Tailwind utilities, so phone replies use the wrong type
- **Where**: `index.css:963-1161` (`.md` block, outside any `@layer`; `@layer components` closes at line 960), `index.css:1163-1396`, `components/Markdown.tsx:116`, `mobile/ThreadCards.tsx:34`, `mobile/ThreadViews.tsx:109`
- **Now**: Unlayered CSS beats every Tailwind layer, so `class="md text-[15px] leading-[1.6]"` renders at 14.5px with 1.8 leading. The phone's prose loses its intended size, and the custom Markdown renderers' utility classes lose to `.md a`.
- **Modern**: `css`: "Use cascade layers (`@layer`) to define explicit priority zones (e.g., `reset`, `base`, `theme`, `components`, `utilities`), and declare their order upfront".
- **Scope**: Wrap the `.md` block and the helper classes in `@layer components`, then recheck `Markdown.tsx:86,93,106`.
- **Support**: Cascade layers are Baseline widely (Safari 15.4).
- **Confidence**: confirmed

### M10. Phone toast cuts off long error text and may go unannounced
- **Where**: `mobile/parts.tsx:257-266`, `mobile/MobileShell.tsx:131-136,181`, callers `InboxRows.tsx:40`, `NeedsCard.tsx:39,52`, `ThreadCards.tsx:258`, `ThreadMenuSheet.tsx:60,71`
- **Now**: `MoToast` is `whitespace-nowrap`, centred, has no max width and sits inside `overflow-hidden`. At 390px error messages are cut on both sides and gone after 2.2 s. Each toast mounts a new `role="status"` that already holds its text, which VoiceOver often skips.
- **Modern**: `persistent-toast-notifications`: "ensure that the container is present in the page on load, and then add the messages to the live region container when relevant". Errors should go inline or persist. The desktop `Toaster.tsx:94` already keeps one persistent region.
- **Scope**: `MoToast` and the shell's toast state.
- **Support**: Plain CSS and ARIA, all browsers.
- **Confidence**: confirmed

### M11. The composer grows by measuring `scrollHeight` on every keystroke
- **Where**: `components/composer/controls.tsx:9-33` (legacy-scan; used at `Composer.tsx:92,411`, `pages/QuickPrompt.tsx:50`), `mobile/MoComposer.tsx:89-94` (a second copy)
- **Now**: Each change sets `height:auto`, reads `scrollHeight` (forced layout) and writes the height back. A ResizeObserver and `fonts.ready` fix wrong first measurements.
- **Modern**: `form-fields-automatically-fit-contents`: "use the `field-sizing: content` CSS property", with `min-block-size`/`max-block-size` for the 132 to 360px caps. "Explicit `width` and `height` properties override `field-sizing: content`", so skip the JS height where the property is supported.
- **Scope**: One hook plus the phone copy. QuickPrompt runs only in Electron and can drop the JS.
- **Support**: Baseline newly available (Safari 26.2). Keep the JS behind `CSS.supports('field-sizing','content')` for older iOS.
- **Confidence**: confirmed

### M12. Background polling keeps running while the page is hidden
- **Where**: `app/useMachines.ts:28` (15 s), `pages/Home.tsx:105` (60 s), `forwarded.ts:13` (15 s), `store.tsx:104-108` (each burst reloads `/channels`, `/status`, `/needs-you`), `components/LiveBrowser.tsx:132` (screencast SSE + a bitmap decode per frame)
- **Now**: None of these check visibility. Any `/machines` GET in the last minute counts as "watching" (`apps/server/machine-stats.ts:8-12`), so a background tab or a minimized window keeps the server sampling CPU and RAM every 5 s and writing sync kv every 15 s.
- **Modern**: `efficient-background-processing`: pause "high-frequency WebSocket data polling when they are not needed". `usePageVisible` already exists (`store.tsx:334`), and ThreadList, Connect and Sync already use it.
- **Scope**: Five call sites. Keep `needs-you` live for notifications. On the phone, also pass whether the Activity tab is the one shown.
- **Support**: Page Visibility works everywhere.
- **Confidence**: confirmed

### M13. Dropdowns are placed by JS math and get clipped inside modals
- **Where**: `components/ui/picker.tsx:68-76,155-157` (flips from an estimate of `options.length * 44`), `ModelPicker.tsx:18-24` (fixed 380px), `ContextMenuParts.tsx:36-52` (ResizeObserver clamp), `rail/ChannelRail.tsx:119,147,170`, no-flip popovers at `thread/ContextMeter.tsx:216`, `pages/PRToolbar.tsx:88`, `ThreadReference.tsx:152`
- **Now**: Picker's card is `position:absolute` inside the Modal's `overflow-auto` box (`modal.tsx:56`), so the five pickers in `AutomationEditor.tsx:202-254` and one in `SettingsCrew.tsx:421` are clipped or make the modal scroll.
- **Modern**: `viewport-aware-dropdowns`: "Use CSS anchor positioning, not JavaScript coordinates." Use a top-layer popover with `position-area` and `position-try-fallbacks: flip-block, flip-inline`. For right-click menus, the guide's zero-size placeholder anchor.
- **Scope**: Picker first (with H4), then ModelPicker, `useMenuPlacement` and the rail.
- **Support**: Fine in Electron. For Safari and Firefox, gate with `@supports (position-area: block-end)` and keep the current JS as the fallback. The popover alone fixes the clipping on iOS 18.3+.
- **Confidence**: confirmed

### M14. Copy buttons say "Copied" even when the copy failed
- **Where**: `components/ui/feedback.tsx:95-126`, `Transcript.tsx:91-108`, `QuickAnswer.tsx:164`, `thread/ThreadQuickCard.tsx:240`, `thread/panel/GlanceCard.tsx:52`, `mobile/ThreadViews.tsx:555-565`
- **Now**: `copyText` swallows failures and ignores `execCommand`'s return value. Nothing is announced to screen readers. The plain-http fallback textarea has no `readonly`, so on iPhone it may raise the keyboard and zoom.
- **Modern**: `copy-button`: "The confirmation bubble IS the live region." Report both outcomes ("clipboard access can be denied: show the failure too"), and give the fallback field `readonly`.
- **Scope**: One helper plus CopyButton. The 5 ad-hoc copy buttons can reuse it.
- **Support**: The async Clipboard API needs a secure context. That matters over plain-http Tailscale.
- **Confidence**: confirmed (iOS zoom part likely)

### M15. The main composers are named only by their placeholder
- **Where**: `components/Composer.tsx:245,535`, `mobile/NewSheet.tsx:236`, `thread/ContextMeter.tsx:427`
- **Now**: There is no label. The placeholder changes with state and carries key hints. `MoComposer.tsx:217` does it right.
- **Modern**: `accessibility`: "Don't use `placeholder` as a naming mechanism".
- **Scope**: 4 call sites.
- **Support**: All browsers.
- **Confidence**: confirmed

### M16. Validation skips native constraints, and `aria-invalid` doesn't match what is shown
- **Where**: `pages/Secrets.tsx:58-62,123,144,149`, `pages/ChannelSettings.tsx:263-266,411`, `AvatarColorPicker.tsx:53`, `pages/Settings.tsx:567-583,615`, `ChannelActionsEditor.tsx:91`
- **Now**: No field uses `required` or `pattern`. Three fields set `aria-invalid` on every keystroke, with no visual state and no linked message. Submit errors are one form-level alert that is not tied to any field, and focus doesn't move. Secrets disables Submit until both fields are filled.
- **Modern**:
  - `accessible-error-announcement`: apply `aria-invalid` "at the exact same moment the visual state (`:user-invalid`) applies".
  - `forms`: "DO move focus to the first invalid field" and "DON'T disable submit buttons to block validation".
- **Scope**: A field-error slot in `settings-parts.tsx` Row and the Label/Field helpers, plus about 6 forms.
- **Support**: `:user-invalid` is Baseline widely (Safari 16.5).
- **Confidence**: confirmed

### M17. The `Label` primitive puts the hint into the field's accessible name
- **Where**: `components/ui/feedback.tsx:204-211`, `pages/ChannelSettings.tsx:25-34` (25 uses with a hint), `Pair.tsx:202`, `IosPairing.tsx:174`, and 14 more
- **Now**: The hint sits inside `<label>`. The Pair token field reads "Token On the machine that runs Omni: cat data/api-token, or…". The `settings-parts.tsx:59-87` Row already uses `aria-describedby` correctly.
- **Modern**: `accessibility`: "Don't pack descriptions, error messages, or instructions into the label: ... use the `aria-describedby` attribute".
- **Scope**: One primitive and its call sites.
- **Support**: All browsers.
- **Confidence**: confirmed

### M18. Every to-do row in the transcript is a dead fake button
- **Where**: `components/ui/feedback.tsx:75-90`, `thread/ToolRows.tsx:82`
- **Now**: `CheckItem` is a `div role="button" tabIndex=0` with no `onClick` at its only call site. Each TodoWrite row becomes a dead Tab stop, and its state is visual only.
- **Modern**: `accessibility`: "Don't apply `tabindex="0"` to static, non-interactive, and hidden elements". Render a list with the state as text.
- **Scope**: One primitive.
- **Support**: All browsers.
- **Confidence**: confirmed

### M19. The Toggle's off state is almost invisible
- **Where**: `components/ui/feedback.tsx:128-134`, `index.css:619-660`, `pages/settings-parts.tsx:46`
- **Now**: The off track `#ecebe7` on the `#f7f7f6` card is about 1.1:1, and the knob on the track about 1.2:1. Dark mode is similar.
- **Modern**: `brand-consistent-forms`: provide "a color with good base contrast (at least `3:1` with the background color)".
- **Scope**: CSS in one primitive. Every SwitchRow in Settings, plus the ContinueSheet toggles on the phone.
- **Support**: Fix it in CSS. The native `switch` attribute is Safari-only.
- **Confidence**: confirmed

### M20. Reduced motion is a global kill switch, and JS smooth scrolls ignore it
- **Where**: `index.css:1398-1418` (`*` rule: 1ms, one iteration, `!important`), `index.css:1258-1261` + `pages/useReveal.ts:28-31` (search-hit flash), `index.css:731-739` + `ui/inline-confirm.tsx:138` (undo fuse), `pages/useTranscriptScroll.ts:51`, `pages/Settings.tsx:162`, `pages/Secrets.tsx:169`, `AutomationEditor.tsx:72`
- **Now**: With reduced motion on, the search-hit highlight vanishes after 0.2 s and the Undo fuse empties at once while the undo window keeps running. Four scroll calls hard-code `behavior: 'smooth'`. Only `Thread.tsx:150` checks the preference.
- **Modern**: `motion`: "DO NOT globally apply `animation-duration: 0.01ms;`" and "Keep non-motion transitions (such as `color` or `background-color` changes ...) enabled". `stack-drill-down`: "Hard-coding `behavior: 'smooth'` bypasses the user's setting."
- **Scope**: Replace the global rule with per-animation queries (about 20 keyframe classes), plus 4 JS call sites.
- **Support**: All Baseline widely.
- **Confidence**: confirmed

### M21. The diff file header is `sticky` inside `overflow-hidden`, so it never sticks
- **Where**: `components/DiffViewer.tsx:134,139`
- **Now**: The card's `overflow-hidden` (for rounded corners) makes it a scroll container, so the `sticky top-0` header sticks to a box that never scrolls. In long diffs, the file name and fold button scroll away.
- **Modern**: `css-layout`: "Use `overflow: clip` to clip content without establishing a scroll container".
- **Scope**: One class on `DiffFile`, which the Changes tab and PR diffs share.
- **Support**: `overflow: clip` is Baseline widely (Safari 16).
- **Confidence**: confirmed in CSS, not checked in a browser

### M22. Tables: Markdown tables forced to `display: block`, unfocusable scrollers, broken CSV truncation
- **Where**: `index.css:1129-1134` (`.md table`), `index.css:1104-1109` (`.md pre`), `dashboard/UsageSection.tsx:92-93`, `ArtifactViewer.tsx:49-63`, `pages/SettingsCrew.tsx:468-477`
- **Now**: Wide tables and code blocks scroll in containers with no `tabindex`, role or name, and Safari does not focus scrollers by itself. `display: block` can drop table semantics in VoiceOver. CSV cells use `truncate` under automatic layout, so they never truncate, and the full text lives only in `title`. The charter diff uses `role="row"` with no cells.
- **Modern**: `responsive-table`: "Add a `tabindex="0"` attribute to the container". `single-line-overflow`: "In tables, set `table-layout: fixed` and an inline size on the table."
- **Scope**: A `table` renderer in Markdown.tsx that wraps tables in a named, focusable region (desktop and phone), plus four smaller fixes.
- **Support**: Attributes only, so all browsers. It mostly helps Safari.
- **Confidence**: confirmed markup; VoiceOver effect likely

### M23. The thin scrollbar thumb is about 1.4:1, and nothing reacts to `prefers-contrast`
- **Where**: `index.css:291-294` (`.scroll-thin` uses `--line-strong`), 53 call sites (`rail/ListPanel.tsx:66`, `thread/ThreadPanel.tsx:98`, ...). Hairline tokens `index.css:26-27` (`--line` at 8% alpha).
- **Now**: The thumb fails 3:1 against the track in both schemes. There is no `@media (prefers-contrast: more)` anywhere, so macOS "Increase contrast" changes nothing.
- **Modern**:
  - `customize-scrollbar-color-and-thickness`: "Choose a thumb color with a contrast ratio of at least 3:1 against the track color".
  - `adapt-scrollbar-to-contrast-preferences`: "Use an `@media (prefers-contrast: more)` block".
  - `color`: use `prefers-contrast` "when the design uses low-contrast accents (e.g., subtle borders, muted secondary text)".
- **Scope**: A `--scrollbar-thumb` token plus one contrast block. Per the repo rules, token changes also go into Claude Design, `apps/ios/src/theme.ts` and the desktop window background.
- **Support**: `scrollbar-color` works in Electron. Safari only from 26.2; older Safari keeps native bars.
- **Confidence**: confirmed (contrast computed)

### M24. The desktop transcript hides its scrollbar with no other hint
- **Where**: `pages/Thread.tsx:247` (`.scroll-none`), `index.css:295-301`, `index.css:1432-1438` (`.mo-scroll`, 11 uses)
- **Now**: A long thread shows no scroll position, and there is no thumb to drag.
- **Modern**: `scrollability-affordance-hints`: if the scrollbar is removed, the affordance "must have a contrast ratio of 3:1". Simplest fix: use `.scroll-thin` (after M23).
- **Scope**: One class. `.mo-scroll` is a design call.
- **Support**: None needed.
- **Confidence**: confirmed on desktop

### M25. Thread quick card layout follows the viewport, not the thread's width
- **Where**: `pages/Thread.tsx:206,320,346`, `App.tsx:141-147`, `rail/ListPanel.tsx:31`, `Transcript.tsx:159,162` (`sm:max-w-[80%]`)
- **Now**: From a 768px viewport up, the quick card (on by default) becomes a 304px column next to a 72 + 264px rail. In a 900px window that leaves about 260px for the transcript.
- **Modern**: `form-factor-adaptation`: "Use container queries instead of viewport-width media queries for component layout".
- **Scope**: The Thread.tsx root and two class strings, plus the bubble classes.
- **Support**: Container size queries are Baseline widely (Safari 16).
- **Confidence**: confirmed from the widths, not checked visually

### M26. The whole app ships as one 1.35 MB bundle
- **Where**: `pages/Page.tsx:1-11`, `mobile/registry.tsx` (every page imported eagerly: Settings, Automations, ChannelSettings, Storage, Sync, Onboarding, IosPairing with `qrcode-generator`)
- **Now**: The last main-checkout build has `index-*.js` at 1.35 MB minified, 410 KB gzip. First paint waits for all of it. Mermaid, xterm and NativeBrowser are already split.
- **Modern**: `performance`: "DO use dynamic imports: Split routes or heavy UI libraries" and "DON'T ship a single, enormous `app.js` bundle".
- **Scope**: `React.lazy` on rare routes, the same pattern as `ThreadPanel.tsx:16`, plus Suspense fallbacks.
- **Support**: All browsers. The gain is mostly on iPhone; Electron loads locally.
- **Confidence**: confirmed (size from a build dated 2026-11-14)

### M27. Opening a thread renders its first page in one task
- **Where**: `pages/useThreadSession.ts:122`, `Transcript.tsx:436-440`
- **Now**: Up to 300 rows, each running react-markdown, render as one default-priority update. Nothing in the web app uses `startTransition` or yields.
- **Modern**: `break-up-long-tasks`: "yield control back to the browser periodically with `scheduler.yield()`". In React, wrap the history apply in `startTransition`.
- **Scope**: useThreadSession and the phone thread screen. Profile first.
- **Support**: `scheduler.yield` has no Safari support and needs a `setTimeout` fallback. `startTransition` works everywhere.
- **Confidence**: likely (not measured)

### M28. No view transitions on the phone stack (push uses timers, back doesn't animate)
- **Where**: `mobile/MobileShell.tsx:103-114` (underlay with `setTimeout(PUSH_MS + 40)`), `:144,162`, `index.css:1458-1483`, `router.ts:135-158`. Inbox shelves: `sidebar/InboxView.tsx:46-89`.
- **Now**: A pushed screen plays a mount keyframe while a timed underlay keeps the old top visible. Back has no animation. Inbox cards jump between shelves.
- **Modern**: `directional-navigation-transitions`: "Pass the direction in a `types` array to `document.startViewTransition()`". `place.dir` is already computed. For the Inbox, see `group-element-transitions`, but `dynamic-sort` says skip it for large or busy lists.
- **Scope**: A `startViewTransition` + `flushSync` wrapper around the hashchange subscription, plus view-transition reduced-motion rules.
- **Support**: Baseline newly available (Safari 18). Transition types need Safari 18.2. Without support, today's behaviour stays.
- **Confidence**: confirmed (current behaviour)

### M29. Tooltips are `title` only, so some information never reaches touch or keyboard users
- **Where**: `rail/ChannelRail.tsx:207-210`, `LinkChip.tsx:36-45,56`, `ChannelStack.tsx:3-5` (phone Activity rollup), `sidebar/FolderRows.tsx:128`, `thread/panel/RunningSubagents.tsx:17`
- **Now**: There is no tooltip component (about 497 `title=`). Link previews, "Add the X secret to show titles", the phone rollup channel names and subagent progress exist only in `title`. Rail discs never show the name on keyboard focus. Icon buttons are fine: `IconButton` always sets `aria-label`.
- **Modern**: `interest-triggered-tooltips` (`interestfor` + `popover="hint"`): "anything the user needs belongs in a toggletip or inline".
- **Scope**: A shared tooltip primitive, or move the needed text inline on the phone.
- **Support**: `interestfor` is Chromium-only and `popover="hint"` has no Safari support, so polyfill on desktop Safari and Firefox. On iOS, put the needed text inline.
- **Confidence**: confirmed

---

## Low

### L1. Duration labels round to "2h 60m" and "60m ago"
- **Where**: `apps/web/src/format.ts:60-66` (`untilLabel`), `packages/shared/format.ts:18` (`relTime`)
- **Now**: `Math.round` on the remaining minutes: 2h 59m 45s left gives "in 2h 60m", and 59m 50s ago gives "60m ago". `resetIn` and `elapsedShort` already do it correctly.
- **Modern**: `calculate-event-differentials`: balance whole units first, or use `Intl.DurationFormat` (narrow style gives "2h 5m").
- **Scope**: Two functions and their tests.
- **Support**: DurationFormat needs Safari 16.4. `packages/shared` also runs on the iOS app's Hermes, so use integer-first math there.
- **Confidence**: confirmed

### L2. The automation timezone is a free-text field
- **Where**: `components/AutomationEditor.tsx:195`
- **Now**: A typo saves, and the server only reports "invalid schedule" afterwards. `TimezoneInput` (`onboarding-parts.tsx:672`, using `Intl.supportedValuesOf('timeZone')`) and `isTimezone` (`packages/shared/settings.ts:352`) already exist.
- **Modern**: `coordinate-global-events`: "DO identify time zones by IANA name".
- **Scope**: One field.
- **Support**: Safari 15.4+.
- **Confidence**: confirmed

### L3. No `<meta name="color-scheme">`
- **Where**: `apps/web/index.html` (the theme script at `:17-22` sets `data-theme` only; `components/theme.tsx:10-18` syncs `theme-color` but not `color-scheme`). legacy-scan flagged it.
- **Now**: Before the stylesheet arrives, the canvas paints in the default (light) scheme. This shows on a slow remote load or a cold iPhone home-screen launch in dark mode. The desktop window already paints `--chrome` through `backgroundColor`.
- **Modern**: `dark-mode`: "MANDATORY: To help prevent a 'flash of un-themed content' (FOUC), place a `<meta>` tag in your `<head>`". `dark-mode-toggle`: update its `content` for a forced theme.
- **Scope**: One meta tag, plus one line each in the inline script and `apply()`.
- **Support**: Baseline widely.
- **Confidence**: confirmed

### L4. Trusted Types as the follow-up to H1
- **Where**: The two HTML sinks: `components/MermaidDiagram.tsx:34` and `pages/Search.tsx:78`
- **Now**: There is no runtime guard on DOM sinks.
- **Modern**: `security`: "`require-trusted-types-for 'script'` enforces Trusted Types runtime checks on DOM XSS sinks". Route Mermaid output through a named policy (Mermaid already bundles DOMPurify). Run it report-only first, because Mermaid writes `innerHTML` internally.
- **Scope**: The CSP header plus one policy.
- **Support**: Baseline newly available since 2026-02-24 (Safari 26, Firefox 148).
- **Confidence**: confirmed sinks; Mermaid compatibility unverified

### L5. Search snippets go through `innerHTML`
- **Where**: `pages/Search.tsx:78`, `format.ts:189-197` (`safeSnippet` escapes everything, then restores `<mark>`)
- **Now**: Safe today, but it is an HTML sink. `command-palette/items.tsx:45` already builds `<mark>` React nodes.
- **Modern**: `security`: "Use DOMParser or create elements programmatically (`document.createElement`) instead of concatenating HTML strings."
- **Scope**: Reuse the palette's splitter.
- **Support**: Plain DOM.
- **Confidence**: confirmed

### L6. `'unsafe-inline'` script on small server pages whose scripts are known in advance
- **Where**:
  - `apps/relay/src/page.ts:84`: the script is a static constant, so it can use a hash.
  - `apps/desktop/src/server-screen.ts:97`: a one-line static script, so a hash or CSS works.
  - `apps/server/auth-api.ts:359`: a per-request script, so it needs a nonce.
- **Now**: Each page escapes its dynamic text, but any slip would run as script.
- **Modern**: `security`: use nonces or hashes for `script-src`, not `'unsafe-inline'`.
- **Scope**: Three header strings.
- **Support**: All browsers.
- **Confidence**: confirmed

### L7. `role="menu"` without the menu keyboard pattern
- **Where**: `pages/PRToolbar.tsx:82-115` (also on the phone), `BrowserMarkToolbar.tsx:40`
- **Now**: The PR Filters menu never takes focus and has no arrow keys. Its items carry both `menuitemcheckbox` and `aria-selected`.
- **Modern**: `viewport-aware-dropdowns`: "Do not apply `role="menu"` or `role="menuitem"` unless you fully implement the corresponding keyboard navigation contract".
- **Scope**: Two components. The existing `moveFocus` helper fits.
- **Support**: All browsers with a roving tabindex. `focusgroup` is Chromium-only.
- **Confidence**: confirmed

### L8. Desktop toasts vanish while focused and sit above the modal
- **Where**: `components/Toaster.tsx:28-41,93-96`
- **Now**: The timer pauses only on mouseenter. A keyboard user tabbing to Open sees the toast vanish after 6.5 s, and focus drops to `body`. At z-60, toasts sit over the z-50 modal scrim.
- **Modern**: `persistent-toast-notifications`: "If the user is focused on a control inside the toast, pause dismissal until focus has left the toast." Use `popover="manual"` so toasts stay above `::backdrop` after H2.
- **Scope**: One component.
- **Support**: Popover is Baseline newly available.
- **Confidence**: confirmed

### L9. Background reads compete with the thread load at default priority
- **Where**: `apps/web/src/api.ts:587` (`request()` takes no fetch options), `api.ts:642` (`listGet`)
- **Now**: `yield-gate.ts` holds list reads back, but they and every poll still go out at default priority.
- **Modern**: `deprioritize-background-fetches`: pass `priority: 'low'` for background sync.
- **Scope**: The `api.ts` signatures and the poller call sites.
- **Support**: Safari 17.2+. Ignored elsewhere, so no fallback needed.
- **Confidence**: confirmed

### L10. Rail fonts swap in after first paint
- **Where**: `App.tsx:133-139` (`data-layout` is set in `useEffect`), `index.css:153-158`, `main.tsx:9-17`
- **Now**: The first frame paints in system-ui, then Adwaita Sans starts downloading (about 170 KB woff2 per weight, 4 weights) and text reflows. The phone is unaffected.
- **Modern**: `visually-stable-font-fallbacks`: `font-size-adjust: from-font` so text "occupies the same visual space regardless of which font is currently active". Set `data-layout` in the inline head script, and optionally preload the regular weight.
- **Scope**: index.html, index.css, App.tsx.
- **Support**: `font-size-adjust` needs Safari 17.
- **Confidence**: confirmed ordering; visible shift likely

### L11. Folders can only be reordered by mouse
- **Where**: `components/sidebar/FolderRows.tsx:82,103-112`, `folders.tsx:175`. The folder menu (`ContextMenuParts.tsx:173-186`) has New thread, Rename, Duplicate and Delete, but no move.
- **Now**: Threads have Move to folder and queued messages have Move up/down (`thread/PendingMessages.tsx:166-167`), but folder order has no keyboard path.
- **Modern**: `drag-and-drop`: "Provide a keyboard-accessible alternative to pointer reordering", and announce the new position in a polite live region.
- **Scope**: Move up/down items in the folder menu, or a grab-move-drop handler.
- **Support**: No new API needed.
- **Confidence**: confirmed

### L12. Missing input hints on identifier, URL and token fields
- **Where**: `pages/Sync.tsx:234-242` (relay URL), `ChannelSettings.tsx:388,391,429`, `Onboarding.tsx:289` (store domain, repo), `Settings.tsx:719-733` (save on Return), `Pair.tsx:205-214` (token is `autoComplete=off`)
- **Now**: iOS may capitalize "Https://…" and autocorrect slugs. The pairing token can't go into a password manager.
- **Modern**: `forms`: "`autocorrect="off"` (plus `autocapitalize="none"` and `spellcheck="false"`)" on identifiers, "use `enterkeyhint`", and "DON'T ... disable `autocomplete` on passwords".
- **Scope**: About 10 call sites. The `SettingField` contract could carry them.
- **Support**: Other browsers ignore what they don't support.
- **Confidence**: confirmed; iOS effects likely

### L13. Busy and progress semantics
- **Where**: `ui/status.tsx:162-171` (every Loader is `role="status"`, 36 uses), `ui/primitives.tsx:52-56` (a busy Button becomes `disabled`), `pages/Storage.tsx:124` (unnamed progressbar), `onboarding-parts.tsx:621-628` (Steps has no `aria-current`)
- **Modern**: `accessibility`: "Don't use live regions for interstitial states like 'Loading…'". `spinner`: slow the animation instead of stopping it under reduced motion.
- **Scope**: The Loader and Button primitives plus 3 one-offs.
- **Support**: All browsers.
- **Confidence**: confirmed; focus drop likely

### L14. No `<main>` landmark on the phone, no skip link on desktop
- **Where**: `mobile/MobileShell.tsx:153`, `App.tsx:141-147,158-166`
- **Modern**: `accessibility`: "Provide skip links prior to repeated content like site headers with navigation or long/infinite lists".
- **Scope**: Two shell files.
- **Support**: All browsers.
- **Confidence**: likely

### L15. Attachment and Markdown images reserve no space, and the newest load lazily
- **Where**: `thread/Attachments.tsx:21`, `Markdown.tsx:101-105`, `apps/server/uploads.ts:9` (no stored dimensions)
- **Modern**: `performance`: "Failing to specify width/height on lazy loaded images causes layout shifts" and "DON'T lazy load above-the-fold images".
- **Scope**: A fixed thumbnail box, or dimensions stored at upload.
- **Support**: All browsers.
- **Confidence**: confirmed

### L16. Overlays animate in but never out
- **Where**: `index.css:1234-1246,1262-1287,1313-1322,1468`, `Toaster.tsx:73-83` (a `setTimeout` exit)
- **Modern**: `animate-to-from-top-layer`: `@starting-style` + `transition-behavior: allow-discrete`, and "Include `overlay` in your `transition` list".
- **Scope**: CSS only, after H2, M2 and M13.
- **Support**: `overlay` is Chromium-only. Safari closes instantly, which is fine as enhancement.
- **Confidence**: confirmed

### L17. The phone quick card closes through an invisible full-pane button
- **Where**: `mobile/ThreadScreen.tsx:190,196-199`
- **Modern**: `declarative-dialog-popover-control`: `popover="auto"` with `commandfor` and `command="toggle-popover"`. The toggle needs `aria-expanded`.
- **Scope**: One screen.
- **Support**: Invoker commands need Safari 26.2. Toggle from script on older iOS.
- **Confidence**: confirmed

### L18. Scroll fades driven by JS, and focus lands inside fades or under sticky headers
- **Where**: `rail/useScrollFade.ts:1-27`, `rail/ChannelRail.tsx:69-73`, `rail/ListPanel.tsx:64-66`, `thread/ContextMeter.tsx:207-218`, `ThreadList.tsx:144,251,283`
- **Modern**: `scrollability-affordance-hints`: a mask driven by `animation-timeline: scroll(self)`, and "Set `scroll-padding-inline` (or `scroll-padding-block`) to the fade size". `state-aware-sticky-headers`: add `scroll-padding-top`.
- **Scope**: One hook with two callers. The scroll-padding part is a few CSS lines.
- **Support**: Scroll-driven animations are Baseline newly available (Safari 26). Keep a fallback for the rail.
- **Confidence**: confirmed

### L19. Long thread titles truncated with only a `title` tooltip
- **Where**: `thread/ThreadHeader.tsx:99`, `ui/feedback.tsx:158`, `rail/ListPanel.tsx:56`, `mobile/ThreadViews.tsx:272`
- **Modern**: `form-factor-adaptation`: "DO NOT truncate headings with `text-overflow: ellipsis`". `improve-text-layout-and-legibility`: use `text-wrap: balance` on headings.
- **Scope**: 3 or 4 class strings.
- **Support**: `balance` needs Safari 17.5. Unsupported browsers wrap normally.
- **Confidence**: confirmed

### L20. `vh`/`vw` on overlays the phone renders, and no left/right safe-area insets
- **Where**: `ui/modal.tsx:56` (`92vh`), `ContextMenu.tsx:153` (`100vh`), `mobile/ThreadViews.tsx:96` (`60vh`), `index.css:951` (`100vw`), plus 11 inline `env(safe-area-inset-bottom)` strings with different floors
- **Modern**: `responsive-design`: "Use dynamic viewport units (`dvh`, `dvw`) instead of `vh`/`vw`". `css-layout`: `100vw` "ignores scrollbar width". `form-factor-adaptation`: pad edge UI by the safe-area insets.
- **Scope**: A handful of class strings plus one safe-area utility.
- **Support**: `dvh` is Baseline widely (Safari 15.4).
- **Confidence**: confirmed

### L21. The type scale is all px
- **Where**: `index.css:85-101` (`--fs-*`), `index.css:222` (`body { font-size: 14px }`), 1,077 `text-[Npx]` utilities
- **Modern**: `typography`: "DON'T use `px` for font-size. Prefer `rem`". `respect-os-text-scale` gives the same rule.
- **Scope**: Large, but it can be staged: tokens first (mirrored in Claude Design and `apps/ios/src/theme.ts`), then the utilities. Page zoom works today.
- **Support**: `<meta name="text-scale">` is Chromium-only and does nothing on iOS.
- **Confidence**: confirmed

### L22. Copy-then-sort, copy-then-reverse and manual promise resolvers
- **Where**: legacy-scan, 18 lines in web, shared and the prototype, for example:
  - `pages/useThreadSession.ts:131` (`findLast`)
  - `thread/ContextMeter.tsx:203`
  - `packages/shared/history.ts:190,203`
  - `packages/shared/yield-gate.ts:30` (`Promise.withResolvers`)
- **Modern**: `js`: "DO use `array.toSorted(compareFn)` instead of `[...array].sort(compareFn)`".
- **Scope**: Mechanical. Keep the `[...set]` spreads (`attention.ts:191,200`).
- **Support**: `toSorted` needs Safari 16. `Promise.withResolvers` needs Safari 17.4 and a TS `lib` bump from ES2023 (`packages/typescript-config/base.json`). `packages/shared` also runs on Hermes in the iOS app, so check support there first.
- **Confidence**: confirmed

### L23. The desktop server screen duplicates tokens and its spinner ignores reduced motion
- **Where**: `apps/desktop/src/server-screen.ts:35-40` (`@media (prefers-color-scheme)` copies of the tokens), `:67-69` (spinner), `:84` ("Starting the server" has no `role="status"`)
- **Modern**: `dark-mode`: `light-dark()`, as `index.css` and the relay page already do. `spinner`: "Always respect the `prefers-reduced-motion` media query".
- **Scope**: The page's style and markup strings.
- **Support**: Electron only.
- **Confidence**: confirmed

### L24. The Activity Monitor prototype rebuilds its charts as HTML strings
- **Where**: `prototypes/activity-monitor/index.html:405,420,459` (the chart SVG string goes to `innerHTML` on every tick and pointer move), `:460,607` (legacy-scan array copies), `:725` (the EventSource stays open while hidden)
- **Now**: Untrusted strings correctly go through `textContent` (`:585-600`). Only numbers go through `innerHTML`.
- **Modern**: `interactions-in-complex-layouts`: avoid re-parsing and re-laying-out large subtrees per interaction. Update the path's `d` attribute instead. `efficient-background-processing`: pause while hidden.
- **Scope**: Prototype only, so low priority.
- **Support**: macOS Electron window.
- **Confidence**: confirmed

---

## Already modern (keep)

- `light-dark()` token table with `color-scheme` on `:root` and a `[data-theme]` override (`index.css:7-68,132-136`). `theme-color` meta per scheme, kept in sync (`theme.tsx:10-18`). The theme is applied before paint by an inline script.
- Status marks differ by shape, not only colour (`ui/status.tsx` SHAPE), which meets the `color` guide's "Don't use color alone".
- `--fg-4` contrast is documented and tested (`index.css:21-22`, `tests/fg4-contrast.test.ts`).
- Artifact iframes are sandboxed without `allow-same-origin`, with CSP sandbox on artifact routes (`HtmlRender.tsx:71-76`, `artifacts-api.ts:28`, `channels-api.ts:328`). Both sides of the frame messaging check `e.source` (`HtmlRender.tsx:56`, `packages/shared/html-render.ts:99`), which is the `validate-origins` advice for opaque origins.
- Fetch Metadata checks in `request-guard.ts:169-175`.
- Mermaid uses `securityLevel: 'strict'` and a lazy import (`mermaid.ts:9-12`). react-markdown runs without raw HTML.
- Electron windows use `contextIsolation`, `sandbox` and no `nodeIntegration`, and deny `window.open`. The monitor gets its own partition.
- The relay Connect page uses only `textContent`, `light-dark()`, `frame-ancestors 'none'`, `base-uri 'none'` and `form-action 'none'`.
- Combobox + `aria-activedescendant` in CommandPalette, the slash and @ menus and FileMenu. The ReplyControls menu has the full keyboard contract. The rail More menu returns focus correctly.
- `IconButton`/`IconLink` always set `aria-label`, and no unnamed icon-only buttons were found.
- `inert` on folded sidebar groups and covered phone layers. `<html lang>`. Per-route `document.title`.
- Container queries in Home, MachineTiles, UsageSection, ThreadHeader and BrowserAnnotationOverlay. `100dvh` and `env(safe-area-inset-*)` with `max()` floors. The iOS keyboard is handled through `visualViewport`.
- Passive scroll listeners, one rAF-batched live row update, one shared clock interval. Many polls already gate on visibility, and SSE reconnects on `visibilitychange`.
- Dates: next-run labels use the automation's IANA zone. Day keys use noon stepping across DST. Calendar labels use `Date.UTC` with `timeZone: 'UTC'`.

## Checked, nothing found or not applicable

- **Web components**: React app. `web-components` says "Default to that framework's component for in-app UI".
- **Icons**: inline SVG from the shared `ICON_PATHS` is one of the techniques the `icons` guide accepts.
- **LCP image / fetchpriority / preloads**: the LCP is text rendered after JS, with no hero image.
- **scrollend, schedule-tasks-by-priority, analytics batching, detect-initial-visibility**: no heavy scroll handlers, no queued background compute, no telemetry.
- **Temporal**: not recommended yet. It would need a polyfill on iPhone and Hermes support for shared code, and the Date + Intl code is correct today.
- **Scroll anchoring**: `overflow-anchor: none` plus the JS anchor is justified, because Safari has no scroll anchoring. `scroll-initial-target` is Chromium-only.
- **ResizeObserver vs container queries**: none of the 25 observers switch layout by width.
- **One-time codes / WebOTP, range sliders, required selects, sortable tables, navigation drawer, shrinking header**: no such UI.
- **Page scroll lock under modals**: the desktop root does not scroll, and the phone shell locks once.
- **Disclosure animation (`interpolate-size`, `::details-content`)**: Chromium-only polish, and rendering tool output only on open keeps the transcript light.
- **Desktop route cross-fades**: not recommended, because a document view transition blocks input while it runs.

## Skipped, and why

- **`apps/ios`**: React Native, not a browser surface.
- **`apps/mcp`, `crates/`, server business logic**: not browser-facing. legacy-scan also flagged Node code in `apps/server`: 2 `AbortSignal.timeout`, 4 `Error` `cause`, 5 `Promise.withResolvers` and 7 copy-then-sort. These are listed for completeness and not ranked.
- **Test fixtures** (`packages/test-fixtures/inline-page.html`, `apps/web/tests/diff-file-markup.html`): not shipped.
- **`restrict-outbound-connections` (connection allowlists)**: the tool marks it as a volatile, single-engine feature that needs explicit opt-in (`npx modern-web-guidance@latest set-allow-volatile-features`). Not retrieved.
- **Built-in AI, WebAssembly, passkeys, WebMCP**: Omni has no such features in scope.
- **Live measurements**: no Lighthouse or trace runs, since the audit was static. The perf findings (M1, M12, M26, M27) are confirmed as patterns. M26's bundle size comes from an existing build, not a fresh one.
