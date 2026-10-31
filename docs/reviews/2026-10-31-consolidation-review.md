# Consolidation release: the KPIs re-measured

31 October 2026 · measured on `origin/main` @ `b17ccad` (after #455) · baseline from the three reviews of 30 October at `122bc68` · tracker #415, this review closes #414

The release ran #386 to #413 in a day and a half. This page re-measures every KPI from the tracker's baseline table with the baseline's method, re-derived where the reviews did not record it, and says for each whether the target is met, missed with a reason, or dropped. Nothing was removed from the product on the way.

**18 of 23 met, 5 missed, 0 dropped.** The misses are the Mac composers (one control over on each), the sidebar (a pinned running thread shows three times, not two), one stale heading (its fix is in a follow-up PR not yet merged), source `any` (68, target 40) and the initial JS bundle (338 kB gzip, target 300). Duplicate-code share could not be compared: the baseline's scan settings were not recorded and no setting reproduces 0.142%, so it is reported at two settings instead of judged.

## The table

| Track | KPI | Baseline | Target | Now | Status |
|---|---|---|---|---|---|
| Stabilize | Server lock winners in the race test | 8 | 1 | 1 | met |
| Stabilize | `npm test` on Linux | exit 137 | completes, 0 failures | exit 0, 0 failures, 38 s | met |
| Stabilize | Server suite time (bounded) | 165 s, 30 failures | under 60 s | 39 s, 0 failures | met |
| Stabilize | Unused-name diagnostics | 9 | 0, enforced | 0, `noUnusedLocals` and `noUnusedParameters` fail `npm run typecheck`; knip in `npm run check` | met |
| UI | Settings destinations (web) / Mac tabs | 5 / 8 | 1 / 4-5 | 1 / 4 | met |
| UI | Thread header controls (web / Mac / phone) | 9 / 9 / 2 | 5 / 5 / 2 | 4 / 4 / 2 | met |
| UI | Thread menu item-set differences across surfaces | about 5 | 0 | 0 | met |
| UI | Reply composer controls (web / Mac) | 11 / 9 | 6 or fewer | 4 / 7 | missed on Mac |
| UI | New-thread composer controls (web / Mac) | 12 / 10 | 7 or fewer | 4 / 8 | missed on Mac |
| UI | Move-or-continue concepts / entry points | 7 / about 12 | 2 / 4 or fewer | 2 / 4 | met |
| UI | Sidebar appearances of one thread | 4 | 2 | 3 | missed |
| UI | Clicks to a new thread in the current channel | 3-4 | 1 | 1 | met |
| UI | Contradictory or stale copy | 3 | 0 | 1 | missed until the follow-up to #400 merges |
| Architecture | Accepted remote commands silently lost | possible | 0 | 0 | met |
| Architecture | Ownership representations | 4 | 1 | 1 | met |
| Architecture | Transition endpoints | 6 | 4 | 4 (the 6 old routes stay as aliases) | met |
| Architecture | Median files touched by a cross-cutting PR | 38 | 25 or fewer | 18 | met |
| Architecture | Runtime import component across the runner | 19 files | 0 across ownership boundaries | 0 | met |
| Hygiene | Source files over 600 lines | 21 | 12 or fewer | 10 | met |
| Hygiene | Largest function or component | 414 lines | 250 or fewer | 244 | met |
| Hygiene | Source `any` | 86 | 40 or fewer | 68 | missed |
| Hygiene | Initial JS gzip | 419 kB | 300 kB or less | 338 kB | missed |
| Hygiene | Settings contract files | 3 | 1 | 1 | met |
| Hygiene | Duplicate-code share | 0.142% | 0.10% or less | 0.13% at the closest setting | not comparable, see below |

No target: non-null assertions went from 249 to 273 and `as` casts from 684 to 715 (AST counts over the same files). Both rose with the typed harness contract (#406) and the shared DTOs (#408), which replaced `any` with narrower casts.

## How each one was measured

All counts are over `apps/` and `packages/`, non-test `.ts`, `.tsx` and `.swift`, without fixtures, generated bundles or `.d.ts` files, on a Linux box (Node 26.12, no Swift toolchain). Where the reviews did not write the method down, the method here reproduces the baseline figure on `122bc68` first, so the two numbers compare.

### Stabilize

- **Lock winners.** `apps/server/tests/lock.test.ts`: 30 rounds of 8 processes racing for a stale lock, exactly 1 winner each round, the other 7 naming the winner's pid. 4 of 4 tests pass, three runs in a row. The baseline's 8 was the same test on Linux before #386 (`O_EXLOCK` is a macOS flag; Linux now takes the lock through `flock(1)`).
- **`npm test` on Linux.** `npm test` through turbo: exit 0 in 38 s, shared 478, web 638, mac 2, server 2061 passed, 0 failed. A first run on the same head hit the `mac-fixtures.test.ts` timeout once (the flake the follow-up to #400 fixes); the file passed alone and the full run passed the second time, in 38 s.
- **Server suite.** `cd apps/server && npx vitest run`, alone on the box: 198 files, 2061 tests, 38.6 s, 0 failures. The baseline's 165 s and 30 failures were the same command before #386, #387 and #388.
- **Unused names.** `npm run typecheck` with `noUnusedLocals` and `noUnusedParameters` in every package's tsconfig: 0 diagnostics, 6 of 6 packages. `npm run unused` (knip) exits 0. The CI workflow from #389 is written at `scripts/ci-workflow.yml` but not active: no token in this release had GitHub's `workflow` scope to put it under `.github/workflows/`. Enforcement is local for now.

### UI

The control counts come from the code, checked on a throwaway QA stack (`scripts/qa-stack.sh up`, ports 4931 and 4942, never :4747) at 1280 px and 390 px with headless Chromium. The Mac counts are from the Swift source only: no Mac app was built or run in this release, see below.

- **Settings.** Web: one route, `#/settings/<section>`, four sections (General, Workspace, Machines, Secrets); the old `#/sync`, `#/secrets` and `#/storage` hashes redirect into it (`apps/web/src/router.ts`). Mac: four tabs in `SettingsTab.swift`, the old eight folded into them. Phone: the same four rows on `SettingsScreen.tsx`.
- **Thread header.** Web `HeaderActions.tsx`: the context meter, Done, the ⋯ menu and the panel toggle, 4 (Restore replaces Done on an archived thread). Mac `ThreadScreen.swift`: the meter button, Done, the ⋯ menu and the inspector toggle, 4. Phone `ThreadScreen.tsx`: Back and the ⋯ menu, 2. The status pill is a label on all three.
- **Thread menu.** One list, `packages/shared/thread-actions.ts` (8 actions in 3 groups), rendered by the web's right-click menu, the phone's sheet and the Mac through the slash engine bundle. `apps/server/tests/mac-fixtures.test.ts` records the Mac's rendering of it, so a difference fails the suite. 0 differences.
- **Reply composer.** Web `Composer.tsx`: Attach, Fork, the model pill (model and effort in one), Send, 4; the Machine chip is a fifth while a second machine is synced. Mac `ComposerView.swift`: Attach, Fork, Dictate, the model pill, the effort pill, the Machine chip, Send, 7. Missed on the Mac by one: Dictate has no web equivalent, and the Mac keeps effort as its own pill where the web folds it into the model pill (`ModelPickerButton.swift`). Folding it was out of #452's scope and needs a Mac build to check, which this release had none of.
- **New-thread composer.** Web: inside a channel, Role, the model pill, Attach, Start, 4; on Home, Channel instead of Role; the Base and Machine chips appear only with a repo or a second machine, 6 at most. Mac `NewThreadView.swift`: Channel, Role, the model pill, the effort pill, Run on, Base, Attach, Start, 8. Missed on the Mac by one, for the same effort pill.
- **Move or continue.** Two concepts: Continue (fork a thread, through the Continue sheet, `packages/shared/continue.ts`) and Machine (where a thread runs: run on, hand off, take over, all behind the Machine chip, `composer/MachineChip.tsx` and `RunOnPicker.swift`). Four entry points: Fork in the reply box, Fork in the thread menu, the Machine chip on the reply box and the Machine chip on the new-thread composer. The handoff and takeover cards in the transcript show state and cancel; they start nothing.
- **Sidebar.** Web `Sidebar.tsx` and Mac `SidebarView.swift` both keep Running and Pinned as cross-channel sections above the channels, so a pinned thread that is running shows three times: Running, Pinned, its channel or folder. A thread that is neither pinned nor running shows once. #396 removed Recent threads and the footer theme switch (4 to 3) and kept Pinned on purpose, as the one list of pins from every channel. Missed, by a design choice rather than a slip.
- **New thread in the current channel.** One click: the sidebar's New thread button opens the current channel's composer (`startNewThread` in `router.ts`, #397), the phone has a New thread chip above the reply box, and the Mac's New thread does the same.
- **Copy.** The three contradictions from the baseline are gone (#392: the slash menu's "fixed per thread", the "New thread on another model" hint, the agent prompt's renderer workarounds). This review found one stale heading. The parked-messages card said "waiting when Omni restarted" under the stale-session card from #400, where the messages wait for a session download, not a restart. Two Mac QA-harness comments still said Hand off lives in the ⋯ menu; fixed in this PR. The heading's fix is in the follow-up PR to #400, which was not open when this was measured, so it counts as 1 here and the tracker's result table says so.

### Architecture

- **Remote commands.** `docs/internals/delivery.md`: every forwarded message, report, limit action and Stop is a synced `remote_commands` row written before the sender says "accepted"; a row ends `accepted`, `rejected` or `expired`, and a rejection or expiry is written into the transcript. The three delivery-gap tests from #390 are plain `it` since #398, #399 and #400, and the doc's "where it does not hold yet" list is empty.
- **Ownership.** ADR 0005: `assignments` is the one record a delivery path reads. The thread row's `run_machine` stays as the status write's tag, and the two kv keys are written for machines on an older build and never read for ownership. The baseline's four were four readers, each with its own mix.
- **Transition endpoints.** `docs/internals/transitions.md`: four routes under `/api/threads/:id/transitions` (preview, create, read, cancel) for every kind of transition. The six older routes (`continue/preview`, `continue`, `run`, `handoff`, `takeover`, `handoff/cancel`) still answer, each as one call into the same service, so a client on an older build keeps working. The count is 4 because there is one implementation.
- **Files per cross-cutting PR.** The 39 PRs merged in this release (#416 to #455). A PR is cross-cutting when it touches two or more of `apps/server`, `apps/web`, `apps/mac`, `packages/shared` and `apps/mcp`: 27 PRs, median 18 files (mean 20). The 14 that touch three or more: median 22.5. All 39: median 17. The two largest were #436 (Settings, 64 files) and #449 (ownership, 61).
- **Import component.** Static scan of relative imports, `import type` excluded, Tarjan SCC over `apps/server` without tests and scripts, as #410 measured it: the one cycle left is 9 files, all inside `runner/`. `apps/server/tests/import-boundaries.test.ts` fails on a cycle that crosses an owner, or on that one growing.

### Hygiene

- **Files over 600 lines.** `wc -l` over the scan set: 10. `QAScript.swift` 743, `ThreadStore.swift` 740, `sync/files.ts` 688, web `api.ts` 662, `Transcript.swift` 659, `Continue.swift` 644, `ChannelSettingsView.swift` 637, `SidebarView.swift` 635, `WorkspaceStore.swift` 607, `ThreadScreen.swift` 604. The same scan on `122bc68` gives 20 (the baseline counted 21).
- **Largest function.** TypeScript compiler API over the scan set, longest span of any function declaration, expression, arrow, method or constructor: 244 lines, `Draw` in `apps/web/src/components/BrowserAnnotate.tsx`; then `ThreadPage` 243, the Hermes `spawn` 238, `Sidebar` 238. Swift, by brace matching: `QARunner.run` 218. The baseline's 414 was `Draw` before #412.
- **Source `any`.** `any` keyword nodes in the same AST scan: 68. The method gives exactly 86 on `122bc68`, so the two compare. Where they are: `apps/mcp/omni.ts` 15 (the Conductor tools map untyped API responses), `handoff/records.ts` 5, `scripts/lib/brain-export.ts` 5, `context-meter.ts`, `links.ts`, `github.ts` and `stream.ts` 4 each, the rest one to three per file across 17 files. It missed because #406 cleared the harness boundary (0 left in `apps/server/harness/`) and no later issue owned the rest. Reaching 40 means giving the Conductor tools the shared DTOs from #408 and typing the GitHub and Notion responses, a PR of its own rather than a few edits.
- **Initial JS gzip.** `vite build` in `apps/web` to a `/tmp` output dir, the gzip figure vite prints for the one chunk `index.html` loads: 338 kB (1,109 kB raw). The baseline's 419 kB was the same figure. #391 moved xterm into its own chunk (86 kB gzip) and mermaid already loads on demand; both leave the initial chunk. By the source map, what remains is app code (components 23%, shared 9%, phone layout 7%, pages 7%) and react-dom (22%), then the markdown stack (react-markdown, remark, micromark, about 12%). It missed because no single lazy import gets under 300. The phone layout is the largest piece the desktop never runs, worth about 20 kB; the markdown stack is needed on the first thread. The next step is a route-level split of the pages and the phone tree, which is a structural change outside this release.
- **Settings contract.** One file, `packages/shared/settings.ts`: the fields with their section, label, hint and check, the `UserConfig` types and the setup state. The server's zod schema and `PUT /api/setup` are built from it, the web's General and Workspace forms render from it, and `mac-fixtures.test.ts` checks `Setup.swift` and `ProfileSettingsView.swift` against the same list.
- **Duplicate-code share.** `npx jscpd` 4.x over the scan set (TypeScript, TSX and Swift). The baseline review did not record its settings, and none of 20 combinations tried (mild and strict mode, 50 to 150 min tokens, 5 to 15 min lines, with and without tests, with and without Swift) gives 0.142% on `122bc68`. Two settings, same ignore list, baseline then now: the defaults (min 50 tokens, 5 lines, mild) 0.82% then 0.75% of lines, 106 then 102 clones, 66 of them Swift; min 90 tokens, the closest to the baseline figure, 0.13% then 0.13%, 11 then 12 clones. Min 100 tokens gives 0.09% then 0.08%. It is not judged against the target. The share moved little either way, and the clone count fell.

## What the release did not get to

- **No Swift was compiled.** Every PR in the release was built on a Linux box with no Xcode, so each Mac change was written against neighbouring code and checked by `mac-fixtures.test.ts`, never by `npm run test:mac` or a running app. The Mac counts above are from the source. The first Mac build after this release needs `npm run build:mac` and `npm run test:mac`, then the QA harness scripts for the new chrome (Stop, the grouped ⋯ menu, the Machine chip, Settings).
- **CI is written, not active.** `scripts/ci-workflow.yml` runs typecheck, knip and tests on Node 24 for PRs and pushes to main. Moving it to `.github/workflows/ci.yml` needs a push with the `workflow` scope.
- **The design system is behind the code.** Six components introduced here are not in Claude Design: the Stop button (#394), the grouped thread menu (#401), the Settings section nav and the Advanced fold (#404, #405), the stale-session card (#400) and the Machine chip (#403). Its MCP was unavailable throughout. Each PR named what it added; the next session with the MCP adds them from `apps/web/src/components/` and `apps/web/src/index.css`.
- **Two Mac composer pills.** Folding effort into the Mac's model pill, as the web does, brings both Mac composers to target. It waits for a Mac build.
- **Known flakes.** `cursor-cloud.test.ts` and `next-thread.test.ts` were fixed in #451; `mac-fixtures.test.ts` timed out once in three full runs here; the follow-up to #400 carries its fix.

## Scripts

The scans are small and were run from `/tmp`; the commands, so they can be rerun on the next head:

- Files over 600: `find apps packages -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.swift' \)` without `node_modules`, `dist`, `tests`, `Tests`, `test-fixtures`, `*.test.ts(x)` and `*.d.ts`, piped to `wc -l`.
- `any`, non-null, casts and the largest function: the TypeScript 5 compiler API (`typescript@5` installed under `/tmp`; the repo's TypeScript 7 has no JS API) walking each file for `AnyKeyword`, `NonNullExpression`, `AsExpression` (not `as const`) and the line span of each function-like node.
- Duplicates: `npx jscpd --format typescript,tsx,swift --ignore "<the list above>" apps packages`, with `--min-tokens 90` for the second figure.
- Bundle: `npx vite build --outDir /tmp/<dir>` in `apps/web`; `--sourcemap` and a sum of `sourcesContent` by package for the breakdown.
- PR sizes: `gh pr view <n> --json files` for #416 to #455, grouped by the top-level areas a PR touches.
- Controls: `playwright-core` with the system Chromium against the QA stack, listing visible `button`, `a`, `select` and `input` elements inside the header and each composer, at 1280 and 390 px.
