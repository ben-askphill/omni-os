# Omni OS

Local agent workspace. See README.md for what it does.

## Standing rules

### Record tool failures

- Every agent and harness follows the global tool-failure policy in `apps/server/tool-failure-policy.ts`, which Omni adds to every thread's system prompt. Pass the rule to child agents whose results Omni cannot observe.
- Omni automatically captures reported tool failures in the machine-local `tool_failures` table in `data/omni.db`. Inspect groups through the Conductor's `tool_failures` tool or `GET /api/tool-failures`. Record status and safe fix, replacement or avoidance guidance with `triage_tool_failure` or `PATCH /api/tool-failures/:group`.
- Omni already records every call a harness runs, shell commands included. Report only failures it cannot see (a call inside a child agent or wrapper) through `POST /api/tool-failures` using the actual thread and call reference. Never report your own calls, the commands inside one, or expected misses (no match, an absent file, a test you are fixing). Never include arguments, raw output, credentials or private payloads. Do not recursively log logger failures. One failure never disables a tool.

### Every surface, every time

- A feature or fix takes effect on all three surfaces unless the task says otherwise: the Web UI on desktop, the Web UI's phone layout (`apps/web/src/mobile/`) and the desktop app (`apps/desktop/`, ADR 0010). The desktop app shows the Web UI, so a Web UI change reaches it as is. Desktop-only behavior goes through `window.omniDesktop`.
- Ship all three in the same PR. None of them is a follow-up. If one surface does not need the change, say why in the PR.
- Check each surface before calling the work done: desktop browser, 390px phone width and the desktop app's QA harness (`apps/desktop/scripts/qa.ts`). A UI change carries screenshots of all three ([docs/pr-screenshots.md](docs/pr-screenshots.md)).
- Why: folders once shipped web-only (#177) and never reached the old SwiftUI Mac app, and later the phone Channels screen ignored folder data.
- The `omni` command (`crates/omni-cli`) is not a surface: a feature does not grow a command. It keeps its six commands, and the MCP tools cover the rest ([ADR 0014](docs/adr/0014-omni-command-line.md)).

### Browser support

- Desktop app (Electron): any feature its Chromium ships. Code only the desktop app runs (QuickPrompt, the Activity Monitor, `server-screen.ts`, anything behind `window.omniDesktop`) needs no fallback.
- Desktop web and phone web (`apps/web/`, server-rendered pages, the relay's Connect page): Baseline widely available features freely, and Baseline newly available features once iOS Safari 18.0 has them. iPhone Safari, mostly as a home-screen app, is the floor. It matches the iOS app's deployment target (`apps/ios/app.config.ts`), so raise both together.
- Anything newer, or Chromium-only, goes in only as progressive enhancement: behind `@supports` or a feature check (`CSS.supports(...)`, `'x' in el`), and the page still works without it. The fallback is today's code, or at most ~20 new lines with no new dependency unless the task's brief names a bigger one. No polyfills unless the brief names one.
- `packages/shared` also runs on the iOS app's Hermes engine: check a newer JS built-in (`Promise.withResolvers`, `Intl.DurationFormat`) there too. Hermes V1 has no `Array.prototype.toSorted` (`packages/shared/tests/hermes-builtins.test.ts`).
- Look support up on MDN or webstatus.dev, not from memory, and say in the PR which browsers get the fallback.
- Why: nothing was written down, and Chromium-only APIs (`focusgroup`, `interestfor`, `closedby`) work in the desktop app but not on iPhone Safari. The modern web audit (#838) is the first work held to it.

### Build components with ui-sdk

- The Web UI (`apps/web`) has ui-sdk (`@ui-sdk/react` and `@ui-sdk/core`). It needs React 19 or newer.
- Before using ui-sdk, follow the `ui-sdk` skill (`.agents/skills/ui-sdk/`) if it's installed, and read `node_modules/@ui-sdk/react/docs/llms.txt`.
- To build a new component, also search `node_modules/@ui-sdk/react/docs/core.md` by heading (it's about 400 KB, so don't read it whole), and read `rendering.md` in the same folder.
- A component built with it still goes into the design system (next section).

### New UI components go into the design system

- The Omni OS design system lives in Claude Design: https://claude.ai/design/p/a7120f6b-8577-40e3-9087-e512ce20d673. Reuse its components and tokens first.
- If a feature needs a component that design system does not have, add it there in the same task, not only in code.
- How: the Claude Design MCP (`mcp__claude_design__get_project`, `list_files`, `read_file`, `write_files`) reads and writes the project. Read its `readme.md` and `SKILL.md` first. Components live in `components/<group>/` (a `.jsx`, `.d.ts` and `.prompt.md` each, plus a `*.card.html` preview), their styles in `components/omni.css`, tokens in `tokens/`. Writing needs a plan first: call `finalize_plan` with the exact paths, then pass the plan token it returns to `write_files` (an `if_match` etag alone is refused). `project not found` from `get_project` means the login lacks Claude Design access: ask Ben to run `/design-login`.
- The repo has no `DESIGN.md`. The code copies of the tokens are `apps/web/src/index.css`, `apps/ios/src/theme.ts` and the window background in `apps/desktop/src/windows.ts` (`--chrome`): a token change goes into the design system and all three files.

- Backend: `apps/server/` (Hono, node:sqlite, no ORM). `runner.ts` owns the claude CLI lifecycle; `stream.ts` is the pure stream-json parser.
- Web UI: `apps/web/` (React 19, Tailwind v4, hash router). Talks only to `/api`. Desktop web shows the channel rail by default (`rail-model.ts`: the Inbox disc opens `#/inbox`, the Inbox list in the panel and the Overview dashboard beside it; Pull requests, Artifacts and Automations sit behind one More disc; the list panel follows the page); Settings > Appearance turns on the Classic sidebar instead (Full color discs, Press I for the Inbox and Press E to mark done live there too); the phone layout stays its own shell and has no rail. Inbox cards (desktop, channel rail, phone Activity) name the machine and live run time; a job shows the threads under it as a tree with a status mark per state (no spinners); Overview and phone Activity show machine tiles with live CPU and RAM when sync is on. A finished turn can show an Open items card under the transcript. The Usage card (desktop sidebar, and near the top of phone Activity) lists each signed-in account with its own plan numbers and reset times. Claude Code threads can show a `/goal` line under the transcript.
- Sync relay: `apps/relay/`. A Cloudflare Worker each user deploys; see ADR 0008. Thread files and change-log payloads live in R2; the Durable Object SQLite keeps the index. It imports nothing from the other packages.
- iOS app: `apps/ios/` (Expo, React Native). Pairs with a server over HTTPS, reads channels and threads live, sends and steers (with the / command picker and agent and machine @mention pills in the composer), Activity (phone web's Inbox, with machine tiles when sync is on, the Usage card per account, and the thread tree under a job with its Done question), Artifacts (Files and Claude Artifacts, and a thread's own and delegated files from its thread menu), Settings and Channel Settings from the shared catalog (including Update all machines, Accounts, Branch steps, worktree copy/shared directories and avatar backgrounds), New from the tab bar, shared icons and channel avatars, the thinking line while a turn runs, the Open items card under a finished turn, merge-risk cards on a rated PR's threads, crew question cards on the thread that delegated them, push alerts that preview the reply, handoff, attachments, Changes (review notes) and PR review (including PRs from delegated threads, the composer Open PR chip when the agent asks, working Open PR / Fix conflicts / Fix checks states, Auto-merge, Rerun failed checks, and forwarded-message waiting rows). It imports `@omni/client-core` and `@omni/shared`, nothing from `apps/web`, `apps/desktop` or `apps/server`. See `apps/ios/README.md` and `apps/ios/RELEASE.md`.
- Desktop app: `apps/desktop/` (Electron). It loads the Web UI and runs the bundled server on Electron's own Node. One codebase builds it for macOS and as a Linux AppImage. It replaced the SwiftUI Mac app and the Linux launcher (ADR 0010). Desktop-only UI goes through `window.omniDesktop` (`packages/shared/desktop-bridge.ts`, read via `apps/web/src/desktop.ts`), always gated on it being there. The page tells it the active layout (`setLayout`) so macOS traffic lights sit in the channel rail, or in the classic sidebar when that is on. It raises native notifications for questions, failures, finishes, crew reports and watched PRs. On macOS the Window menu opens the Activity Monitor, which reads Claude transcripts from `~/.claude/projects` only (Claude Code threads never get `CLAUDE_CONFIG_DIR`). It imports `@omni/shared` only. QA harness: `apps/desktop/scripts/qa.ts`. See `apps/desktop/README.md`.
- `omni` command: `crates/omni-cli` (Rust), six commands (`new`, `send`, `threads`/`show`, `status`, `doctor`, `open`) over `/api`, held to the recorded scenarios in `packages/test-fixtures/native/cli/`, some of which answer with the wire fixtures. The desktop app ships the binary and writes a shim to `~/.local/bin/omni` and its own `bin` folder, which is on every thread's PATH (`apps/desktop/src/cli-shim.ts`). `scripts/omni.sh` builds and runs it from a checkout. See `docs/user/cli.md` and ADR 0014.
- `packages/shared/`: pure TypeScript the web, desktop and iOS clients use (slash grammar, menu, pills, shared view models and view plans such as Inbox shelves, the phone turn plan, usage rows and report folds, thread status marks, the crew avatar's motion and eye rules, and the thinking line's mark, shimmer and status label). It imports only itself. `apps/web/` and `apps/desktop/` never import each other, and `apps/desktop` never imports `apps/server`, `apps/mcp`, `apps/ios` or `@omni/client-core`. `turbo boundaries` (run by `npm test`) enforces it with the tags in `turbo.json`.
- `packages/client-core/`: typed HTTP and thread stream for the iOS app. It imports `@omni/shared` only.
- Monorepo: npm workspaces (`apps/*`, `packages/*`) run with Turborepo. Import another package by name (`@omni/shared/slash.ts`), never by a relative path out of the package, and declare it in that package's `package.json`. `packages/test-fixtures` holds the fake CLIs, the corpora and the wire fixtures (`wire/`) the tests share. `data/`, `crew/`, `templates/` and `mods/` stay at the repo root (no `automations/`: Omni ships none).
- Rust: `crates/` in a Cargo workspace at the repo root (`omni-mcp`, the per-thread `ask`, `render` and `threads` MCP servers, `omni-cli`, the `omni` command, and `omni-core`). Neither has a TypeScript build any more. The desktop build ships both binaries and fails without them (`apps/desktop/scripts/native.ts`; `--native off` makes an app without them). The server starts `omni-mcp` from the app's `bin/` or a checkout's `target/debug` (`apps/server/native-mcp.ts`, `OMNI_NATIVE_MCP=<path>` names another), and leaves the three servers out, with a warning, when it does not start. `omni-mcp lazy` stands in front of each thread's browser MCP and starts it at the thread's first browser call (`apps/server/lazy-mcp.ts`; `OMNI_BROWSER_LAZY=0` starts it with every thread, as an install without the binary does). `npm run dev`, `npm start`, `scripts/qa-stack.sh` and the server's tests build it with `cargo` first (`apps/server/scripts/native.ts`). Without `cargo`, `npm test` still passes: the tests that start those servers skip. With `cargo`, a build that fails fails the run and stops `npm run dev`. `npm run test:rust` runs the crates' own tests. [docs/internals/rust-port.md](docs/internals/rust-port.md) has the status of every module and the rules.
- Conductor tools: `apps/mcp/omni.ts`, calls the local API.
- `npm run dev` (server :4747 + vite :4748), `npm test`, `npm run typecheck`, all through turbo. One package: `npx turbo run test --filter=@omni/server`; one file: `cd apps/server && npx vitest run tests/<file>.test.ts`.
- Secret values go in the secret store (Keychain on a Mac, `data/secrets.json` on Linux, or libsecret via `OMNI_SECRET_STORE`). The `secrets` table holds names only.
- `data/` is runtime state (db, thread dirs, worktrees, browser profiles). Never commit it.
- Repo skills live in `.agents/skills/`; each `.claude/skills/<name>` is a symlink to one. Edit and `git add` the `.agents/skills/` path: git refuses a path through the symlink.
- A feature or fix with a visible change to the Web UI or the desktop app ships with screenshots in the PR description (before/after, of desktop web, phone web and the desktop app). Take them against a throwaway server, never :4747, and upload with `scripts/pr-screenshots.sh`. See `docs/pr-screenshots.md`.

## Don't hurt the live install

You most likely run inside Omni itself, served from :4747 on the user's Mac.

1. **Never touch :4747 or the main checkout's `data/`.** Don't restart, kill, test against or write to them. Use `scripts/qa-stack.sh up` for a throwaway server with its own data dir and fake CLIs.
2. **Never kill by pattern.** No `pkill -f`, and no `kill` of a PID found by matching a name or path: other threads run their own stacks and fake CLIs. Stop what you started by its port and PID file (`QA_SERVER_PORT=<port> scripts/qa-stack.sh down`). A preview HTTP server you started so the browser can open local HTML: stop it by that process's PID the same way; `pkill -f` on its command line also matches your own shell and kills it.
3. **Install with dev deps.** Agent shells often set `NODE_ENV=production`, so use `npm install --include=dev`.
4. **macOS has no `timeout` command.** Bound a slow command with your shell tool's own timeout setting, or `perl -e 'alarm 60; exec @ARGV' <cmd>`.
5. **Crop or join screenshots with ImageMagick** (`magick`), not Python: Pillow is often missing. See [docs/pr-screenshots.md](docs/pr-screenshots.md).

## Hit every surface

Most misses are a change that works where it was tested and is missing elsewhere. Before calling a change done, say which of these applied:

- **Clients**: desktop web, phone web and the desktop app, in the same PR (see "Every surface, every time").
- **Harnesses**: Claude Code, Codex, Cursor Agent, Antigravity (over ACP, ADR 0022), Cursor Cloud and Hermes each have an adapter in `apps/server/harness/`, and custom harnesses (`custom:<slug>`, `harness/custom.ts`, ADR 0017) run on the Hermes adapter. Decide per harness, even if the answer is "not supported". The runner talks to all of them through `HarnessSession` in `harness/adapter.ts`: a typed `send`, `interrupt` and `end`, and an `exit` callback. A process id is optional: only Claude Code and Codex have one for the whole session (`harness/session.ts`).
- **Agents**: something a user can do is usually something the Conductor should reach through `apps/mcp/omni.ts`.
- **Sync**: new state that should reach the other Mac needs a handler in `apps/server/sync/handlers/`. The relay (`apps/relay/`) takes any entity name, so it needs no change.
- **Wire contract**: the desktop app shows the Web UI, so it reads the same JSON. A change to the shape of an API response or stream updates its recorded fixture in `packages/test-fixtures/wire/` through `apps/server/tests/wire-fixtures.test.ts`.
- **Docs**: if the change makes a page in `docs/` wrong, fix it in the same PR. Where a new doc goes: `docs/README.md`. Don't document what the code already says.
- **Words**: use the canonical domain terms in [GLOSSARY.md](GLOSSARY.md), not the ones it lists under _Avoid_.

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
