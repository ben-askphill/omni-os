# Forking Omni OS

Omni is built so you can fork it, run it as your own, and keep pulling updates from upstream without merge
conflicts. It works because **everything personal lives in `data/`, which git never sees.** The repo
holds only shared code and generic examples.

## Set up your fork

```bash
gh repo fork ben-askphill/omni-os --clone --remote   # your fork as origin, the original as upstream
cd omni-os
npm install
npm run setup
```

Or skip `npm run setup` and answer the same questions in the Web UI or the desktop app on first open. See
[Install](docs/user/install.md) for prerequisites and [Configuration](docs/user/configuration.md) for every file.

## What is yours and what is shared

| Yours (in `data/`, gitignored) | Shared (in the repo) |
| --- | --- |
| `data/omni.config.json`: name, pronouns, email, timezone, folders, GitHub owner, integrations, automation on/off | `omni.config.example.json`: every field, with example values |
| `data/crew/<role>.md`: your own roles, and overlays on the shipped ones | `crew/*.md`: the generic charters |
| `data/automations/<id>.yaml`: your own automations | None: Omni ships no automations |
| `data/omni.db`: channels, threads, folders, secret names | The schema and migrations |
| `data/threads`, `data/worktrees`, `data/browsers`: thread files, checkouts, browser logins | |
| `.env`: server options | `.env.example` |
| Secret store: secret values (Keychain on a Mac, `data/secrets.json` on Linux) | |

Your channels (clients, projects, repos, stores) are rows in `data/omni.db`, made in the app or by `npm run setup`.
Omni seeds only `#conductor` and `#inbox`.

## Design system

`design-system/` is a copy of the Omni OS design system: tokens (`tokens.json`, `tokens.css`, `tokens/`), the
component sources and previews (`components/`), logo and icon assets, the brand book (`README.md`,
`guidelines/brand-book.html`) and the desktop and phone UI kits. Open `design-system/README.md` first. Its source
of truth is a Claude Design System artifact, so edits made here do not reach it. Change it there and re-export.
The code copies of the tokens live in `apps/web/src/index.css`, `apps/ios/src/theme.ts` and `apps/desktop/src/windows.ts`.

## Customising without touching tracked files

- **A charter**: put `data/crew/inbox.md` next to the shipped `crew/inbox.md`. It is an overlay: it sets only the
  fields it names, and its body is added after the shipped charter (`charter_mode: append`) or replaces it
  (`charter_mode: replace`, or a plain copy). A file with a new name is a role of your own. See
  [docs/user/crew.md](docs/user/crew.md).
- **An automation**: make, edit or toggle it in the Automations page. Omni writes it to
  `data/automations/<id>.yaml`. You can also write one there by hand. See
  [docs/user/automations.md](docs/user/automations.md).
- **Paths and names in shared files**: charters and automation prompts take `{{user}}`, `{{workspace}}`,
  `{{reposDir}}`, `{{githubOwner}}`, `{{omniRoot}}`, `{{omniRepo}}`, `{{centralBrain}}` and `{{timezone}}`, filled
  from your config. Use them instead of hardcoding your own.
- **Server options**: `.env` (port, model defaults, concurrency). An env var wins over the config file, which helps
  for a one-off run.

If you find yourself editing a tracked file just for yourself, that is a missing config option: open an issue or a
PR upstream instead of carrying the change.

## Pulling upstream updates

```bash
git fetch upstream
git merge upstream/main          # or: git rebase upstream/main
npm install --include=dev
npm run build:desktop            # if you build the desktop app from this checkout, on a Mac
```

Restart the server if you run it yourself. `npm run build:desktop` needs the app quit first, and opens the new build. Since none of your settings live in tracked files, this merges cleanly unless
you changed shared code yourself. `git status` should be clean before you pull; if it shows `crew/`
changes, move them into `data/crew/` and run `git checkout -- crew`.

## Upgrading an install from before the config file

An Omni data dir with threads but no `data/omni.config.json` writes one at its first boot and skips onboarding. It
keeps your first name (from the old profile, else `git config user.name`), your git email and the GitHub owner of the
checkout's `origin`. The workspace, notes folder and timezone take a fresh install's fallbacks (`~/Omni`, none, this
machine's timezone). Check them afterwards in Settings.

## Contributing back

Shared changes go upstream as PRs against `ben-askphill/omni-os`. See [CONTRIBUTING.md](CONTRIBUTING.md) and
`CLAUDE.md`. Never commit `data/` or `.env`.
