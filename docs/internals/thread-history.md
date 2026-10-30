# Thread history

A thread opens with its newest page of events. Older pages load as Ben scrolls up, and a search hit loads the page that holds it. The server side is `apps/server/history.ts` and `apps/server/db/repos/history.ts`. The shared rules (budgets, cursors, spans, the client's join) are in `packages/shared/history.ts`, and the Mac app ports the client half to `OmniKit/History.swift`.

`GET /api/threads/:id` without `?history=recent` still sends every event. The Conductor, tests and older clients read it that way, and the Mac app's "Copy Thread as Markdown" needs the whole thread.

## The routes

- `GET /api/threads/:id?history=recent`: the usual detail, with `events` cut to the newest page and its anchors, plus `history: { from, to: null, results_below }`.
- `GET /api/threads/:id/transcript`: the text transcript used by a continued thread's Carryover, separate from event paging. Referenced threads have their own bounded history route, described in [Message context](message-context.md#thread-references).
- `GET /api/threads/:id/history?<cursor>`: `{ events, span }`. The cursor is `historyQuery` of a `HistoryCursor`: `before` and `after` bound it, `take=oldest` fills a gap upward, `at=<event id>` reveals one event.
- `GET /api/threads/:id/events/:eventId`: one row, never clipped. "Show all" on a clipped row reads it.
- `GET /api/threads/:id/events/:eventId/output?offset=&limit=`: a chunk of a `tool_result`'s saved text (#225).
- `GET /api/threads/:id/tools/:toolUseId/tail`: the live tail of a running call (#225).
- `GET /api/search`: each hit carries `event_id`, the event of the thread's best body hit. It is `null` when only the title matched.

## The stream's catch-up

`GET /api/threads/:id/stream?after=<id>` opens with a catch-up (`apps/server/stream-catch-up.ts`), on the first connect and every reconnect alike:

- **Replay.** When the rows after `after` fit one page (`readAfter`: the oldest page after the cursor reaches the live end), they come one by one with their SSE ids. Then one `sync`: the detail `GET /api/threads/:id` answers with, with `events: []`.
- **Snapshot.** When they do not fit, or `after` is stale (not an id, or past the thread's newest row), no rows come. The `sync` carries the newest page in `events` and `history`, like `?history=recent`, and its SSE id is that page's newest row, unless that row is at or below `after` (a stale cursor), which a client may already have seen.
- Then the thread's last context reading, then live messages.

A client applies the sync in place of fetching the detail again: thread, pending, live, blocked, handoff, artifacts, children and team are the server's now. On a snapshot it calls `detachHead`, so the rows it held become an island with their cursors intact, then joins the page with `applyHead`, and moves its `after` to the page's newest row. Rows it batched before the sync go in first.

The stream subscribes to the bus before it reads the catch-up, so a row written in between is both queued and read. It remembers the ids the catch-up sent and drops their queued copies, and drops queued `thread`, `artifact` and `context` messages, which the sync and the context reading supersede. Every row it sends, replayed or live, is clipped to `rowBytes` like a page's, a `tool_result` made compact first. A connection whose reader falls `STREAM_QUEUE_MAX` (2,000) messages behind is closed, and its client reconnects into the catch-up above, so a reader that stopped costs a page at most. The size check reads payload sizes from the record header, so a gap too big to replay is never read whole. `apps/server/tests/stream-catch-up.test.ts` covers the races, the budgets, clipping and stale cursors.

## Budgets

`HISTORY_BUDGET` sets every limit. The numbers come from the largest real threads: 3,100 to 3,200 events, 4.8 to 6.5 MB of payload, about 80 turns.

- `rows: 300`. A turn averages about 40 rows, so a page holds about 7 turns. It also caps the rows a client folds per page, even when a turn is mostly status lines.
- `bytes: 256 KiB`. A turn averages about 80 KB of payload, about 95 KB encoded. A page is about 3 turns, about 1/30 of the old full open.
- `rowBytes: 32 KiB`. The runner caps a `tool_result` at about 20 KB (about 30 KB encoded), and `assistant_text` peaks at 8 KB, so normal rows never clip. Only abnormal rows do: a 3.5 MB `Write`, a 159 KB pasted log.
- `anchors: 16`, `anchorBytes: 64 KiB`. A real anchor is a 2 to 5 KB `init`, a 1 KB `result` or a 1 to 2 KB parent call.

The long fixture (`packages/test-fixtures/long-thread.ts`) records what this buys in `packages/test-fixtures/history/baseline.json`. The full open is 3,472 rows and 8.1 MiB. The head is 262 rows and 154 KiB, plus one 173-byte anchor. Thirteen pages reach the start, one of them cut mid-turn by the row cap, and the largest is 174 KiB. `apps/server/tests/history-budget.test.ts` checks the exact numbers. Record them again with `OMNI_RECORD_HISTORY_BASELINE=1` after a deliberate change.

`OMNI_HISTORY_BUDGET=rows:bytes:rowBytes` overrides the first three, read once at boot. It exists only for recording the Mac fixtures, where a short thread has to show a head, an older page, a reveal and a clipped row. Do not set it on a real install.

## Spans and cursors

A span is an id range `[from, to)` that a client holds completely. `from: 0` reaches the thread's start, and `to: null` reaches the live end. Event ids are global across threads, so a thread's ids have holes, and only spans can say two stretches touch. Ids only grow, so a closed span stays complete. No later row can land inside it.

`before` and `after` are exclusive, like the stream's `after`. A page edge that is not a request bound has a real row past it, so a gap a client shows is never empty when it appears.

Pages snap to turns. A newest page starts right after a `result`, and an oldest page ends on one. A turn bigger than the budget gives a partial page that cuts mid-turn. An `error` with no `result` joins the next turn for paging. A harness that writes no results gets mid-turn pages, which are still correct.

`at=H` reveals in one request. It reads from the start of H's turn (the newest `result` before H). When that page stops short of H, it reads from H itself.

## Anchors

A page also carries rows from outside its span that the clients' folds need. A client treats every held row outside its spans as an anchor: it informs the fold and never renders. Anchors are clipped like page rows and come in this order, within their budget:

1. Parent calls. A call nested under a call outside the page brings that call, recursively. A background agent's calls land turns after the agent started.
2. Answers. A question whose answer is outside the page brings the answer.
3. Session, head only. The newest `init` below the page when it has none.
4. Last result, head only. The newest `result` below the page when it has none.

A new kind (#209) pages like any other row. One that refers back to an earlier row adds a rule in `anchorsFor`. Three cross-edge effects have no rule and are accepted as rare: a cloud agent card whose run spans the floor, a handover that completes a switch across a gap, and a call in a revealed page whose result lies in the gap after it.

## Clipping

A row whose encoded JSON exceeds `rowBytes` gets its payload rewritten. A `tool_result` is made compact before it gets here (see Tool output), which leaves it far under `rowBytes`, so only the other kinds clip. Every string longer than 2048, then 512, then 128 characters is shortened to a prefix and `…`, stopping at the first tier that fits. The last tier keeps only the top-level scalars of 128 characters or fewer. A payload that is not JSON, or still too big, becomes `{}`. The row gains `clipped: { bytes }`, the stored payload's size, and a boolean `truncated` becomes `true`.

It is blind to kind. Ids, names, `parent`, `tool_use_id` and flags are short top-level fields every tier keeps, so grouping and nesting survive for kinds no client knows. Per-kind stubs could not cover those kinds. Clipping is deterministic, so an anchor and a page copy of one row are the same bytes. When a client holds two copies, the unclipped one wins.

## Reading

The page query selects `octet_length(payload)` and returns the payload only when it fits `rowBytes`. The size comes from the record header, so a multi-MB payload is read only when the page keeps its row, by primary key. That is at most `bytes / rowBytes` reads per page.

Every statement is a keyset read on an index. `history-budget.test.ts` runs `EXPLAIN QUERY PLAN` on each and fails on a `SCAN` or the wrong index. Two traps:

- Kinds are SQL literals, never parameters. SQLite uses a partial index (`events_result`, `events_init`, `events_call`) only when it can prove the query's kind matches.
- The call and answer lookups have no `ORDER BY id`. With one, SQLite reads the whole thread through `events_thread` to skip a sort. The repo sorts in JavaScript instead.

`events_call` indexes `json_extract(payload, '$.id')`, so inserting a `tool_use` whose payload is not valid JSON fails. `events.add` always stringifies.

## Clients

Both clients hold one `History` and fold it with its spans (`buildItems(events, spans)` on the web, `Transcript.update(_:spans:)` on the Mac). The traps that cost time:

- The stream's `after` moves only on the first load, on streamed rows and on a snapshot sync. An older page never moves it, or the replay would skip rows.
- "New activity" and follow-the-bottom key on `tailId`, not on the row count, so an earlier page never looks like new output.
- Web: the transcript sets `overflow-anchor: none` and `useScrollAnchor` restores the first visible `[data-key]` row itself, because phone Safari has no scroll anchoring. Without `none`, Chrome corrects a second time.
- Mac: `.scrollTargetLayout()` alone did not hold the row. At the top edge the lazy stack keeps its offset and the page pushes the row down, so `holdsTopRow` (`TranscriptAnchor.swift`) scrolls it back after the layout.
- A reveal (`?at=` on the web, `ThreadStoreRegistry.reveal` on the Mac) reads from the start of the hit's turn, so the hit's group folds as it would in the full thread.

## A thread held open

Live rows only add, so a thread left open while its agent works would hold every row it streamed (#411). After each live batch, `boundHistory` (`History.bound` on the Mac) checks `RETAIN`: once the client holds more than `rows + slack` (2,000) rows while Ben follows the newest, or `hard` (6,000) while he reads older ones, it drops the oldest down to 1,500. The cut goes at a turn start and keeps the anchors a head page would carry (parent calls, the newest `init` and `result`). The head span starts at the cut, `below` counts the dropped results, and "Earlier messages" loads them back. The slack makes it a step every 500 rows, not one per frame, which matters on the Mac: a span change lays the transcript out again.

The view says whether it follows: `useTranscriptScroll`'s `following` on the desktop, the newest turn being on screen on the phone, `ScrollPin.isPinned` on the Mac. Each sets `follows` on the history (`useThreadHistory`, `ThreadStore`).

The web fold still runs over every held row each frame, but no longer redoes the work for rows that did not change. `buildItems` parses each row's payload once (a `WeakMap` by row), and the transcript passes each fold through `keepSame`, which keeps an item the previous fold made when it is equal, so its memoized `ItemRow` skips rendering. The Mac's `Transcript.update` already lays out only the new tail.

`apps/web/tests/live-history.test.ts` streams 320 turns into an open thread and checks the bound, the turn count, the fold against the whole thread's, and loading the dropped rows back. `apps/web/tests/live-history-measure.test.ts` times each frame (`OMNI_MEASURE=1`, see its header). With the same 320 turns (13,764 rows), the last frames went from 0.8 ms to append, 10 ms to fold and 34 to 48 ms to render the desktop transcript, with 14,026 rows held and the heap growing from 54 to 264 MiB, to 0.02 ms, 0.2 ms and 1 ms, with 1,507 rows held and the heap ending at 85 MiB.

## Tool output

A tool's output is the bulk of a thread, and a client only needs it once Ben opens the row. So history never sends it whole (#225). Where the other kinds wait until they are too big, a `tool_result` is made compact as soon as its text is longer than `TOOL_OUTPUT.preview` (1,024 characters): `compactRow` in `apps/server/tool-output.ts` keeps the first 1,024 characters in `text`, sets `truncated: true` and adds `output: { chars, lines, exit_code? }` for what it left out. A result that fits travels as it was stored. A compact row is never `clipped`.

The stored row is never changed. Sync, `GET /api/threads/:id` without `?history=recent`, the Conductor and the brain export still read every character the runner saved. That is at most 16,000 characters: each harness's parser cuts the text there and sets the row's own `truncated`. #225 does not change what is saved.

- **Compact rows come from two places.** A row that fits `rowBytes` is cut in JavaScript (`compactRow`). A bigger one is cut by SQLite from its primary key (`compactStored`), so a multi-MB result never reaches JavaScript. The two give the same bytes. The stream's live rows go through `compactRow` in `liveMessage`.
- **Chunks.** `GET .../events/:eventId/output?offset=&limit=` returns `{ text, next, total, is_error, truncated, exit_code? }`: 16K characters by default, 64K at most. Offsets count code points, which is what SQLite's `substr` counts, so no chunk splits a character. A client sends `next` back as it is and never computes an offset. `truncated` is the saved text's own flag, for a note after the last chunk. Each read is one primary-key read (`tests/tool-output.test.ts` reads the plans).
- **The tail.** `GET .../tools/:toolUseId/tail` follows a call that prints while it runs. Its messages never go through the bus, which is what keeps a noisy command out of the global feed and every thread stream's queue. The server keeps the newest 32K units of each running call's output (`apps/server/tool-tail.ts`). A subscriber has a buffer of the same size: older output is dropped and counted in `skipped`, never queued, and a stream sends at most one message every 100 ms. At most 64 calls are tracked. A call ends with its `tool_result`, or with its thread's process. Closing the connection frees the subscription.
- **Which harness has a tail.** Codex reports a command's output as it runs (`item/commandExecution/outputDelta`), and its adapter now opens the command's row when the command starts, so there is a row to open while it runs. Claude Code, Cursor and Hermes report a tool's output only when it ends, so their tail says `end` with `live: false` and the open row keeps showing "Waiting for result".

A client mounts the output loader when the row opens and unmounts it when the row closes. It shows the preview at once, loads the first chunk, offers "Load more" for the next, and follows the tail while the call has no result. Closing the row cancels the chunk request, closes the tail connection and drops what it loaded. If a chunk fails, the row keeps its tool name, its error status and the preview, and offers Retry.

## Seeding a long thread for QA

`OMNI_DATA_DIR=<qa data dir> npx tsx apps/server/scripts/seed-long-thread.ts [--turns N]` writes the long fixture into a new `inbox` thread titled "Long thread (seeded)", indexed for search, and prints its id. It works next to a running `scripts/qa-stack.sh` server.
