# Knowledge-work proposal: build slices

How to build every change in the knowledge-work proposal (`omni-knowledge-work-proposal.html`, thread 0fde4a1c, T-OMNIWIDE) as seven slices, one builder thread each, instead of one thread per change. Task T-IMPLPLAN.

- Status: proposal, not built. Ben has not signed off on the decisions in section 6.
- Surveyed: `main` at `b13c93fe` (#804). Paths below were re-checked on that commit. Where the audit's path or line was wrong, the corrected one is given.
- In-flight state was read on 2026-11-18 at about 21:30 CET with `get_thread` and `git status` in each worktree. Every listed thread is **stopped**, nothing is committed, and every worktree's uncommitted diff sits on `b13c93fe`.

## Item IDs

- S1 to S6, R1 to R8, A1 to A8: as in proposal section 3.
- M1 to M9: the rows of proposal section 4, in order. M1 safe defaults, M2 install and sign in, M3 onboarding questions, M4 no Ask Phill or Ben in the product, M5 useful roles out of the box, M6 starter routines, M7 second device, M8 accountability (owner field), M9 docs match behavior (README).

## 1. Coverage

Every item maps to exactly one slice. A3 is done and maps to none.

| Item | Slice | In flight (thread, task) | WIP on disk |
| --- | --- | --- | --- |
| S1 | A Quick ask | 115467f1 T-QUICKASK | yes |
| S2 | A Quick ask | 115467f1 T-QUICKASK | yes |
| R1 | A Quick ask | 115467f1 T-QUICKASK | yes |
| A1 | A Quick ask | unassigned | no |
| R2 | A Quick ask | unassigned | no |
| A2 | B Steps | ca900289 T-STEPVIEW | yes (Rust server, shared model) |
| R3 | B Steps | ca900289 T-STEPVIEW | no |
| S4 | B Steps | unassigned | no |
| R4 | C Plain mode | f8ba161a T-TECHSWITCH | yes |
| R5 | C Plain mode | f8ba161a T-TECHSWITCH | yes |
| R6 | C Plain mode | f8ba161a T-TECHSWITCH | yes |
| S5 | C Plain mode | f8ba161a T-TECHSWITCH | partial |
| S6 | C Plain mode | f8ba161a T-TECHSWITCH | partial |
| R7 | C Plain mode | fbc77d4a T-SETTINGS | yes, at final test run |
| A4 | D Access | ff9f0a55 T-SIGNIN | yes (server only) |
| A6 | D Access | 074d6114 T-ACCESS | yes (shared, policy, migration) |
| M1 | D Access | 074d6114 T-ACCESS (implied) | no |
| R8 | E Inbox | 878f40ba T-INBOXMERGE | yes (snooze server side) |
| A8 | E Inbox | unassigned | no |
| A5 | F Kits | 7ebb2c49 T-TEMPLATES | yes (server, loader) |
| A7 | F Kits | unassigned | no |
| S3 | G First run | d7f83445 T-SLICE-MULTIUSER | no |
| M2 | G First run | d7f83445 / 04cda726 | partial in 04cda726 |
| M3 | G First run | d7f83445 / 04cda726 | partial in 04cda726 |
| M4 | G First run | d7f83445 / 04cda726 | yes in 04cda726 |
| M5 | G First run | d7f83445 | no |
| M6 | G First run | 04cda726 (starter-automations.ts) | partial |
| M7 | G First run | unassigned | no |
| M8 | G First run | d7f83445 | no |
| M9 | G First run | d7f83445 | no |
| A3 | none: done | 979432c8 T-AUTOADMIN | done (live automations, no repo code) |

Count: 6 S + 8 R + 8 A + 9 M = 31 items. 30 in slices, A3 done.

## 2. What the in-flight threads actually hold

| Thread | Task | State | Diff (vs `b13c93fe`) |
| --- | --- | --- | --- |
| 115467f1 | T-QUICKASK | stopped mid full test run | 13 files: `crew/conductor.md`, `runner/prompts.ts`, `runner/queue.ts`, new `db/repos/report-follow-ups.ts`, migration, `apps/mcp/omni.ts` |
| ca900289 | T-STEPVIEW | stopped writing tests | `crates/omni-mcp/src/steps.rs` + goldens, `packages/shared/steps.ts`. No UI yet |
| f8ba161a | T-TECHSWITCH | stopped before Store pack, channel page, Overview, Settings toggles | 26 files: new `packages/shared/display.ts`, `apps/server/display.ts`, `apps/web/src/display.ts`, thread page gates, run control names |
| ff9f0a55 | T-SIGNIN | stopped before automation side and client cards | 11 files: new `connectors.ts`, `sign-in-check.ts`, hold in `runner/setup.ts` |
| 074d6114 | T-ACCESS | stopped writing `runner/approvals.ts` | 6 files: new `access.ts` (server and shared), channel columns, sync handler, `question.ts` |
| fbc77d4a | T-SETTINGS | stopped in the final full test run | 24 files: catalog, web and iOS Settings, Extras section, docs |
| 878f40ba | T-INBOXMERGE | stopped in `useInbox` | 15 files: `snoozed_at`/`snooze_until` on threads, sync merge, `packages/shared/snooze.ts`. No pane merge yet |
| 7ebb2c49 | T-TEMPLATES | stopped writing the web hook | 14 files plus new `templates/`, `templates.ts`, `templates-api.ts`, `list_templates` tool |
| d7f83445 | T-SLICE-MULTIUSER | stopped with no reply | nothing |
| 04cda726 | T-FIRSTRUN | stopped in setup tests | 38 files: `personal-terms.ts` guard, Ben-neutral strings in prompts, setup, `apps/mcp/omni.ts`, `starter-automations.ts`, `harness/catalog.ts` |
| 979432c8 | T-AUTOADMIN | done | no repo diff; seven automations saved on omarchy |

### Overlaps and gaps found

- **T-FIRSTRUN (04cda726) was not on the list** and already holds most of the section 4 work, while T-SLICE-MULTIUSER (d7f83445) has done nothing. Two threads own the same items. Slice G continues 04cda726 and d7f83445 is closed.
- **False Ready is claimed twice.** A4's scope and M2 both say "fix the Claude Code probe". The line is `apps/server/harness/catalog.ts:105` (`available: true` in `claudeHarness`), not `:45`. 04cda726 already edits `harness/catalog.ts`. The probe fix belongs to D (A4). G's onboarding uses it.
- **The Shopify / Ask Phill pack sits in two places.** f8ba161a builds the Store add-on pack (C). M4 names the same pack, and 7ebb2c49 asked T-TECHSWITCH what the setting is called. C owns the pack flag; G and F read it.
- **A3 is done as data, not product.** T-AUTOADMIN saved seven automations with state and precheck helpers on omarchy. "Posts nothing when empty", a dry run, an approve card and drafts that expire are not product features. M6's starter routines need them, so slice G builds them as part of M6 (section 6, D4).
- **A7 overlaps crew plan S6.** The crew plan (`docs/plans/2026-11-18-user-defined-crew.md`, section 3) designs a per-role memory store with approval. A7 asks for per-channel memory. Building a second store would duplicate it, so F builds A7 on that store, scoped per channel (D3).
- **M5 overlaps the crew plan.** "Share roles as Install or Copy" belongs to the crew plan's later slices. G ships only the three charters (Researcher already exists as `crew/researcher.md`; Writer and Admin are new, and Admin may be today's `crew/inbox.md` renamed).
- **S4 hits a route the step view replaces.** The Plan card's tick calls `PATCH /:id/plan/steps/:index` (`apps/server/thread-routes-api.ts:426-439`) from `PlanCard` (`apps/web/src/components/Transcript.tsx:286-302`). S4 removes both once A2's step list replaces the card.
- **A1 names "the planned @agent Ask".** No doc in `docs/` describes it. A ships its own path and leaves a single entry point the later feature can call.

### Corrected paths

| Audit said | On `b13c93fe` |
| --- | --- |
| `QuickPrompt.tsx` | `apps/web/src/pages/QuickPrompt.tsx` |
| `transcript-fold.ts` | `packages/shared/transcript-fold.ts` (TodoWrite at `:308`, Bash summary at `:472`) |
| `ToolRows.tsx` | `apps/web/src/components/thread/ToolRows.tsx` |
| `UsageSection.tsx` | `apps/web/src/components/dashboard/UsageSection.tsx` |
| `Cards.tsx:162-176` | `apps/web/src/components/dashboard/Cards.tsx` |
| `thread-panel-surface.ts` | `apps/web/src/pages/thread-panel-surface.ts` |
| `rail-model.ts` | `apps/web/src/rail-model.ts` |
| `Onboarding.tsx` | `apps/web/src/components/Onboarding.tsx` (repos folder row at `:217`) |
| `Pair.tsx` | `apps/web/src/components/Pair.tsx` (`cat data/api-token` at `:187`) |
| `harness/catalog.ts:45` | `apps/server/harness/catalog.ts:105` |
| `crew.ts:79` delegate_only lock | `apps/server/crew.ts:75-80` (`CREW_LOCKS`), deny list `:330-333` |
| `queue.ts:213-216` relay turn | `apps/server/runner/queue.ts:213-215` |
| `prompts.ts:121-122` | `apps/server/runner/prompts.ts:120-121`; store and portal lines `:147-148` |
| `conductor.md:12, :21, :25, :37-44` | delegate-first `:12`, folder `:25`, brief `:37-39`, review rule `:46` |
| `status.ts:162-181` (18 labels) | `packages/shared/status.ts:163-181`, `MARK` table, 18 entries |
| `ThreadPanel.tsx:29-37` (8 tabs) | `apps/web/src/components/thread/ThreadPanel.tsx:29-38` |

## 3. Slices

Order: A, B, C, D, F and G start together (six threads, the cap). E starts when B and C have merged, since R8 needs R4's five statuses and A8 needs A2's steps.

Every slice keeps the repo's rules: all three surfaces in the same PR (desktop web, 390px phone web, desktop app QA harness), iOS where the client already has the screen, every harness decided, Conductor tools in `apps/mcp/omni.ts`, sync handlers for new synced state, wire fixtures through `wire-fixtures.test.ts`, docs fixed in the same PR, new components in the Claude Design project.

**Taking over another thread's WIP.** All donor worktrees sit on `b13c93fe`. The slice thread copies the donor's diff into its own worktree before it rebases: `git -C <donor> diff HEAD --binary | git apply --3way`, then copies the donor's untracked files (`git -C <donor> ls-files --others --exclude-standard`). It never checks out or switches the donor's branch. The donor thread is then marked done without being woken.

### A. Quick ask (S1, S2, R1, A1, R2)

- Continues 115467f1 (T-QUICKASK).
- Scope:
  1. Finish R1, S1, S2 (in WIP): Conductor answers read-only asks itself and keeps `delegate_only` (`crew/conductor.md:12`, `runner/prompts.ts:120-121`); no folder question or three-part brief on a question (`conductor.md:25`, `:37-39`); a crew report no longer starts a relay turn (`runner/queue.ts:213-215`); the child's answer shows on the parent's delegation card on web, phone and iOS.
  2. A1: a thread `workspace` field (`none | read | worktree`). `needsWorktree` (`apps/server/sandbox.ts:34-36`) returns false for `none` and `read`. A quick ask has no charter, worktree, folder or task id, stays out of the Inbox and lists under "Recent asks" for 7 days. It promotes to a task when it writes, runs, browses, makes a file or the user presses Keep. One server entry point (`startQuickAsk`) for the later @agent Ask.
  3. R2: Quick Prompt (`apps/web/src/pages/QuickPrompt.tsx`) answers in the same panel with a follow-up box, Copy and "Keep as thread"; Shift+Enter makes it a task. Same on the phone New sheet (`apps/web/src/mobile/NewSheet.tsx`) and iOS New.
- Harnesses: the quick ask runs on Auto, which already labels chat as quick (`apps/server/harness/auto.ts:290`). Cursor Cloud and Hermes cannot run `workspace: none` locally: refuse quick on them and say so.
- Depends on: nothing. A1 needs R1.
- PRs: stacked. A1 = steps 1 (prompt, queue, delegation card). A2 = steps 2 and 3 on top.
- Acceptance: `crew-reports.test.ts` shows no relay turn; a prompt test for the read-only rule; a thread test for `workspace` and promotion; `npm run typecheck`, `npm test`; wire fixture for the thread shape; screenshots of Quick Prompt answering in place on desktop web, 390px phone and the desktop app.

### B. Steps (A2, R3, S4)

- Continues ca900289 (T-STEPVIEW).
- Scope:
  1. A2: `set_steps` tool in `crates/omni-mcp` beside ask and render (in WIP), a prompt line telling agents to post 3 to 6 steps, harness plans (TodoWrite, TaskCreate/TaskUpdate) mapped onto it in `packages/shared/steps.ts`, phase grouping as the fallback, "Working on it" and "Writing the answer" on every turn, child threads nested under their step. Decide each of the five adapters: Claude Code and Codex get the MCP server; Cursor gets it through its MCP config; Hermes and Cursor Cloud fall back to phases.
  2. R3: the step list replaces `PlanCard` in `Transcript.tsx:286-325`, and "Step 3 of 5 · Reading app listings" shows on Inbox cards, phone rows and desktop notifications. Web reuses `nowDoing` (`packages/shared/thread-view.ts:107`), which only iOS shows today.
  3. S4: delete the click-to-tick handler in `PlanCard` and the route at `apps/server/thread-routes-api.ts:426-439` with its `plan_step_update` event.
- Design system: a Steps component in the Claude Design project.
- Depends on: nothing. Should merge before C's last PR so C hides tool rows the step view has already replaced.
- PRs: stacked. B1 = A2's server, Rust and shared model with goldens. B2 = R3 UI on all surfaces plus S4.
- Acceptance: `cargo test` for `omni-mcp` goldens; `npm run test:rust`; shared `steps.ts` tests over each harness's plan shape; `npm test`; wire fixture for the step event; screenshots of a running thread's steps and an Inbox card's step line on all three surfaces.

### C. Plain mode (R4, R5, R6, S5, S6, R7, Store and Portal pack)

- Continues f8ba161a (T-TECHSWITCH). Imports fbc77d4a (T-SETTINGS) first.
- Scope:
  1. R7 from fbc77d4a: Settings grouped as Assistant, Spaces, Devices, Developer, Extras (`packages/shared/settings-catalog.ts`, `apps/web/src/pages/SettingsDesktop.tsx`, iOS sections). It is ready apart from its last test run, so it goes first and other slices rebase on its groups.
  2. R5: one "Show technical details" switch (in WIP, `packages/shared/display.ts`), on by default in a repo channel; inspector tabs (`ThreadPanel.tsx:29-38`) show only with content.
  3. R4: the 18 `MARK` labels (`packages/shared/status.ts:163-181`) show as five (Working, Needs you, Done, Failed, Stopped) with detail as a sub line when the switch is off, on web, phone and iOS.
  4. R6: Fast / Balanced / Thorough in `ModelPicker.tsx` and `PlusSheet.tsx`; "Add to this" and "Stop and send" in `ReplyControls.tsx:13-15`; "New" in `NewSheet.tsx:145`.
  5. S5 and S6: without a repo, no PRs tab, card or rail entry, Branch steps, quick-actions card, branch or "Cold start"; hidden by default the context ring under 70%, model and tokens in the result line, task ids, token and cache charts, slash-menu source tags, machine name with one machine.
  6. Store and Portal pack: the Store card and Portal slug (`ChannelSettings.tsx:362-365`) and their prompt lines (`runner/prompts.ts:147-148`) move behind an opt-in pack setting. C names the setting; F and G read it.
- Design system: the switch and the five-state status mark.
- Depends on: nothing. B should land before C3's final PR.
- PRs: stacked. C1 = R7. C2 = R5, R4, R6. C3 = S5, S6 and the pack.
- Acceptance: `settings-catalog.test.ts`, iOS `sections-model.test.ts`, a shared display test for the five-state map, `npm test`, `npm run typecheck`, settings catalog fixture; before and after screenshots with the switch on and off, on all three surfaces.

### D. Access and pre-flight (A4, A6, M1)

- Continues 074d6114 (T-ACCESS). Imports ff9f0a55 (T-SIGNIN) first.
- Scope:
  1. A4 from ff9f0a55: per-machine connector sign-in check that holds a job in setup and warns before it starts; skip quietly for automations after one report; the thread header shows which account it runs on. Fix the false Ready: Claude Code reports `available: true` unconditionally (`apps/server/harness/catalog.ts:105`). Probe it like Codex and Cursor.
  2. A6: Off, Read, Draft, Write per channel and connector, declared by the role, enforced per harness: Claude Code by permission prompt plus a hook that forces "ask" (replaces `permissionMode: bypassPermissions`, `apps/server/config.ts:55`); Codex by approval requests (`harness/codex/session-start.ts:72-74`); Cursor by deny config (`harness/cursor/adapter.ts:96`); Hermes and Cursor Cloud refuse anything above Read. "Ask first" card rides the question events so it streams, syncs, notifies and shows on every client; "Always allow for this role".
  3. M1: a new install defaults to "Ask first".
- Depends on: nothing. Ships before any outside install.
- PRs: stacked. D1 = A4. D2 = A6 and M1.
- Acceptance: tests for the sign-in hold, the catalog probe and the access policy per harness; a channel sync handler test; `npm test`; wire fixture for the approval question; screenshots of the pre-flight warning and the approval card on all three surfaces.

### E. Inbox (R8, A8)

- Continues 878f40ba (T-INBOXMERGE) after B and C merge.
- Scope:
  1. R8: merge the Inbox list (`apps/web/src/components/sidebar/InboxView.tsx`) and Overview (`apps/web/src/pages/Home.tsx`, rail entry in `apps/web/src/rail-model.ts:53-58`) into one clearable pane: peek with a reply box, snooze until a time or new activity (server side in WIP), phone Activity and iOS Activity the same. Uses C's five statuses.
  2. A8: a one-line recap when returning to a long thread, in the thread header and the Inbox peek, built from B's steps.
- Depends on: B (A8), C (R4).
- PRs: single.
- Acceptance: snooze and sync merge tests, `useInbox` tests, a Conductor `snooze_thread` tool test, `npm test`; screenshots of the merged pane, peek and recap on all three surfaces.

### F. Kits (A5, A7)

- Continues 7ebb2c49 (T-TEMPLATES).
- Scope:
  1. A5 (in WIP): templates for CRO audit, ticket to proposal to comment, meeting agenda, ADR update from a meeting, client Q&A with sources, meeting recall, connect a store; slash menu and New sheet entries; `templates/` shipped by `apps/desktop/scripts/stage.ts` and checked by the personal-terms guard; Shopify templates behind C's pack. Short templates run as quick asks once A2 lands.
  2. A7: "Recent learnings" per channel with approve and edit, kept apart per client, built on the crew plan's memory store (section 3 of that plan) scoped by channel. Synced; the Conductor can list and propose entries.
- Depends on: A (quick ask, for light templates), C (pack name). A7 depends on crew plan S6's store; if S6 has not landed, F builds the store and crew S6 reuses it.
- PRs: stacked. F1 = A5. F2 = A7.
- Acceptance: template loader and expansion tests, stage test for `templates/`, memory store and sync tests, `npm test`; screenshots of template chips and the learnings list on all three surfaces.

### G. First run (S3, M2 to M9)

- Continues 04cda726 (T-FIRSTRUN). Close d7f83445 (T-SLICE-MULTIUSER, no work).
- Scope:
  1. M4 (in WIP): no Ben or Ask Phill in shipped strings; a `USER` variable; widen the personal-terms guard past `crew/*.md` (`apps/desktop/scripts/stage.ts`) to prompts, `apps/mcp/omni.ts` (`:520-522`, `:1169`) and templates.
  2. M3: onboarding asks "Where should Omni keep your files?"; repos folder, GitHub owner and store (`apps/web/src/components/Onboarding.tsx:217`) become optional add-ons.
  3. M2: onboarding installs and signs in to Claude Code, using D's probe.
  4. S3: Research answers in the thread by default (`crew/researcher.md:10`); an HTML report only when asked or when it runs past a few bullets.
  5. M5: ship Writer and Admin charters beside Researcher.
  6. M6: three starter routines, off by default, plus what A3 left out of the product: post nothing when empty, dry run, an approve card, drafts that expire.
  7. M8: thread `owner` and `agent` as separate fields, synced, shown on thread cards.
  8. M7: one computer first, Sync hidden until wanted, QR pairing in the desktop app (`apps/web/src/components/Pair.tsx:187`).
  9. M9: README.md:29 says Codex reviews every PR; `crew/conductor.md:46` says only when asked. Fix the README.
- Depends on: C (pack flag) for M4, D (probe) for M2.
- PRs: stacked. G1 = M4, M3, S3, M9. G2 = M2, M5, M6. G3 = M8, M7.
- Acceptance: personal-terms guard test over every shipped dir, setup and onboarding tests, a fresh-profile run on a QA stack with no `data/`, `rg -iw "ben|ask phill"` over shipped dirs returns nothing, `npm test`; screenshots of the first run on all three surfaces.

## 4. Merge conflicts

Files more than one slice's WIP or scope touches, and who owns each.

| File | Slices | Rule |
| --- | --- | --- |
| `apps/mcp/omni.ts` | A, E, F, G | New tools go in their own blocks; G's string rewrites land first (G1), others rebase |
| `apps/server/db/migrate.ts` | A, D, E, F, G | Column adds are idempotent (`:287`); conflicts are textual, keep both |
| `apps/server/runner/prompts.ts` | A, B, C, G | A owns the Conductor rule, B adds one step line, C gates `:147-148`, G renames; merge A1 first |
| `apps/server/thread-routes-api.ts` | A, B, D, G | B deletes the plan route; others add fields |
| `apps/server/runner/api.ts`, `runner/setup.ts` | A, D, F, G | D's hold in setup goes first, A's `workspace` after |
| `packages/shared/settings-catalog.ts` | C, F, G | C1 (R7) lands first; F and G add to its groups |
| `packages/shared/status.ts`, `apps/web/src/components/ui/status.tsx` | C, E, G | C owns the labels; G only renames strings |
| `apps/web/src/components/Transcript.tsx` | B, C | B replaces PlanCard; C gates the result line. B2 before C3 |
| `apps/web/src/components/sidebar/InboxView.tsx` | B, C, E | E starts after B and C, so it rebases once |
| `db/repos/needs-you.ts`, `db/repos/threads.ts` | D, E, G | Additive |
| `apps/web/src/store.tsx`, `apps/web/src/api.ts` | C, E, F | Additive |
| `sync/handlers/kv.ts`, `bus.ts` | C, F | Additive |
| `apps/desktop/scripts/stage.ts` | F, G | G owns the guard; F adds `templates/` to `SHIPPED_DIRS` |
| `crew/*.md` | A, G | A owns `conductor.md`; G owns `researcher.md` and new charters |
| `apps/server/harness/catalog.ts` | D, G | D owns the probe; G drops its edit there |
| `packages/test-fixtures/wire/` | all | Re-recording renumbers ids; record only the fixture the slice changes |

Suggested merge order: A1, C1, G1, B1, D1, B2, C2, A2, D2, C3, F1, G2, F2, G3, E.

## 5. Thread budget

- Seven builder threads in total, one per slice. None is new: each continues the thread that holds the most WIP (A 115467f1, B ca900289, C f8ba161a, D 074d6114, E 878f40ba, F 7ebb2c49, G 04cda726).
- Three threads retire without another turn: fbc77d4a (into C), ff9f0a55 (into D), d7f83445 (no work). 979432c8 is done.
- At most six at once: A, B, C, D, F, G. E stays stopped until B and C have merged, then takes the slot of the first slice to finish.
- A builder works its slice's steps in order, with no subagents, and opens the next stacked PR only when the previous one is green.
- Rule for future work: a new change joins the open slice whose files it shares. A new slice opens only when the change touches none of the open slices' files and would take a builder at least one stacked PR. Never more than six builder threads running; a seventh waits for a slot. One-line fixes ride with the slice that owns the file.

## 6. Decisions for Ben

- D1. Retire fbc77d4a and ff9f0a55 into C and D instead of letting them finish their own PRs. Recommended: yes. Both would hold a slot, and the work is easier to move now than to rebase later.
- D2. Close d7f83445 in favor of 04cda726 for slice G. Recommended: yes. d7f83445 has no reply and no diff.
- D3. A7 per-channel memory on the crew plan's per-role store, not a second store. Recommended: yes.
- D4. A3's missing product features (post nothing when empty, dry run, approve card, expiring drafts) go in G under M6. Recommended: yes; otherwise the starter routines repeat what T-AUTOADMIN wrote by hand.
- D5. Quick asks refused on Cursor Cloud and Hermes. Recommended: yes, until either can run without a local workspace.

## 7. Briefs

Paste each into `continue_thread` on the named thread (each is a Claude Code thread on Opus 5.5). Each brief stands alone.

### A. Quick ask (thread 115467f1)

```
Goal: finish slice A of docs/plans/2026-11-18-knowledge-work-slices.md: the Conductor answers read-only asks itself (R1), no folder question or three-part brief on questions (S2), crew reports show on the parent without a relay turn (S1), then a quick-ask thread with workspace none|read|worktree that stays out of the Inbox under "Recent asks" and promotes on write/run/browse/file/Keep (A1), and Quick Prompt answering in the same panel with follow-up, Copy and "Keep as thread" (R2) on desktop web, phone web, the desktop app and iOS. Your worktree already holds R1, S1 and S2; finish those first. Work the steps in order, no subagents.
Done when: PR A1 (R1, S1, S2) and PR A2 (A1, R2, stacked on A1) are open; crew-reports, prompt and thread tests pass; npm run typecheck and npm test are green; the thread wire fixture is updated.
Proof back: both PR links, the test command and its summary line, and screenshots of Quick Prompt answering in place on desktop web, 390px phone and the desktop app QA harness.
```

### B. Steps (thread ca900289)

```
Goal: finish slice B of docs/plans/2026-11-18-knowledge-work-slices.md: the plain step view (A2) with set_steps in crates/omni-mcp, harness plans mapped onto it, phase fallback and nested children, decided for all five harnesses; the step list replacing PlanCard with "Step 3 of 5 · ..." on Inbox cards, phone rows and notifications (R3); and removing Plan card click-to-tick with its PATCH /:id/plan/steps/:index route (S4). Your worktree has the Rust server and packages/shared/steps.ts. Add a Steps component to the Claude Design project. Work the steps in order, no subagents.
Done when: PR B1 (server, Rust, shared model) and PR B2 (UI on all surfaces plus S4, stacked) are open; npm run test:rust, the steps.ts tests and npm test pass; the step event wire fixture is updated.
Proof back: both PR links, test summaries, and screenshots of a running thread's steps and an Inbox step line on desktop web, 390px phone and the desktop app.
```

### C. Plain mode (thread f8ba161a)

```
Goal: finish slice C of docs/plans/2026-11-18-knowledge-work-slices.md. First copy the uncommitted Settings regroup (R7) from worktree data/worktrees/fbc77d4a-bf82-49b5-a3e5-00cdec518910 into yours (git -C <donor> diff HEAD --binary | git apply --3way, plus its untracked files; never check out its branch), and ship it as PR C1. Then the "Show technical details" switch (R5), five statuses (R4), plain run controls (R6) as PR C2; then the no-repo and hidden-by-default trims (S5, S6) and the opt-in Store and Portal pack as PR C3. Name the pack setting in the PR; slices F and G read it. Design system: the switch and five-state mark. Work in order, no subagents.
Done when: PRs C1, C2, C3 are open and stacked; settings-catalog, iOS sections-model and display tests pass; npm run typecheck and npm test are green.
Proof back: three PR links, test summaries, the pack setting's name, and before/after screenshots with the switch on and off on desktop web, 390px phone and the desktop app.
```

### D. Access and pre-flight (thread 074d6114)

```
Goal: finish slice D of docs/plans/2026-11-18-knowledge-work-slices.md. First copy the uncommitted sign-in pre-flight (A4) from worktree data/worktrees/ff9f0a55-15c7-4209-b91b-01ccdeb29723 (git diff HEAD --binary | git apply --3way plus untracked files; never check out its branch), finish its automation side, account in the thread header and client cards, and fix Claude Code's unconditional available: true (apps/server/harness/catalog.ts:105) with a real probe. Ship as PR D1. Then finish access levels per channel and connector (A6) enforced per harness with the "Ask first" approval card on every client, and "Ask first" as a new install's default (M1), as PR D2. Work in order, no subagents.
Done when: PRs D1 and D2 are open and stacked; sign-in hold, catalog probe, access policy and channel sync tests pass; npm test is green; the approval question wire fixture is updated.
Proof back: both PR links, test summaries, and screenshots of the pre-flight warning and the approval card on desktop web, 390px phone and the desktop app.
```

### E. Inbox (thread 878f40ba), start after slices B and C merge

```
Goal: finish slice E of docs/plans/2026-11-18-knowledge-work-slices.md: rebase your snooze work onto main, then merge the Inbox list and Overview into one clearable pane with peek, reply and snooze using the five statuses from slice C (R8), and add a one-line recap on returning to a long thread, in the thread header and the peek, built from slice B's steps (A8). Phone Activity and iOS Activity get the same. Work in order, no subagents.
Done when: one PR is open; snooze, sync merge, useInbox and the Conductor snooze tool tests pass; npm test is green.
Proof back: the PR link, test summaries, and screenshots of the pane, peek and recap on desktop web, 390px phone and the desktop app.
```

### F. Kits (thread 7ebb2c49)

```
Goal: finish slice F of docs/plans/2026-11-18-knowledge-work-slices.md: the seven templates (A5) with slash and New sheet entries, templates/ shipped and guarded, Shopify templates behind slice C's pack setting, as PR F1; then per-channel "Recent learnings" with approve and edit (A7), built on the per-role memory store in docs/plans/2026-11-18-user-defined-crew.md section 3 scoped by channel (build that store if crew S6 has not landed), synced and reachable by the Conductor, as PR F2. Work in order, no subagents.
Done when: PRs F1 and F2 are open and stacked; template, stage, memory store and sync tests pass; npm test is green.
Proof back: both PR links, test summaries, and screenshots of template chips and the learnings list on desktop web, 390px phone and the desktop app.
```

### G. First run (thread 04cda726)

```
Goal: finish slice G of docs/plans/2026-11-18-knowledge-work-slices.md: a first run with no Ben or Ask Phill in the product. PR G1: neutral strings, USER variable and the personal-terms guard widened to every shipped dir (M4), "Where should Omni keep your files?" with repo and store optional (M3), Research answering in the thread by default (S3), README Codex line fixed (M9). PR G2: onboarding installs and signs in to Claude Code using slice D's probe (M2), Writer and Admin charters (M5), three starter routines off by default plus post-nothing-when-empty, dry run, approve card and expiring drafts (M6). PR G3: owner and agent fields on threads (M8), one computer first with QR pairing in the desktop app (M7). Leave apps/server/harness/catalog.ts to slice D. Work in order, no subagents.
Done when: PRs G1, G2, G3 are open and stacked; guard, setup and onboarding tests pass; a fresh-profile run on a QA stack works; rg -iw "ben|ask phill" over shipped dirs finds nothing; npm test is green.
Proof back: three PR links, test summaries, the rg output, and first-run screenshots on desktop web, 390px phone and the desktop app.
```
