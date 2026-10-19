// The label next to the spinner while a thread runs.
import type { EventRow } from './api.ts';

/**
 * The newest status since Ben's last message, or null for the default. An empty status clears an
 * earlier one, as when Codex finishes compacting in the middle of a turn.
 */
export function statusLabel(events: Pick<EventRow, 'kind' | 'payload'>[]): string | null {
  for (let k = events.length - 1; k >= 0; k--) {
    const e = events[k];
    if (e.kind === 'user') return null;
    if (e.kind !== 'status') continue;
    try {
      return String(JSON.parse(e.payload)?.text ?? '') || null;
    } catch {
      return null;
    }
  }
  return null;
}
