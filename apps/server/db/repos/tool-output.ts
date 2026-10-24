import { db } from '../connection.ts';

// The reads behind compact tool results and chunked output (apps/server/tool-output.ts). Each is one read of a row by
// primary key whose text SQLite cuts itself, so a multi-MB result never reaches JavaScript whole. `substr` and
// `length` count code points, which is the unit of every offset on the wire. tests/tool-output.test.ts reads the plans.

/** The stored text, pulled out once: a CTE that is not materialized would parse the payload for every use. */
const TEXT = `WITH t AS MATERIALIZED (
  SELECT id, thread_id, created_at, payload, json_extract(payload, '$.text') AS text
  FROM events WHERE id = ? AND kind = 'tool_result'
)`;

export const TOOL_OUTPUT_SQL = {
  /** The payload without its text, the text's first `?` code points, its length and its line breaks. */
  head: `${TEXT}
  SELECT id, thread_id, created_at, json_remove(payload, '$.text') AS rest, substr(text, 1, ?) AS head,
    length(text) AS chars, length(text) - length(replace(text, char(10), '')) AS breaks
  FROM t WHERE text IS NOT NULL`,
  /** `?` code points of the text from the 1-based position `?`, with what a chunk reports about its row. */
  chunk: `${TEXT}
  SELECT id, substr(text, ?, ?) AS text, length(text) AS total, substr(text, 1, 32) AS lead,
    json_extract(payload, '$.tool_use_id') AS tool_use_id, json_extract(payload, '$.is_error') AS is_error,
    json_extract(payload, '$.truncated') AS truncated
  FROM t WHERE thread_id = ? AND text IS NOT NULL`,
} as const;

/** A stored tool_result's text, cut at the preview: what a compact row is made of. */
export interface StoredHead {
  id: number;
  thread_id: string;
  created_at: string;
  /** The payload's other fields, as JSON. */
  rest: string;
  head: string;
  chars: number;
  breaks: number;
}

export interface StoredChunk {
  id: number;
  text: string;
  total: number;
  /** The text's first 32 code points, for its exit code. */
  lead: string;
  tool_use_id: string | null;
  is_error: number | null;
  truncated: number | null;
}

/** SQLite throws on a payload that is not JSON; such a row has no text to read. */
function read<T>(run: () => unknown): T | null {
  try {
    return (run() as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export const toolOutput = {
  /** The row's text cut at `preview` and its size, null when it is not a tool_result with text. */
  head: (id: number, preview: number) => read<StoredHead>(() => db.prepare(TOOL_OUTPUT_SQL.head).get(id, preview)),
  /** `limit` code points of the row's text from `offset` (0-based), null when the thread has no such tool_result. */
  chunk: (threadId: string, id: number, offset: number, limit: number) =>
    read<StoredChunk>(() => db.prepare(TOOL_OUTPUT_SQL.chunk).get(id, offset + 1, limit, threadId)),
};
