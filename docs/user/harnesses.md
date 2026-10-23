# Harnesses

A harness is the agent CLI a thread runs on. Pick one per channel (its default) or per thread in the model picker, or leave it to [Auto](#auto). Each runs through its official CLI and bills the plan it is signed in to.

| Harness | Bills | Install and sign in | Runs as |
| --- | --- | --- | --- |
| Claude Code | Claude plan | `npm install -g @anthropic-ai/claude-code`, then `claude` and `/login` | `claude -p` with stream-json |
| Codex | ChatGPT plan | `npm install -g @openai/codex && codex login` | `codex app-server` ([ADR 0001](../adr/0001-codex-app-server.md)) |
| Cursor Agent | Cursor plan | `curl https://cursor.com/install -fsS \| bash && cursor-agent login` | `cursor-agent` |
| Hermes | Anthropic API | On your own Linux server, see [below](#hermes-remote) | HTTP over Tailscale ([ADR 0003](../adr/0003-hermes-remote-harness.md)) |

- `OMNI_CLAUDE_BIN`, `OMNI_CODEX_BIN` and `OMNI_CURSOR_BIN` in `.env` point at a binary that is not on `PATH`. Without one, Codex also tries the copy inside the ChatGPT app.
- The usage meter is per harness: Claude's rate-limit events drive the 5h / 7d meter, Codex reports its own, Cursor reports none.
- Each harness has its own concurrency cap (4 by default): `OMNI_MAX_CONCURRENT` (Claude Code), `OMNI_MAX_CONCURRENT_CODEX`, `OMNI_MAX_CONCURRENT_CURSOR`, `OMNI_MAX_CONCURRENT_HERMES`. A full harness never holds up threads on another.
- Some features are Claude Code only: published artifact cards and [mods](mods.md).

## Auto

Auto is the first entry in the model picker and the default for a new thread. Omni reads the first prompt and picks the harness, model and effort for it. The thread's model pill then reads "Auto · <model>", and hovering it shows why, for example "Hard code task: Opus 5.5, high effort". Once picked, the run is fixed for the thread like any other.

- It sorts the prompt into a kind (code, math, research, writing, ops, quick) and scores how much it asks: its length, the code it names, and cues such as a migration, a race, a typo or a lookup. Light work runs on Haiku, standard on Sonnet, hard on Opus at high effort, the hardest on Opus at xhigh. Code and math never start below Sonnet.
- It also reads what the brief needs, and that can pick the harness. First match wins:

| Brief | Runs on |
| --- | --- |
| Make an image | Codex |
| Mail, calendar, Notion, Slack | Claude Code |
| Review a PR or code | Codex |
| Claude plan 90% used | Codex |
| Both plans 90% used, code | Cursor Composer |
| Quick or bulk code change | Cursor Composer |
| Anything else | Claude Code |

- Image generation goes to Codex because it is the only harness here that makes images; the image shows in the thread's artifacts. If Codex is not signed in, the thread runs on Claude Code and the Auto note says there is no image generation.
- Your claude.ai connectors (Gmail, Calendar, Notion, Slack, Productive, the Portal) exist only in Claude Code, so that work stays there even when the plan is busy.
- A review goes to Codex so a different model family checks work Claude most likely wrote.
- "Quick", "fast", "asap" and the like lower the effort a step on any harness. For code, they also move the thread to Cursor's Composer, a fast and cheap coding model, as does a mechanical change across many files ("rename X across the repo"). Not for the hardest tasks, and not when the first message has images, which Cursor Agent cannot see.
- Composer only runs while Cursor's Auto and Composer usage is under 90%. Auto never picks Grok, Gemini or Cursor's other named models, or Hermes: see [Auto routing](../internals/auto-routing.md#lanes) for why.
- A model picked on the thread, a crew role's or a channel's default all win over Auto. Set a channel's default to Auto in its settings, or `model: auto` in a crew role's frontmatter.
- How well it picks, and how to check that again: [Auto routing](../internals/auto-routing.md).

## Hermes (remote)

Hermes is an always-on agent on your own Linux server. Omni does not spawn it. The Hermes API server listens on the server's Tailscale address and is not public. A thread talks to it at `OMNI_HERMES_URL`, the server's Tailscale address and port (set it in Settings or `npm run setup`; empty means Hermes is off). The Mac must be on the tailnet.

The bearer token is the Keychain secret `HERMES_API_KEY` (global). It is not an env var, not a database column and not written to logs.

| Piece | What |
| --- | --- |
| Where it runs | On the Hermes server, in whatever clone Hermes already has. Omni does not create a worktree, browser profile or artifacts dir for the thread |
| Session | `omni-<thread id>`. The same id continues the conversation, with Hermes' own context |
| Prompt | Channel facts (repo, store, notes) go in `instructions` on the first run. The transcript shows only what you typed |
| Steer / interrupt | `POST /v1/runs/{id}/steer` and `/stop`. A steer that arrives after the run finished is queued as the next run |
| Attachments | Described in the message. The files stay on the Mac; Hermes cannot read those paths |
| Usage | Token counts on the run, not the plan meter. It bills the Anthropic API, not the Claude, ChatGPT or Cursor plan |
| Availability | `GET /v1/capabilities` with the bearer token. Missing key or an unreachable URL shows the fix in the model picker |

