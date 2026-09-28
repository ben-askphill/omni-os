# Hermes threads run on a remote API, not a local CLI

Hermes Agent is an always-on process on a Linux server. It already has a checkout, tools and a long-lived conversation. Omni reaches it through the Hermes API server (HTTP, `Authorization: Bearer`) over Tailscale. The server listens on its tailnet address and is not public. The base URL is config (`OMNI_HERMES_URL`, default `http://100.110.128.38:8642`); the Mac must be on the tailnet. The bearer token is the Keychain secret `HERMES_API_KEY`. It is not stored in the database, an env file or a log.

The runner still wants a child process per thread, for queueing, steer, interrupt and keepalive. Hermes has no local CLI, so the adapter holds a dummy process open (the same shape Cursor uses for one process per turn) and does the real work with HTTP. A stable session id, `omni-<thread id>`, is what continues the conversation: Hermes keeps the context, and a second run on that id sees the first.

## Consequences

- A Hermes thread does not get an Omni worktree, browser profile or artifacts directory. Those exist only on the Mac. The system prompt names the channel's repo, store and notes, and tells Hermes to work on its own clone and open PRs. `OMNI_ARTIFACTS_DIR` is not a path it can write to; artifacts come back as links or text.
- Attachments stay on the Mac. The message describes them and says they were not transferred. Uploading bytes is a later change.
- Steer is `POST /steer` while the run is going, and a queue when Hermes answers 409. Interrupt and killing the holder are `POST /stop`. The event stream is SSE; if it drops, Omni reads `GET /v1/runs/{id}` once rather than trusting a silent close.
- Every create sends `Idempotency-Key` (the message uuid) so a retry cannot start a second run. HTTP 429, the server's own concurrency cap, is backed off and retried with the same key.
- The plan meter stays empty. Token counts and the serving model ride on the run's result. This bills the Anthropic API, not Ben's Claude, ChatGPT or Cursor plan.
- Availability is `GET /v1/capabilities` returning 200. No key, a 401 or an unreachable URL all look the same in the picker: set `HERMES_API_KEY` in Secrets and connect this Mac to Tailscale (`OMNI_HERMES_URL`, default `http://100.110.128.38:8642`).
