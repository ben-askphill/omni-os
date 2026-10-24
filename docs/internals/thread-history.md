# Thread history

A thread opens with its newest page of events. Older pages load as Ben scrolls up, and a search hit loads the page that holds it. The server side is `apps/server/history.ts` and `apps/server/db/repos/history.ts`. The shared rules (budgets, cursors, spans, the client's join) are in `packages/shared/history.ts`, and the Mac app ports the client half to `OmniKit/History.swift`.

`GET /api/threads/:id` without `?history=recent` still sends every event. The Conductor, tests and older clients read it that way, and the Mac app's "Copy Thread as Markdown" needs the whole thread.

## The routes

- `GET /api/threads/:id?history=recent`: the usual detail, with `events` cut to the newest page and its anchors, plus `history: { from, to: null, results_below }`.
- `GET /api/threads/:id/history?<cursor>`: `{ events, span }`. The cursor is `historyQuery` of a `HistoryCursor`: `before` and `after` bound it, `take=oldest` fills a gap upward, `at=<event id>` reveals one event.
- `GET /api/threads/:id/events/:eventId`: one row, never clipped. "Show all" on a clipped row reads it.
- `GET /api/search`: each hit carries `event_id`, the event of the thread's best body hit. It is `null` when only the title matched.

## The stream's catch-up

`GET /api/threads/:id/stream?after=<id>` opens with a catch-up (`apps/server/stream-catch-up.ts`), on the first connect and every reconnect alike:

- **Replay.** When the rows after `after` fit one page (`readAfter`: the oldest page after the cursor reaches the live end), they come one by one with their SSE ids. Then one `sync`: the detail `GET /api/threads/:id` answers with, with `events: []`.
- **Snapshot.** When they do not fit, or `after` is stale (not an id, or past the thread's newest row), no rows come. The `sync` carries the newest page in `events` and `history`, like `?history=recent`, and its SSE id is that page's newest row, unless that row is at or below `after` (a stale cursor), which a client may already have seen.
- Then the thread's last context reading, then live messages.

A client applies the sync in place of fetching the detail again: thread, pending, live, blocked, handoff, artifacts, children and team are the server's now. On a snapshot it calls `detachHead`, so the rows it held become an island with their cursors intact, then joins the page with `applyHead`, and moves its `after` to the page's newest row. Rows it batched before the sync go in first.

The stream subscribes to the bus before it reads the catch-up, so a row written in between is both queued and read. It remembers the ids the catch-up sent and drops their queued copies, and drops queued `thread`, `artifact` and `context` messages, which the sync and the context reading supersede. Every row it sends, replayed or live, is clipped to `rowBytes` like a page's. The size check reads payload sizes from the record header, so a gap too big to replay is never read whole. `apps/server/tests/stream-catch-up.test.ts` covers the races, the budgets, clipping and stale cursors.

## Budgets

`HISTORY_BUDGET` sets every limit. The numbers come from the largest real threads: 3,100 to 3,200 events, 4.8 to 6.5 MB of payload, about 80 turns.

- `rows: 300`. A turn averages about 40 rows, so a page holds about 7 turns. It also caps the rows a client folds per page, even when a turn is mostly status lines.
- `bytes: 256 KiB`. A turn averages about 80 KB of payload, about 95 KB encoded. A page is about 3 turns, about 1/30 of the old full open.
- `rowBytes: 32 KiB`. The runner caps a `tool_result` at about 20 KB (about 30 KB encoded), and `assistant_text` peaks at 8 KB, so normal rows never clip. Only abnormal rows do: a 3.5 MB `Write`, a 159 KB pasted log.
- `anchors: 16`, `anchorBytes: 64 KiB`. A real anchor is a 2 to 5 KB `init`, a 1 KB `result` or a 1 to 2 KB parent call.

The long fixture (`packages/test-fixtures/long-thread.ts`) records what this buys in `packages/test-fixtures/history/baseline.json`. The full open is 3,472 rows and 8.1 MiB. The head is 222 rows and 182 KiB, plus one 173-byte anchor. Thirteen pages reach the start, and the largest is 217 KiB. `apps/server/tests/history-budget.test.ts` checks the exact numbers. Record them again with `OMNI_RECORD_HISTORY_BASELINE=1` after a deliberate change.

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

A row whose encoded JSON exceeds `rowBytes` gets its payload rewritten. Every string longer than 2048, then 512, then 128 characters is shortened to a prefix and `…`, stopping at the first tier that fits. The last tier keeps only the top-level scalars of 128 characters or fewer. A payload that is not JSON, or still too big, becomes `{}`. The row gains `clipped: { bytes }`, the stored payload's size, and a boolean `truncated` becomes `true`.

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

## What builds on this

- #225 sends compact tool output. `GET /events/:id` is the full read on demand, and it is not bounded yet. Summaries for `tool_result` can replace clipping for that kind without changing paging.

## Seeding a long thread for QA

`OMNI_DATA_DIR=<qa data dir> npx tsx apps/server/scripts/seed-long-thread.ts [--turns N]` writes the long fixture into a new `inbox` thread titled "Long thread (seeded)", indexed for search, and prints its id. It works next to a running `scripts/qa-stack.sh` server.
