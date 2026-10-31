// A tool's output as a transcript record, clipped the same way for every harness that builds its own.
import type { Record as StreamRecord } from '../stream.ts';

/** The most of a tool's output a record keeps. */
export const MAX_RESULT = 16_000;

export function toolResult(id: string, text: string, isError: boolean): StreamRecord {
  const truncated = text.length > MAX_RESULT;
  return { kind: 'tool_result', payload: { tool_use_id: id, text: truncated ? text.slice(0, MAX_RESULT) : text, is_error: isError, truncated } };
}
