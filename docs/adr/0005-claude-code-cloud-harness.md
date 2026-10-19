# Claude Code cloud sessions are a harness that starts and messages them through the claude CLI

Ben wants some threads to run as Anthropic-hosted Claude Code cloud sessions: billed to his Claude plan, visible on claude.ai/code and in the desktop app, and still running when the Mac sleeps. `claude-cloud` is a harness like Hermes: no local process to keep warm, a holder stands in as the runner's child, and the thread has no worktree, browser or MCP config on this Mac.

The first message starts the session with `claude -p <Omni context + brief> --environment <OMNI_CLOUD_ENVIRONMENT> --ref <origin default branch> --output-format json`, run from the channel's repo, and the `session_…` id it prints becomes the thread's session id. Every later message, and a steer, is queued into it with `claude -p <msg> --cloud <id> --output-format json`. Both use the claude.ai login the CLI keeps in the Keychain, so Omni never reads that token. When no environment is set, a routine's API trigger (`OMNI_CLOUD_ROUTINE_URL` plus the Keychain secret `CLAUDE_ROUTINE_TOKEN`) starts the session instead; its saved prompt has to act on the `<routine-fire-payload>` text.

There is no supported API to read an Anthropic-hosted session's replies. So by default a turn ends as soon as the session is started or the message is queued, with its claude.ai link as the reply, and that is the crew report a parent gets. With `OMNI_CLOUD_REPLY_WAIT_MINUTES` set, the turn waits instead for the session's own final message, which `scripts/cloud-reply-hook.sh`, a Stop hook committed in the repo, posts to `/api/cloud/reply/:sessionId` with the bearer `OMNI_CLOUD_REPLY_SECRET`.

## Setup

1. `claude auth login` with claude.ai on this Mac. Run `/remote-env` in a session to find the environment id (`env_…`), and set `OMNI_CLOUD_ENVIRONMENT` to it.
2. Give cloud sessions GitHub access to the channel's repo: the Claude GitHub App, or `/web-setup`.
3. Optional, for real replies: expose Omni through a tunnel, add its host to the environment's allowed domains, set `OMNI_REPLY_URL` and the network secret `OMNI_CLOUD_REPLY_SECRET` on the environment, store the same secret in Omni's Secrets, commit the hook and its `.claude/settings.json` entry, then set `OMNI_CLOUD_REPLY_WAIT_MINUTES`.

## Considered

- **Reading the session through `/v1/code/sessions/{id}/events`.** It needs the CLI's OAuth token, which would mean Omni reading Claude Code's Keychain item, and the endpoint is documented only for routine runs.
- **Driving `claude --cloud "<task>"` in a pty.** The CLI refuses `--cloud <task>` with `-p`, and scraping a TUI is brittle.
- **The Agent SDK.** `query()` has no option to run in Anthropic's cloud; `spawnClaudeCodeProcess` only moves the CLI to infrastructure we run.

## Consequences

- `--environment` is documented for self-hosted `ccpool_` ids. Anthropic-hosted `env_` ids are accepted by `remote.defaultEnvironmentId`, but whether `-p --environment env_…` works was not tested here; the routine path is the documented fallback.
- Interrupt only stops Omni waiting. The session keeps running on claude.ai; there is no stop API.
- Omni's secrets, files, MCP tools and browser do not reach the session. Attachments are named and marked as not transferred.
- The session clones the pushed default branch, not the Mac's checkout.
