---
name: verify
description: Use to check your own work in Omni OS whenever you change apps/server/, apps/web/, packages/shared/, apps/mac/ or apps/mcp/ code, before you say it is done or open a PR. Runs the checks, starts a throwaway stack, drives it and proves the change. Use it aggressively.
---

# Verify your change in Omni OS

Get yourself into a loop: change, run, look, fix, until the change provably works. Do not hand the user something you have not seen working. Pick the steps that fit the change; this is a checklist, not a script.

## 1. Static checks (every change)

- `npm run typecheck`
- `npm test` (turbo boundaries, then every package's vitest), or one package: `npx turbo run test --filter=@omni/<server|web|shared|mac>`, or one file while iterating: `cd apps/server && npx vitest run tests/<file>.test.ts` (each package has its own `vitest.config.ts`).
- A failing test: rerun it on `main` (`git stash; git checkout main; npx vitest run ...`) before treating it as yours. Lock, server-boot, sync-two-macs and mac-fixtures tests can fail on machines without a Mac setup.
- `npm run build` for web changes. Run it alone, not chained after other commands.
- Changed a slash module in `packages/shared/`: `npm run build:slash`. Changed `packages/shared/browser-pick-*.ts`: `npm run build:pick`.
- Mac code (macOS only): `npm run test:mac`.

## 2. Run it

`scripts/qa-stack.sh up` starts a throwaway server (:4757) with its own data dir and the fake CLIs, vite in front (:4768), and seeds sample threads. It prints the thread URLs. `QA_SERVER_PORT=<port> scripts/qa-stack.sh down` stops it and deletes its data. `down` refuses to run without the port, and refuses a stack whose processes run from another checkout, so it cannot stop another thread's stack. Never test against :4747 or `data/`: that is the live workspace.

- Threads run on `packages/test-fixtures/fake-claude.mjs`. Drive a turn with directives in the prompt: `RICH` (tools, plan, sub-agent), `TOOL:<ms>`, `BG:<ms>`, `LIMIT[:<epoch>]`, `CTX:<tokens>`, `PUBLISH:<path>`, and more listed at the top of that file.
- Every `/api` call needs the stack's own token (`status` prints it; it is `$QA_DIR/data/api-token`, default `$TMPDIR/omni-qa-<port>/data/api-token`). Your shell's `OMNI_TOKEN` is the live server's, so never use it here. `T=$(cat "${TMPDIR:-/tmp}/omni-qa-4757/data/api-token")`
- Create a thread: `curl -s -X POST localhost:4757/api/threads -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{"channel":"inbox","prompt":"RICH"}'`
- The web URLs `up` and `status` print end in `?pair=<token>`, which pairs the browser. A bare URL shows the pairing screen.
- Need some other state (folders, channels, a stuck request)? Build it through the API first; reach into the sqlite db in the QA data dir only when no route exists.

## 3. Drive it

- Web: open the printed URL in a browser tool (the thread's `omni-browser` MCP, Claude in Chrome, or Playwright). Click through the actual flow you changed, not just the page load. Check desktop width and 390px phone width (the phone layout is its own code in `apps/web/src/mobile/`), and dark mode (`browser_emulate_media`) when colour changed.
- With `omni-browser`, take a `browser_snapshot` before clicking. Pass the exact snapshot reference as `target` to `browser_click`; `element` is only a description, and `ref` is not a supported argument. For a selector, pass a valid unique CSS selector as `target`.
- Omit the `omni-browser` screenshot filename to save in the thread's browser folder. An explicit relative filename saves in the working directory instead. Do not pass an absolute path in `/tmp` or another directory outside the thread's browser folder and worktree. Read or copy the exact returned path, then put a copy in `shots/` for `scripts/pr-screenshots.sh`.
- Server: curl the route and read the response. Then check the side effect: the row in the QA db, the feed event (`curl -N localhost:4757/api/feed`), the line in `scripts/qa-stack.sh logs`.
- Mac: the Debug app's QA harness (`-OmniQAScript`, see "QA harness" in `apps/mac/NOTES.md`) points the app at :4757 and snapshots windows.

## 4. Prove it

- Visible change: before (from `main`) and after screenshots, attached as `docs/pr-screenshots.md` says.
- Backend change: the request and response, or the log line that shows the new path ran. When nothing proves the path ran, add a log line.
- Put what you ran under a `Verified:` line in your reply and PR body, and what you could not run under `Not verified:`. Never claim a check you did not run.

## 5. When you get blocked, fix this skill

If something stopped you (a missing env var, a crash on boot, a step here that is wrong), solve it, then edit this file so the next run does not hit it. Keep the fix short and in the right section. Commit it with your change.

Known blockers:
- The server crashes on boot if `OMNI_AUTOMATIONS_DIR` points at a missing dir. `qa-stack.sh` creates it.
- macOS has no `setsid`; `qa-stack.sh` falls back to perl's `setpgrp`. The PID file holds the subshell, so `down` stops the group its child leads.
- A Linux box may have no `lsof`: `qa-stack.sh` reads a process's cwd from `/proc` instead, and `ss -ltnp | grep :<port>` stands in for `lsof -iTCP:<port>` in the checks below.
- Another worktree's QA stack can already hold :4757 (`up` then logs "port 4757 ... is in use" and your curls hit the wrong code). Check `lsof -nP -iTCP:4757 -sTCP:LISTEN` and move with `QA_SERVER_PORT`/`QA_WEB_PORT`.
- With several agents running, 4757/4768 and the obvious pairs (4791, 4801, 4811, 4893, 4917, 5131) are often all taken. Find a free pair first: `for p in 6231 6331 6431 6531; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null || lsof -nP -iTCP:$((p+1)) -sTCP:LISTEN >/dev/null || { echo $p; break; }; done`, then pass it as `QA_SERVER_PORT`/`QA_WEB_PORT`.
- A live turn needs the real CLI: `QA_CLAUDE_BIN=$(which claude) QA_CODEX_BIN=$(which codex) QA_CURSOR_BIN=$(which cursor-agent) scripts/qa-stack.sh up --seed 0` swaps any of the fakes, and spends that plan. Cursor's dashboard calls (`harness/cursor/dashboard.ts`) run on a QA stack by default and are off in vitest (`OMNI_CURSOR_DASHBOARD=0`).
- `up` can print "up" for both ports while another worktree's stack holds them, so the browser shows that worktree's code. After `up`, check `lsof -t -iTCP:<web port> -sTCP:LISTEN | xargs -I{} lsof -p {} | grep cwd` points at your worktree.
- A thread's fake CLI stays alive after its turn (and after `/stop`), so the next message skips the spawn-time worktree check. To test that check, kill the thread's process first: `kill $(ps -eo pid,command | grep fake-claude | grep <thread-id> | grep -v grep | awk '{print $1}')`.
- A fresh QA stack opens on the onboarding dialog, which swallows every click a browser script makes. Mark it onboarded first: `echo '{"onboardedAt":"2026-01-01T00:00:00.000Z"}' > "$QA_DIR/data/omni.config.json"`.
- Playwright from `node_modules` can want a browser build that is not downloaded. Pass `executablePath` to a build already in `~/Library/Caches/ms-playwright/` rather than downloading one.
- A fresh worktree has no `node_modules`, so `@omni/server` types resolve to the main checkout's copy and typecheck misses (or invents) errors in your change. Tests do the same: `@omni/test-fixtures` resolves to main's fake CLIs, so a new fixture directive silently does nothing. Run `npm ci --include=dev` in the worktree first (agent shells set `NODE_ENV=production`).
- The Mac QA harness pointed at a `qa-stack.sh` server shows "Port answers, but not as this install's Omni": in QA mode the app reads the token from `<-OmniQAOut>/data/api-token`, not the stack's. Copy it there first (`mkdir -p "$OUT/data"; install -m 600 "$QA_DIR/data/api-token" "$OUT/data/api-token"`) and launch with `env -u OMNI_TOKEN`.
- `qa-stack.sh`'s `security` wrapper passes every call but the Cursor key to the real login Keychain, so saving a secret on a QA stack (Secrets, or a webhook's Set secret) writes it to Ben's Keychain. After `up`, overwrite `$QA_DIR/bin/security` with a stub (`-i` reads stdin and exits 0; `find-generic-password` prints a fixed value for the names you test) before saving any.
- Mac QA runs read and write the real app's drafts (`~/Library/Application Support/Omni/Drafts`), so text or context left unsent in one run is in the reply box on the next. Delete that thread's `reply%3A<id>.txt` and `context%3A<id>.txt` (the id percent-encoded) between runs and after the last one.
- The thread's Browser panel says "The live browser is off" on a default QA stack. Start it with `QA_BROWSER=1 scripts/qa-stack.sh up` (it launches a real Chrome for the channel).
- A web view in a Mac QA window stops painting a few seconds after it loads (the window is never on screen), so `cacheDisplay` drew the Web tab's page blank. `snapshot` now lays each shown web view's own `takeSnapshot` over it while it draws. For the same reason the page's `requestAnimationFrame` and scroll events wait for a frame that never comes; `{"annotate": {"pageScroll": n}}` forces one.
- The Mac QA step `{"annotate": {"hover": [x, y]}}` can fail with "nothing was inspected under the pointer" on a build that works: it sends one move and waits 5s. Run it again, and run the untouched build the same way, before treating it as yours.
- Synthesized clicks in the Mac QA harness never focus a text field: the app is not active, so its window is not key, and a field ignores the first click in a non-key window. A step that tests focus must call `NSApp.activate()` first (see `browserAddress` in `QARunner.swift`).
- Mac snapshots, and `screencapture` without screen recording permission (it fails), draw a Core Animation layer at its model value, so they can't show it moves. Prove a layer animation runs by building the view's file with a small `swiftc` harness that puts it in a window and prints `layer.presentation()` values a few times over a second.
- The worktree branch can start on top of commits that are not on `main` (another local branch's work). Check `git log --oneline main..HEAD` before you start; if it lists commits you did not make, they end up in your PR. With your edits still uncommitted and not in those commits' files, `git reset --keep main` drops them from your branch only (the other branch keeps them).
- After `down` and `up`, the browser still holds the old stack's pairing cookie and can show the pairing screen even on the `?pair=` link. Paste the new token from `status` into the field.
