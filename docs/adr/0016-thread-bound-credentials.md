# A thread calls the API with a token of its own

Every guard on what an agent thread may do (the automation guard, the crew guard, who a message is from, who may answer a question card) read the `x-omni-thread` header that Omni's MCP servers and the `omni` command add. A call without it counted as Ben. Every local harness process also got the install token itself in `OMNI_TOKEN`, so any shell an agent ran could leave the header off and act as Ben: create and run automations from an automation's own thread, post a message that counts as his answer, start a thread with no parent and so no automation above it, or trade the token for a device session. Security audit run 1, finding 12, reported it. The design is the proposal "Thread-bound credentials" (claude.ai artifact A7GPvongi9iKS4c7s4Fjs2). This record covers its parts 1 and 2. Part 3, an OS sandbox for unattended threads, comes later.

## Decision

- **A token per spawn.** Each time the runner spawns a thread's local harness (Claude Code, Codex, Cursor Agent), it mints `omt_` and 32 random bytes (`apps/server/thread-tokens.ts`). The server keeps only its SHA-256, in `thread_tokens`, a machine-local table no sync handler reads. The token is revoked when that spawn's process exits, when the thread's next spawn mints its own, when the server starts (no harness process outlives the server that spawned it), and with the thread. Hermes and Cursor Cloud run elsewhere and get none.
- **The same names, a different value.** The process gets the token as `OMNI_TOKEN`, and its MCP servers read it from the file `OMNI_TOKEN_FILE` names, `data/threads/<id>/token` (0600, not a folder that syncs). Skills, prompts and the tool-failure policy that say `$OMNI_TOKEN` keep working. The harness environment never carries the server's own `OMNI_TOKEN`, `OMNI_TOKEN_FILE` or `OMNI_MCP_TOKEN` (`harness/env-guard.ts`).
- **The server decides who is calling.** `request-guard.ts` takes a live thread token only straight from this machine, sets `omniAuth` to `{ via: 'thread', thread }`, and refuses a request whose `x-omni-thread` header names another thread. `callerOf` (`automation-guard.ts`) answers every guard: the token's thread, else the header from an install-token caller (it still only narrows), else nobody, which is Ben.
- **What a thread token cannot do.** Its messages are the Conductor's. It cannot answer a question card. A thread it creates or starts as a team files under it: no parent means the caller, and a parent outside its lineage is a 403. It cannot open a terminal or add, change, run or retry a channel action (the shell routes of #820, so the Conductor's `run_channel_action` is refused from a thread), approve, edit or delete a channel learning, change a channel's access levels or take back a grant, edit, cancel, reorder, steer, resume or drop a thread's queued messages, turn a quick ask into a task (which starts with no parent), approve an MCP client, finish setup, pair a browser, mint an app pairing code, ask for a desktop nonce, link or unlink Google, or turn auto-merge on. From a thread under an automation or a usage scan it also cannot rotate the install token, continue, fork, message, compact, retry, start fresh, resume, relay page comments to or send review notes to a thread outside its automation and usage scan, or start a PR review. Any thread token asks questions only on its own card, since Ben's answer on another thread's card counts as his say there.
- **The `omni` command in an agent's thread** (`OMNI_THREAD_ID` and `OMNI_THREAD_DIR` set, which only a harness process gets) uses `OMNI_TOKEN`, `OMNI_TOKEN_FILE` or the thread folder's `token` (Codex's shell drops variables named like a token), and never falls back to a data folder's `api-token`. With none it sends nothing and exits 3. Ben's thread terminal and channel actions name the thread but get no thread folder, so they keep the install's token. `omni doctor` names the token as the thread's own and does not hold it to the install's proof.
- **Unchanged:** Ben's clients, his terminal and the channel actions he starts, the external MCP, and `x-omni-thread` from an install-token caller (older binaries, scripts).

## Defaults where the proposal left a choice

Ben picked the least disruptive option for each.

- **Continuing a thread, and review notes to a new delegate,** make a thread whose lineage runs through the thread acted on, not the caller. Only a thread under an automation or a usage scan is held there, to threads under the same automation and scan, so the Conductor still continues any thread Ben names and a run's thread may continue the run itself.
- **Rotating the install token** stays open to a thread token outside unattended lineages, so the Conductor's `rotate_install_token` keeps working.
- **Ending another device's session** (`revoke_signed_in_device`) stays open to a thread token, as it was to the install token.

## What this does not close

- A thread that reads `data/api-token`, another thread's token file or `omni.db` from disk on purpose. The tokens close the paths Omni gives a thread; the OS sandbox (part 3) is what keeps an unattended thread from the files.
- Channel secrets and harness logins in the thread's environment, which `env-guard.ts` passes on purpose.

## Considered

- **An HMAC of the thread id, or a signed token with claims.** Neither can be revoked per spawn without the table this keeps, and both break when the key rotates.
- **A new `OMNI_THREAD_TOKEN` variable.** Every skill and prompt that says `$OMNI_TOKEN` would need to change. The `omt_` prefix tells a script which token it holds.
- **Refusing the header from install-token callers.** It only ever narrows, so refusing it gains nothing and breaks older binaries.

## Consequences

- Rotating the install token no longer leaves running threads on a dead token.
- Plan PR #805 slice D2 (access levels, approval cards) relies on this: an approval card counts as Ben's answer only because a thread token cannot answer one.
- Audit finding 12 stays open until part 3 ships the sandbox for unattended threads.
