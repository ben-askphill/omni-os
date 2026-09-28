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
