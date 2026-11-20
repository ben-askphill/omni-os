# eve agents: Omni speaks eve's own API

Vercel's eve framework runs durable agents that each serve the same HTTP API (`/eve/v1`: sessions, an NDJSON event stream, cancel). Nomos, Ben's assistant, is one. Omni's Connect sheet found eve agents by their health route but could not run threads on them: custom harnesses spoke only the Runs API ([ADR 0017](0017-custom-harnesses.md)). Ben wanted to paste an eve agent's URL and connect it with one plain sign-in step, with no Vercel connector or API.

## Decision

- **An eve adapter in Omni, not a Runs API shim in each agent.** A custom harness file can say `kind: eve`. `harness/eve/client.ts` speaks eve's API and presents the same calls as the Runs API client (`harness/remote.ts` picks one by kind), translating eve's stream into Runs API events. The adapter, the test turn, the probe and the transcript stay one path.
- **eve names the session.** A thread's first turn creates an eve session; the thread keeps `omni-eve-<eve session id>` as its session id (the adapter takes a `session_id` back from `createRun`), so later turns and a restart continue it. A run is one turn, read from the stream's tail index at send time.
- **No steer.** eve's steer cancels the running turn and starts another, so `kind: eve` has steering off and a mid-turn message waits. Approvals and OAuth sign-ins eve asks for show as a status line; Omni does not answer them yet.
- **Sign-in is the existing pairing protocol, served by the agent.** eve has no API key of its own: each agent's route auth decides who may call it, and Nomos's web chat uses a signed cookie or bearer and Vercel OIDC. The agent serves `POST /v1/omni/pair` and `/v1/omni/revoke` at its root, offers a code page behind its own sign-in (`GET /v1/omni/pair` answers 405 with `code_url`), and accepts the key in its `eveChannel` auth as the signed-in owner. Omni's Connect sheet shows **Get a code** for it. An agent without the route connects with a key from Secrets taken as a bearer.
- **Vercel's login wall is the agent's to drop.** Vercel Authentication blocks everything outside Vercel; Find recognizes its redirect and says to turn it off for production, so the agent's own sign-in guards it. Nomos fails closed when deployed without its web password.

## Considered

- **A Runs API shim inside each eve agent** (a custom channel serving `/v1/runs`). Omni would not change, but every eve agent would carry a translation layer to keep in step with eve, and `withEve` deployments route only `/eve/v1/**` to the eve runtime, so the shim could not even live at the protocol's paths there.
- **A pairing helper like `omni-pair.sh`.** It answers for Hermes because Hermes runs on a host with a terminal and one static key. An eve agent on Vercel has neither: no terminal to run it in, and no key to hand over until the agent mints one.
- **Signing in with the web chat's password.** Omni would hold Ben's password and a 30-day session token that it would have to renew, and every eve agent signs in differently.
- **Vercel OIDC or the deployment-protection bypass secret.** Both tie Omni to Vercel's own credentials, which Ben ruled out.
- **eve's steer.** It cancels and restarts the turn, which reads as a lost turn in a thread; queueing matches how Omni treats Cursor Agent.

## Not yet

Answering eve's approvals and questions from the thread (`inputResponses`), sending attachments as eve file parts, a shared eve extension that any agent can install for the pairing routes, and showing an eve agent's skills and tools from `/eve/v1/info` in the sheet.
