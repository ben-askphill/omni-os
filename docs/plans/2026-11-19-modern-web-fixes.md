# Modern web fixes: implementation plan

2026-11-19 · plan for the 58 findings in [the modern web audit](../reviews/2026-11-19-modern-web-audit.md) · not built yet

This plan groups every finding into PR-sized workstreams, one PR each, in the order to build them. Each workstream ends with a builder brief that can be pasted into a delegation as is. Finding ids (H1, M12, L3) refer to the audit report, which has the `file:line`, the guide quote and the support caveat for each one.

## Rules every workstream follows

- **Every surface, every time** (`CLAUDE.md`). Each PR covers desktop web, the 390px phone layout and the desktop app. A visible change carries before/after screenshots of all three, taken on a `scripts/qa-stack.sh` stack (never :4747) and uploaded with `scripts/pr-screenshots.sh`.
- **Verify skill.** Run `/verify` before calling it done: `npm test`, `npm run typecheck` and the knip/boundaries checks, a QA stack driven in the browser, and `apps/desktop/scripts/qa.ts` for the desktop app.
- **Design system.** A new or changed component (the dialog, the picker, a tooltip, a token) also goes into the Claude Design project in the same PR. A token change also goes into `apps/web/src/index.css`, `apps/ios/src/theme.ts` and `--chrome` in `apps/desktop/src/windows.ts`. If the Claude Design MCP is disconnected, say so in the PR and leave a `/design-sync` follow-up.
- **iPhone check.** "Manual check on the iPhone layout" means the 390px phone layout in a browser at minimum. Where iOS Safari behaviour is the point of the fix (W3, W7, W10), also check it on Ben's iPhone home-screen app, or say in the PR that it was not checked on a device.
- **Support policy.** Every PR follows the policy line from W0. Chromium-only features go behind `@supports`, a feature check, or a fallback no bigger than the policy allows.

## Order and parallel waves

| # | Workstream | Findings | Wave | Depends on |
|---|---|---|---|---|
| W0 | Browser support policy | (none) | 0 | |
| W1 | Modal on `<dialog>` | H2, M3 | 1 | W0 |
| W2 | CSP and headers on the Web UI shell | H1, L6 | 1 | W0 |
| W3 | iPhone field zoom and input hints | H3, L12 | 1 | W0 |
| W4 | Picker and ModelPicker on popover + combobox | H4, M13 | 1 | W0 |
| W5 | Transcript render cost | M1, M27, L15 | 1 | W0 |
| W6 | One dismiss stack for overlays and menus | M2, M5, L7, L16, L17 | 2 | W1, W4, W12 for L16 |
| W7 | Phone sheets, toasts and landmarks | M4, M10, L8, L14 | 2 | W1 |
| W8 | Keyboard access: tabs, toolbars, segmented, folder reorder | H5, M8, L11 | 1 | W0 |
| W9 | Form and feedback primitives | M14, M15, M16, M17, M18, L13 | 2 | W3 |
| W10 | Composer input: IME Enter and `field-sizing` | M6, M11 | 1 | W0 |
| W11 | Focus rings and contrast | M7, M19, M23, M24 | 2 | W3 |
| W12 | Motion: reduced motion and phone view transitions | M20, M28, L18 | 2 | W0 |
| W13 | CSS layout fixes | M9, M21, M22, M25, L19, L20 | 2 | W1 for L20 |
| W14 | Background work and time labels | M12, L9, L1, L2 | 1 | W0 |
| W15 | First paint: route splitting, fonts, color-scheme meta | M26, L10, L3 | 3 | W2 |
| W16 | Tooltip primitive | M29 | 3 | W4 |
| W17 | Trusted Types and the search snippet sink | L4, L5 | 3 | W2 |
| W18 | Type tokens in rem | L21 | 3 | W3, W11 |
| W19 | Tidy-ups: array methods, server screen page | L22, L23 | 3 | W0 |
| | Won't do | L24 | | |

- **Wave 0** is one line in `CLAUDE.md` and lands first.
- **Wave 1** can run in parallel: W1, W2, W3, W4, W5, W8, W10 and W14. The top 5 (W1 to W5) come first if builders are limited.
- **Wave 2** starts once its dependencies have merged. W6 and W7 build on the dialog and popover patterns from W1 and W4.
- **Wave 3** is cleanup that depends on earlier waves or carries low impact.

### File hot spots (merge conflicts)

These files are touched by more than one workstream. Merge in the listed order, or rebase the later one:

| File | Workstreams, in merge order |
|---|---|
| `apps/web/src/index.css` | W3, W11, W12, W13, W18 |
| `components/ui/modal.tsx` | W1, W13 (L20 `92vh`) |
| `components/ui/picker.tsx` | W3 (font size), W4, W10 (IME at `:104`) |
| `components/ui/feedback.tsx` | W9, W11 (Toggle, SearchField) |
| `components/ContextMenu.tsx` | W6, W10 (IME at `:169`), W13 (L20 `100vh`) |
| `mobile/MobileShell.tsx` | W5 (hidden tabs), W7, W12 (view transitions) |
| `apps/web/index.html` | W15 (inline script, meta), then W2 recomputes its hash. W2 should compute the hash from the built file at server start, so the order stops mattering. |

## Mapping check

Every finding appears exactly once below. The check output is pasted at the end of this section.

| Finding | Workstream |
|---|---|
| H1 | W2 |
| H2 | W1 |
| H3 | W3 |
| H4 | W4 |
| H5 | W8 |
| M1 | W5 |
| M2 | W6 |
| M3 | W1 |
| M4 | W7 |
| M5 | W6 |
| M6 | W10 |
| M7 | W11 |
| M8 | W8 |
| M9 | W13 |
| M10 | W7 |
| M11 | W10 |
| M12 | W14 |
| M13 | W4 |
| M14 | W9 |
| M15 | W9 |
| M16 | W9 |
| M17 | W9 |
| M18 | W9 |
| M19 | W11 |
| M20 | W12 |
| M21 | W13 |
| M22 | W13 |
| M23 | W11 |
| M24 | W11 |
| M25 | W13 |
| M26 | W15 |
| M27 | W5 |
| M28 | W12 |
| M29 | W16 |
| L1 | W14 |
| L2 | W14 |
| L3 | W15 |
| L4 | W17 |
| L5 | W17 |
| L6 | W2 |
| L7 | W6 |
| L8 | W7 |
| L9 | W14 |
| L10 | W15 |
| L11 | W8 |
| L12 | W3 |
| L13 | W9 |
| L14 | W7 |
| L15 | W5 |
| L16 | W6 |
| L17 | W6 |
| L18 | W12 |
| L19 | W13 |
| L20 | W13 |
| L21 | W18 |
| L22 | W19 |
| L23 | W19 |
| L24 | Won't do |

**Won't do: L24 (Activity Monitor prototype charts).** `prototypes/README.md` says prototypes are standalone experiments, outside `npm test` and the build. The cost only shows while the macOS monitor window is open, and its security posture is already right (`textContent` for untrusted strings). Revisit if the prototype moves into `apps/`.

Check run against the report's `### H1.` to `### L24.` headings, this table and each workstream's Findings line. The order table above was checked the same way.

```
report findings: 58 (H 5, M 29, L 24)
mapped rows:     58 (in workstreams 57, won't do 1)
missing:         none
duplicates:      none
unknown ids:     none
table vs workstream Findings lines: consistent
per workstream:  W1 2, W2 2, W3 2, W4 2, W5 3, W6 5, W7 4, W8 3, W9 6, W10 2, W11 4, W12 3, W13 6, W14 4, W15 3, W16 1, W17 2, W18 1, W19 2
order table vs workstreams: consistent
```

---

## W0. Browser support policy

- **Findings**: none. Every other workstream depends on it.
- **Files**: `CLAUDE.md` (root), and optionally `AGENTS.md` if it mirrors the rules.
- **Approach**: Add one rule under Standing rules, close to this:
  > **Browser support.** Desktop app (Electron): any feature current Chromium ships. Desktop web and phone web: Baseline widely available features freely; Baseline newly available features when iOS Safari 18+ has them; anything newer or Chromium-only only as progressive enhancement behind `@supports` or a feature check, with a fallback of at most ~20 lines and no new dependency. Polyfills only where a brief names them.
- **Risks**: Pinning the iOS floor too high cuts off Ben's own devices. Check the iPhone's iOS version first, and say in the PR which floor was picked.
- **Verify**: Docs only. Re-read the audit's support lines against the policy and list any finding whose fix the policy now rules out (the expected answer is none).
- **Dependencies**: none.

**Builder brief**
- **Goal**: Add a browser support policy to the omni-os `CLAUDE.md` so every modern-web fix (plan `docs/plans/2026-11-19-modern-web-fixes.md`) uses the same rule for Electron, desktop web and iPhone Safari.
- **Done when**: `CLAUDE.md` has one Browser support rule under Standing rules, worded per W0 in the plan, with the iOS floor confirmed against Ben's iPhone, and a docs-only PR is open.
- **Proof back**: PR URL, the exact rule text, the iOS version it is based on.

---

## W1. Modal on `<dialog>`

- **Findings**: H2 (Modal is not modal), M3 (backdrop/Escape loses form edits).
- **Files**: `apps/web/src/components/ui/modal.tsx` (Modal, ConfirmDialog, `SCRIM`, ModalFooter), `components/ui/use-dismissable.ts` (Modal stops using it), `components/CommandPalette.tsx`, `components/Onboarding.tsx`, form callers `components/AutomationEditor.tsx`, `pages/SettingsCrew.tsx`, `components/ContinueSheet.tsx`, plus the other call sites (16 `Modal`/`ConfirmDialog` uses in 12 files; `grep -rn '<Modal\|<ConfirmDialog' apps/web/src`). CSS for `.scrim` and `modal-in` in `index.css`.
- **Approach**:
  - Render a `<dialog>` and call `showModal()` from a ref in an effect when `open` turns true, and `close()` when it turns false. Keep the `open`/`onClose` props so call sites don't change.
  - Map the `cancel` event (Escape, and the back gesture where one exists) to `onClose`. Backdrop clicks: a `click` on the dialog element itself whose target is the dialog, as the guide's fallback, since `closedby` is Chromium/Firefox only.
  - Add a `dismiss` prop: `'any'` (default; ConfirmDialog keeps it) or `'confirm'` for forms. In `'confirm'` mode, `cancel` calls `preventDefault()` when the form is dirty and asks a ConfirmDialog first (M3). AutomationEditor, the crew role editor and ContinueSheet pass a dirty flag.
  - Keep the existing focus behaviour (`data-autofocus`, then the first control; ConfirmDialog autofocuses Cancel) by putting `autofocus` on that element. Drop the manual focus-return code, since the browser now returns focus to the invoker.
  - Move the scrim styles to `dialog::backdrop`, the panel styles to the dialog. Keep the bottom-sheet look under 640px.
  - CommandPalette: same `<dialog>`, options get `tabIndex={-1}` so only the combobox is a Tab stop, and focus returns on close. Onboarding: same.
- **Risks and migration**:
  - React portals and stacking: a `<dialog>` in the top layer sits above the z-60 toasts and menus. Toasts that must stay visible need W7's `popover="manual"`. Until then, check that a toast fired while a modal is open still shows.
  - Nested: a ConfirmDialog opened from a form Modal is a second `showModal()`. That's supported and is the reason `cancel` must stop at the top dialog.
  - Desktop app: `SCRIM` carries `-webkit-app-region:no-drag`. Check in `apps/desktop/scripts/qa.ts` that a click on `::backdrop` over a drag region closes the modal instead of moving the window. If it doesn't, put `no-drag` on the dialog element at full size.
  - The guards that look for `[aria-modal]` (`useThreadInterruptKey.ts:21`, `inbox-key.ts:10`) keep working if the dialog keeps `aria-modal`, or switch them to `:modal` here.
  - happy-dom's `HTMLDialogElement` support is partial. Stub `showModal`/`close` in tests if needed.
- **Verify**:
  - Tests: extend `apps/web/tests/modal-focus.test.ts` (opens with `showModal`, Escape fires `onClose` once, a dirty form's Escape asks first, focus returns to the trigger). Add a CommandPalette case for one Tab stop.
  - Manual, desktop: open Settings > Secrets (Add), an automation editor and the palette. Tab cycles inside, the background can't be clicked, Escape closes only the top layer, the backdrop closes a ConfirmDialog but asks first on a dirty automation.
  - Manual, 390px: same modals open as bottom sheets with the keyboard up, and Escape from a hardware keyboard works.
  - Desktop app: the QA harness opens a modal over the title bar drag region.
- **Dependencies**: W0. W6 and W7 build on it.

**Builder brief**
- **Goal**: Make the shared `Modal`, `ConfirmDialog`, CommandPalette and Onboarding real modals by rendering them as `<dialog>` with `showModal()`, so focus stays inside, the page behind is inert, and a form modal never loses edits to a stray backdrop click or Escape. Findings H2 and M3 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W1 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - All 16 call sites render through the new dialog with no call-site API change beyond the new `dismiss` prop on the three form callers.
  - Tab never leaves an open modal on desktop web, phone web or the desktop app, and the background is inert.
  - Escape closes only the top dialog, and a dirty form asks before closing.
  - `modal-focus.test.ts` covers this, the full checks pass, the design system has the dialog change, and a PR is open with screenshots of all three surfaces.
- **Proof back**: PR URL; the test names added; a short screen recording or screenshots showing Tab cycling inside a modal on desktop and the phone layout; the desktop QA harness result for a backdrop click over a drag region.

---

## W2. CSP and headers on the Web UI shell

- **Findings**: H1 (no CSP, clickjacking guard or `nosniff`), L6 (`'unsafe-inline'` on the relay, server-screen and paired pages).
- **Files**: `apps/server/app.ts:148-156` (new middleware), maybe a small `apps/server/web-headers.ts`; `apps/web/index.html` (inline theme script, read only); `apps/relay/src/page.ts:84`; `apps/desktop/src/server-screen.ts:97`; `apps/server/auth-api.ts:359`; `docs/user/remote-access.md` (security headers paragraph); `apps/server/tests/server-api.test.ts` or a new `web-shell-headers.test.ts`.
- **Approach**:
  - On every `text/html` response from the web block only (the SPA shell and its fallback route), set:
    - `Content-Security-Policy-Report-Only: script-src 'self' 'sha256-<theme script>'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; report-to omni`
    - `Reporting-Endpoints: omni="/api/csp-report"`, with a small endpoint that logs a count and a capped sample. Log no URLs with keys and no payload bodies (guide: data hygiene).
    - Enforced now (low risk): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
  - Compute the script hash at server start from the built `index.html`, so W15 can change the inline script without editing a constant.
  - After the report-only run is clean on Ben's machines, switch to enforced `Content-Security-Policy` in a follow-up commit in the same PR, or a second PR if the run needs time.
  - Do not add `frame-ancestors` or `X-Frame-Options` to artifact, design-system or upload routes: `ArtifactViewer`, `HtmlRender` and `ArtifactThumb` frame them from the same origin.
  - L6:
    - Relay page: hash its static `SCRIPT` constant.
    - Server screen: replace the one-line scroll script with a hash, or drop it and use CSS (`display:flex; flex-direction:column-reverse` on the log) so the CSP has no `script-src` at all.
    - Paired page: per-request nonce, since its script embeds the session path.
- **Risks and migration**:
  - `style-src` is left open on purpose: React style attributes and Tailwind arbitrary values need it.
  - Vite dev (:4748) is untouched because headers come from the built-shell path only. Say so in the PR.
  - Things that could trip report-only: Mermaid (no script injection; it renders SVG), xterm (canvas), any `eval` in a dependency. The report endpoint will show them.
  - The desktop app loads the same shell from the bundled server, so it gets the headers too. Check that `window.omniDesktop` preload still works (preload scripts are not subject to page CSP).
  - Relay change needs a relay redeploy by each user, so mention it in the PR and the relay docs.
- **Verify**:
  - Tests: a server test that GET `/` returns the CSP-RO, XFO, nosniff and Referrer-Policy headers, that the hash matches the built inline script, and that an artifact route returns no `frame-ancestors`. A relay test that the page CSP has no `'unsafe-inline'` in `script-src`. A desktop test for `screenHtml()`.
  - Manual: QA stack, open desktop web and 390px phone web, use Thread, Settings, Mermaid diagram, terminal, artifacts; zero CSP violations in the console and the report endpoint. Desktop app via `qa.ts`: same.
  - `curl -sI` the shell and an artifact route on the QA stack, paste both in the PR.
- **Dependencies**: W0. W17 follows it. W15 changes the inline script; with the hash computed at start, either order works.

**Builder brief**
- **Goal**: Give the Web UI shell a Content-Security-Policy (report-only first, then enforced), a clickjacking guard, `nosniff` and a referrer policy, and replace `'unsafe-inline'` scripts on the relay, server-screen and paired pages with hashes or a nonce. Findings H1 and L6 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W2 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - The built shell (`/` and the SPA fallback) sends CSP (report-only or enforced, say which), `X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy`, with the theme-script hash computed from the built file.
  - Artifact and upload routes are unchanged and still render in their iframes.
  - A CSP report endpoint logs counts without sensitive data.
  - The three small pages carry no `'unsafe-inline'` in `script-src`.
  - Tests cover the headers, and the full checks pass. A PR is open.
- **Proof back**: PR URL; `curl -sI` output for `/` and one artifact route on a QA stack; the console and report endpoint showing zero violations after using desktop web, phone web and the desktop app; whether enforcement is on or still report-only, and why.

---

## W3. iPhone field zoom and input hints

- **Findings**: H3 (iOS zooms on 13 to 14px fields), L12 (missing autocapitalize, autocorrect, spellcheck, enterkeyhint, autocomplete).
- **Files**: `apps/web/src/index.css:263-272` (`.field`), the ~33 `.field !text-[12.5px|13px]` call sites (`grep -rn 'field.*!text-\[1[23]' apps/web/src`), `components/ui/folder-input.tsx:21`, `components/ui/picker.tsx:172` (search input), `components/ui/feedback.tsx:182` (SearchField); L12 sites `pages/Sync.tsx:234-242`, `pages/ChannelSettings.tsx:388,391,429`, `components/Onboarding.tsx:289`, `pages/Settings.tsx:719-733`, `components/Pair.tsx:205-214`; optionally the `SettingField` contract in `packages/shared/settings.ts`.
- **Approach**:
  - In `.field`: `font: inherit` and, under `@media (pointer: coarse)`, `font-size: max(1rem, 1em)`.
  - Replace the `!text-[13px]` overrides with a `.field-sm` modifier whose small size applies only under `(pointer: fine)`, so the coarse-pointer rule always wins. Mono fields get `.field-mono`.
  - L12: identifier fields (relay URL, store domain, repo, slugs): `autoCapitalize="none" autoCorrect="off" spellCheck={false}`, `type="url"` + `inputMode="url"` for URLs. Fields that save on Return: `enterKeyHint="done"`. Pairing token: `autoComplete="current-password"` (or `one-time-code` if it is single-use; check `apps/server` pairing), not `off`. Secrets keeps `new-password`, with a comment on why.
  - If `SettingField` grows an `input` hint object, the iOS app can read it later; keep it optional.
- **Risks and migration**:
  - Desktop layout shifts: none if `.field-sm` keeps today's sizes under a fine pointer. A touch laptop or an iPad with a trackpad matches `(pointer: coarse)` only when the primary pointer is touch.
  - The change is visible on the phone (bigger text in Settings fields). Check that labels and rows still fit at 390px.
- **Verify**:
  - Tests: a CSS test in the style of `fg4-contrast.test.ts` that reads `index.css` and asserts the coarse-pointer rule, plus a grep-style test that fails if a `.field` uses `!text-[..px]` without the modifier.
  - Manual, 390px with touch emulation: computed font-size of Settings, Secrets, Sync, Pair and Picker search inputs is 16px. On the iPhone home-screen app: focus each field, no zoom.
  - Desktop web and desktop app: fields look unchanged (screenshot diff of Settings).
- **Dependencies**: W0. W9, W11 and W18 build on the `.field` changes.

**Builder brief**
- **Goal**: Stop iPhone Safari zooming into Settings, Secrets, Sync, Pair and Picker fields by making `.field` at least 16px on coarse pointers, and add the right input hints to identifier, URL and token fields. Findings H3 and L12 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W3 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - Every `.field` input computes to 16px or more under `(pointer: coarse)` and keeps today's size on desktop.
  - No `.field` call site forces a px size past the coarse rule, and a test guards it.
  - The L12 fields carry `autocapitalize`/`autocorrect`/`spellcheck`/`inputmode`/`enterkeyhint` as listed, and the pairing token can be autofilled.
  - Full checks pass and a PR is open with phone and desktop screenshots.
- **Proof back**: PR URL; computed font sizes for 5 named fields at 390px with touch emulation; whether it was checked on the iPhone home-screen app; desktop before/after of Settings.

---

## W4. Picker and ModelPicker on popover + combobox

- **Findings**: H4 (listbox not announced, ModelPicker has no keys), M13 (JS placement, clipped inside modals).
- **Files**: `apps/web/src/components/ui/picker.tsx` (42 call sites), `components/ModelPicker.tsx`, `components/model-picker/ModelList.tsx`, `components/ContextMenuParts.tsx:36-52` (`useMenuPlacement`, only the placement part), `components/rail/ChannelRail.tsx:119,147,170` (portal menu), `index.css:837-839` (cursor wash), tests `apps/web/tests/crew-picker.test.ts`, `mobile-model-sheet.test.ts`.
- **Approach**:
  - Picker: the trigger button owns a `popover="auto"` panel (top layer, so modals no longer clip it). Placement uses CSS anchor positioning (`anchor-name` from `useId()`, `position-area: block-end span-inline-end`, `position-try-fallbacks: flip-block, flip-inline`) inside `@supports (position-area: block-end)`. The current JS measure stays as the fallback path for browsers without it.
  - With search: the input is `role="combobox"` with `aria-expanded`, `aria-controls` and `aria-activedescendant` pointing at the cursor option. Copy the pattern from `CommandPalette.tsx:82-85` and `composer/menus.tsx:108`. Options are `tabIndex={-1}` with ids.
  - Without search: the list takes focus and uses `aria-activedescendant` the same way. Leave `appearance: base-select` for later (Chromium-only today, and the phone should keep the iOS wheel).
  - Cursor wash: raise it to a visible state (selected-row token or a 3:1 outline), shared with W11's focus work.
  - ModelPicker: the same popover. Arrow keys, Home/End, Enter and Escape through a shared `useListboxKeys` hook that Picker also uses. Headers and notes move out of the `role="listbox"` (use `role="group"` with `aria-labelledby` for sections).
  - Light dismiss comes from `popover="auto"`, so Picker stops registering its own outside-click listener.
- **Risks and migration**:
  - 42 call sites: the props stay the same. Check the `placement`/`align` props each caller passes still map to a `position-area`.
  - Pickers inside a `<dialog>` (W1): a popover opened from inside a modal dialog shows above it. Test in AutomationEditor.
  - Phone: popovers are fine on iOS 18.3+. Check the Picker in a MoSheet with the keyboard open, since anchor positioning uses the layout viewport.
  - The rail menu portal can go once its menu is a popover.
- **Verify**:
  - Tests: Picker announces through `aria-activedescendant` (attribute follows ArrowDown), Escape closes and focus returns to the trigger, ModelPicker handles arrows and Escape. Extend `crew-picker.test.ts`.
  - Manual, desktop: the five pickers in an open automation editor drop below or flip above without clipping or scrolling the modal. VoiceOver on macOS reads each option as the cursor moves.
  - Manual, 390px: Picker inside a sheet with the keyboard up, ModelSheet unchanged.
  - Desktop app: QA harness picks a model in the composer.
- **Dependencies**: W0. Coordinate with W1 (dialog stacking) and W3 (`picker.tsx:172` font size). W6 and W16 reuse its popover approach.

**Builder brief**
- **Goal**: Rebuild the shared `Picker` and `ModelPicker` on a top-layer `popover` with the combobox/`aria-activedescendant` pattern, so screen readers follow the cursor, ModelPicker works from the keyboard, and pickers inside modals stop getting clipped. Findings H4 and M13 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W4 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - All 42 Picker call sites and ModelPicker use the new panel with unchanged props.
  - Arrow keys move an announced active option, and Escape closes and returns focus.
  - Anchor positioning is used where supported, with the JS fallback elsewhere.
  - The automation editor's pickers render unclipped.
  - Tests cover the keyboard and ARIA, the full checks pass, the design system has the updated Picker, and a PR is open with screenshots of all three surfaces.
- **Proof back**: PR URL; a screenshot of an open picker inside the automation editor (before clipped, after not); the test names; a note on what macOS VoiceOver reads when ArrowDown moves the cursor.

---

## W5. Transcript render cost

- **Findings**: M1 (off-screen rows and hidden phone tabs still lay out), M27 (thread open renders in one task), L15 (images reserve no space).
- **Files**: `apps/web/src/components/Transcript.tsx:379,436-440`, `mobile/ThreadScreen.tsx:239`, `mobile/MobileShell.tsx:146,162`, `pages/useThreadSession.ts:122`, `pages/useScrollAnchor.ts:63`, `pages/useTranscriptScroll.ts:74`, `components/thread/Attachments.tsx:21`, `components/Markdown.tsx:101-105`, optionally `apps/server/uploads.ts:9`, `index.css` (row class).
- **Approach**:
  - Add a `.tx-row` class on the `[data-key]` row wrappers: `content-visibility: auto; contain-intrinsic-size: auto none auto 6lh` (tune the estimate from real rows). Leave it off the newest N rows (the live turn) so streaming text and the bottom pin never deal with a placeholder.
  - Phone: inactive tab roots get `content-visibility: hidden` next to the existing `visibility: hidden`. Covered stack layers get it only after the push animation ends.
  - Thread open: wrap the history apply that renders the first page in `startTransition` so a tap right after opening stays responsive. No `scheduler.yield` unless profiling shows a non-React loop.
  - Images: a fixed thumbnail box for attachments (`aspect-ratio` plus `object-fit`), and Markdown images get `width`/`height` when known. Drop `loading="lazy"` on attachments in the newest turn.
  - Profile before and after. Use a long fixture thread (`packages/shared/history.ts` keeps up to 6,000 rows), and record a Chrome performance trace of opening the thread and scrolling up, on desktop and at 390px with CPU throttling.
- **Risks and migration**:
  - `content-visibility: auto` adds paint containment, which clips shadows and anything that overflows a row, such as hover menus or tooltips inside rows. Find those and move them, or exclude those rows.
  - Scroll anchoring: the ResizeObservers already correct when a placeholder resolves. Watch for scroll jumps while reading back history. That is the main regression to test.
  - Find in page (Cmd+F) still finds text in `auto` rows (they stay in the accessibility tree and searchable), but not in `hidden` phone tabs, which is fine.
- **Verify**:
  - Tests: `transcript-scroll.test.ts` and `live-history-measure.test.ts` still pass. Add a test that the newest rows carry no `.tx-row`.
  - Manual: open a 1,500-row thread on a QA stack on desktop and at 390px. Scroll to the top and back with no jumps, stream a new turn with the bottom pin holding, and use Find in page.
  - Perf proof: before/after trace numbers for thread open (longest task, total style+layout) and a scroll-up pass.
  - Desktop app: QA harness opens the long thread.
- **Dependencies**: W0. W7 and W12 also edit MobileShell; merge W5 first or rebase.

**Builder brief**
- **Goal**: Cut layout and style work on long threads by deferring off-screen transcript rows and hidden phone tabs with `content-visibility`, render a thread's first page as a transition, and reserve image space. Findings M1, M27 and L15 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W5 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - Transcript rows (except the newest) use `content-visibility: auto` with an intrinsic size, and hidden phone tabs use `content-visibility: hidden`.
  - The first page applies in `startTransition`, and attachments reserve their box.
  - No scroll jump on a 1,500-row thread on desktop or at 390px, and the bottom pin holds while streaming.
  - Full checks pass and a PR is open.
- **Proof back**: PR URL; before/after Chrome trace numbers for opening and scrolling a long QA thread (desktop and 390px with CPU throttling); a note on any row type excluded because of clipping.

---

## W6. One dismiss stack for overlays and menus

- **Findings**: M2 (one Escape closes several layers), M5 (context menu focus and fields inside `role="menu"`), L7 (`role="menu"` without keys), L16 (no exit animations), L17 (phone quick card's invisible dismiss button).
- **Files**: `components/ui/use-dismissable.ts`, `components/ContextMenu.tsx`, `ContextMenuParts.tsx` (`useMenuDismiss`), `components/ui/inline-confirm.tsx`, `composer/ReplyControls.tsx`, `mobile/parts.tsx` (MoSheet Escape), `pages/useThreadInterruptKey.ts:21`, `inbox-key.ts:10`, `pages/PRToolbar.tsx:82-115`, `BrowserMarkToolbar.tsx:40`, `thread/HeaderActions.tsx:74-79`, `sidebar/FolderRows.tsx:139-145`, `mobile/ThreadScreen.tsx:190-199`, `index.css` exit-animation rules, tests `context-menu-keys.test.ts`, `rail-more-menu.test.ts`.
- **Approach**:
  - Menus (ContextMenu, ReplyControls send menu, PR Filters, rail More) become `popover="auto"`. Nesting and light dismiss come from the browser, and an Escape inside a child closes only the child. Right-click menus use the guide's zero-size anchor at the pointer.
  - Inline controls inside a dialog (inline-confirm) handle Escape themselves and stop propagation so the dialog's `cancel` never fires.
  - Global key guards switch from `[aria-modal],[role=dialog],[role=menu]` to `document.querySelector(':modal, :popover-open')`.
  - ContextMenu: return focus to the trigger on close, close on `focusin` outside, set `aria-expanded`/`aria-haspopup` on both "…" triggers. The rename field and the reference panel move out of `role="menu"` into a small non-modal dialog, or a popover with `role="dialog"`.
  - L7: PR Filters and the mark-toolbar menu either get the full keyboard contract via the existing `moveFocus` helper, or drop the menu roles and stay a popover button group. Remove `aria-selected` from `menuitemcheckbox`.
  - L17: the phone quick card is a `popover="auto"` toggled by its button (`popovertarget`, or script on iOS older than 26.2), with `aria-expanded`. The full-pane button goes.
  - L16: exit animations with `@starting-style` and `transition-behavior: allow-discrete` (`overlay` in the transition list), each inside a reduced-motion-aware rule per W12.
- **Risks and migration**:
  - Many small keyboard behaviours change. Write the tests first from the audit's confirmed cases: Escape on inline confirm in the crew editor, Escape in Fork's model list, NewSheet + stacked sheet.
  - Phone sheets are W7. Keep MoSheet's Escape change here limited to stopping propagation.
- **Verify**:
  - Tests: the M2 cases from the audit, each closing only the inner layer; context menu returns focus to the "…" button; PR Filters arrow keys or no menu role.
  - Manual, desktop and 390px: right-click a thread and Escape, open Fork > model list and Escape, open the PR Filters by keyboard, open and close the phone quick card.
  - Desktop app: QA harness right-click menu.
- **Dependencies**: W1 (dialog `cancel`), W4 (popover pattern). L16 goes after W12, or follows W12's per-rule reduced-motion pattern.

**Builder brief**
- **Goal**: Replace the per-overlay window key and mouse listeners with browser-managed popovers and dialog close requests, so each Escape or outside click closes only the top layer, menus return focus and follow the menu keyboard contract, and overlays animate out. Findings M2, M5, L7, L16 and L17 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W6 of `docs/plans/2026-11-19-modern-web-fixes.md`. Builds on W1 and W4.
- **Done when**:
  - The audit's stacked-Escape cases each close only the inner layer, with tests.
  - ContextMenu returns focus to its trigger and has no text field inside `role="menu"`.
  - PR Filters and the mark toolbar menu meet the menu contract or drop the roles.
  - The phone quick card is a popover with `aria-expanded`, and overlays have reduced-motion-aware exit transitions.
  - Full checks pass and a PR is open with screenshots of all three surfaces.
- **Proof back**: PR URL; the list of Escape scenarios tested and their results; the test names; a screen recording of a menu exit animation.

---

## W7. Phone sheets, toasts and landmarks

- **Findings**: M4 (phone sheets not modal), M10 (phone toast cut off and unannounced), L8 (desktop toasts vanish while focused and sit above the modal), L14 (no `<main>` on the phone, no skip link on desktop).
- **Files**: `apps/web/src/mobile/parts.tsx:257-321` (MoSheet, MoToast), `mobile/MobileShell.tsx:131-181`, the 14 MoSheet callers (read only), `components/Toaster.tsx`, `App.tsx:141-166`, tests `toast-stack.test.ts`, `mobile-screens.test.ts`.
- **Approach**:
  - MoSheet stays in the shell (not a top-layer `<dialog>`: the iOS keyboard covers the layout viewport, and MobileShell sizes from `visualViewport`). While any sheet is open, set `inert` on the stack layers and tab bar. While stacked, set `inert` on the lower sheet. Move focus into the sheet on open and back to the trigger on close.
  - MoToast: one persistent `role="status"` container mounted with the shell, messages added into it. Wrap long text (`max-width: calc(100% - 32px)`, no `nowrap`). Errors use `role="alert"` and stay until dismissed, or go inline at the caller.
  - Desktop Toaster: pause the timer on `focusin` as well as hover, return focus somewhere sensible on dismiss, and render as `popover="manual"` so it stays above `::backdrop` after W1. Name the region.
  - L14: wrap the phone screen area in `<main>`, and add a visually hidden "Skip to content" link as the first focusable element in the desktop shell (rail and classic sidebar layouts).
- **Risks and migration**:
  - `inert` on the tab bar must lift the moment the sheet closes, including when a route change closes it.
  - Toast copy that relied on being cut short may now wrap to two lines. Check the callers' messages.
- **Verify**:
  - Tests: open sheet makes the tab bar inert, focus lands in the sheet, close returns focus; MoToast container exists before the first toast; Toaster pauses on focus.
  - Manual, 390px plus the iPhone with VoiceOver if possible: open NewSheet, swipe through, nothing behind is reachable; trigger an error toast with a long message, it wraps and is announced.
  - Desktop: tab to a toast's Open button, it stays. Open a modal and fire a toast, the toast is visible and usable. Skip link works.
  - Desktop app: QA harness toast over a modal.
- **Dependencies**: W1. W5 and W12 also edit MobileShell.

**Builder brief**
- **Goal**: Make phone sheets behave as modals (inert background, focus in and back), make phone and desktop toasts readable, announced and stable under keyboard focus, and add a `<main>` landmark on the phone and a skip link on desktop. Findings M4, M10, L8 and L14 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W7 of `docs/plans/2026-11-19-modern-web-fixes.md`. Builds on W1.
- **Done when**:
  - An open MoSheet makes everything behind it inert, focus moves in and returns.
  - MoToast uses one persistent live region and wraps long text at 390px, errors persist.
  - Desktop toasts pause on focus and stay above an open modal.
  - The phone has a `<main>` and desktop has a working skip link.
  - Tests cover these, the full checks pass, and a PR is open with screenshots.
- **Proof back**: PR URL; a 390px screenshot of a long error toast; whether VoiceOver on the iPhone was used and what it announced; the test names.

---

## W8. Keyboard access: tabs, toolbars, segmented, folder reorder

- **Findings**: H5 (browser tab strip and annotation toolbar), M8 (`Segmented` and tab roles without the pattern; route links as tabs), L11 (folder reorder is mouse-only).
- **Files**: `components/LiveBrowser.tsx:273-312` (TabStrip), `components/BrowserMarkToolbar.tsx:77-140`, `components/ui/primitives.tsx:75` (`IconButton active`), `components/ui/segmented.tsx` (~25 uses), `pages/Channel.tsx:116-164`, `thread/ThreadPanel.tsx:99-121`, `mobile/LibraryScreen.tsx:86`, `sidebar/SidebarTop.tsx:78`, `ModelPicker.tsx:189-206`, `pages/ChannelSettings.tsx:115-131`, `sidebar/FolderRows.tsx`, `ContextMenuParts.tsx:173-186`, `folders.tsx:175`, tests `live-browser-web.test.ts`, `folder-groups.test.ts`.
- **Approach**:
  - One small `useRovingFocus` hook (arrow keys, Home/End, one Tab stop), since `focusgroup` is Chromium-only. Used by the tab strip, the mark toolbar and Segmented.
  - Browser tabs: each tab is a `<button role="tab">` with roving focus. Close buttons and New tab move outside the `role="tablist"` (or close via Delete on the focused tab plus a separate visible button).
  - Mark toolbar: roving focus, and `IconButton active` sets `aria-pressed`. Check every other `active` caller makes sense as a toggle, or add a separate `pressed` prop.
  - Segmented gets a `kind` prop:
    - `'tabs'` keeps `role="tab"` and links `aria-controls` to a `role="tabpanel"`.
    - `'choice'` (filters) becomes a radio group: native radios styled as segments, or `role="radio"` with roving focus.
    - `'nav'` renders links with `aria-current="page"`, for Channel's Threads/PRs/Settings.
    - The selected state gets a border or underline that survives forced colors.
  - Folders: add Move up and Move down to the folder context menu, calling `folders.reorder`, and announce "Moved X above Y" in a polite live region.
- **Risks and migration**:
  - About 25 Segmented call sites need a `kind`. Default it to `'choice'` and list the call sites that are really tabs or nav in the PR.
  - Changing link-tabs to nav changes what screen readers announce on the Channel page. That's intended.
- **Verify**:
  - Tests: tab strip arrow-key switching, toolbar one Tab stop with `aria-pressed`, Segmented roles per kind, folder Move up/down calls reorder.
  - Manual, desktop: switch browser tabs and tools by keyboard only, reorder a folder by keyboard, Tab through a Settings page with several Segmented controls.
  - 390px: Library type filter and other phone Segmented uses still work by touch.
  - Desktop app: QA harness Browser panel keyboard pass.
- **Dependencies**: W0. Independent of the overlay work.

**Builder brief**
- **Goal**: Make the Browser panel's tab strip and annotation toolbar keyboard operable, give `Segmented` correct tabs/radio/nav semantics with arrow keys, and add a keyboard way to reorder folders. Findings H5, M8 and L11 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W8 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - Browser tabs and the mark toolbar each have one Tab stop with arrow keys, and the active tool exposes `aria-pressed`.
  - Every Segmented call site has a `kind` with matching roles, and Channel's route links use `aria-current`.
  - Folders can be moved up and down from their context menu with an announcement.
  - Tests cover each, the full checks pass, and a PR is open with screenshots.
- **Proof back**: PR URL; the Segmented call sites by kind; the test names; a note confirming a keyboard-only pass of the Browser panel in the desktop app.

---

## W9. Form and feedback primitives

- **Findings**: M14 (copy buttons claim success on failure), M15 (composers named by placeholder), M16 (validation and `aria-invalid` out of sync), M17 (Label puts the hint in the name), M18 (CheckItem is a fake button), L13 (busy and progress semantics).
- **Files**: `components/ui/feedback.tsx` (copyText, CopyButton, Label, CheckItem, ErrorNote), `pages/settings-parts.tsx` (Row, field-error slot), `components/ui/status.tsx:162-171` (Loader), `components/ui/primitives.tsx:52-56` (busy Button), `Transcript.tsx:91-108`, `QuickAnswer.tsx:164`, `thread/ThreadQuickCard.tsx:240`, `thread/panel/GlanceCard.tsx:52`, `mobile/ThreadViews.tsx:555-565`, `Composer.tsx:245,535`, `mobile/NewSheet.tsx:236`, `thread/ContextMeter.tsx:427`, `pages/Secrets.tsx`, `pages/ChannelSettings.tsx`, `AvatarColorPicker.tsx:53`, `pages/Settings.tsx:567-615`, `ChannelActionsEditor.tsx:91`, `thread/ToolRows.tsx:82`, `pages/Storage.tsx:124`, `onboarding-parts.tsx:621-628`.
- **Approach**:
  - Copy: `copyText` returns `Promise<boolean>`, checks `execCommand`'s result, and the fallback textarea is `readonly` and 16px. CopyButton shows "Copied" or "Couldn't copy" in a live region outside the button. The 5 ad-hoc copy buttons switch to it.
  - Composer names: `aria-label="Message"` (or a visually hidden `<label>`) on the 4 textareas. The placeholder stays as a hint.
  - Validation: a `useFieldError` helper that sets `aria-invalid` and `aria-describedby` only after the field is touched or on submit, in step with a `:user-invalid` style. Native `required`/`pattern` where the rule is simple. On submit failure, focus the first invalid field. Secrets stops disabling Submit and shows the error instead.
  - Label: the hint moves out of `<label>` into a `<span id>` linked by `aria-describedby`, like Row does. Every caller's control gets the id.
  - CheckItem: render a `<li>` with the state as text (visually hidden "done", "in progress"), with `role="button"` and `tabIndex` only when `onClick` exists.
  - L13: Loader is no longer a live region by default (`aria-hidden` inside buttons, `aria-busy` on the region that loads). A busy Button keeps focus (`aria-disabled` instead of `disabled` while busy). Storage's progressbar gets a name. Onboarding Steps marks `aria-current="step"`. Under reduced motion the loader slows down instead of stopping.
- **Risks and migration**:
  - `aria-disabled` buttons still fire clicks, so the busy Button must ignore clicks while busy.
  - Label call sites (18) each need an id for the control. Do it with `useId()` inside Label and pass it through a render prop or `htmlFor` contract.
- **Verify**:
  - Tests: copy failure path shows the failure, Label hint is in `aria-describedby` not the name, `aria-invalid` only after blur/submit, CheckItem is not focusable without `onClick`, busy Button keeps focus.
  - Manual, desktop: VoiceOver reads the Pair token field name as just "Token"; submit an empty secret, focus lands on the field with the message.
  - 390px: copy over plain http on a QA stack reached by IP shows the right outcome; the fallback doesn't zoom.
  - Desktop app: copy a message.
- **Dependencies**: W3 (`.field` changes). Coordinate `feedback.tsx` edits with W11.

**Builder brief**
- **Goal**: Fix the shared form and feedback primitives so copy reports real outcomes, inputs have real names and descriptions, validation state matches what is shown, to-do rows are not fake buttons, and loading states don't spam screen readers. Findings M14, M15, M16, M17, M18 and L13 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W9 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - copyText reports failure and CopyButton announces both outcomes; all copy buttons use it.
  - The 4 composers have accessible names, Label hints are descriptions, and `aria-invalid` follows touch/submit with focus moving to the first invalid field.
  - CheckItem is a list item, and the Loader/busy Button changes are in.
  - Tests cover each, the full checks pass, and a PR is open.
- **Proof back**: PR URL; the test names; what VoiceOver reads for the Pair token field before and after; a screenshot of a failed copy.

---

## W10. Composer input: IME Enter and `field-sizing`

- **Findings**: M6 (Enter submits during IME composition), M11 (composer auto-grow measures `scrollHeight` every keystroke).
- **Files**: `components/composer/controls.tsx` (export `isImeEnter`, `useAutosize`), the 16 Enter handlers listed under M6 in the report, `Composer.tsx:92,411`, `pages/QuickPrompt.tsx:50`, `mobile/MoComposer.tsx:89-94`, `index.css` (composer textarea class), tests `composer-slash.test.ts`, `quick-prompt.test.ts`.
- **Approach**:
  - Export `isImeEnter(e)` (`e.isComposing || e.keyCode === 229`) from `composer/controls.tsx` and use it at all 16 sites, before any Enter action.
  - Add a lint-style test that greps `apps/web/src` for `key === 'Enter'` handlers without `isImeEnter` (allowlist only real exceptions).
  - Composer: `field-sizing: content` with `min-block-size` and `max-block-size` matching today's 132 to 360px caps. `useAutosize` returns early when `CSS.supports('field-sizing', 'content')`, so no inline height is set. QuickPrompt (Electron only) drops the JS. MoComposer shares the hook instead of its own copy.
- **Risks and migration**:
  - An inline `style.height` left over from the JS path overrides `field-sizing`. Make sure the supported path never writes it, including the ResizeObserver and `fonts.ready` callbacks.
  - Placeholder height: `field-sizing` sizes to the placeholder too. Check a long placeholder on the phone.
- **Verify**:
  - Tests: `isImeEnter` covers both signals, and the grep test passes. The autosize hook writes no height when `field-sizing` is supported (mock `CSS.supports`).
  - Manual: type Japanese with the macOS IME in rename, palette, Settings save-on-Return and the QuestionCard; confirming a candidate never submits. On the iPhone (Japanese keyboard), the same in the phone composer and search.
  - Composer grows and caps on desktop, 390px and the desktop app QuickPrompt.
- **Dependencies**: W0. Touches `picker.tsx:104` and `ContextMenu.tsx:169`, which W4 and W6 also edit.

**Builder brief**
- **Goal**: Stop Enter from submitting half-composed CJK input anywhere in the web UI, and let the composer textareas size themselves with `field-sizing: content` instead of measuring on every keystroke. Findings M6 and M11 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W10 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - All 16 Enter handlers use one exported `isImeEnter` helper, and a test fails on a new unguarded Enter handler.
  - Composer, MoComposer and QuickPrompt grow with `field-sizing` where supported, keep the JS fallback elsewhere, and keep their size caps.
  - Full checks pass and a PR is open.
- **Proof back**: PR URL; the list of handlers changed; the result of an IME test in rename and the composer (macOS, and iPhone if available); the browsers where the JS fallback still runs.

---

## W11. Focus rings and contrast

- **Findings**: M7 (faint or missing focus indicators), M19 (Toggle off state about 1.1:1), M23 (scrollbar thumb about 1.4:1, no `prefers-contrast`), M24 (transcript hides its scrollbar).
- **Files**: `index.css` (`.field:focus`, `.scroll-thin`, `.scroll-none`, `.mo-scroll`, Toggle at `:619-660`, `--line*` tokens), `components/ui/feedback.tsx:128-134,182`, `pages/Search.tsx:38`, `SettingsNav.tsx:20`, `ImageZoom.tsx:135-152`, `LiveBrowser.tsx:486-498`, `App.tsx:79-82`, `pages/Thread.tsx:247`, plus the token copies in `apps/ios/src/theme.ts` and `apps/desktop/src/windows.ts`, test `fg4-contrast.test.ts`.
- **Approach**:
  - Focus: `.field:focus-visible` and SearchField get a 2px `--fg` ring (or the global `:focus-visible` ring at `index.css:243`), distinct from hover. ImageZoom and LiveBrowser get the global ring, plus `+`/`-`/`0` keys for zoom on ImageZoom and a role on the element with the label. The resize separator gets a visible focus state.
  - Toggle: the off track gets a token with 3:1 against the card in both schemes, or a 1px `--fg-3` border.
  - Scrollbar: a `--scrollbar-thumb` token at 3:1 (based on `--fg-3`), used by `.scroll-thin`. A `@media (prefers-contrast: more)` block strengthens `--line`, `--line-strong` and the thumb.
  - Transcript: `.scroll-none` becomes `.scroll-thin` on desktop. `.mo-scroll` on the phone stays as is (iOS shows its own indicator while scrolling). Say that in the PR. Reverted on 2026-11-20: Ben wants no visible bar there (M24's decision line in the audit).
  - Extend `fg4-contrast.test.ts` into a token contrast test covering the new pairs.
- **Risks and migration**:
  - Token changes go into Claude Design, `apps/ios/src/theme.ts` and the desktop window background in the same PR (repo rule).
  - A visible scrollbar on the transcript is a design change. Show it in the screenshots.
- **Verify**:
  - Tests: the contrast test asserts 3:1 for Toggle off-track, the scrollbar thumb and the focus ring against their backgrounds, in light and dark.
  - Manual: Tab through Settings and Search on desktop, every focused field is obvious. Turn on macOS Increase contrast and check hairlines and the thumb. At 390px, Toggles read as off.
  - Desktop app: same pass in the QA harness.
- **Dependencies**: W3 (`.field`). Coordinate `feedback.tsx` with W9.

**Builder brief**
- **Goal**: Give every focusable field and surface a clearly visible focus ring, bring the Toggle's off state and the thin scrollbar thumb to 3:1, respond to `prefers-contrast: more`, and show a scrollbar on the desktop transcript. Findings M7, M19, M23 and M24 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W11 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - The listed fields and surfaces show a focus ring distinct from hover, and ImageZoom zooms from the keyboard.
  - The Toggle off track and scrollbar thumb meet 3:1 in both schemes, enforced by a contrast test.
  - A `prefers-contrast: more` block exists, and the token changes are mirrored in Claude Design, the iOS theme and the desktop window colour.
  - Full checks pass and a PR is open with screenshots.
- **Proof back**: PR URL; contrast ratios before and after for each pair; screenshots with Increase contrast off and on; the design system change or the `/design-sync` follow-up.

---

## W12. Motion: reduced motion and phone view transitions

- **Findings**: M20 (global reduced-motion kill switch; smooth scrolls ignore the setting), M28 (no view transitions on the phone stack), L18 (JS scroll fades; focus lands under fades and sticky headers).
- **Files**: `index.css:1398-1418` and the ~20 keyframe classes, `pages/useReveal.ts`, `components/ui/inline-confirm.tsx:138`, `pages/useTranscriptScroll.ts:51`, `pages/Settings.tsx:162`, `pages/Secrets.tsx:169`, `AutomationEditor.tsx:72`, `mobile/MobileShell.tsx:103-162`, `router.ts:135-158`, `index.css:1458-1483`, `rail/useScrollFade.ts`, `rail/ChannelRail.tsx:69-73`, `rail/ListPanel.tsx:64-66`, `thread/ContextMeter.tsx:207-218`, `ThreadList.tsx:144,251,283`, test `shimmer-css.test.ts`.
- **Approach**:
  - Replace the `*` rule with per-animation reduced-motion rules. Movement (slides, scale, push) goes; fades, colour changes, the search-hit flash and the undo fuse stay (the fuse can switch to a non-moving countdown).
  - A `prefersReducedMotion()` helper. The four JS scrolls pass `behavior: prefersReducedMotion() ? 'auto' : 'smooth'`.
  - Phone stack: wrap the route change for push/back in `document.startViewTransition({ update, types: [place.dir] })` with `flushSync`, slide direction from the type, and remove the timed underlay. Without support, today's mount keyframe stays. Add `::view-transition-*` reduced-motion rules and `pointer-events: none` on `::view-transition`.
  - L18: scroll fades driven by `animation-timeline: scroll(self)` with `@property` inside `@supports`, keeping the IntersectionObserver/JS path as fallback for the rail. Add `scroll-padding-block` equal to the fade and `scroll-padding-top` equal to sticky header heights.
  - Inbox shelf moves (the `group-element-transitions` part of M28): skip for now. The audit rates it low and live updates are frequent.
- **Risks and migration**:
  - View transitions capture the whole phone shell. Check that the keyboard and `visualViewport` sizing survive a push with the keyboard open.
  - A view transition blocks input while it runs. Keep the duration at today's 420 ms or less.
- **Verify**:
  - Tests: CSS test that no `*` reduced-motion rule remains and that the named flash and fuse animations keep running under reduced motion; router test that a push calls `startViewTransition` when present.
  - Manual: macOS Reduce motion on, search hit flash and undo fuse visible, scrolls jump. At 390px, push and back animate in both directions; with Reduce motion they cross-fade or cut. Tab through the rail, focus is never under the fade.
  - Desktop app: Reduce motion pass in the QA harness.
- **Dependencies**: W0. W6's exit animations (L16) follow this pattern. MobileShell overlaps W5 and W7.

**Builder brief**
- **Goal**: Replace the global reduced-motion kill switch with per-animation rules that keep fades and meaning, make JS scrolls respect the setting, animate the phone stack's push and back with view transitions, and move scroll fades to CSS with scroll padding. Findings M20, M28 and L18 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W12 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - No `*` reduced-motion rule remains. Movement stops under reduced motion while the search flash and undo fuse still show.
  - The four smooth scrolls respect the setting.
  - Phone push and back animate in both directions with `startViewTransition`, with today's behaviour as the fallback.
  - Scroll fades run in CSS where supported, and focus never lands under a fade or sticky header.
  - Tests cover these, the full checks pass, and a PR is open with recordings.
- **Proof back**: PR URL; screen recordings of phone push/back, and of the search flash with Reduce motion on; the test names.

---

## W13. CSS layout fixes

- **Findings**: M9 (unlayered `.md` rules beat utilities), M21 (diff header never sticks), M22 (tables), M25 (quick card layout follows the viewport), L19 (truncated headings), L20 (`vh`/`vw` on phone overlays, no left/right safe areas).
- **Files**: `index.css:963-1396` (`.md` block and helpers), `components/Markdown.tsx:86-116`, `mobile/ThreadCards.tsx:34`, `mobile/ThreadViews.tsx:96,109,272`, `components/DiffViewer.tsx:134`, `index.css:1104-1134`, `dashboard/UsageSection.tsx:92-93`, `ArtifactViewer.tsx:49-63`, `pages/SettingsCrew.tsx:468-477`, `pages/Thread.tsx:206,320,346`, `Transcript.tsx:159,162`, `thread/ThreadHeader.tsx:99`, `ui/feedback.tsx:158`, `rail/ListPanel.tsx:56`, `ui/modal.tsx:56`, `ContextMenu.tsx:153`, `index.css:951`, the 11 inline `env(safe-area-inset-bottom)` strings, tests `markdown-corpus.test.ts`, `thread-quick-card.test.ts`, `pr-detail-layout.test.ts`.
- **Approach**:
  - M9: wrap the `.md` block and loose helpers in `@layer components`. Then check the Markdown renderers' utilities that used to lose to `.md a`, and the phone prose size and leading.
  - M21: `overflow-clip` instead of `overflow-hidden` on the diff file card.
  - M22: a `table` renderer in Markdown.tsx that wraps the real `<table>` in a `role="region"` with `aria-label` and `tabIndex={0}` scroll wrapper, and drop `display: block` from `.md table`. Same focusable wrapper for wide `.md pre`. ArtifactViewer CSV: `table-layout: fixed` plus a width, so `truncate` works, with the full text reachable (expand on click or focus). SettingsCrew charter diff: real cells or no table roles. UsageSection: focusable scroll wrapper.
  - M25: `@container` on the thread root, with the quick card's static-column switch and the bubble max width keyed to the container instead of `sm:`/`lg:` viewport breakpoints.
  - L19: headings wrap with `text-wrap: balance` and a line clamp of 2 where space is tight, instead of single-line truncation.
  - L20: `dvh` instead of `vh` in the three overlays, drop `100vw`, and add a `safe-x` utility that pads left and right insets on the desktop shell when it renders on a landscape iPhone. Replace the repeated inline bottom-inset math with one utility.
- **Risks and migration**:
  - M9 changes the cascade for every Markdown render. Diff screenshots of the Markdown corpus (`markdown-corpus.test.ts` fixtures) on desktop and phone before and after.
  - M25 changes when the quick card docks. Pick the container width that matches today's behaviour at full-screen desktop, and show half-screen screenshots.
- **Verify**:
  - Tests: Markdown table renders inside a focusable named region; `.md` rules are inside a layer (CSS test); quick card dock switches on container width (`thread-quick-card.test.ts`).
  - Manual: long diff in the Changes tab keeps its header; a wide agent table scrolls by keyboard in Safari; a 900px desktop window gives the transcript more room; phone prose matches its intended 15px/1.6.
  - Desktop app: half-width window screenshot.
- **Dependencies**: W1 for the `modal.tsx` line in L20. Otherwise independent.

**Builder brief**
- **Goal**: Fix six CSS layout problems from the audit: Markdown rules that override utilities, a diff header that never sticks, inaccessible wide tables, a quick card that ignores the thread's width, truncated headings, and viewport units and safe areas on phone overlays. Findings M9, M21, M22, M25, L19 and L20 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W13 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - `.md` lives in a cascade layer and phone prose renders at its intended size.
  - The diff header sticks.
  - Markdown tables and wide code blocks scroll in focusable named regions without `display: block`, and CSV cells truncate with full text reachable.
  - The quick card docks by container width.
  - Headings wrap instead of truncating, and phone overlays use `dvh` with consistent safe-area utilities.
  - Tests cover these, the full checks pass, and a PR is open with screenshots of all three surfaces.
- **Proof back**: PR URL; before/after screenshots of a Markdown corpus reply on the phone, a long diff, and a 900px desktop window; the test names.

---

## W14. Background work and time labels

- **Findings**: M12 (polling while hidden), L9 (background reads at default priority), L1 ("2h 60m" rounding), L2 (free-text automation timezone).
- **Files**: `app/useMachines.ts:28`, `pages/Home.tsx:105`, `forwarded.ts:13`, `store.tsx:104-108,334` (`usePageVisible`), `components/LiveBrowser.tsx:132`, `api.ts:587,642`, `apps/web/src/format.ts:60-66`, `packages/shared/format.ts:18`, `components/AutomationEditor.tsx:195`, `components/onboarding-parts.tsx:672` (TimezoneInput), `packages/shared/settings.ts:352` (`isTimezone`), tests `poll-retry.test.ts`, `list-gate.test.ts`, `clock.test.ts`, `usage-reset.test.ts`, and the shared format tests.
- **Approach**:
  - Gate the four pollers on `usePageVisible`. On the phone, also on whether the owning tab is shown. Refetch once on return to visible. Keep `needs-you` live for notifications.
  - The `/channels` burst reload waits for `visibilitychange` when hidden.
  - LiveBrowser closes the screencast EventSource while hidden or the panel is closed, and reopens on return.
  - `request()` in `api.ts` accepts `RequestInit` extras. `listGet` and the pollers pass `priority: 'low'`.
  - L1: integer-first unit balancing in `untilLabel` and `relTime` (compute total minutes, then hours and minutes). Keep the same copy style. Don't use `Intl.DurationFormat` in `packages/shared` (it also runs on Hermes).
  - L2: AutomationEditor uses the existing TimezoneInput with `isTimezone` validation.
- **Risks and migration**:
  - The server treats any `/machines` GET in the last minute as "watching". With polling paused, machine tiles may show stale numbers for one poll after return. Refetch on return covers it.
  - `priority` is ignored where unsupported. No fallback needed.
- **Verify**:
  - Tests: pollers stop when hidden and refetch on visible (fake timers + mocked `visibilityState`); `untilLabel` and `relTime` table tests including 2h 59m 45s, 59m 45s and 59m 50s; AutomationEditor rejects "Europe/Amsterdm".
  - Manual: on a QA stack, hide the tab on Home and watch the server log stop `/machines` and machine-stats sampling after a minute; return and see fresh tiles. Phone: switch away from Activity, same check.
  - Desktop app: minimize the window, same server log check.
- **Dependencies**: W0. Independent.

**Builder brief**
- **Goal**: Stop the web UI polling and streaming while it is hidden, run background reads at low fetch priority, fix duration labels that show "60m", and give the automation timezone field a real picker. Findings M12, L9, L1 and L2 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W14 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - The four pollers and the LiveBrowser screencast pause while hidden and refetch on return, and `needs-you` stays live.
  - Background reads pass `priority: 'low'`.
  - `untilLabel` and `relTime` never output 60 minutes, with table tests.
  - AutomationEditor uses TimezoneInput.
  - Full checks pass and a PR is open.
- **Proof back**: PR URL; server log lines showing `/machines` polling and stats sampling stop with the tab hidden and resume on return (desktop web, phone and minimized desktop app); the label test table.

---

## W15. First paint: route splitting, fonts, color-scheme meta

- **Findings**: M26 (one 1.35 MB bundle), L10 (rail fonts swap after first paint), L3 (no `<meta name="color-scheme">`).
- **Files**: `apps/web/src/pages/Page.tsx`, `mobile/registry.tsx`, `apps/web/index.html`, `App.tsx:133-139`, `main.tsx:9-17`, `index.css:153-158`, `components/theme.tsx:10-18`, `apps/web/vite.config.ts` (only if a manual chunk is needed).
- **Approach**:
  - `React.lazy` for rarely used routes: Settings and its subpages, Automations (with AutomationEditor), ChannelSettings, Storage, Sync, Onboarding, IosPairing (with `qrcode-generator`), Machines, Secrets. Same pattern as `ThreadPanel.tsx:16`, with a quiet Suspense fallback that matches the page frame.
  - Fonts: move the `data-layout` decision into the inline head script (read `omni.layout` from localStorage and match `(min-width: 768px)`), add `font-size-adjust: from-font` to the rail font rule, and preload the regular weight if Vite can emit its hashed URL into the HTML.
  - L3: add `<meta name="color-scheme" content="light dark">`, and have the inline script and `apply()` set it to `light` or `dark` for a forced theme.
  - Measure the main chunk before and after with `vite build`.
- **Risks and migration**:
  - A lazy route shows a fallback on first open. Prefetch the Settings chunk on idle after first paint so it opens instantly.
  - The inline script changes, which changes its CSP hash. W2 computes the hash from the built file at start, so nothing to update by hand. If W2 merged with a constant, update it here.
  - `data-layout` set before React must match what `App.tsx` computes, or the first render flips. Share the rule from one place (`layout-pref.ts`).
- **Verify**:
  - Tests: `router-navigate.test.ts` and `mobile-screens.test.ts` still pass with lazy pages; a test that the inline script's layout rule matches `layout-pref.ts`.
  - Manual: cold load on desktop web with cache disabled, no font reflow in the rail. Dark mode cold launch of the iPhone home-screen app shows no white flash. Every lazy route opens on desktop and phone.
  - Bundle: main chunk size before and after in the PR.
  - Desktop app: cold start screenshot.
- **Dependencies**: W2 (hash handling).

**Builder brief**
- **Goal**: Shrink the web UI's main bundle by lazy-loading rarely used routes, stop the rail's web fonts reflowing text after first paint, and add a `color-scheme` meta so dark mode paints dark from the first frame. Findings M26, L10 and L3 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W15 of `docs/plans/2026-11-19-modern-web-fixes.md`. After W2.
- **Done when**:
  - The listed routes load lazily on desktop and phone, and the main chunk is measurably smaller.
  - The inline head script sets `data-layout` and `color-scheme` before first paint, and the rail font has `font-size-adjust`.
  - The CSP (if W2 has merged) still reports zero violations.
  - Full checks pass and a PR is open.
- **Proof back**: PR URL; `vite build` main chunk size before and after (minified and gzip); a cold-load recording of the rail with no reflow; whether the dark-mode cold launch was checked on the iPhone.

---

## W16. Tooltip primitive

- **Findings**: M29 (information only in `title`, unreachable on touch and keyboard).
- **Files**: new `components/ui/tooltip.tsx`, `rail/ChannelRail.tsx:207-210`, `LinkChip.tsx:36-56`, `ChannelStack.tsx:3-5`, `sidebar/FolderRows.tsx:128`, `thread/panel/RunningSubagents.tsx:17`, `index.css`, Claude Design (new component).
- **Approach**:
  - Don't convert all ~497 `title=` attributes. Only fix the places where `title` holds information nobody can get to otherwise.
  - A `Tooltip` primitive: `popover="hint"` with `interestfor` where supported, else a small JS fallback that opens on hover and on focus, closes on Escape and blur, and positions with the W4 anchor code. The trigger keeps `aria-describedby` pointing at the tip.
  - Rail discs: the tip shows the channel name on focus too. LinkChip: preview text in the tip, and the "Add the X secret" hint moves inline. Phone Activity rollup and subagent progress: the text goes inline (visible), not into a tip, since touch has no hover.
- **Risks and migration**:
  - Two tooltip systems (native `title` and the primitive) remain. Document in the component's `.prompt.md` when to use which.
- **Verify**:
  - Tests: Tooltip opens on focus and closes on Escape; rail disc has `aria-describedby`.
  - Manual, desktop: Tab through the rail, names appear. 390px: rollup names visible inline.
  - Desktop app: rail tooltip on focus.
- **Dependencies**: W4 (positioning).

**Builder brief**
- **Goal**: Add a small Tooltip primitive that works on hover and keyboard focus, and move information that today only lives in `title` (rail names, link previews, phone rollup names, subagent progress) into it or inline. Finding M29 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W16 of `docs/plans/2026-11-19-modern-web-fixes.md`. After W4.
- **Done when**:
  - A Tooltip component exists in code and in Claude Design.
  - The five listed places expose their information to keyboard (desktop) and inline (phone).
  - Tests cover focus and Escape, the full checks pass, and a PR is open with screenshots.
- **Proof back**: PR URL; screenshots of a focused rail disc showing its name and the phone Activity rollup; the design system file path.

---

## W17. Trusted Types and the search snippet sink

- **Findings**: L4 (no runtime guard on DOM sinks), L5 (search snippets through `innerHTML`).
- **Files**: `apps/server/app.ts` (the CSP from W2), `components/MermaidDiagram.tsx:34`, `pages/Search.tsx:78`, `format.ts:189-197`, `command-palette/items.tsx:45` (reuse its splitter), maybe a new `trusted-html.ts`.
- **Approach**:
  - L5 first: render search snippets by splitting on the `<mark>` markers into React nodes, as the palette does, and delete `safeSnippet`.
  - L4: add `require-trusted-types-for 'script'; trusted-types omni-mermaid dompurify` to the report-only CSP. Mermaid's SVG goes through a named `omni-mermaid` policy that runs DOMPurify (already bundled by Mermaid) before React's `dangerouslySetInnerHTML`. Watch the report endpoint for violations from Mermaid internals and other libraries (xterm, react-markdown), then decide whether to enforce.
- **Risks and migration**:
  - Mermaid writes `innerHTML` internally. If its violations can't be routed through a policy, leave Trusted Types report-only and say so.
- **Verify**:
  - Tests: Search snippet renders `<mark>` nodes without `dangerouslySetInnerHTML`; the CSP header contains the Trusted Types directive.
  - Manual: render a Mermaid diagram, run a search, open the terminal on desktop and phone; check the report endpoint.
  - Desktop app: same in the QA harness.
- **Dependencies**: W2.

**Builder brief**
- **Goal**: Remove the search snippet's `innerHTML` sink and add Trusted Types to the Web UI's CSP, with Mermaid output routed through a named policy. Findings L4 and L5 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W17 of `docs/plans/2026-11-19-modern-web-fixes.md`. After W2.
- **Done when**:
  - Search renders snippets as React nodes and `safeSnippet` is gone.
  - The CSP carries `require-trusted-types-for 'script'` (report-only or enforced, say which), and Mermaid renders through the `omni-mermaid` policy.
  - The report endpoint shows no unexplained violations after using desktop web, phone web and the desktop app.
  - Full checks pass and a PR is open.
- **Proof back**: PR URL; the CSP header; the list of violations seen (if any) and what was done about each.

---

## W18. Type tokens in rem

- **Findings**: L21 (all type sizes in px).
- **Files**: `index.css:85-101` (`--fs-*`), `index.css:222` (`body`), Claude Design tokens, `apps/ios/src/theme.ts` (mirror the scale, values unchanged in points).
- **Approach**:
  - Stage 1 only: convert the `--fs-*` tokens and `body` to rem with the same computed sizes at a 16px root (14px is `0.875rem`). The 1,077 `text-[Npx]` utilities stay for now. List them as follow-up, converted only when a file is touched for another reason.
  - Keep the phone/desktop breakpoint in px (`store.tsx:293`) and note that text scale won't move it.
- **Risks and migration**:
  - The utilities in px won't scale while the tokens do, so mixed scaling at non-default browser font sizes. Acceptable for stage 1, but the PR should show a 20px default font size screenshot so Ben can judge it.
- **Verify**:
  - Tests: CSS test that `--fs-*` are in rem.
  - Manual: at the default font size, screenshots match before. At a 20px browser default, desktop and phone screenshots for review.
  - Desktop app: unchanged at default zoom.
- **Dependencies**: W3 and W11 (both edit `index.css` near these tokens).

**Builder brief**
- **Goal**: Move the web UI's type tokens and body size from px to rem with identical default sizes, as stage 1 of respecting the user's text size setting. Finding L21 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W18 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - `--fs-*` and `body` are in rem in `index.css` and in Claude Design.
  - Screenshots at the default size match before.
  - A test guards the rem tokens, the full checks pass, and a PR is open.
- **Proof back**: PR URL; default-size before/after screenshots (desktop and phone); 20px-default screenshots for Ben's review; the count of remaining px utilities.

---

## W19. Tidy-ups: array methods, server screen page

- **Findings**: L22 (copy-then-sort, copy-then-reverse, manual resolvers), L23 (desktop server screen tokens and spinner).
- **Files**: the 18 legacy-scan lines in `apps/web/src`, `packages/shared` and (skip) the prototype; `packages/typescript-config/base.json` (`lib`); `apps/desktop/src/server-screen.ts`.
- **Approach**:
  - L22: first check that Hermes in `apps/ios` supports `toSorted`, `toReversed`, `findLast` and `Promise.withResolvers` (`findLast` is already used there). In `apps/web/src`, convert freely. In `packages/shared`, convert only what Hermes supports. `Promise.withResolvers` also needs the TS `lib` bump to ES2024 (check that every package still typechecks). Leave `[...set]` spreads alone.
  - L23: rewrite the server screen tokens with `light-dark()`, add a reduced-motion rule that slows the spinner, and `role="status"` on "Starting the server".
- **Risks and migration**:
  - The `lib` bump can surface type errors in unrelated packages. If it does, drop `withResolvers` from this PR.
- **Verify**:
  - `npm run typecheck`, `npm test`, and the iOS app's tests for any shared file touched. Desktop: `server-screen` unit test and a QA harness run with the server forced to fail.
- **Dependencies**: W0. W2's L6 also edits `server-screen.ts` (the CSP line). Merge W2 first.

**Builder brief**
- **Goal**: Apply the mechanical JS modernizations flagged by legacy-scan where every runtime supports them, and bring the desktop server-screen page in line with the web tokens and reduced motion. Findings L22 and L23 in `docs/reviews/2026-11-19-modern-web-audit.md`; approach in W19 of `docs/plans/2026-11-19-modern-web-fixes.md`.
- **Done when**:
  - The flagged lines use `toSorted`/`toReversed`/`findLast`/`Promise.withResolvers` where Hermes (for `packages/shared`) and the TS config allow, with the skipped ones listed.
  - The server screen uses `light-dark()`, slows its spinner under reduced motion and announces "Starting the server".
  - Full checks pass and a PR is open.
- **Proof back**: PR URL; the Hermes support check result; the lines converted and skipped; a desktop QA harness screenshot of the failed-server screen.
