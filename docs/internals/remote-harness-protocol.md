# Remote harness protocol (Runs API v1)

The HTTP shape Omni speaks to a remote agent that runs on its own server: Hermes, and every custom harness (`data/harnesses/<slug>.yaml`, [ADR 0017](../adr/0017-custom-harnesses.md)). Hermes Agent's API server serves it as is. Any other agent (a Cloudflare agent, a home-made server) can join Omni by serving these routes. An eve agent needs none of them: Omni speaks eve's own API to it ([eve agents](#eve-agents), [ADR 0018](../adr/0018-eve-agents.md)) and shares only the transport rules and the pairing calls below. The client is `apps/server/harness/hermes/client.ts`; the adapter that drives it is `apps/server/harness/hermes/adapter.ts`; the fake the tests run against is `apps/server/tests/fake-hermes.ts`.

## Transport

- Base URL: whatever the harness file names. `https://` anywhere; plain `http://` only to the same machine (`localhost`, a loopback address) or a Tailscale address (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`, `*.ts.net`). Omni refuses any other `http://` URL, since the key is a bearer header.
- Auth: `Authorization: Bearer <key>` on every request. The key is the value of the secret the file names, read from that machine's secret store. It never goes in a URL or a body.
- Omni never follows a redirect. A 3xx is a failure, so the key never reaches another host.

## Calls

| Call | Request | Answer | Omni's use |
| --- | --- | --- | --- |
| `GET /v1/capabilities` | | 200 when up and the key is good; 401 or 403 when the key is refused | The availability probe: at start, every 15 minutes and on a save. Find and Test connection also read the body's `name` and [`avatar`](#the-offered-avatar) |
| `POST /v1/runs` | `{ input, session_id, instructions?, tools? }`, header `Idempotency-Key` | 200 or 202 with `{ run_id, status }` | Starts a turn. `session_id` is `omni-<thread id>`, the same for every turn of a thread, so the server continues its own conversation. `instructions` carries Omni's system prompt on the first run of a session only. `tools` offers [the read call](#the-read-call) where the channel allows it |
| `GET /v1/runs/{id}/events` | header `Accept: text/event-stream` | SSE, one JSON event per `data:` line | The turn's events, below |
| `GET /v1/runs/{id}` | | `{ status, output?, error?, usage?, runtime? }` | Reconciles a turn whose event stream ended without a terminal event |
| `POST /v1/runs/{id}/steer` | `{ input }` | 2xx, or 409 (or 400) when the run is no longer running | Adds a message to the running turn. On 409 Omni queues it as the next run |
| `POST /v1/runs/{id}/stop` | | 2xx, or 409 when already stopped | Stop, and the end of a session |
| `POST /v1/runs/{id}/approval` | | | Exists in the client; nothing calls it yet |
| `POST /v1/runs/{id}/tool_result` | `{ call_id, output, is_error }` | 2xx | Answers a `tool.requested` the run waits on: [the read call](#the-read-call). Optional |

Rules the server can rely on:

- **Retries.** The message's uuid is the `Idempotency-Key`. A 429 (the server's own concurrency cap) is retried with backoff (250 ms to 2 s) on the same key, so a retry never starts a second run. A run that still gets 429 fails with "at its concurrent run cap".
- **Instructions.** A 400 whose body mentions `instructions` means the server takes no system prompt. Omni then sends the prompt in front of the first message instead, under a new key (`<uuid>:text`).
- **Tools.** A 400 whose body mentions `tools` means the server takes no client-side tools. Omni sends the run again without them, under a new key (`<uuid>:notools`), and offers none again in that session.
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
| `tool.requested` (`call_id`, `name`, `arguments`) | A call of a tool Omni offered: a tool row, then Omni's answer through `POST /v1/runs/{id}/tool_result` ([the read call](#the-read-call)) |
| `message.started`, `reasoning.available`, `run.steered`, `tool.progress` | Ignored |
| `run.completed` (`output`, `usage`, `runtime`) | The turn's result: token counts (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`) and the serving model (`runtime.model`) |
| `run.failed`, `run.cancelled`, `run.interrupted` | The turn fails or stops |

## What a remote harness does not get

- No secret but its own key: no channel or global secret, no install token, no thread token.
- No Omni MCP tools, browser, artifacts folder or design-system file. The thread's worktree is on Omni's machine for the local agents seated beside it: the remote agent never changes it, and reads it only through [the read call](#the-read-call), in a channel with **Remote agents can see this channel's work** on. The prompt says it talks only and works on its own clone.
- No inbound route: the server never calls Omni, so Omni opens no endpoint for it. The read travels inside the run's own stream and Omni's answer to it.
- No credential for the read. Omni keeps its grant in memory and answers on the server's behalf.
- A charter only when one was written for its agent: otherwise `instructions` carry only who it is and how the thread works, and the server's own instructions lead.
- No delegate-only role (the Conductor) and no level below Full access: Omni cannot take its tools away.

## The read call

The one tool Omni offers a remote agent: the thread's work, read-only (group threads slice 5, [ADR 0020](../adr/0020-remote-agents-are-agents.md)). It is optional on both sides: a server that ignores `tools` and never asks keeps working, and Omni offers it only in a channel with **Remote agents can see this channel's work** on. The code is `apps/server/worktree-read.ts`, with the definition and rows in `apps/server/harness/read-tool.ts`.

- **Offer.** On a run in an open channel, `POST /v1/runs` carries `tools: [{ name: "omni_worktree", description, parameters }]`, `parameters` being a JSON Schema: `{ action: "list" | "read" | "search" | "diff", path?, pattern? }`.
- **Call.** The server emits `tool.requested` with `call_id`, `name: "omni_worktree"` and `arguments` (an object, or JSON text), and waits. Omni answers with `POST /v1/runs/{id}/tool_result` `{ call_id, output, is_error }`, then reads on. `is_error: true` is a refusal, and `output` says why, starting `Refused:`.
- **Actions.** `list` names the tracked files, under `path` if given. `read` returns one file's text. `search` returns `path:line:text` for lines matching `pattern`, an extended regular expression (`git grep -E`), under `path` if given. `diff` returns the changed-file list and the diff of the worktree against the thread's base commit, as Changes compares it.
- **What it returns.** Git-tracked files only: untracked and ignored files read as absent, in every action and in the diff, so a file a local member made shows once it is staged or committed. Text only: a binary file (a NUL byte in its first 8,000 bytes) is refused. Up to 1 MB: a longer file, search or diff comes back cut to 1 MB with `[Cut to 1 MB of <size>: ...]` after it. Paths are relative to the worktree's root; one outside it, an absolute one, or a symlink that resolves outside it is refused.
- **The grant.** At the start of each of a remote agent's turns, Omni opens a grant: a random token in its memory, keyed to the thread, the turn and the worktree's path. The adapter keeps it beside the run id, and a call is answered with the grant of the run it names (its `run_id`, else the run whose stream carried it). The grant closes when the turn ends, so a call that names an ended run is refused, and a restart forgets every grant. It is never a thread token, and it is never sent: the server sees only answers.
- **Each read checks again** that the channel's switch is on and that the thread's worktree is still the one the grant was opened on, so turning the switch off refuses the next read of a turn already running.
- **In the thread.** Each call is a tool row under the agent's reply: Read, Glob (list), Grep (search) or Diff, with Omni's answer as its result. A seated member's rows carry its name, as its replies do.
- **No writes.** Git runs read-only: no optional locks, no fsmonitor, no external diff driver or textconv.

## Pairing

How a server hands Omni its key without anyone pasting it ([Connect an agent](../plans/2026-11-18-connect-an-agent.md), decision F2). The agent's owner makes a one-time code where only they can see it (the server's terminal, a platform's logs). Omni's server redeems it, server to server, and puts the key straight into its secret store. The agent never calls Omni, so only Omni-to-agent reachability is needed, which runs need anyway. Both calls are optional: a server without them is connected with a key from Secrets.

| Call | Request | Answer |
| --- | --- | --- |
| `GET /v1/omni/pair` | | 405, which tells Omni the route is there. The body may offer `{ name, description, code_url, avatar }`: what the sheet shows before signing in, the page (on the same host, relative or absolute) where the owner gets a code, and the agent's [avatar](#the-offered-avatar). Omni reads it for eve agents |
| `POST /v1/omni/pair` | `{ code, client_id, client_name }`, no `Authorization` | 200 `{ protocol, key, key_id?, url?, name?, kind?, shared_key?, revoke? }`; 404 for a code that is unknown, used or expired (the same answer for all three); 429 after repeated misses from one address |
| `POST /v1/omni/revoke` | `{ key_id }`, with the key as the bearer, at the pairing address | 204, after which the key no longer works. Only when the pair answer said `revoke: true` |

- **The code** has at least 128 bits, works once, lives at most 10 minutes and is held only as a hash, compared in constant time. Omni sends it as typed: the server ignores case, dashes and spaces.
- **`client_id`** is the machine's id and **`client_name`** "Omni on <machine>", so the agent can list who paired.
- **The answer**: `key` is the bearer key for every Runs API call. `url` is where runs go when that is not the address Omni paired at; Omni takes it only on the pairing address's own host. `name` is shown with the host, never alone. `shared_key: true` says every machine that pairs gets this same key (so it cannot be revoked for one alone, and a second machine gets it sent sealed instead of pairing again, decision F7). `revoke: true` says `/v1/omni/revoke` works.
- **Omni's side** follows the transport rules above: https, or plain http only to this machine or the tailnet; no redirects; the pairing address and `url` on the host Ben typed or the link named.

### The pairing link

`omni://connect-agent?url=<runs url>&code=<code>[&pair=<pairing address>][&name=<name>]`, with each value percent-encoded. `pair` is left out when the server pairs at `url` itself. The desktop app opens it as the page `#/connect-agent?...`, which opens Add remote agent in Settings > Agents with the fields filled in; a browser or phone takes the same link pasted into the sheet. Opening a link never connects anything: Ben presses Connect.

### Hermes: the pairing helper

Hermes's API server has no pairing route and takes one key per profile (`API_SERVER_KEY`), so `scripts/omni-pair.sh` answers the pairing call for it. Run on the Hermes host, it reads `$HERMES_HOME/.env` (default `~/.hermes/.env`; `--profile <name>` reads `~/.hermes/profiles/<name>/.env`), makes `API_SERVER_KEY` when there is none, and listens on the API server's port plus one for at most 10 minutes and one redeem. It prints the link, a terminal QR code when `qrencode` is installed, and the address and code to type. Its answer carries the profile's key with `shared_key: true` and `revoke: false`. Flags are at the top of the script; `--json` prints one line for scripts. Install it pinned to a release:

```sh
curl -fsSL https://raw.githubusercontent.com/ben-askphill/omni-os/<release tag>/scripts/omni-pair.sh | sh
```

### The offered avatar

The agent Omni makes on Connect takes the avatar the server offers, so it looks the same everywhere it is used. An eve agent offers it in its pairing offer (`avatar` in the `GET /v1/omni/pair` 405 body, no key needed); a Runs API server in its signed-in `GET /v1/capabilities` body.

- **The value** is a data URL, `data:image/png;base64,...` (PNG, JPEG or WebP), square, at most 256px a side and 256 KB decoded. Omni reads at most that much of the body. Anything else is not taken: the agent gets the initials disc, and Find says why.
- **Saved** inline in the agent's file, as an uploaded avatar is, with `avatar_offered:` and a short hash of the image, so it syncs with the file.
- **Read again** on every passing Test connection. A new offer replaces the avatar only while it is still the one the server offered: once Ben sets his own in the agent's Identity block, the offer is ignored.

## eve agents

An eve agent (`kind: eve`) is spoken to through eve's default HTTP channel, the API eve's own web chat and terminal use. The client is `apps/server/harness/eve/client.ts`; it presents the same calls as the Runs API client, translating eve's stream into the events above, so the adapter, the test turn and the transcript are shared. The fake the tests run against is `apps/server/tests/fake-eve.ts`.

| eve call | Omni's use |
| --- | --- |
| `GET /eve/v1/health` | Find, without a key: a 200 means an eve agent answers here |
| `GET /eve/v1/info` | The availability probe, with the key: 200 up, 401 or 403 the key refused. It costs no model call, and names the model for the test |
| `POST /eve/v1/session` `{ message, operationId, clientContext? }` | A thread's first turn. `operationId` is the message's uuid, so a retry returns the same session. `clientContext` carries Omni's prompt. The answer's `sessionId` becomes the thread's session id, `omni-eve-<sessionId>` |
| `POST /eve/v1/session/{id}` `{ message, turnPolicy: "queue" }` | Every later turn. A 409 (the session ended) starts a new session instead |
| `GET /eve/v1/session/{id}/stream?startIndex=-1&includeTailIndex=1` | Before a later turn: the tail index, so the run reads from the next event on |
| `GET /eve/v1/session/{id}/stream?startIndex=<n>` | The run's events, NDJSON. A reconnect reads the run from its start again; the adapter skips what it has seen by `seq` (the stream index) |
| `POST /eve/v1/session/{id}/cancel` | Stop |
| `POST /eve/v1/session/{id}/reset` | Retires the test turn's session after Connect's test |

- **A run is one turn**: events count from the run's first `turn.started`; a terminal event before it belongs to the turn before and is skipped.
- **Mapping**: `message.appended` is reply text and `message.completed` its finished block; `actions.requested` and `action.result` are tool rows (subagent calls are task rows); `step.started` names the model and `step.completed` adds up the tokens; `turn.completed`, `turn.failed` and `turn.cancelled` end the run. `input.requested` and `authorization.required` become a status line saying to answer in the agent's own chat; a turn that parks on one ends at `session.waiting` with what it said so far.
- **The read call**: eve has no client-side tools, so an eve agent serves an `omni_worktree` tool of its own whose call parks the turn for input: an `input.requested` request whose `action.toolName` is `omni_worktree`, with the call's arguments as `action.input`, of kind `question` with `allowFreeform`. Omni answers it like [the read call](#the-read-call), as eve's structured response on the session, `POST /eve/v1/session/{id}` `{ inputResponses: [{ requestId, text }] }`, which never steers, and the parked turn goes on: its `session.waiting` is not the run's end. Omni draws the call's tool row itself, so the agent's own `actions.requested` and `action.result` for it are not drawn. Nothing tells an eve agent which turns allow reads: in a closed channel its call is refused and says why.
- **No steer**: eve's steer cancels the running turn and starts another, so `kind: eve` has steering off and a message sent mid-turn waits for the next turn.
- **Signing in**: eve has no key of its own; each agent's route auth decides. To pair, the agent serves `GET` and `POST /v1/omni/pair` and `POST /v1/omni/revoke` at its root (not under `/eve/v1`, which eve owns; a Next.js app with `withEve` serves them as route handlers, since only `/eve/v1/**` reaches the eve runtime there), shows codes on a page behind its own sign-in, and accepts the key it hands out in its `eveChannel` auth. Nomos (`ben-askphill/nomos`: `agent/lib/omni-pairing.ts`, `app/v1/omni/`, `app/omni/`) is the reference: stateless HMAC codes (a nonce and an expiry, used once), keys `omni_<id>_<hmac>`, and a revoked list.
- **Vercel's login wall** (Vercel Authentication) redirects every path to `vercel.com/sso-api`. Find says how to turn it off for production instead of calling the agent unreachable.

## Later additions

Each is optional, so a server that does not serve it keeps working. Planned in [Addendum A of the crew plan](../plans/2026-11-18-user-defined-crew.md): a capabilities body on `GET /v1/capabilities` (protocol version, flags, models, model family), a `git` block on `POST /v1/runs` and a `git.pushed` event (B3), `usage.cost_usd` on the terminal event (B4), and answers through `/approval` (B5).
