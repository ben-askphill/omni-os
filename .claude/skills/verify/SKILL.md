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
- Changed a slash module in `packages/shared/`: `npm run build:slash`.
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
- Another worktree's QA stack can already hold :4757 (`up` then logs "port 4757 ... is in use" and your curls hit the wrong code). Check `lsof -nP -iTCP:4757 -sTCP:LISTEN` and move with `QA_SERVER_PORT`/`QA_WEB_PORT`.
- With several agents running, 4757/4768 and the next obvious pairs (4791, 4801, 4811) are often all taken. Check with `lsof` and pick a pair that is free (for example 4893/4894), passing the same env `qa-stack.sh` uses.
- A live Cursor turn needs the real CLI: point `OMNI_CURSOR_BIN` at it instead of `fake-cursor.mjs`. Cursor's dashboard calls (`harness/cursor/dashboard.ts`) run on a QA stack by default and are off in vitest (`OMNI_CURSOR_DASHBOARD=0`).
- `up` can print "up" for both ports while another worktree's stack holds them, so the browser shows that worktree's code. After `up`, check `lsof -t -iTCP:<web port> -sTCP:LISTEN | xargs -I{} lsof -p {} | grep cwd` points at your worktree.
- A thread's fake CLI stays alive after its turn (and after `/stop`), so the next message skips the spawn-time worktree check. To test that check, kill the thread's process first: `kill $(ps -eo pid,command | grep fake-claude | grep <thread-id> | grep -v grep | awk '{print $1}')`.
- A fresh worktree has no `node_modules`, so `@omni/server` types resolve to the main checkout's copy and typecheck misses (or invents) errors in your change. Run `npm ci --include=dev` in the worktree first (agent shells set `NODE_ENV=production`).
- The Mac QA harness pointed at a `qa-stack.sh` server shows "Port answers, but not as this install's Omni": in QA mode the app reads the token from `<-OmniQAOut>/data/api-token`, not the stack's. Copy it there first (`mkdir -p "$OUT/data"; install -m 600 "$QA_DIR/data/api-token" "$OUT/data/api-token"`) and launch with `env -u OMNI_TOKEN`.
