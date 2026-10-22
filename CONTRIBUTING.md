# Contributing

Omni is one person's daily tool, built in the open so others can fork it. Fixes and generic improvements from forks are welcome as PRs against `ben-askphill/omni-os`. Changes that only make sense for your own setup belong in your `data/` folder instead; if you need to edit a tracked file just for yourself, that is a missing config option, so open an issue ([FORKING.md](FORKING.md)).

Most work here is done by agents running inside Omni. [CLAUDE.md](CLAUDE.md) is their guide and applies to humans too.

## Set up

Follow [Install](docs/user/install.md) through `npm install --include=dev`. You do not need the Mac app installed to work on the server or Web UI.

```bash
npm run dev          # server on :4747, Web UI on http://localhost:4748
```

If you already run Omni for real on :4747, do not develop against it. Use the throwaway stack below.

## Checks

| Command | What |
| --- | --- |
| `npm test` | `turbo boundaries`, then every package's vitest suite |
| `npm run typecheck` | `tsc` in every package |
| `npm run test:mac` | The Mac app's Swift tests (OmniKit, headless). Needs Xcode |
| `npm run test:all` | vitest plus the Swift tests |
| `npx turbo run test --filter=@omni/web` | One package (`server`, `web`, `shared`, `mac`) |
| `cd apps/server && npx vitest run tests/<file>.test.ts` | One file |
| `npx turbo run test --affected` | Only what changed against `main` |
| `npm run build:slash` | Rebuild the Mac app's slash bundle after changing a slash module in `packages/shared/` |

## Run it without touching your real data

```bash
scripts/qa-stack.sh up               # server on :4757, Web UI on :4768, own data dir, fake CLIs, 3 seeded threads
QA_SERVER_PORT=4757 scripts/qa-stack.sh down
```

Threads in the stack run on `packages/test-fixtures/fake-claude.mjs`, so prompts like `RICH` or `TOOL:2000` drive a turn without spending a plan. The Mac app's QA harness points the Debug app at the same stack: see "QA harness" in `apps/mac/NOTES.md`.

## What a PR needs

- **One problem per PR.** Include the server, client, test and doc changes that problem needs, and nothing unrelated.
- **Both clients.** A feature with a visible change ships in the Web UI and the Mac app in the same PR. The Mac app is never a follow-up. If one client does not need it, say why.
- **Evidence.** Say what you ran and what you saw. A visible change needs before and after screenshots of each client it touches, taken against the throwaway stack and uploaded with `scripts/pr-screenshots.sh` ([how](docs/pr-screenshots.md)). A backend fix needs a test, or the request and response that show it working. Say what you could not check.
- **Docs.** If the change makes a page in `docs/` wrong, fix that page in the same PR. Where a new doc goes: [docs/README.md](docs/README.md#where-a-new-doc-goes).
- **Title.** A plain sentence about the outcome, like the ones in `git log`. The [PR template](.github/pull_request_template.md) has the rest.
- **Never commit** `data/`, `.env`, screenshots meant only for the PR, or a secret value. Secret values live in the Keychain only.

## How the code is split

The Web UI and the Mac app never import each other, and `turbo boundaries` (part of `npm test`) enforces it. Read [Web UI and Mac app](docs/internals/overview.md#web-ui-and-mac-app) before a change that crosses the server and a client.
