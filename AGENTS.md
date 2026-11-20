# Agent instructions

Project context and conventions live in `CLAUDE.md`. Read it first.

- Desktop app: `apps/desktop/` (Electron). It loads the Web UI and runs the bundled server on Electron's own Node. One codebase builds it for macOS and as a Linux AppImage. It replaced the SwiftUI Mac app and the Linux launcher (ADR 0010). Desktop-only UI goes through `window.omniDesktop` (`packages/shared/desktop-bridge.ts`, read via `apps/web/src/desktop.ts`), always gated on it being there. The page tells it the active layout (`setLayout`) so macOS traffic lights sit in the channel rail, or in the classic sidebar when that is on. It raises native notifications for questions, failures, finishes, crew reports and watched PRs. On macOS the Window menu opens the Activity Monitor, which reads Claude transcripts from `~/.claude/projects` only (Claude Code threads never get `CLAUDE_CONFIG_DIR`). It imports `@omni/shared` only. QA harness: `apps/desktop/scripts/qa.ts`. See `apps/desktop/README.md`.
- Words: use the canonical domain terms in [GLOSSARY.md](GLOSSARY.md), not the ones it lists under _Avoid_.

## Standing rules

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
