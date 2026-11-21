# Shadow agent router

A measurement, not a feature. For the first message of every new #conductor thread, two routers say which agents
should take it, and Omni logs their picks beside what the Conductor did in that turn. Nothing the user sees changes:
no agent is seated, no prompt changes, and the routers run after the thread has started. The log is there to decide,
on real traffic, whether a router could seat agents itself. Code: `apps/server/agent-router/`.

## Turning it on

- `OMNI_SHADOW_ROUTER=1` in `.env`, then restart the server. Off by default: Jev sends the message to TypeSafe, a vendor
  outside Omni, and Haiku spends the Claude plan.
- Jev needs the secret `JEV_API_KEY` (Settings > Secrets, the #conductor channel's or a global one). Without it the row
  logs `JEV_API_KEY is not set` and Haiku still runs.
- Haiku runs through the Claude CLI (`runner/aux.ts askClaude`, with `--system-prompt` and `--json-schema`). The server
  has no Anthropic API key, only the CLI's own sign-in, and that sign-in is for Claude Code, not for direct API calls.
  So Haiku's latency includes starting the CLI.

## What a row holds

One row per thread in `agent_router_shadow`, machine-local and never synced (the Conductor's turn runs on one machine).
No message text and no key: the thread's first `user` event holds the message.

| Columns | What |
| --- | --- |
| `agents` | The agent ids on offer at call time: the delegatable agents `list_crew` shows, user-made ones included |
| `jev_*` | `jev-1.14.0` with one yes/no question per agent and one for the Conductor answering itself. `jev_scores` is every yes probability, `jev_picks` the most likely answer first, then any other agent at 0.7 or above |
| `haiku_*` | `claude-haiku-5-5`, its picks most important first and its stated confidence in the first |
| `*_ms`, `*_error` | Each router's own time, and why it failed. A failed router leaves its picks null |
| `conductor_picks` | What the Conductor did by the end of that first turn: the agents of the threads it delegated (a team's members too) and of the agents it seated in its own thread. `[]` when it answered itself |

`conductor-self` in a router's picks means the Conductor answers itself.

## Scoring

`apps/server/agent-router/agreement.sql` gives each router's agreement with the Conductor, plus the combined variant
where Jev decides "answer or delegate" and Haiku picks the agent:

```
sqlite3 -readonly data/omni.db < apps/server/agent-router/agreement.sql
```

The Conductor's pick is the label, so a disagreement can be the router being right. Label the disagreements by hand
before tuning anything on them.

## Traps

- Only the first turn counts. A message steered into that turn while it runs is part of it, so a delegation it causes
  is joined in too.
- A thread made here to run on another machine is not logged: its turn, and its delegations, happen there.
- The row is saved as the thread starts, and the routers answer on a later tick, so a fast Conductor turn can end
  before either router answers. The row fills in whichever order they land.
