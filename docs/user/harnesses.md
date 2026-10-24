# Harnesses

A harness is the agent CLI a thread runs on. Pick one per channel (its default) or per thread in the model picker, or leave it to [Auto](#auto). Each runs through its official CLI and bills the plan it is signed in to. Hermes and Cursor Cloud are the exceptions: they run off the Mac and Omni talks to them over HTTP.

| Harness | Bills | Install and sign in | Runs as |
| --- | --- | --- | --- |
| Claude Code | Claude plan | `npm install -g @anthropic-ai/claude-code`, then `claude` and `/login` | `claude -p` with stream-json |
| Codex | ChatGPT plan | `npm install -g @openai/codex && codex login` | `codex app-server` ([ADR 0001](../adr/0001-codex-app-server.md)) |
| Cursor Agent | Cursor plan | `curl https://cursor.com/install -fsS \| bash && cursor-agent login` | `cursor-agent` |
| Hermes | Anthropic API | On your own Linux server, see [below](#hermes-remote) | HTTP over Tailscale ([ADR 0003](../adr/0003-hermes-remote-harness.md)) |
| Cursor Cloud | Cursor plan | Secret `CURSOR_API_KEY`, see [below](#cursor-cloud) | A Cursor cloud agent, through the Cloud Agents API |

- `OMNI_CLAUDE_BIN`, `OMNI_CODEX_BIN` and `OMNI_CURSOR_BIN` in `.env` point at a binary that is not on `PATH`. Without one, Codex also tries the copy inside the ChatGPT app.
- The usage meter is per harness: Claude's rate-limit events drive the 5h / 7d meter, Codex reports its own, Cursor reports none.
- Each harness has its own concurrency cap (4 by default): `OMNI_MAX_CONCURRENT` (Claude Code), `OMNI_MAX_CONCURRENT_CODEX`, `OMNI_MAX_CONCURRENT_CURSOR`, `OMNI_MAX_CONCURRENT_HERMES`, `OMNI_MAX_CONCURRENT_CURSOR_CLOUD`. A full harness never holds up threads on another.
- Some features are Claude Code only: published artifact cards and [mods](mods.md).

## Switching mid-thread

The model and effort pickers in a thread's reply box move it to another model, effort or harness. Not to or from Hermes or Cursor Cloud, which have no worktree on this Mac, and a Cursor Cloud thread keeps the model its agent started with.

- Between turns the switch applies at once.
- While a turn runs, it waits: the pills show the pick with "Next turn" until the turn ends, however it ends (done, failed or stopped), and then it applies. A later pick replaces it; picking the current model and effort again, or the pill's clear button, drops it. Anything you send meanwhile waits for the turn too and runs on the new pick, instead of steering the running turn.

- Same harness: its session carries on with the new model or effort.
- Another harness: your next message starts a session there with a handover ahead of it. Omni builds it from the thread's transcript: title, folder, artifacts, open todos, then the messages, replies and tool calls, the newest kept whole when it runs past 32K characters. The transcript shows "Handing over from ... to ...", then how much the new session read. A message that starts with a command, like `/review`, runs first, and the handover goes with your next message.
- Back to a harness the thread ran on before: its own earlier session resumes and reads only what happened since. Straight back before anything ran elsewhere needs no handover.
- The Conductor can do the same with `switch_thread_run`, when you ask it to.

## Auto

Auto is the first entry in the model picker and the default for a new thread. Omni reads the first prompt and picks the harness, model and effort for it. The thread's model pill then reads "Auto · <model>", and hovering it shows why, for example "Hard code task: Opus 5.5, high effort". Once picked, it is the thread's run like any other, and [switching](#switching-mid-thread) it drops the "Auto".

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
- Composer only runs while Cursor's Auto and Composer usage is under 90%. Auto never picks Grok, Gemini or Cursor's other named models, Hermes or Cursor Cloud: see [Auto routing](../internals/auto-routing.md#lanes) for why.
- A model picked on the thread, a crew role's or a channel's default all win over Auto. Set a channel's default to Auto in its settings, or `model: auto` in a crew role's frontmatter.
- In #conductor, a saved channel default takes precedence over the Conductor role's charter. New thread follows saved settings until you pick a model or effort for that draft. Other crew roles keep their own defaults ahead of the channel's.
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

## Cursor Cloud

A Cursor Cloud thread is a [Cursor cloud agent](https://cursor.com/docs/cloud-agent): it runs on Cursor's own Linux machines, on a fresh clone of the channel's GitHub repo, pushes a branch and opens a PR. The `cursor` harness is something else: it runs `cursor-agent` on your Mac. Ask the Conductor for a "Cursor cloud agent" and it picks Cursor Cloud; Auto never does.

It needs two things, and the model picker says which is missing:

- The secret `CURSOR_API_KEY`, globally or on the channel, made at cursor.com/dashboard under Integrations. A key only in the Keychain (service `omni-os`, account `global/CURSOR_API_KEY`) works too. Omni sends it only to the Cloud Agents API, on the Authorization header: never to the local `cursor` harness (`apps/server/harness/env-guard.ts` strips it there) and never into a process environment or a log.
- The channel's GitHub repo, set in its settings. Cursor also needs access to that repo through its GitHub integration.

| Piece | What |
| --- | --- |
| Start | The first message creates the agent (`POST /v1/agents`) with Omni's context and your brief, on the repo's default branch, with Cursor opening the PR when the run ends. The agent id is `bc-<thread id>`, which is also the thread's session |
| Follow-ups | Each later message is a new run on the same agent (`POST /v1/agents/{id}/runs`), on the same branch. A message sent mid-run waits for the run to end: cloud agents can't steer here |
| In the thread | A card per run with its status, the agent on cursor.com, the branch it pushed and the PR. It updates every 10 seconds (`OMNI_CURSOR_CLOUD_POLL_MS`) |
| Reply | The agent's final message, with a line linking the agent and the PR. A delegated thread sends it to the Conductor as its crew report |
| Stop | Cancels the run. Quitting Omni does not: the agent keeps working, and the next message waits for it before it goes |
| Attachments | Images (PNG, JPEG, GIF, WebP, up to five, 15 MB each) go with the prompt. Other files stay on the Mac and are described |
| Models | Cursor default (the one set on cursor.com) or a model from Cursor's list. No effort levels |
| Usage | Billed to your Cursor plan. Omni shows no meter for it |

Not supported, since the agent runs on Linux: building or running the Mac app, Swift and Xcode tests, and screenshots of the Mac app or a browser. Its prompt tells it to say what it could not check. Pull the branch and do those on the Mac.

Omni drives the [Cloud Agents API v1](https://cursor.com/docs/cloud-agent/api/endpoints), which Cursor marks as a public beta.

