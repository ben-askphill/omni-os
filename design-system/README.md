# Omni OS — Design System

**Fluid agents, a calm instrument.** Omni OS is Ben's local workspace for agent work: channels, threads, crew and automations, running on his own subscriptions through the official agent CLIs. It's used all day on a laptop and on a phone over a private network (Tailscale). The agents are the fluid part; the white, rounded workspace that holds them is quiet.

## Product context

Vocabulary is from the repo's `CONTEXT.md`:
- **Channel** — a client, project or area that groups threads and carries shared facts (repo, store, browser profile). Kinds: client, internal, personal.
- **Thread** — one task's conversation with one agent, from the first prompt through every follow-up. Never "chat" or "session".
- **Crew role** — a charter in `crew/*.md` (conductor, researcher, builder, store-ops, inbox).
- **Conductor** — the crew role Ben talks to; it delegates to crew threads in other channels. Reports come back tagged with a task id (`T-4F2A`).
- **Harness** — the agent CLI plus the plan it bills: Claude Code, Codex, Cursor Agent, and Cursor Cloud (a Cursor cloud agent started through Cursor's API on the channel's GitHub repo; each run shows as a `CloudAgentCard`). **Model** and **Effort** are per thread, and switch between turns from the reply composer's pills (`ModelPicker`, `EffortPicker`). A switch to another harness is a **handover**: the next session reads the thread so far, shown as a `SwitchLine` in the transcript.
- **Question card** — an agent's `ask_user_question` (Omni's AskUserQuestion): 1 to 4 multiple-choice questions in the thread, with a free-text Other, that keep the thread in Needs you until Ben answers (`QuestionCard`).
- **Automation** — a cron schedule that starts a new thread on every run.
- **Artifacts** (HTML reports, files), **PRs** (GitHub), **usage** (5h / week windows per harness).

### Sources
- **GitHub: `ben-askphill/omni-os` @ main** (see `github.md`). Read: `web/src/index.css` (tokens, Bencho blocks), `web/src/components/ui.tsx` (Button, IconButton, Status, Chip, Avatar, Segmented + sliding thumb, InlineConfirm, SlideToConfirm, Picker, Ticks, CheckItem, Toggle, Kbd, Modal), `Sidebar.tsx`, `ThreadList.tsx`, `Transcript.tsx`, `CommandPalette.tsx`, `Toaster.tsx`, `theme.tsx`, `App.tsx`, `pages/Channel.tsx`, `ModelPicker.tsx`, `CONTEXT.md`. Not yet read in full: `Composer.tsx`, `pages/Thread.tsx`, `pages/PRs.tsx`, `DiffViewer.tsx`, `ArtifactViewer.tsx`, `SlashMenu.tsx`.
- **bencho.dev** (https://bencho.dev) — the MIT block library the web app's interactions come from (pill thumb, say, sld, pik, chk, tick, bell, liquid toggle).
- Original brief (pasted in chat, Sep 2026). Sample clients Volero, Pink Gellac, Acne Studios from the brief; others invented.

## Index

- `styles.css` — entry point (imports only). Link this one file.
- `tokens/` — `fonts.css` (SF stacks), `colors.css` (light, dark), `type.css`, `space.css` (radii, heights, shadows), `motion.css` (Bencho easings), `base.css` (element defaults, keyframes).
- `components/omni.css` — all component class styles (`om-*`), plus `components/thread/switch-line.css` for `SwitchLine` (`om-switch`), `components/thread/question-card.css` for `QuestionCard` (`om-question`) and `components/thread/cloud-agent.css` for `CloudAgentCard` (`om-cloud`).
- `components/<group>/` — React primitives; each `.jsx` + `.d.ts` + `.prompt.md`, one `*.card.html` per folder.
- `assets/logo/` — mark, wordmark, favicons, app icons. `assets/icons/` — the icon set as 24-grid SVGs. `assets/ds-fallback.js` — compiles component sources in-browser when `_ds_bundle.js` is missing or stale.
- `brand/` — logo cards. `guidelines/` — foundation cards + `brand-book.html` (the long-form brand book; card groups are numbered as its chapters).
- `ui_kits/omni-os/` — desktop (`index.html`) and phone (`phone.html`); `cards/` hold light/dark previews.
- `Mobile Design System.html` — the mobile design system page: principles, metrics, every mobile part as a live specimen, live screens.
- `phone.md` — the Phone chapter: principles, metrics, type, and the phone components for web and Expo.
- `components/mobile/` — phone components (`Mo*`): React for the web phone layout and previews (`*.jsx`, styles in `mobile.css`), Expo / React Native for the iOS app (`native/*.tsx` with `theme.ts`, `Icon`, `StatusGlyph`). Same names and props; the `.d.ts` documents both.
- `ui_kits/omni-mobile/` — mobile redesign (Oct 2026 research brief): Activity home, Channels / Library tabs + new delegation, outcome-first threads, thread menu pushes, PR merge, lock screen. 15 live phones on one canvas.
- `Mac OS Design System.html` (root, beside Showcase) — every SwiftUI view in `apps/mac/Omni`, specimen by specimen (`ui_kits/mac/mac.css`, `mac.js` render the BrandPaths icons, Loader, marks, rings). `_notes.md` holds the measurements read from the Swift sources.
- `github.md` — repo association + screen map. `SKILL.md` — Agent Skill entry.
- `tokens.json` — the tokens: colour (light, dark), type, spacing, radii, heights, layout, font sizes and weights, shadows. `tokens.css` is generated from it; `styles.css` imports it first. The stylesheets under `tokens/` keep what tokens.json cannot hold (motion, the `--type-*` shorthands, `color-mix()` diffs, the `.scheme-dark` sidebar copy).
- `components/<Name>/preview.html` + `README.md` — each component's live card and guide; `components/bundle.js` (namespace `OmniOSDesignSystem_a7120f`) and `components/index.d.ts` (props).

### Components
- **core/** — `Button`, `IconButton`, `Input`, `Kbd`, `Status` (+ `StatusGlyph`), `Monogram` (+ `TaskId`, `Chip`)
- **forms/** (Bencho blocks from ui.tsx) — `Segmented` (+ `useSlidingThumb`, `Thumb`), `Toggle`, `InlineConfirm`, `SlideToConfirm`, `Picker`, `ModelPicker` (+ `EffortPicker`), `CheckItem` (+ `Ticks`)
- **feedback/** — `Toast`
- **icons/** — `Icon`, `CrewMark`, `HarnessMark`
- **brand/** — `OmniMark` (+ `StaticMark`), `OmniLogo`, `Loader`
- **navigation/** — `Rail` (the sidebar), `TabStack`, `CommandPalette`
- **thread/** — `ThreadRow` (+ `ThreadGroup`), `Message` (+ `ResultLine`, `SwitchLine`), `ToolCall` (+ `ToolCalls`), `Delegation`, `CrewReport`, `ArtifactEmbed`, `Composer`, `QuestionCard`, `CloudAgentCard`
- **panels/** — `Panel` (+ `PanelSection`), `GitHubPanel`, `UsageMeter`
- **mobile/** (phone, web + Expo) — `MoRoundButton` (+ `MoActionChip`), `MoHeader` (+ `MoLargeTitle`), `MoSection`, `MoThreadRow` (+ `MoAvatar`, `MoDiff`), `MoGroup` (+ `MoListRow`, `MoRadio`), `MoDecisionCard` (+ `MoResolvedStrip`), `MoTabBar`, `MoSheet`, `MoComposer`, `MoBubble`, `MoArtifactCard`, `MoToast`. Chapter `phone.md`, cards in group 14 Phone.

Intentional additions (not in web/src): `OmniMark`/`OmniLogo`/`Loader` (the fluid brand), `Delegation`, `TabStack`, `CrewMark`, `HarnessMark` — the signature patterns from the brief. Not yet ported from web/src: `Modal`/`ConfirmDialog`, `Empty`, `ErrorNote`, `CopyButton`, `SlashMenu`, `DiffViewer`.

### UI kit
`ui_kits/omni-os/` — Conductor thread (delegation to researcher done / builder running / store-ops needs you, decided with InlineConfirm), channel page (#Volero, 42 threads, big composer, day groups), PR panel with slide to merge, ⌘K, toast, theme + density; phone Conductor.

---

## Content fundamentals

- **Voice:** a calm operator. Plain, specific, short. The Conductor uses first person ("I'll bring the numbers back before anything ships"); the UI says **you** ("Needs you", "Waiting on you").
- **Casing:** sentence case for buttons, titles, tabs ("New thread", "Open thread", "Search or jump to"). Section captions are sentence case too, 12px SF Pro medium ("Clients", "Recent threads", "Plan") — no all-caps labels. Channels are written `#Volero`.
- **Words from CONTEXT.md:** thread (not chat), harness (not provider), crew role (not agent/persona), session only for the harness's own record.
- **Verbs on actions:** "Merge", "Pause WEEKEND15", "Open thread", "Ask the Conductor". Never "Submit", "OK", "Magic".
- **Exact numbers:** "78.3% → 52.1%", "step 5/9", "Claude 4/6", "resets in 3h 12m".
- **Mono is for code only:** `T-4F2A`, `omni/t-4f2b-shipping-rates`, `9e1c0af`, `snippets/shipping-rates.liquid`, `funnel-before-after.html`, inline code, tool args/output. Times, counts, model names and labels are SF Pro (tabular figures).
- **No greetings, no hype, no emoji.** Empty states say what to do ("Start one above. Crew threads delegated by the Conductor land here too.").

## Visual foundations

- **Color.** Pure white base (`--canvas` and `--bg` #FFFFFF); Bencho greys for surfaces inside it (`--surface` #F7F7F6, `--surface-2` #F1F1F0, `--surface-3` #ECEBE7); ink `#17181A`; text fg / fg-2 / fg-3 / fg-4. Dark: canvas #0C0D0F, pane #121316, surfaces #191B1E / #222428 / #2A2C31, text #ECEAE5. Three pops, **status only**: ultramarine #2B3BFF (live; #7280FF in dark), vermilion #FF4420 (needs you), volt #C6F52B (done). No tinted washes. Rules in `guidelines/colors-pop-rules.html`.
- **Selection** = a sliding thumb (white with `--shadow-thumb` on grey tracks, soft surface-2 on white). Primary action = ink pill. Focus = 1.5px ink outline, fields get a 4px wash ring.
- **Type.** SF Pro (Text/Display via optical size), SF Mono, SF Pro Rounded (avatars). Body 14/1.45, markdown 14.5/1.62, UI 13, small 12.5, meta 11, captions 12 medium — SF Pro throughout, tabular figures; SF Mono only for code (ids, branches, paths, filenames). Titles 26–30 at weight 500, −0.01em. No letter-spacing on body.
- **Layout.** White canvas; 252px sidebar; main pane a 22px-radius card with a hairline shadow, 8px inset. Content columns max 768px (`max-w-3xl`), 32px side padding. Side panel 360 by default, drag-resizable 280–720 (persisted).
- **Shapes.** Pills for buttons, nav, tabs, chips, pickers, search. Radii 6 (kbd, checkbox) · 12 (tool output) · 14 (fields, code) · 18 (thread rows) · 20 (tool groups, usage card, panel trays) · 22 (pane, reports, menus) · 26 (composer) · 28 (palette, modal).
- **Cards.** Filled `--surface`, no border, no shadow inside the pane; white sheets inside them get `--shadow-card`. One level of nesting at most.
- **Elevation.** `--shadow-card` (hairline + 1px), `--shadow-thumb`, `--shadow-menu` (palette, picker, toast). Scrim is ink 22% (50% dark), **no blur**.
- **Backgrounds.** Solid only. No gradients, textures or illustrations; imagery lives inside artifacts.
- **Hover.** Bencho wash: a `--wash` layer scales in from .72 with the spring (320ms). **Press:** scale .96 with the settle (220ms). Pills darken one surface step.
- **Motion.** `--ease-spring`, `--ease-settle`, `--ease-stretch`, `--ease-out` from index.css. Thumbs stretch (190ms) then settle (420ms); menus pop (340–420ms); lists rise with a 28ms stagger; panels slide 18px and settle. Alive states: running ping (1.6s), plan bead pulse, signal rise, the liquid mark. Attention never animates. Reduced motion collapses everything to 1ms.
- **Transparency.** Only `--wash`, the scrim and the 70% white search/usage pills.
- **Density.** Code-true heights (nav 32, rows ~60, palette 48). Quiet by default: settled rows regular weight in fg-2. Compact (`data-density="compact"`) drops the second line of thread rows.

## Iconography

- **Set:** the web app's hand-drawn icons — 24-unit grid, 1.75 stroke, round caps and joins, `currentColor` (`components/icons/Icon.jsx`, SVGs in `assets/icons/`) — plus Omni additions on the same grid: delegate, split, sidebar, browser, gauge, pause, diff, more. Old v1 names resolve via aliases.
- **Crew marks:** ring-derived (conductor ring, researcher aperture, builder block, store-ops tag, inbox tray), shown in 28px surface-2 circles.
- **Harness marks** (`HarnessMark`, `HarnessLogo`): the vendors' own monochrome logos — Claude (Claude Code), OpenAI (Codex), Cursor (Cursor Agent and Cursor Cloud share it; the label tells them apart) — copied verbatim from Simple Icons into `assets/harness/*.svg`, rendered in `currentColor` inside a 20px soft disc. Never redraw, recolor with a status pop, or modify them; logos remain their owners' trademarks. Use them everywhere a harness is named — thread rows, delegation branches, palette rows, composer picker, usage meters and the sidebar usage card (`harnessFor(name)` maps "Claude" / "Codex" / "Cursor" / "Cursor Cloud" to an id). Never CC / CX / CU abbreviations.
- **Status** is shape + color: pinging disc, still diamond, edged volt disc, grey dot, hollow ring.
- **Unicode** only for keys (⌘ ⇧ ↵ ↑ ↓) and arrows. **Emoji: never.** No sparkle icons for "AI".

## Logo

- **Mark:** a ring (r40, stroke 20 — the wordmark's o — leaning 10°, in a 128 box) with a satellite droplet — the frozen moment of delegation. SVG + goo filter. `OmniMark` states: idle, hover (leans to pointer), thinking (ripples), delegating (a droplet per crew thread pinches off and orbits), report (a droplet falls in and merges), attention (tense, vermilion, until acknowledged). Lives in the sidebar's Conductor row.
- **Wordmark:** "omni" as one continuous 20u line leaning 10° (o r40 · m r24 · n r28 · baseline turns r16 · 12u gap wherever strokes meet), in `assets/logo/omni-wordmark*.svg`. The o is the mark's ring. Always just "omni" — no "OS" lockup.
- **Small sizes:** `favicon-16.svg` has its own geometry; `favicon-ring-16.svg` drops the droplet. One-colour black/white in `assets/logo/`.

## Fonts

SF Pro, SF Pro Rounded, SF Mono and New York (developer.apple.com/fonts). Apple's license rules out serving them as webfonts, so `tokens/fonts.css` only names the local install and falls back to `system-ui` / `ui-monospace` / `ui-rounded` — which are SF on Apple devices. On non-Apple machines the stacks fall to Helvetica Neue / Menlo; install SF locally for accurate previews.


---

## Consuming this system (generated — do not edit)

Every path named below is under `project/` in this design system: read `project/api/tokens.md`, not `api/tokens.md`.

`components/bundle.js` defines `window.OmniOSDesignSystem_a7120f` (132 components); `tokens.css` is every token as a CSS variable plus `@font-face` for the fonts. The bundle needs react 18 (not packed in this system: bring your own copy) (`window.React`), react-dom 18 (not packed in this system: bring your own copy) (`window.ReactDOM`), loaded before it. Build any UI by mounting these components; never hand-build a control or draw an icon the system provides.

- **Standalone page:** inline `tokens.css` in a `<style>`, then the library files and `components/bundle.js` as classic scripts (a file containing `</style`, `</script` or `<!--` breaks an inline element: write the sequence `<\/style`, `<\/script` or `\x3C!--` in your copy, or load that file by URL).
- **Design canvas:** bring `tokens.css`, `components/bundle.js` and `components/index.d.ts` (for the editor’s props panel) onto the canvas in full, as the canvas type’s design-system components reference says (a server-side copy first where it offers one); in each artboard that uses this system, right after the `support.js` line, load `tokens.css` first, then the script; skip the library files (the artboard supplies React); mount with `<x-import component-from-global-scope="OmniOSDesignSystem_a7120f.<Comp>" …>`.
- **Slides deck, or any surface that cannot run the bundle:** tokens only — the values are on `api/tokens.md`; the deck takes `tokens.json` by file path for its colour pickers.

**Read, per thing:** a component’s props, parts and examples: `api/components/<Comp>.md`; token values: `api/tokens.md`; stored assets and their paths: `api/assets/<Group>.md`. After this README, fetch the cards and fonts you need in ONE message as parallel calls — none depends on another.

**Two rules.** Before you use a thing — a component, a token group, an icon, an asset — read its card from the index below; a value you did not read from a card is a guess. `tokens.json`, `manifest.json`, `components/index.d.ts` and `design-system.json` are sources for tools: hand them over. `components/<Comp>/README.md` is the long-form second read a card links to; `SKILL.md` and `artifact-type/` beside them are authoring guidance, not needed to consume the system.

## Index (generated — do not edit)

**Tokens**

- `api/tokens.md` — Every token: surface, text, fill, palette, type, spacing, radius, shadow, height, layout, font-size, line-height, letter-spacing, font-weight, phone. (20.8k)

**Icons and assets**

- `api/assets/mac-app.md` — 24 files, by asset id. (2.7k)

**Components** (`api/components/<Comp>.md`, 132)

- **01 Logo**: `Loader` — Liquid loader (a bead travelling around the ring) for real waits — replaces skeleton shimmer · `BrandOverview` — BrandOverview · `LogoFavicons` — LogoFavicons · `LogoKeyframes` — LogoKeyframes · `LogoMark` — LogoMark · `LogoWordmark` — LogoWordmark
- `OmniLogo` — The continuous-line “omni” wordmark (20u stroke, 10° lean); use in the rail head, splash, docs · `StaticMark` — Clean static mark (no filter) · `OmniMark` — The fluid Omni mark; use at splash, in the rail’s Conductor row, and anywhere the Conductor’s state should be felt · `Button` — Pill buttons; primary is ink, needs is reserved for resolving a waiting decision · `STATUS_LABEL` — STATUS_LABEL · `Status` — Status dots and pills — the only place the pops appear · `InlineConfirm` — Ask-in-place confirm with an undo fuse — the default way to take a decision a thread is waiting on · `Picker` — Pill dropdown (Bencho "pik") for crew role, channel, harness, model · `Thumb` — Thumb · `Segmented` — Segmented pill with a Bencho sliding thumb — tabs, filters, theme switch · `CREW_ROLES` — CREW_ROLES · `ICON_PATHS` — ICON_PATHS · `Icon` — Omni icon (24 grid, 1.75 round stroke) — web/src set plus delegate, switchboard, split, sidebar, browser, gauge, pause, diff, more · `Rail` — The sidebar: search pill, New thread, Conductor (live mark), channels by kind with nested running threads, usage card, theme switch · `Panel` — Side panel column with surface-tray sections · `PanelSection` — PanelSection · `Message` — Transcript turn: you = right bubble, agents = markdown with no bubble · `ThreadRow` — Thread list row (32px lead, title + chips + time, preview line) and ThreadGroup · `ToolCalls` — ToolCalls
- **08 Core**: `IconButton` — 32px round icon button with the Bencho hover wash · `Input` — Field: surface fill, 14px radius, wash focus ring · `Kbd` — Keycap for shortcut hints · `Monogram` — Neutral round letter avatar (SF Rounded), TaskId in SF Mono, and Chip · `TaskId` — Task id in SF Mono, e.g · `Chip` — 20px pill chip (web/src Chip) · `StatusGlyph` — StatusGlyph · `ButtonSizes` — ButtonSizes · `ButtonStates` — ButtonStates · `ButtonVariants` — ButtonVariants · `Status2` — Status2
- **07 Components**: `Toast` — Toast for a thread that finished while you were elsewhere · `CoreOverview` — CoreOverview · `FormsOverview` — FormsOverview · `IconsOverview` — IconsOverview · `NavigationOverview` — NavigationOverview · `PanelsOverview` — PanelsOverview · `ThreadOverview` — ThreadOverview
- **09 Forms**: `CheckItem` — Animated plan checklist row and Bencho tick meter · `Ticks` — Progress/usage as ticks (Bencho "tick") · `SlideToConfirm` — Slide-to-confirm for deliberate, irreversible actions (merge to main, send to a client) · `Toggle` — Liquid on/off switch (Bencho) for settings · `InlineConfirm2` — InlineConfirm2 · `InlineConfirmNeutral` — InlineConfirmNeutral · `ModelPicker` — Model and effort pills for the composer: ModelPicker groups models under each harness (Auto first, sticky plan headers, one search), EffortPicker lists the pic… · `PickerChannel` — PickerChannel · `PickerCrew` — PickerCrew · `Segmented2` — Segmented2 · `SegmentedIcon` — SegmentedIcon · `SegmentedVertical` — SegmentedVertical
- **06 Iconography**: `CrewMark` — Crew role mark, usually inside a 28px surface-2 circle · `HarnessLogo` — Bare logo glyph, for inline use (menus, palette rows, composer chip) · `HarnessMark` — Harness mark for a thread: the vendor's own monochrome logo (Claude, OpenAI for Codex, Cursor) in a soft disc, optionally with its name
- **11 Navigation**: `CommandPalette` — ⌘K palette across actions, channels, recent threads, T-ids · `TabStack` — Pill tab bar where overflow collapses into status leaves · `CommandPaletteQuery` — CommandPaletteQuery · `Rail2` — Rail2 · `RailAttention` — RailAttention · `RailSections` — RailSections · `TabStackFew` — TabStackFew
- **13 Panels**: `GitHubPanel` — PR panel: checks, colour-free diff ticks, slide to merge · `UsageMeter` — Usage as Bencho ticks; vermilion past the threshold · `GithubPanelBlocked` — GithubPanelBlocked · `GithubPanelRunning` — GithubPanelRunning · `Panel2` — Panel2 · `UsageMeterCompact` — UsageMeterCompact · `UsageMeterUnit` — UsageMeterUnit · `UsageMeterWarn` — UsageMeterWarn
- **12 Thread**: `ArtifactEmbed` — Inline artifact: surface tray + white sheet · `Composer` — Composer with Bencho pickers for crew role, channel and harness · `CrewReport` — Crew report card returning to the Conductor · `Delegation` — Conductor fan-out: branch cards on rounded elbows colored by state · `ResultLine` — End-of-turn rule: "DONE IN 3M 41S · 12 TURNS" between hairlines · `ThreadGroup` — A day group: sticky caption label + count, rows rise in with a 28ms stagger · `ToolCall` — Tool call pill rows, grouped into a surface card · `CloudAgent` — A Cursor cloud agent run in a cursor-cloud thread: status, repo, pushed branch, PR, and a link to the agent on cursor.com · `ComposerBig` — ComposerBig · `ComposerFilled` — ComposerFilled · `CrewReportNeeds` — CrewReportNeeds · `DelegationSingle` — DelegationSingle · `Handoff` — Handing a running thread to another synced Mac · `MessageAgent` — MessageAgent · `MessageUser` — MessageUser · `QuestionCard` — An agent's ask_user_question, in the thread · `SwitchLine` — A run switch between turns, in the result line's quiet rule: the refresh icon and the switch, with the handover's progress under it · `ThreadRowAutomation` — ThreadRowAutomation · `ThreadRowDone` — ThreadRowDone · `ThreadRowMarkedDone` — ThreadRowMarkedDone · `ThreadRowNeeds` — ThreadRowNeeds · `ThreadRowRunning` — ThreadRowRunning · `ThreadRowSelected` — ThreadRowSelected · `ThreadRowSettled` — ThreadRowSettled · `ToolCallOpen` — ToolCallOpen · `ToolCalls2` — ToolCalls2
- **02 Color**: `ColorsInversion` — ColorsInversion · `ColorsNeutralsDark` — ColorsNeutralsDark · `ColorsNeutralsLight` — ColorsNeutralsLight · `ColorsPopRules` — ColorsPopRules · `ColorsPops` — ColorsPops
- **04 Shape & space**: `DensityModes` — DensityModes · `Heights` — Heights · `RadiiBorders` — RadiiBorders · `SpacingScale` — SpacingScale
- **00 Brand book**: `MacOSDesignSystem` — MacOSDesignSystem · `MobileDesignSystem` — MobileDesignSystem · `Showcase` — Showcase
- **14 Phone**: `MoArtifactCard` — An artifact in the thread: a white peek of the page on its surface card, its name in mono, and maximize to open it full screen · `MoBubble` — Your message in a thread: a right-aligned surface-2 bubble with who sent it above · `MoComposer` — The phone composer: action chips, then + for attach, model and effort, the field, and mic, send or stop · `MoDecisionCard` — The needs-you card: the agent's question with the buttons that answer it, the same card in Activity and in the thread · `MoHeader` — Headers for the phone: a 52pt bar for pushed screens and a 30pt large title for tab roots · `MoListRow` — Grouped lists on the phone: an inset surface group of 52pt rows for settings, channels, checks and files · `MoRoundButton` — The 40pt round button and the 36pt action chip that every phone screen is built from · `MoSection` — A list section on the phone: a sentence-case caption, a quiet count and an optional action · `MoSheet` — The phone bottom sheet: 28pt top corners, a grabber and an optional title row, for secondary choices · `MoTabBar` — The phone tab bar: a floating 60pt pill of labelled tabs with the ink new-delegation disc beside it · `MoThreadRow` — One row wherever a thread is listed on the phone: crew avatar with its status glyph, title, time, channel and progress · `MoToast` — A short ink pill that springs up above the tab bar to confirm what just happened · `PhoneActivity` — The Activity screen, the phone home, assembled from the phone components in light and dark
- **05 Motion**: `MotionAlive` — MotionAlive · `MotionMechanical` — MotionMechanical
- **10 Feedback**: `ToastDone` — ToastDone · `ToastFailed` — ToastFailed · `ToastNeeds` — ToastNeeds
- **03 Type**: `TypeMonoVoice` — TypeMonoVoice · `TypePairing` — TypePairing · `TypeScale` — TypeScale
