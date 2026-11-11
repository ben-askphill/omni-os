// One status vocabulary for every client: the web and phone layouts (apps/web/src/components/ui/status.tsx) and the
// iOS app (apps/ios/src/components/glyph.ts) read their labels and tones here. Pure.

/**
 * What a status dot draws. The five states a person reads (running, needs, limited, failed, done) plus the quiet
 * ones: settled after a stop, queued and idle as a hollow ring.
 */
export type Glyph = 'running' | 'needs' | 'limited' | 'failed' | 'done' | 'settled' | 'queued' | 'idle';

/** The token a state takes its colour from: --live, --needs, --warn, --done, or none. */
export type StatusTone = 'live' | 'needs' | 'warn' | 'done' | 'neutral';

export const STATUS: Record<Glyph, { label: string; tone: StatusTone }> = {
  running: { label: 'Running', tone: 'live' },
  needs: { label: 'Needs you', tone: 'needs' },
  limited: { label: 'Limited', tone: 'warn' },
  failed: { label: 'Failed', tone: 'needs' },
  done: { label: 'Done', tone: 'done' },
  settled: { label: 'Stopped', tone: 'neutral' },
  queued: { label: 'Queued', tone: 'neutral' },
  idle: { label: 'Idle', tone: 'neutral' },
};

/** A thread status (ThreadStatus in apps/server/db/repos/threads.ts), a glyph, or anything else, to its glyph. */
export function glyphFor(status: string | null | undefined): Glyph {
  switch (status) {
    case 'running':
    case 'needs':
    case 'limited':
    case 'failed':
    case 'done':
    case 'settled':
    case 'queued':
    case 'idle':
      return status;
    case 'imported':
      return 'idle';
    default:
      return 'settled';
  }
}

export const statusLabel = (status: string | null | undefined) => STATUS[glyphFor(status)].label;

/**
 * The glyph a thread shows. A turn the harness stopped at its usage limit ends failed and keeps its `limit_state`
 * (apps/server/runner/records.ts limitStop): that reads Limited, not Failed. A thread whose own turn ended while
 * threads it delegated still work reads Running.
 */
export function threadGlyph(t: { status: string; delegating?: boolean; limit_state?: string | null }): Glyph {
  if (t.delegating && t.status !== 'queued') return 'running';
  if (t.limit_state && t.status !== 'running' && t.status !== 'queued') return 'limited';
  return glyphFor(t.status);
}

/** The glyph asks for Ben: he answers it, resumes it or looks into it. */
export const asksForYou = (g: Glyph) => g === 'needs' || g === 'failed' || g === 'limited';
