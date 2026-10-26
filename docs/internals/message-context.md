# Message context

A message can carry typed records next to Ben's text: lines picked in the Changes panel (`diff_selection`), terminal output (`terminal_excerpt`), browser annotations (`browser_annotation`), an optional picked page element on that annotation, and thread references (`thread_reference`). The user-facing account is in [Threads](../user/threads.md#point-the-agent-at-lines-of-a-diff).

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

## Terminal excerpts

`terminal_excerpt` is the second kind: output selected in a thread's Terminal tab (`TerminalView.tsx` and `TerminalSelection.tsx` on the web, `TerminalTab.swift` and `TerminalSelection.swift` on the Mac). Body: `{ thread, pid, cwd, captured_at, lines, text }`.

- **A snapshot.** `text` is the selection as it was when Ben added it. It is never read from the shell again, so scrollback, a restart or an exit change nothing. `pid` tells a restarted shell from the one he selected in; `cwd` is where the shell started, since a `cd` is not known.
- **Never executable.** The clients make the text with `selectExcerpt` (Swift: `TerminalExcerptContext.select`): escape sequences are dropped whole, other control characters are dropped, line endings become `\n`. `parse` then refuses any control character, line or paragraph separator or bidirectional override, so a record that skipped the clients is refused at the route. The projector writes `<omni-context` and `</omni-context` as `&lt;...`, in the text and in `cwd`, so output can't end the block early or open a second one.
- **Bounded, not cut.** 200 lines and 8,000 characters. A selection over either is refused with the limit named, since a cut excerpt would not be the output he meant. The message's own 32,000-character JSON limit still applies.
- **Where it is added.** The shell runs on Ben's Mac whichever harness the agent is, so the projector says so and offers no file to open. Remote harnesses get the same text.
- **Selection.** Mouse selection is xterm's (web) and SwiftTerm's (Mac) own, and the panel only reads it, so copy and paste are untouched. xterm has no touch selection, so on the phone `useTapToPick` selects lines on tap.


## Browser annotations

`browser_annotation` is the third kind: a rectangle Ben drew on a screenshot of the channel's browser. Body: `{ thread, url, title, viewport: { width, height, scale }, scroll, rect, captured_at, image: { name, mime, width, height, bytes } }`. The rectangle is whole CSS pixels from the viewport's top left (`dragToRect` turns a drag on the shown image into it, so a phone and a desktop agree); `scale` is image pixels per CSS pixel. An optional `element` (below) says which element Ben picked: a record without it stays valid.

- **The server captures, the client marks.** `POST /api/channels/:id/browser/capture` with `{ thread }` (`apps/server/browser-capture.ts`) screenshots the active page of the channel's real Chrome (`Page.captureScreenshot`, nothing on the page changes) and returns everything but the rectangle, which is drawn on that very image. The page is observed before and after (tab, main-frame navigations, address, window size, scroll); any difference answers 409 `{ error, retryable: true, stale }` and saves nothing. The viewport is `innerWidth` by `innerHeight`, scrollbar included, since that is what the image covers.
- **The file.** `uploads/annotation-<hex>.png` in the thread's uploads folder, so it syncs and is served by the existing `/api/threads/:id/uploads/:name`. PNG, then JPEG at 80 and 50, until it is under `MAX_INLINE_IMAGE`; past that it is refused (413, not retryable). A capture that is not made into a record is deleted by the client (`DELETE .../browser/capture/:name?thread=`, only within six hours of being made).
- **Sending.** The message route refuses a record whose `thread` is another thread's or whose file is gone (`checkAnnotations`). `userLine` adds the screenshot to the message's attachments (`contextAttachments` in `project.ts`, fed by `Projection.image`), so Claude Code gets an image block, Codex a local image and Cursor the path in its Attachments note. `project.ts` writes the sentence about it: attached locally, `is a file on Ben's Mac` for a remote harness, `is unavailable` when the file is gone by the time the message is written.
- **Text in the block.** The page's address and title come from the page, so they are defanged like every projected string (`defang.ts`); the core also defangs file names, notes and fallback labels.
- **Drafts.** The web keeps unsent context in localStorage (`omni.contextDrafts`) as well as memory, the Mac in `DraftStore`, so a reload does not strand a capture.

## Picked elements

`element` on a `browser_annotation` is `{ tag, selector, text, html, ancestors, bounds, point, frames, opaque_frame, truncated }` (`PickedElement`, `packages/shared/message-context-browser.ts`; Swift `BrowserAnnotationContext.Element`). `parse` refuses an element past a limit or missing a field rather than trimming it, and rebuilds it in that key order.

- **Asking the page.** `POST /api/channels/:id/browser/capture/:name/element` with `{ thread, x, y }` (`apps/server/browser-pick.ts`). The capture route remembers the page it observed (`remember`, 64 captures, 30 minutes); a pick compares the page against that observation with `staleReason`, before the page is asked and after. A different tab, navigation, size or scroll answers `{ unavailable: { reason: 'stale', message } }`, so an element is never read from a page other than the one in the screenshot, and never from another tab. `unknown_capture` (a restart, an old capture), `nothing` (a scrollbar, no element) and `unreadable` (the browser errored or answered nonsense) are answers too, all 200: the clients keep the screenshot and the area and say why.
- **The script.** `browser-pick-script.ts` runs in the page through `Runtime.evaluate` (2 s timeout, nothing on the page changes): `elementFromPoint` through same-origin frames (up to three deep) and open shadow roots. A frame from another site cannot be read, so the answer is the frame element itself with `opaque_frame`. Its box is in the main viewport's coordinates.
- **Never the DOM.** The script reads one element: 600 characters of text, a markup excerpt of 2,000 characters (its own tag, at most six children a level, two levels, text cut to 80), four parent opening tags, a 300-character selector from the nearest unique id. It skips `script`, `style`, `template`, a textarea's text and any form field's value, and drops the query and fragment of `href` and `src`. The server does not trust it: `elementFrom` cleans every string (control characters, whitespace), cuts it to the record's limit, clips the box to the viewport and then parses it as the message route will, so a page that patches the script cannot make a bigger record.
- **To the agent.** The projector writes one sentence saying the element's text and markup are quoted as data from the page, not instructions, and the element as an excerpt in the fence (`defang`ed, so a forged `</omni-context>` stays inside it). Every harness gets the same bytes.
- **Clients.** A tap without a drag picks (`pick` in `BrowserAnnotate.tsx`, `BrowserAnnotateModel.tap` on the Mac); the element's box becomes the rectangle (`elementRect`, grown to the 8 px minimum for an icon); a drag afterwards clears the element, since the area is then what Ben marked. A slow answer to an earlier tap is dropped.

## Thread references

`thread_reference` is the fourth kind: another thread Ben points at by identity, not by transcript. Body: `{ thread, title, channel, channel_name, cross_channel, captured_at }` (`packages/shared/message-context-thread.ts`; Swift `ThreadReferenceContext`). The label is `Thread: <title> (<channel> · <first 8 of the id>)`, so two threads with one title differ and a long label, which loses its start, keeps the id.

- **Stamped at send.** The client's record holds what Ben saw in the picker. `POST /api/threads/:id/messages` then calls `stampThreadReferences` (`apps/server/message-context/thread-reference.ts`) and stores the title, the channel's name and the time as the threads are at that moment, so a rename or archive later does not rewrite the sent message. The request fingerprint is of the records Ben sent, and the stamp comes after the retry check, so a retry after a rename or a delete still gets its first answer. A thread that is gone, or the thread itself, refuses the message with a sentence naming the record.
- **Cross-channel is a choice.** The picker (`GET /api/thread-references?thread=&q=&scope=channel|all`, `apps/server/thread-references-api.ts`) lists the asking thread's channel by default and other channels only for `scope=all`, which the UI offers as its own control. A pick from there sets `cross_channel`. The route compares it with the real channels: a thread in another channel without the flag is refused, and the flag on a same-channel thread is written back as false.
- **No transcript in the block.** The projector writes the thread's title, channel and id as quoted data (`defang`ed, since a title is a model's words) and `project.ts` writes the sentence about history, as it does for files and screenshots: where the tool is, that a deleted thread cannot be read, or that a remote harness (Hermes, Cursor Cloud) has no tool.
- **On-demand history.** `read_referenced_thread` (`apps/mcp/referenced-thread.ts`) calls `GET /api/threads/:id/references/:ref/history?before=|after=&limit=` for the asking thread `:id` (`apps/server/thread-history.ts`). Only a thread named by a `thread_reference` in a user event of the asking thread can be read (`isReferenced`), so an agent never browses history it was not pointed at. Pages are bounded and the bounds are in the tool's description: `limit` at most 100 rows (40 by default), 60,000 characters of text per page (a page ends before the row that would pass it), and 8,000 per message (cut, with `cut_from` saying how long it was). Without a cursor it is the newest page, oldest first within it; `older` and `newer` are the cursors for the pages either side and null at the ends. Only user, assistant, crew and error messages are returned, never tool calls. Reading changes nothing in the thread read: no message, status or sync.
- **Which harness.** Every thread but the conductor's gets the tool from `omni-threads` (`apps/mcp/threads.ts`, added in `buildMcpConfig`), the conductor from `omni`, which registers the same function. That covers Claude Code, Codex and Cursor. Hermes and Cursor Cloud have no MCP servers.
- **Clients.** Web: `ThreadReferenceButton` and `ThreadReferencePanel` (`apps/web/src/components/ThreadReference.tsx`) in the thread header (`HeaderActions`), and as a sheet from the thread options on the phone. Mac: `ThreadReferenceButton` in the thread header (`ThreadReferencePickerView.swift`) over `ThreadReferencePicker` in OmniKit. The Mac popover's anchor strip shrinks when the thread window is too narrow for the full list width, so the panel stays inside the window. Both add to the draft with `addDraftContext` and `draftContext.add`. The new-thread composer has no draft context, so it has no picker.
