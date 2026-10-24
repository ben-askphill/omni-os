// Tool output on the wire (#225): a tool_result row travels as a short preview and its size, the saved output is read
// in bounded chunks when a row opens, and a running command's output is followed through a bounded tail.
// Pure. The server builds these in apps/server/tool-output.ts and tool-tail.ts; apps/mac/OmniKit/Sources/OmniKit/
// ToolOutput.swift ports the client half. Why and how: docs/internals/thread-history.md.

/** Every limit on tool output in transport. Offsets and sizes are in code points unless a name says otherwise. */
export const TOOL_OUTPUT = {
  /** Code points of text a compact tool_result carries. A result that fits travels whole. */
  preview: 1024,
  /** Code points one chunk read returns unless the request asks for fewer, and the most it may ask for. */
  chunk: 16 * 1024,
  chunkMax: 64 * 1024,
  /**
   * UTF-16 units of a running call's output the server holds for one subscriber: what a client that joins late starts
   * from, and the most a slow one may have waiting. Older output is dropped and counted in `skipped`, never queued.
   */
  pending: 32 * 1024,
  /** Calls whose live output the server tracks at once. The oldest goes first. */
  calls: 64,
  /** Milliseconds a tail stream waits between two messages, so a noisy command arrives in a few large ones. */
  flushMs: 100,
  /** UTF-16 units of a tail a client keeps. */
  clientTail: 64 * 1024,
} as const;

/** What a compact tool_result says about its stored output, in `payload.output`. */
export interface OutputMeta {
  /** Code points of the stored text. */
  chars: number;
  /** Lines of the stored text: its line breaks plus one. */
  lines: number;
  /** From a leading "Exit code N" line, when the text has one. */
  exit_code?: number;
}

/** The tool_result payload: the stored one, or, with `output`, its compact form (`text` is only the preview). */
export interface ToolResultPayload {
  tool_use_id: string;
  text: string;
  is_error: boolean;
  truncated: boolean;
  output?: OutputMeta;
}

/** GET /api/threads/:id/events/:eventId/output?offset=&limit=: one chunk of a tool_result's stored text. */
export interface OutputChunk {
  event_id: number;
  tool_use_id: string;
  /** Where `text` starts. */
  offset: number;
  text: string;
  /** Where the next chunk starts, null at the end. A client sends it back as it is. */
  next: number | null;
  /** Code points of the stored text. */
  total: number;
  is_error: boolean;
  /** The saved text itself was cut when the harness reported it (apps/server/stream.ts MAX_RESULT). */
  truncated: boolean;
  exit_code?: number;
}

/**
 * One message of GET /api/threads/:id/tools/:toolUseId/tail. `tail` appends `text` to what the client holds, or
 * replaces it with `reset`, after `skipped` UTF-16 units that were dropped before it. `end` closes the stream: the call
 * finished, or `live: false` when the server has no live output for it (Claude Code and Cursor report a tool's output
 * only when it ends).
 */
export type TailMessage = { kind: 'tail'; text: string; reset?: boolean; skipped: number } | { kind: 'end'; live: boolean };

const EXIT_CODE = /^Exit code (-?\d{1,10})(?:\n|$)/;

/** The exit code a result's text starts with ("Exit code 1" is how Claude Code and Codex report a failed command). */
export function exitCodeOf(text: string): number | undefined {
  const m = EXIT_CODE.exec(text);
  return m ? Number(m[1]) : undefined;
}

export const outputQuery = (offset: number, limit?: number) => `offset=${offset}${limit ? `&limit=${limit}` : ''}`;

/** The meta a compact payload carries, null for a payload that holds its whole text. */
export function outputMeta(payload: { output?: unknown }): OutputMeta | null {
  const o = payload.output as Partial<OutputMeta> | undefined;
  return o && typeof o.chars === 'number' && typeof o.lines === 'number' ? (o as OutputMeta) : null;
}

/** The saved output a client holds for one open row: what its chunks added up to, and where the next one starts. */
export interface LoadedOutput {
  text: string;
  /** The next offset to ask for, null when the saved output is held whole. */
  next: number | null;
  total: number;
  truncated: boolean;
}

export const noOutput = (): LoadedOutput => ({ text: '', next: 0, total: 0, truncated: false });

/** Joins a chunk. A chunk that does not start where the held text ends (a repeat, a late answer) changes nothing. */
export function applyChunk(h: LoadedOutput, c: OutputChunk): LoadedOutput {
  if (h.next === null || c.offset !== h.next) return h;
  return { text: h.text + c.text, next: c.next, total: c.total, truncated: c.truncated };
}

/** Joins a tail message to the tail a client holds, keeping at most `cap` UTF-16 units (the newest). */
export function applyTail(held: string, m: Extract<TailMessage, { kind: 'tail' }>, cap: number = TOOL_OUTPUT.clientTail): string {
  const joined = (m.reset ? '' : held) + m.text;
  if (joined.length <= cap) return joined;
  const cutAt = joined.length - cap;
  const low = joined.charCodeAt(cutAt);
  // Never begin on the second half of a surrogate pair.
  return joined.slice(low >= 0xdc00 && low <= 0xdfff ? cutAt + 1 : cutAt);
}
