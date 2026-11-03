# Agent instructions

Project context and conventions live in `CLAUDE.md`. Read it first.

- Desktop app: `apps/desktop/` (Electron). It loads the Web UI and runs the bundled server on Electron's own Node. It replaced the SwiftUI Mac app and the Linux launcher (ADR 0010). Desktop-only UI goes through `window.omniDesktop` (`packages/shared/desktop-bridge.ts`, read via `apps/web/src/desktop.ts`), always gated on it being there. It imports `@omni/shared` only. QA harness: `apps/desktop/scripts/qa.ts`. See `apps/desktop/README.md`.

## Standing rules

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
