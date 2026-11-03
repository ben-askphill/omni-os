# Omni OS

Local agent workspace. See README.md for what it does.

## Standing rules

### Record tool failures

- Every agent and harness follows the global tool-failure policy in `apps/server/tool-failure-policy.ts`, which Omni adds to every thread's system prompt. Pass the rule to child agents whose results Omni cannot observe.
- Omni automatically captures reported tool failures in the machine-local `tool_failures` table in `data/omni.db`. Inspect groups through the Conductor's `tool_failures` tool or `GET /api/tool-failures`. Record status and safe fix, replacement or avoidance guidance with `triage_tool_failure` or `PATCH /api/tool-failures/:group`.
- Report hidden failures through `POST /api/tool-failures` using the actual thread and call reference. Never include arguments, raw output, credentials or private payloads. Do not recursively log logger failures. One failure never disables a tool.

### Every surface, every time

- A feature or fix takes effect on all three surfaces unless the task says otherwise: the Web UI on desktop, the Web UI's phone layout (`apps/web/src/mobile/`) and the desktop app (`apps/desktop/`, ADR 0010). The desktop app shows the Web UI, so a Web UI change reaches it as is. Desktop-only behavior goes through `window.omniDesktop`.
- Ship all three in the same PR. None of them is a follow-up. If one surface does not need the change, say why in the PR.
- Check each surface before calling the work done: desktop browser, 390px phone width and the desktop app's QA harness (`apps/desktop/scripts/qa.ts`). A UI change carries screenshots of all three ([docs/pr-screenshots.md](docs/pr-screenshots.md)).
- Why: folders once shipped web-only (#177) and never reached the old SwiftUI Mac app, and later the phone Channels screen ignored folder data.

### New UI components go into the design system

- The Omni OS design system lives in Claude Design: https://claude.ai/design/p/a7120f6b-8577-40e3-9087-e512ce20d673. Reuse its components and tokens first.
- If a feature needs a component that design system does not have, add it there in the same task, not only in code.
- How: the Claude Design MCP (`mcp__claude_design__get_project`, `list_files`, `read_file`, `write_files`) reads and writes the project. Read its `readme.md` and `SKILL.md` first. Components live in `components/<group>/` (a `.jsx`, `.d.ts` and `.prompt.md` each, plus a `*.card.html` preview), their styles in `components/omni.css`, tokens in `tokens/`. Writing needs a plan first: call `finalize_plan` with the exact paths, then pass the plan token it returns to `write_files` (an `if_match` etag alone is refused). `project not found` from `get_project` means the login lacks Claude Design access: ask Ben to run `/design-login`.
- The repo has no `DESIGN.md`. The code copies of the tokens are `apps/web/src/index.css`, `apps/ios/src/theme.ts` and the window background in `apps/desktop/src/windows.ts` (`--chrome`): a token change goes into the design system and all three files.

- Backend: `apps/server/` (Hono, node:sqlite, no ORM). `runner.ts` owns the claude CLI lifecycle; `stream.ts` is the pure stream-json parser.
- Web UI: `apps/web/` (React 19, Tailwind v4, hash router). Talks only to `/api`.
- Sync relay: `apps/relay/`. A Cloudflare Worker each user deploys; see ADR 0008. It imports nothing from the other packages.
- iOS app: `apps/ios/` (Expo, React Native). Pairs with a server over HTTPS, reads channels and threads live, sends and steers, Activity, Library, handoff, attachments, Changes and PR review. It imports `@omni/client-core` and `@omni/shared`, nothing from `apps/web`, `apps/desktop` or `apps/server`. See `apps/ios/README.md` and `apps/ios/RELEASE.md`.
- Desktop app: `apps/desktop/` (Electron). It loads the Web UI and runs the bundled server on Electron's own Node. One codebase builds it for macOS and as a Linux AppImage. It replaced the SwiftUI Mac app and the Linux launcher (ADR 0010). Desktop-only UI goes through `window.omniDesktop` (`packages/shared/desktop-bridge.ts`, read via `apps/web/src/desktop.ts`), always gated on it being there. It imports `@omni/shared` only. QA harness: `apps/desktop/scripts/qa.ts`. See `apps/desktop/README.md`.
- `packages/shared/`: pure TypeScript the web, desktop and iOS clients use (slash grammar, menu, pills, and shared view models). It imports only itself. `apps/web/` and `apps/desktop/` never import each other, and `apps/desktop` never imports `apps/server`, `apps/mcp`, `apps/ios` or `@omni/client-core`. `turbo boundaries` (run by `npm test`) enforces it with the tags in `turbo.json`.
- `packages/client-core/`: typed HTTP and thread stream for the iOS app. It imports `@omni/shared` only.
- Monorepo: npm workspaces (`apps/*`, `packages/*`) run with Turborepo. Import another package by name (`@omni/shared/slash.ts`), never by a relative path out of the package, and declare it in that package's `package.json`. `packages/test-fixtures` holds the fake CLIs, the corpora and the wire fixtures (`wire/`) the tests share. `data/`, `crew/`, `automations/` and `mods/` stay at the repo root.
- Conductor tools: `apps/mcp/omni.ts`, calls the local API.
- `npm run dev` (server :4747 + vite :4748), `npm test`, `npm run typecheck`, all through turbo. One package: `npx turbo run test --filter=@omni/server`; one file: `cd apps/server && npx vitest run tests/<file>.test.ts`.
- Secret values go in the secret store (Keychain on a Mac, `data/secrets.json` on Linux, or libsecret via `OMNI_SECRET_STORE`). The `secrets` table holds names only.
- `data/` is runtime state (db, thread dirs, worktrees, browser profiles). Never commit it.
- A feature or fix with a visible change to the Web UI or the desktop app ships with screenshots in the PR description (before/after, of desktop web, phone web and the desktop app). Take them against a throwaway server, never :4747, and upload with `scripts/pr-screenshots.sh`. See `docs/pr-screenshots.md`.

## Don't hurt the live install

You most likely run inside Omni itself, served from :4747 on the user's Mac.

1. **Never touch :4747 or the main checkout's `data/`.** Don't restart, kill, test against or write to them. Use `scripts/qa-stack.sh up` for a throwaway server with its own data dir and fake CLIs.
2. **Never kill by pattern.** No `pkill -f`, and no `kill` of a PID found by matching a name or path: other threads run their own stacks and fake CLIs. Stop what you started by its port and PID file (`QA_SERVER_PORT=<port> scripts/qa-stack.sh down`).
3. **Install with dev deps.** Agent shells often set `NODE_ENV=production`, so use `npm install --include=dev`.
4. **macOS has no `timeout` command.** Bound a slow command with your shell tool's own timeout setting, or `perl -e 'alarm 60; exec @ARGV' <cmd>`.

## Hit every surface

Most misses are a change that works where it was tested and is missing elsewhere. Before calling a change done, say which of these applied:

- **Clients**: desktop web, phone web and the desktop app, in the same PR (see "Every surface, every time").
- **Harnesses**: Claude Code, Codex, Cursor Agent, Cursor Cloud and Hermes each have an adapter in `apps/server/harness/`. Decide per harness, even if the answer is "not supported". The runner talks to all of them through `HarnessSession` in `harness/adapter.ts`: a typed `send`, `interrupt` and `end`, and an `exit` callback. A process id is optional: only Claude Code and Codex have one for the whole session (`harness/session.ts`).
- **Agents**: something a user can do is usually something the Conductor should reach through `apps/mcp/omni.ts`.
- **Sync**: new state that should reach the other Mac needs a handler in `apps/server/sync/handlers/`. The relay (`apps/relay/`) takes any entity name, so it needs no change.
- **Wire contract**: the desktop app shows the Web UI, so it reads the same JSON. A change to the shape of an API response or stream updates its recorded fixture in `packages/test-fixtures/wire/` through `apps/server/tests/wire-fixtures.test.ts`.
- **Docs**: if the change makes a page in `docs/` wrong, fix it in the same PR. Where a new doc goes: `docs/README.md`. Don't document what the code already says.

## Unslop every message (always on)

Before you send any message to the user, run the `unslop` skill on it. This applies to every model and agent working in this repo: Claude, Codex, Cursor, Gemini and any other.

- Claude Code: invoke `/unslop` (`.claude/skills/unslop/SKILL.md`).
- Other agents: read `.agents/skills/unslop/SKILL.md` and apply its rules.
- Scope: chat replies, summaries, plans, PR descriptions and any prose written for the user. Leave code, command output and quoted text unchanged.
- Run the pass silently. Send only the cleaned text, not a before/after or a list of fixes.

## Write PRs with pr-writer (always on)

Whenever you create or edit a pull request in this repo, write its title and description with the `pr-writer` skill. This applies to every model and agent working in this repo: Claude, Codex, Cursor, Gemini and any other.

- Claude Code: invoke `/pr-writer` (`.claude/skills/pr-writer/SKILL.md`).
- Other agents: read `.agents/skills/pr-writer/SKILL.md` and follow it.
- A PR template in `.github/` keeps its structure. Fill it in the pr-writer style.
