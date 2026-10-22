# Architecture overview

One Node server (`apps/server/`, Hono on `node:sqlite`) owns every thread, harness process, secret and automation. The Web UI and the Mac app are two clients of its `/api`. Words like channel, thread, turn and request are defined in [CONTEXT.md](../../CONTEXT.md). Decisions and their reasons are in the [ADRs](../adr/).

## How a thread runs

Each Claude Code thread gets one long-lived `claude -p --input-format stream-json --output-format stream-json` process. Messages go in on stdin, the process runs many turns and stays warm for `OMNI_KEEPALIVE_SECONDS` (default 10 minutes) after the last one, so a follow-up starts instantly. While background agents of that thread are still running, it stays up to `OMNI_TASK_KEEPALIVE_SECONDS` (default 4 hours). It is launched with:

| Piece | What |
| --- | --- |
| cwd | worktree `data/worktrees/<thread>` on branch `omni/<id>` (repo channels), else the channel base dir, else your workspace folder |
| context | your workspace folder added with `--add-dir`, its CLAUDE.md loaded, all your user skills and MCP servers |
| system prompt | channel facts (store, Portal slug, repo, notes), artifacts and browser rules, the channel's design system file, the crew role charter |
| MCP | `omni-browser` (`@playwright/mcp` at the exact version in `apps/server/package.json`, run by `node` from Omni's install, never `npx`; attached over CDP to the channel's Chrome that Omni runs, profile in `data/browsers/<channel>`); conductor also gets `omni` |
| env | `OMNI_THREAD_ID`, `OMNI_ARTIFACTS_DIR`, `OMNI_URL`, `OMNI_TOKEN` (the API token), plus global and channel secrets |
| session | `--session-id` on the first run, `--resume` after, so every follow-up keeps full context |

Codex threads run on `codex app-server` (ADR 0001) and Cursor threads on `cursor-agent`, each through an adapter in `apps/server/harness/` that turns its stream into the same events. Hermes is below.

Every stream event is stored in SQLite (`data/omni.db`) and pushed to the UI over SSE. The usage meter is per harness: Claude's rate-limit events drive the 5h / 7d meter, Codex reports its own, Cursor reports none.

Durable messages: a message is saved as a request before the client hears it was accepted, so a restart parks it instead of losing it. The states are in [CONTEXT.md](../../CONTEXT.md) under Delivery state.

## The channel browser

The channel browser (`apps/server/browser.ts`) is one Chrome per channel that Omni launches on first use (a thread's MCP or the Browser panel) and closes after 5 idle minutes. The panel streams it with a CDP screencast and sends mouse, wheel and keys back (`/api/channels/:id/browser/*`). While someone watches, the page lays out at the viewer's size (`Emulation.setDeviceMetricsOverride`, sharp at the display's scale), so it reads like a real browser window in the panel; the last viewer to report a size wins, and with none watching the agent gets the 1280-wide desktop page back. Input goes in batches: a client queues while a batch is on its way and merges moves and scrolls. The frame is Chrome-like: tabs with favicons, the address bar, a loading bar, and Chrome's Cmd shortcuts (L, T, W, R, [, ], C, X, V; A and Z go to the page).

## Web UI and Mac app

The two clients are kept apart so a change to one cannot break the other:

- `apps/web/` imports only `apps/web/`, `packages/shared/` and server types. It never imports `apps/mac/`.
- `apps/mac/` imports only `apps/mac/` and `packages/shared/`. Its Swift code talks to the server over HTTP and SSE, never to `apps/web/`.
- `packages/shared/` holds the pure TypeScript both need (slash grammar, `/` menu ranking, command pills) and imports only itself. The Mac app runs it through JavaScriptCore from a checked-in bundle: run `npm run build:slash` after changing a slash module.
- `turbo boundaries` (part of `npm test`) fails on any import that crosses these lines: a file outside its package, a package that is not a declared dependency, or a dependency the tags in `turbo.json` deny.
- `apps/server/tests/mac-fixtures.test.ts` pins the JSON the Mac app reads from the server, so a server change that would break the app fails `npm test`.
- Some screens copy a Web UI rule (transcript grouping, status line, format helpers). Those are ported to Swift with their own tests, not imported. A Web UI change to one of them should say whether the Mac app needs it too ([ADR 0002](../adr/0002-mac-app-is-a-client.md)).
- Mac-only details (project layout, the OmniKit files, the QA harness): `apps/mac/NOTES.md`.

## Layout

An npm workspaces monorepo run with Turborepo (`turbo.json`). Each app and package has its own
`package.json`, `tests/` and vitest config.

```
apps/server/                @omni/server: Hono API (*-api.ts), runner/, harness/ (claude, codex, cursor,
                            hermes adapters), db/, sync/, sandbox, secrets, terminal, browser, artifacts,
                            GitHub, scheduler; scripts/ for history import and sync backfill
apps/mcp/                   @omni/mcp: omni.ts, the conductor tools
apps/web/                   @omni/web: Web UI (React, Vite)
apps/mac/                   @omni/mac: SwiftUI app (Omni/), OmniKit package, slash engine entry and bundler
packages/shared/            @omni/shared: pure TypeScript both clients use (slash grammar, menu, pills)
packages/test-fixtures/     @omni/test-fixtures: fake CLIs and corpora the TS and Swift tests share
packages/typescript-config/ @omni/typescript-config: the tsconfig bases every package extends
crew/                       shared role charters (yours override them from data/crew/)
automations/                shared automation YAML, cron or PR events (yours go in data/automations/)
omni.config.example.json    every field of data/omni.config.json
mods/                       Claude Code mods loaded with OMNI_MODS=1 (omni-progress)
scripts/                    shell shim, Mac build, QA stack, PR screenshots, launchd install
docs/                       user guides (user/), architecture (internals/), ADRs (adr/), PR screenshot guide
supabase/                   sync relay migration
CONTEXT.md                  domain glossary (channel, thread, harness, crew...)
CONTRIBUTING.md             dev setup, checks and what a PR needs
FORKING.md                  what is yours in a fork and how to pull upstream
.github/                    PR template
data/                       gitignored: your config, db, thread dirs, worktrees, browser profiles, logs
```
