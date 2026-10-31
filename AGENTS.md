# Agent instructions

Project context and conventions live in `CLAUDE.md`. Read it first.

## Standing rules

### Every surface, every time

- A feature or fix takes effect on all three surfaces unless the task says otherwise: the Web UI on desktop, the Web UI's phone layout (`apps/web/src/mobile/`) and the Mac app (`apps/mac/`).
- Ship all three in the same PR. None of them is a follow-up. If one surface does not need the change, say why in the PR.
- Check each surface before calling the work done: desktop browser, 390px phone width and the Mac app's QA harness. A UI change carries screenshots of all three.
- Why: folders once shipped web-only (#177) and never reached the Mac app, and later the phone Channels screen ignored folder data.

### New UI components go into the design system

- The Omni OS design system lives in Claude Design: https://claude.ai/design/p/a7120f6b-8577-40e3-9087-e512ce20d673. Reuse its components and tokens first.
- If a feature needs a component that design system does not have, add it there in the same task, not only in code.
- How: the Claude Design MCP (`mcp__claude_design__get_project`, `list_files`, `read_file`, `write_files`) reads and writes the project. Read its `readme.md` and `SKILL.md` first. Components live in `components/<group>/` (a `.jsx`, `.d.ts` and `.prompt.md` each, plus a `*.card.html` preview), their styles in `components/omni.css`, tokens in `tokens/`. Writing needs a plan first: call `finalize_plan` with the exact paths, then pass the plan token it returns to `write_files` (an `if_match` etag alone is refused). `project not found` from `get_project` means the login lacks Claude Design access: ask Ben to run `/design-login`.
- The repo has no `DESIGN.md`. The code copies of the tokens are `apps/web/src/index.css` and `apps/mac/Omni/Theme.swift`: a token change goes into the design system and both files.

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
