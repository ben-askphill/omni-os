# Message context

A message can carry typed records next to Ben's text: lines picked in the Changes panel now (`diff_selection`), terminal output, screenshot annotations, picked page elements and thread references later. The user-facing account is in [Threads](../user/threads.md#point-the-agent-at-lines-of-a-diff).

## The record

`{ id, kind, v, label, note, body }`, under `context` on the request, the request row (`message_requests.context`), the transcript's user payload and the pending rows. The envelope never changes; a field added later is optional. `v` is the body's version for its kind. `label` is one line any client can show without knowing the kind.

- **The server is strict.** The route refuses an unknown kind, a newer `v`, a bad body, a repeated id and anything over the limits (`packages/shared/message-context.ts`). It recomputes `label` and the body's derived fields, and the record never changes after that.
- **Clients are lenient.** They read with `readContexts` (Swift: `ContextReading.read`) and never throw. A kind they don't have, a newer `v` or a body that doesn't parse shows as a fallback chip with the label and note. On the Mac, `MessageContextList` can't fail a user event or a thread detail.
- **The agent gets text, built when the message is written to the harness** (`userLine` in `runner/state.ts` calls `harnessText`). Claude Code, Codex and Cursor read the same `<omni-context>` block, with no adapter code. A queued message is checked against the file when it is sent, not when it was accepted. Hermes and Cursor Cloud are told the file is on Ben's Mac and they can't open it; only `apps/server/message-context/project.ts` writes those sentences, so a kind can't present a remote path as local.
- **Sync** carries records inside the user event's payload. `message_requests` stays local. A queued message handed to the other Mac carries its records as text.

## Adding a kind

One file per layer and one registry line per layer. Nothing in the core changes.

| Layer | New file | Registry line |
| --- | --- | --- |
| Shared | `packages/shared/message-context-<kind>.ts` | `CONTEXT_KINDS` in `message-context-kinds.ts` |
| Server | `apps/server/message-context/<kind>.ts` | `SERVER_KINDS` in `apps/server/message-context/kinds.ts` |
| Web | `apps/web/src/message-context/<kind>.tsx` | `CONTEXT_VIEWS` in `apps/web/src/message-context/kinds.ts` |
| Mac | `OmniKit/<Kind>Context.swift` and `Omni/<Kind>View.swift` | `contextViews` in `apps/mac/Omni/ContextViews.swift` |

- The shared file defines the body type, `parse` (strict, rebuilds the body in a fixed key order) and `label`.
- The server file is a `Projector`: a title, an optional repo-relative file, an optional check, an optional excerpt. Return no `file` for something that isn't one.
- The web and Mac files give an icon and a detail view. The chip, the inspector, the fallback and the draft store are shared.
- `SERVER_KINDS` and `CONTEXT_VIEWS` are typed over `CONTEXT_KINDS`, so a kind added to the shared table without them fails typecheck. The Mac has no such check: add records of the new kind to `packages/test-fixtures/message-context.json`, which the TypeScript and Swift tests both read.
- The producer (an "Add to message" in the panel that makes the record) calls `addDraftContext` on the web and `ThreadStore.draftContext.add` on the Mac.
