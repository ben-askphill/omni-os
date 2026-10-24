// Compact tool results (#225): a tool_result travels in history pages and on the stream as its first
// TOOL_OUTPUT.preview characters and its size. The stored row keeps the whole text; GET .../events/:eventId/output
// reads it back in chunks. Why: docs/internals/thread-history.md.
import { TOOL_OUTPUT, exitCodeOf, type OutputChunk, type OutputMeta } from '@omni/shared/tool-output.ts';
import type { EventRow } from './db/repos/events.ts';
import { toolOutput, type StoredHead } from './db/repos/tool-output.ts';

const points = (s: string) => Array.from(s);

/** The row as transport carries it. The text becomes `head`, flagged `truncated`, and `output` says what was cut. */
function build(row: Pick<EventRow, 'id' | 'thread_id' | 'kind' | 'created_at'>, rest: object, head: string, chars: number, lines: number): EventRow {
  const exit = exitCodeOf(head);
  const output: OutputMeta = { chars, lines, ...(exit !== undefined && { exit_code: exit }) };
  const payload = JSON.stringify({ ...rest, text: head, truncated: true, output });
  return { id: row.id, thread_id: row.thread_id, kind: row.kind, payload, created_at: row.created_at };
}

/**
 * A tool_result whose text is longer than the preview, as the page and the stream carry it. Any other row, a short
 * result and one that is already compact come back unchanged. The same bytes as `compactStored` makes of the same row.
 */
export function compactRow<R extends EventRow>(row: R): R {
  // The JSON of a text is never shorter than the text.
  if (row.kind !== 'tool_result' || row.payload.length <= TOOL_OUTPUT.preview) return row;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(row.payload);
  } catch {
    return row;
  }
  const { text, ...rest } = parsed ?? {};
  if (typeof text !== 'string') return row;
  const chars = points(text);
  if (chars.length <= TOOL_OUTPUT.preview) return row;
  const lines = text.split('\n').length;
  return { ...row, ...build(row, rest, chars.slice(0, TOOL_OUTPUT.preview).join(''), chars.length, lines) };
}

/**
 * The compact row of a stored tool_result too big to load, cut by SQLite so its text is never read whole. Null when
 * the row has no text to cut (the caller clips it like any other row).
 */
export function compactStored(id: number): EventRow | null {
  const s: StoredHead | null = toolOutput.head(id, TOOL_OUTPUT.preview);
  if (!s || s.chars <= TOOL_OUTPUT.preview) return null;
  let rest: object;
  try {
    rest = JSON.parse(s.rest);
  } catch {
    return null;
  }
  return build({ id: s.id, thread_id: s.thread_id, kind: 'tool_result', created_at: s.created_at }, rest, s.head, s.chars, s.breaks + 1);
}

/**
 * One chunk of a tool_result's stored text, `limit` code points from `offset`. Null when the thread has no such
 * tool_result. A request past the end returns an empty chunk with `next: null`.
 */
export function readOutput(threadId: string, eventId: number, offset: number, limit: number = TOOL_OUTPUT.chunk): OutputChunk | null {
  const size = Math.min(Math.max(1, Math.floor(limit)), TOOL_OUTPUT.chunkMax);
  const from = Math.max(0, Math.floor(offset));
  const s = toolOutput.chunk(threadId, eventId, from, size);
  if (!s) return null;
  const text = s.text ?? '';
  const end = from + points(text).length;
  const exit = exitCodeOf(s.lead ?? '');
  return {
    event_id: eventId,
    tool_use_id: s.tool_use_id ?? '',
    offset: from,
    text,
    // An empty chunk before the end (a NUL cut the text short) must not make a client ask again.
    next: text && end < s.total ? end : null,
    total: s.total,
    is_error: !!s.is_error,
    truncated: !!s.truncated,
    ...(exit !== undefined && { exit_code: exit }),
  };
}
