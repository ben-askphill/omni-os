# Omni OS docs

## Using Omni

- [Install and first run](user/install.md), including the step-by-step agent instructions
- [Configuration](user/configuration.md): your config, `.env`, placeholders and secrets
- [Threads](user/threads.md): Needs you and Mark done, the composer, context chips, history, channel actions, Watch PR and Send to Grok Bot
- [Harnesses](user/harnesses.md): Claude Code, Codex, Cursor Agent, Hermes and Cursor Cloud
- [Crew and Conductor](user/crew.md)
- [Automations](user/automations.md): cron, GitHub PR events, published pages and signed GitHub webhooks
- [Sync between two Macs](user/sync.md)
- [Remote access and security](user/remote-access.md), including the phone layout and home-screen setup
- [Sign in with Google](user/google-sign-in.md): per-device sessions, the allowlist, the OAuth clients and the broker
- [Link previews](user/link-previews.md)
- [Mods](user/mods.md)
- [Other ways in](user/entry-points.md): shell, Quick Prompt, history import, brain export
- [Known limits](user/limits.md), including Storage and worktree retention
- [Forking Omni](../FORKING.md)

## Working on Omni

Start with [CONTRIBUTING.md](../CONTRIBUTING.md). Agents also read [CLAUDE.md](../CLAUDE.md).

- [Architecture overview](internals/overview.md): how a thread runs, the Web UI and Mac app split, repo layout
- [Auto routing](internals/auto-routing.md): how Auto picks a model, and the benchmarks that check it
- [Thread history](internals/thread-history.md): how a long thread opens on its newest page, the budgets, and what clients hold
- [Message context](internals/message-context.md): diff lines, terminal excerpts, browser annotations, thread references and how to add a kind
- [Glossary](../CONTEXT.md)
- [Mac app notes](../apps/mac/NOTES.md)
- [Screenshots on PRs](pr-screenshots.md)
- Decisions: [0001 Codex app-server](adr/0001-codex-app-server.md) · [0002 Mac app is a client](adr/0002-mac-app-is-a-client.md) · [0003 Hermes remote harness](adr/0003-hermes-remote-harness.md) · [0004 Supabase sync](adr/0004-supabase-sync.md)

## Where a new doc goes

- `docs/user/`: how to use a feature. What it does, how to start, anything unintuitive, and where its setting lives. Not a tour of every button.
- `docs/internals/`: decisions, constraints that span the server and both clients, and traps you cannot see from the code. If reading the code answers it, leave it out.
- `docs/adr/`: one decision with its context and the options turned down.
- When behaviour changes, rewrite the affected text instead of appending a second account.
