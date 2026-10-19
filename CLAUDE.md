# Omni OS

Local agent workspace. See README.md for what it does.

- Backend: `server/` (Hono, node:sqlite, no ORM). `runner.ts` owns the claude CLI lifecycle; `stream.ts` is the pure stream-json parser.
- Web UI: `web/` (React 19, Tailwind v4, hash router). Talks only to `/api`.
- Mac app: `mac/` (SwiftUI app plus the `OmniKit` package). Another client of `/api`, see `mac/NOTES.md` and ADR 0002.
- `shared/`: pure TypeScript both clients use (slash grammar, menu, pills). It imports only itself. `web/` and `mac/` never import each other; `tests/app-boundaries.test.ts` enforces it.
- `npm run test:mac` (Swift), `npm run build:slash` after changing a slash module in `shared/`.
- Conductor tools: `mcp/omni.ts`, calls the local API.
- `npm run dev` (server :4747 + vite :4748), `npm test`, `npm run typecheck`.
- Never store secret values outside the Keychain. The `secrets` table holds names only.
- `data/` is runtime state (db, thread dirs, worktrees, browser profiles). Never commit it.
- A feature or fix with a visible change to the Web UI or Mac app ships with screenshots in the PR description (before/after, both clients if both change). Take them against a throwaway server, never :4747, and upload with `scripts/pr-screenshots.sh`. See `docs/pr-screenshots.md`.

## Unslop every message (always on)

Before you send any message to Ben, run the `unslop` skill on it. This applies to every model and agent working in this repo: Claude, Codex, Cursor, Gemini and any other.

- Claude Code: invoke `/unslop` (`.claude/skills/unslop/SKILL.md`).
- Other agents: read `.agents/skills/unslop/SKILL.md` and apply its rules.
- Scope: chat replies, summaries, plans, PR descriptions and any prose written for Ben. Leave code, command output and quoted text unchanged.
- Run the pass silently. Send only the cleaned text, not a before/after or a list of fixes.
