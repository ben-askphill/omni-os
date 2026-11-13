# No-mistakes

no-mistakes is Kun Chen's local git gate ([github.com/kunchenguid/no-mistakes](https://github.com/kunchenguid/no-mistakes), MIT). `no-mistakes init` in a checkout adds a git remote named `no-mistakes`. A push to that remote runs review, test, docs and lint in a disposable worktree, with an agent on this machine. The gate pushes the branch to origin and opens the pull request after those checks pass.

The binary stays on the machine that installed it. The repo carries `.no-mistakes.yaml` and the prompt that detects the command. A thread uses the gate when both of these are true for the checkout that thread runs in:

- `no-mistakes` is on the Omni server's PATH
- `git remote get-url no-mistakes` prints a URL, and the thread's working directory is the root of that checkout

Hermes and Cursor Cloud stay on a plain push. Those turns run off this machine, and the daemon and the remote stay here. Claude Code, Codex and Cursor Agent get the gate on a worktree thread and on a thread whose checkout is the repo itself.

The Conductor does not push. It delegates, and the crew thread's prompt carries the instructions. There is no Conductor tool for the gate, sync does not copy the remote, and the Web UI, the phone layout and the desktop app are unchanged.

Full tool docs: [kunchenguid.github.io/no-mistakes](https://kunchenguid.github.io/no-mistakes/).

## Set it up on this machine

1. Install the binary and the daemon.

```sh
curl -fsSL https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.sh | sh
```

The installer keeps the binary in `~/.no-mistakes/bin`, symlinks `no-mistakes` into `~/.local/bin` or `/usr/local/bin`, and runs `no-mistakes daemon restart`.

2. Make sure the Omni server can see the command. `which no-mistakes` has to succeed in the environment that starts the server. `npm run dev` in a login shell uses that shell's PATH. The desktop app, launched from Finder, often has `/usr/local/bin` on PATH and misses `~/.local/bin`. When `which` only finds `~/.local/bin/no-mistakes`, symlink that file into `/usr/local/bin`.

3. Sign in to GitHub with the `gh` CLI. The gate uses it to open the pull request and to read checks.

```sh
gh auth login
gh auth status
gh auth setup-git
```

A branch that edits `.github/workflows` also needs the `workflow` scope (`gh auth refresh -s workflow`). If the origin URL embeds a token, update it and run `no-mistakes init` again. The provider page has the cases: [Provider integration](https://kunchenguid.github.io/no-mistakes/guides/provider-integration/).

4. Choose the pipeline agent in `~/.no-mistakes/config.yaml`. That file is per machine. This repo's `.no-mistakes.yaml` does not set `agent` or `agent_config`. A repo copy of `agent_config` is ignored.

```yaml
agent: claude
agent_config:
  claude:
    model: sonnet
    effort: high
```

`agent` is one name or a list, for example `agent: [claude, codex]`. The names are `auto`, `claude`, `codex`, `grok`, `rovodev`, `opencode`, `pi`, `copilot`, `antigravity`, `cursor`, `devin`, and `acp:<target>`. `auto` uses the first runnable native agent. `cursor` needs `acpx` and `cursor-agent`. `devin` needs `acpx` and `devin`. `effort` is `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. The agent rejects a level it does not implement. Field reference: [Global config](https://kunchenguid.github.io/no-mistakes/reference/global-config/).

5. Initialize each checkout you want gated, including this repo and a client repo a builder thread will push.

```sh
no-mistakes init
```

`origin` has to point at the GitHub repository already. For a fork, keep `origin` on the parent and pass the fork:

```sh
no-mistakes init --fork-url git@github.com:YOU/omni-os.git
```

`init` installs the `/no-mistakes` skill at `~/.claude/skills/no-mistakes` and `~/.agents/skills/no-mistakes`. `no-mistakes skill install` refreshes that skill and does not touch the repo. An Omni thread follows the Shipping section of its prompt whether or not the skill is loaded. A terminal agent uses the skill.

6. Check the install.

```sh
no-mistakes doctor
```

7. Start a new thread after `init`. Omni writes the Shipping section when the turn's process starts. A warm session keeps the prompt it was given. The other Mac needs its own install and its own `no-mistakes init`. Sync does not copy the remote or the daemon.

## What this repo asks the gate to run

`.no-mistakes.yaml` is this repo's policy. no-mistakes reads `commands`, `gates`, `test.instructions`, `document.instructions`, `pr.template`, `pr.appendix` and `no_ci` from the default branch. A value that exists only on the pushed branch is ignored. Those fields apply once this file is on `main`. Until then a run uses the tool's defaults.

`commands.test` is unset on purpose. In no-mistakes that field is a targeted check of the change, and the test step still drives the product afterwards. The repo's real commands sit next to it:

- `commands.prepare` is `npm ci --include=dev --prefer-offline`, so the disposable worktree has dependencies. `test.prepare: true` runs that install before the agent-driven test step, because test runs before lint. Later lint and gates reuse it.
- `commands.lint` is `npm run unused` (Knip). This repo has no root eslint script.
- The `typecheck` gate runs `npm run typecheck`.
- The `suite` gate runs `npm test`.
- The `build` gate runs `npm run build`.

`test.instructions` tells the live check to start `scripts/qa-stack.sh` on a free port, to leave port 4747 and `data/` alone, and to stop that stack before it finishes.

`no_ci: true` matches GitHub as it is today. Pull requests register no checks. `scripts/ci-workflow.yml` is not under `.github/workflows`, and `desktop-release.yml` runs only when someone dispatches it. An empty check list then counts as passed, so a run can finish. A check that is registered still has to pass. The flag does not waive a failing check.

New pull requests take their narrative from `.github/pull_request_template.md`. The gate's evidence appendix is collapsed under one Validation block.

`allow_repo_commands` stays off. A feature branch cannot replace the commands or the agent that runs on this machine.

## Pushing from a thread

A builder or store-ops thread whose checkout has the gate is told to commit and run:

```sh
no-mistakes axi run --intent "<the goal you asked for>"
```

That call blocks until the pipeline asks for a decision or finishes. Several minutes is normal. On a `gate:`, the thread answers with `no-mistakes axi respond`. An `ask-user` finding waits for you. The gate opens the pull request. Use `git push origin` and `gh pr create` only when you tell the thread to skip the gate.

`git push no-mistakes` starts the same pipeline and returns before the pull request exists. The prompt uses that when you asked to start the gate and not wait.

With the binary missing, or with no `no-mistakes` remote, the thread prompt has no Shipping section. The builder charter then pushes with `git push origin` and opens the pull request with `gh`.

A gate step's own agent reads `CLAUDE.md` in the disposable worktree. When a pipeline command says that turn is already inside a validation step, that agent finishes its step and leaves the pipeline alone.
