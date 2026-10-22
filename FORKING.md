# Forking Omni OS

Omni is built so you can fork it, run it as your own, and keep pulling updates from upstream without merge
conflicts. The rule that makes this work: **everything personal lives in `data/`, which git never sees.** The repo
holds only shared code and generic examples.

## Set up your fork

```bash
gh repo fork ben-askphill/omni-os --clone --remote   # your fork as origin, the original as upstream
cd omni-os
npm install
npm run setup
```

Or skip `npm run setup` and answer the same questions in the Web UI or the Mac app on first open. See
[Install](docs/user/install.md) for prerequisites and [Configuration](docs/user/configuration.md) for every file.

## What is yours and what is shared

| Yours (in `data/`, gitignored) | Shared (in the repo) |
| --- | --- |
| `data/omni.config.json`: name, pronouns, email, timezone, folders, GitHub owner, integrations, automation on/off | `omni.config.example.json`: every field, with example values |
| `data/crew/<role>.md`: your version of a charter | `crew/*.md`: the generic charters |
| `data/automations/<id>.yaml`: your own automations | `automations/*.yaml`: generic examples, all off |
| `data/omni.db`: channels, threads, folders, secret names | The schema and migrations |
| `data/threads`, `data/worktrees`, `data/browsers`: thread files, checkouts, browser logins | |
| `.env`: server options | `.env.example` |
| Keychain: secret values | |

Your channels (clients, projects, repos, stores) are rows in `data/omni.db`, made in the app or by `npm run setup`.
Omni seeds only `#conductor` and `#inbox`.

## Customising without touching tracked files

- **A charter**: copy `crew/inbox.md` to `data/crew/inbox.md` and edit the copy. Your copy replaces the shared one.
- **An automation**: turn it on or off in the Automations page. That writes `automations.<id>.enabled` to your
  config, not the YAML. To run it in another channel, set `automations.<id>.channel` there. For a different prompt
  or schedule, copy the YAML into `data/automations/` and edit the copy, or write a new one there.
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
scripts/build-mac.sh             # if you use the Mac app
```

Restart the server if you run it yourself; the Mac app restarts its own. Since none of your settings live in tracked files, this merges cleanly unless
you changed shared code yourself. `git status` should be clean before you pull; if it shows `crew/` or
`automations/` changes, move them into `data/crew/` or `data/automations/` and run `git checkout -- crew automations`.

## Upgrading an install from before the config file

An Omni data dir with threads but no `data/omni.config.json` writes one at its first boot with the defaults the code
used to have (workspace `~/phillbert` if it exists, timezone Europe/Amsterdam, `~/central-brain` if it exists, your
first name from `git config user.name`) and skips onboarding. Check it afterwards in Settings.

## Contributing back

Shared changes go upstream as PRs against `ben-askphill/omni-os`. See [CONTRIBUTING.md](CONTRIBUTING.md) and
`CLAUDE.md`. Never commit `data/` or `.env`.
