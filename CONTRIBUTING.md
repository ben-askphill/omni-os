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
| `npm run typecheck` | `tsc` in every package, with `noUnusedLocals` and `noUnusedParameters` on |
| `npm run unused` | Knip: unused files, dependencies and binaries (`knip.json`). Unused exports are not checked yet |
| `npm run check` | Typecheck, knip, then `npm test`; the CI workflow runs the same three (`scripts/ci-workflow.yml`, to be moved to `.github/workflows/ci.yml`) |
| `npm run test:mac` | The Mac app's Swift tests (OmniKit, headless). Needs Xcode |
| `npm run test:all` | vitest plus the Swift tests |
| `npx turbo run test --filter=@omni/web` | One package (`server`, `web`, `shared`, `mac`) |
| `cd apps/server && npx vitest run tests/<file>.test.ts` | One file |
| `npx turbo run test --affected` | Only what changed against `main` |
| `npm run build:slash` | Rebuild the Mac app's slash bundle after changing a slash module in `packages/shared/` |
| `npm run build:pick` | Rebuild the Mac app's page reader after changing `packages/shared/browser-pick-script.ts` or `browser-pick-read.ts` |

`npm test` runs on macOS and Linux and needs Node 24 and git. It runs two packages at a time, each on half the cores. On a small machine, pass a lower cap: `npx turbo run test --concurrency=1 -- --maxWorkers=2`. Some tests need more and skip without it:

- The Swift tests (`npm run test:mac`) and the Mac app's QA harness need macOS with Xcode. On Linux, say in the PR that the Mac app was not built or checked.
- The real-Chrome tests in `apps/server/tests/browser-pick-cdp.test.ts` skip when no Chrome or Chromium is installed.
- The real-CLI tests run only on request, with the CLIs signed in: `OMNI_LIVE_COMMANDS=1` for `commands-live`, `OMNI_LIVE_CODEX=1` for `codex-live`.

## Run it without touching your real data

```bash
scripts/qa-stack.sh up               # server on :4757, Web UI on :4768, own data dir, fake CLIs, 3 seeded threads
QA_SERVER_PORT=4757 scripts/qa-stack.sh down
```

Threads in the stack run on `packages/test-fixtures/fake-claude.mjs`, so prompts like `RICH` or `TOOL:2000` drive a turn without spending a plan. The Mac app's QA harness points the Debug app at the same stack: see "QA harness" in `apps/mac/NOTES.md`.

## What a PR needs

- **One problem per PR.** Include the server, client, test and doc changes that problem needs, and nothing unrelated.
- **Every surface.** A feature or fix ships on desktop web, the phone web layout and the Mac app in the same PR. None of them is a follow-up. If one surface does not need it, say why.
- **Design system.** A UI component the [Omni OS design system](https://claude.ai/design/p/a7120f6b-8577-40e3-9087-e512ce20d673) does not have yet gets added there in the same PR. Reuse what it has first.
- **Evidence.** Say what you ran and what you saw. A visible change needs before and after screenshots of desktop web, phone web and the Mac app, taken against the throwaway stack and uploaded with `scripts/pr-screenshots.sh` ([how](docs/pr-screenshots.md)). A backend fix needs a test, or the request and response that show it working. Say what you could not check.
- **Docs.** If the change makes a page in `docs/` wrong, fix that page in the same PR. Where a new doc goes: [docs/README.md](docs/README.md#where-a-new-doc-goes).
- **Title.** A plain sentence about the outcome, like the ones in `git log`. The [PR template](.github/pull_request_template.md) has the rest.
- **Never commit** `data/`, `.env`, screenshots meant only for the PR, or a secret value. Secret values live in the Keychain only.

## How the code is split

The Web UI and the Mac app never import each other, and `turbo boundaries` (part of `npm test`) enforces it. Read [Web UI and Mac app](docs/internals/overview.md#web-ui-and-mac-app) before a change that crosses the server and a client.
