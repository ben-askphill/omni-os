// The status glyph a thread or run shows, apart from StatusDot's drawing so pure models can pick one. Pure.

/**
 * The status glyphs the Web UI draws (`.glyph` in apps/web/src/index.css): a blue dot that pings while running, a
 * vermilion diamond when it needs Ben, a lime dot when done, a grey dot once settled, and a grey ring when idle or queued.
 */
export type Glyph = 'running' | 'needs' | 'done' | 'settled' | 'idle' | 'queued';

/** A thread or run status to its glyph: a failure needs Ben, a stop just settles (web: glyphFor). */
export function glyphFor(status: string | null | undefined): Glyph {
  switch (status) {
    case 'running':
    case 'needs':
    case 'done':
    case 'settled':
    case 'queued':
    case 'idle':
      return status;
    case 'failed':
      return 'needs';
    case 'imported':
      return 'idle';
    default:
      return 'settled';
  }
}
