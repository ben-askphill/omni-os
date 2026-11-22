# Shipped personal settings audit (2026-11-22)

Omni ships as a desktop app (Mac, Linux AppImage), an iOS app, a relay each user deploys, and the repo. This audit
looked for settings that belong to the person who builds Omni: their name, company, clients, machines, folders,
handles and timezone. It started from main at `711350c3f` (desktop 2.1.1).

## What ships

| Release | Built from | How the guard reads it |
| --- | --- | --- |
| Desktop: server bundle | `apps/server`, `apps/mcp`, `packages/shared` (esbuild, 471 source files, no `scripts/` or `tests/`) | As esbuild emits it: types and their comments drop, comments in expressions stay |
| Desktop: main process | `apps/desktop/src`, `apps/desktop/package.json` | Same |
| Desktop: Web UI | `apps/web/src`, `index.html`, `public/` (Vite, minified) | Same, so stricter than the minified build |
| Desktop: copied as is | `crew/`, `templates/`, `mods/`, `prototypes/activity-monitor/` (`SHIPPED_DIRS` in `stage.ts`) | Every line |
| Desktop: Rust binaries | `crates/omni-cli`, `crates/omni-mcp`, `crates/omni-core` (`src/`) | Without comments and `#[cfg(test)]` modules |
| iOS app | `apps/ios/src`, `index.ts`, `app.config.ts`, `app.json`, `eas.json`, `packages/client-core`, `packages/shared` (Metro, minified) | As esbuild emits it |
| Sync relay | `apps/relay/src`, `wrangler.jsonc` | As esbuild emits it |

The server reads nothing else from the repo at run time: `package.json` (stamped), `.env` (the user's), and the four
copied folders. The desktop release runs the guard in `stage.ts` before it copies anything; `npm test` runs it in
`apps/desktop/tests/stage.test.ts`.

## Leaks fixed

| File:line on main | What | Decision | Now |
| --- | --- | --- | --- |
| `apps/server/config-migrate.ts:14,29,39` | A data dir with threads and no `omni.config.json` got the author's workspace (`~/phillbert`), timezone (Europe/Amsterdam) and notes folder (`~/central-brain`) | Neutral default | Name, email and GitHub owner as before; workspace, notes folder and timezone take a fresh install's fallbacks |
| `crew/conductor.md:43` | The Conductor charter's machine-mention example named the author's machines (MacBook Pro, omarchy) | Neutral default | `@Studio Mac`, `@build-server` |
| `apps/mcp/omni.ts:94` | `list_crew`'s description named the author's own eve agent (Nomos) | Neutral default | "an eve agent" |
| `packages/shared/settings-catalog.ts:149` | Settings search found the Shopify add-on by "ask phill", on every client | Removed | Keyword dropped, `settings-catalog.json` re-recorded |
| `apps/server/harness/auto.ts:41` | Auto read "portal" (the author's company portal connector) as a connector need on every install | User setting | Counts only while the Shopify add-on, which owns the client portal field, is on (`autoNeedOptions` in `apps/server/display.ts`) |
| `packages/shared/settings.ts:375`, `apps/server/profile.ts:27`, `apps/web/src/automation-draft.ts:174` | Timezone errors gave the author's timezone as the example | Neutral default | America/New_York |
| `apps/web/src/components/onboarding-parts.tsx:698` | The timezone field's placeholder was the author's timezone | Neutral default | The browser's own timezone, else UTC |
| `packages/client-core/src/api/claude-artifacts.ts:24`, `messages.ts:82`, `needs-you.ts:70`, `push.ts:25`, `apps/ios/src/send/sender.ts:195` | "Ben" in comments esbuild keeps. Metro strips them, so no iOS build carried them; fixed so the guard can read the iOS sources | Neutral default | "the user" |

## Kept on purpose

| Where | What | Why |
| --- | --- | --- |
| `apps/desktop/package.json:8` | `homepage` is `github.com/ben-askphill/omni-os` | The project's own repo, where its updates come from. In `ALLOWED_HITS` |
| `packages/shared/link-source-types.ts`, `link-parsers-work.ts` | Productive | A third-party service among the link-preview sources. In `ALLOWED_HITS` |
| `apps/server/harness/auto.ts` | `productive` in Auto's connector and ops cues | A third-party product with a public claude.ai connector, like Granola and Slack in the same list |
| Shopify add-on (`ChannelSettings`, iOS, `runner/prompts.ts`) | "Client portal slug" | Generic wording, off on a new install |
| `apps/server/grokbot.ts`, Secrets | "the Omni OS requests routine" | Setup text for an opt-in integration, hidden until its secrets are set |
| `apps/server/agent-router/*` | Jev (TypeSafe) | Third-party router, off unless `OMNI_SHADOW_ROUTER=1` and a key |
| `apps/ios/app.json`, `eas.json`, Clerk default | EAS project id, App Store id, shared Clerk instance | The published app's own services |
| `apps/desktop/src/backend/data-dir.ts:15` | `~/omni-os` | The old Mac app's default checkout, only read to offer its data |
| Model, harness and effort defaults, seeded Conductor and General channels, `tokens: notion` in charters | Product defaults | Nothing in them is one person's |

## Open: needs a decision

| Where | What | Why it is not in this change |
| --- | --- | --- |
| `apps/server` (18 files, 37 lines), `crates/omni-cli/src/commands/write.rs:159` | The internal message source id `'ben'`: `source` on user events and requests, `from` in the `omni` command's request. No client reads it; it shows in the server bundle (27 lines) and in raw event payloads | Renaming it means migrating stored event payloads, accepting both ids from machines on older builds while sync catches up, and re-recording the CLI scenarios and wire fixtures. That is its own PR, and slice G left it as the author's call |

## Fine as they are (not shipped, unchanged)

- 971 comment lines in the shipped source folders name the author or their machines (967 "Ben"; also omarchy, MacBook Pro/Air, an email and client names in examples). Every build strips them: esbuild for the server and desktop, Vite for the Web UI, Metro for iOS, rustc for the binaries. By area: `apps/server` 451, `packages/shared` 216, `apps/web` 211, `apps/ios` 71, `crates/omni-cli` 17, `packages/client-core` 10, `apps/mcp` 6, `apps/desktop` 3.
- `apps/web/src/index.css:485,656`: CSS comments, which Vite strips. "Omarchy" at `:186` is the Linux distribution the font stack targets.
- Rust `#[cfg(test)]` modules: `crates/omni-cli/src/connection.rs` (omarchy tailnet names), `commands/status.rs` (omarchy, MacBook Air), `commands/doctor.rs` (`ben-askphill` gh login), `time.rs` (Europe/Amsterdam). Not compiled into a release binary.
- Tests, fixtures and test config: `apps/server/vitest.config.ts:21` and `packages/shared/vitest.config.ts:13` set `OMNI_TZ: 'Europe/Amsterdam'`; many tests use the author's timezone, machines and clients as data.
- Dev-only scripts: `apps/server/scripts/setup.ts:121` (`npm run setup`, Europe/Amsterdam example), `scripts/repeated-asks.ts`, `scripts/route-eval/`, `apps/server/agent-router/agreement.sql`.
- Docs, plans, ADRs and reviews (this file included), and `CONTRIBUTING.md`/`FORKING.md` naming the upstream repo.

## The author's own install

- Their values live in each machine's `data/omni.config.json` and in the kv display prefs, not in code. The file exists on omarchy and the MacBook Pro (checked 2026-11-22); the MacBook Air did not answer ssh. The migration change touches only a data dir with threads and no file, and any machine that has run Omni since the file was added (2026-10-21) has one.
- "portal" still counts as a connector on their machines: the Shopify add-on is on there (kv `display`, synced).

## The gate

`apps/desktop/scripts/personal-terms.ts` lists the terms (case-sensitive and any-case), the shipped sources and
`ALLOWED_HITS`. `npx tsx apps/desktop/scripts/personal-terms.ts` prints every hit and exits 1 on any.

| Run | Hits |
| --- | --- |
| The guard as it was, on main | 0 (it missed lowercase spellings, machines, timezone, client-core, iOS, the relay and Rust) |
| The widened guard, on main | 15 |
| The widened guard, after the fixes | 0 |

The built output says the same. Main's server and MCP bundles, Web UI build and copied folders held Europe/Amsterdam
(6), phillbert (2), central-brain (2), ask phill, omarchy, MacBook Pro and Nomos. A Linux stage of this change
(`stage.ts --native off`) holds none of them; `'ben'` (above) is the one word left.
