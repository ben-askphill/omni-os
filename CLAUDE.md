# Omni OS

Local agent workspace. See README.md for what it does.

- Backend: `server/` (Hono, node:sqlite, no ORM). `runner.ts` owns the claude CLI lifecycle; `stream.ts` is the pure stream-json parser.
- UI: `web/` (React 19, Tailwind v4, hash router). Talks only to `/api`.
- Conductor tools: `mcp/omni.ts`, calls the local API.
- `npm run dev` (server :4747 + vite :4748), `npm test`, `npm run typecheck`.
- Never store secret values outside the Keychain. The `secrets` table holds names only.
- `data/` is runtime state (db, thread dirs, worktrees, browser profiles). Never commit it.
