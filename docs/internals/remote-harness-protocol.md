# Remote harness protocol (Runs API v1)

The HTTP shape Omni speaks to a remote agent that runs on its own server: Hermes, and every custom harness (`data/harnesses/<slug>.yaml`, [ADR 0017](../adr/0017-custom-harnesses.md)). Hermes Agent's API server serves it as is. Any other agent (an eve or Cloudflare agent, a home-made server) can join Omni by serving these routes. The client is `apps/server/harness/hermes/client.ts`; the adapter that drives it is `apps/server/harness/hermes/adapter.ts`; the fake the tests run against is `apps/server/tests/fake-hermes.ts`.

## Transport

- Base URL: whatever the harness file names. `https://` anywhere; plain `http://` only to the same machine (`localhost`, a loopback address) or a Tailscale address (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`, `*.ts.net`). Omni refuses any other `http://` URL, since the key is a bearer header.
- Auth: `Authorization: Bearer <key>` on every request. The key is the value of the secret the file names, read from that machine's secret store. It never goes in a URL or a body.
- Omni never follows a redirect. A 3xx is a failure, so the key never reaches another host.

## Calls

| Call | Request | Answer | Omni's use |
| --- | --- | --- | --- |
| `GET /v1/capabilities` | | 200 when up and the key is good; 401 or 403 when the key is refused | The availability probe: at start, every 15 minutes, on a save and when a picker opens on a harness that is down. The body is not read yet |
| `POST /v1/runs` | `{ input, session_id, instructions? }`, header `Idempotency-Key` | 200 or 202 with `{ run_id, status }` | Starts a turn. `session_id` is `omni-<thread id>`, the same for every turn of a thread, so the server continues its own conversation. `instructions` carries Omni's system prompt on the first run of a session only |
| `GET /v1/runs/{id}/events` | header `Accept: text/event-stream` | SSE, one JSON event per `data:` line | The turn's events, below |
| `GET /v1/runs/{id}` | | `{ status, output?, error?, usage?, runtime? }` | Reconciles a turn whose event stream ended without a terminal event |
| `POST /v1/runs/{id}/steer` | `{ input }` | 2xx, or 409 (or 400) when the run is no longer running | Adds a message to the running turn. On 409 Omni queues it as the next run |
| `POST /v1/runs/{id}/stop` | | 2xx, or 409 when already stopped | Stop, and the end of a session |
| `POST /v1/runs/{id}/approval` | | | Exists in the client; nothing calls it yet |

Rules the server can rely on:

- **Retries.** The message's uuid is the `Idempotency-Key`. A 429 (the server's own concurrency cap) is retried with backoff (250 ms to 2 s) on the same key, so a retry never starts a second run. A run that still gets 429 fails with "at its concurrent run cap".
- **Instructions.** A 400 whose body mentions `instructions` means the server takes no system prompt. Omni then sends the prompt in front of the first message instead, under a new key (`<uuid>:text`).
- **Tool-failure policy.** A resumed session gets Omni's tool-failure policy in front of its first input, since its instructions were sent in an earlier session.
- **Attachments** are described in the message text ("not transferred"). No bytes are uploaded.
- **Reconnect.** When the event stream drops, Omni reconnects once and skips events whose `seq` it has seen. If that also ends without a terminal event, it reads `GET /v1/runs/{id}` up to three times, then fails the turn and stops the run.

## Events

Each event has `event`, `run_id` and a `seq` that only grows within a run. `apps/server/harness/hermes/normalize.ts` maps them:

| Event | Becomes |
| --- | --- |
| `message.delta` (`delta`), `message.interim` | Reply text, in one bubble per turn |
| `tool.started`, `tool.completed`, `tool.failed` (`tool`, `preview`, `duration`, `error`) | A tool row, under Claude's tool names where one fits |
| `subagent.start`, `subagent.complete` | A task row |
| `run.queued`, `run.started`, `run.stopping` | A status line |
| `approval.request`, `approval.responded` | A status line. No answer is sent yet |
| `message.started`, `reasoning.available`, `run.steered`, `tool.progress` | Ignored |
| `run.completed` (`output`, `usage`, `runtime`) | The turn's result: token counts (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`) and the serving model (`runtime.model`) |
| `run.failed`, `run.cancelled`, `run.interrupted` | The turn fails or stops |

## What a remote harness does not get

- No secret but its own key: no channel or global secret, no install token, no thread token.
- No Omni MCP tools, browser, worktree, artifacts folder or design-system file. The prompt says so and tells it to work on its own clone.
- No delegate-only role (the Conductor) and no level below Full access: Omni cannot take its tools away.

## Later additions

Each is optional, so a server that does not serve it keeps working. Planned in [Addendum A of the crew plan](../plans/2026-11-18-user-defined-crew.md): a capabilities body on `GET /v1/capabilities` (protocol version, flags, models, model family), a `git` block on `POST /v1/runs` and a `git.pushed` event (B3), `usage.cost_usd` on the terminal event (B4), answers through `/approval` (B5), and the pairing calls `POST /v1/omni/pair` and `/v1/omni/revoke` ([Connect an agent](../plans/2026-11-18-connect-an-agent.md), C0).
