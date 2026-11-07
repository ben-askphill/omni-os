import type { SyncStatus } from '@omni/client-core';
import { relTime } from '@omni/shared/format.ts';

import type { Glyph } from '../components/StatusDot';

/** Sync as one line with its dot, the words the Web UI's Machines section uses. */
export function syncLine(s: SyncStatus | null, now: number): { glyph: Glyph; text: string } {
  if (!s) return { glyph: 'settled', text: 'Reading sync' };
  if (!s.configured) return s.legacyRelay ? { glyph: 'needs', text: 'Moved to Cloudflare: sign in again' } : { glyph: 'idle', text: 'Off' };
  if (s.signedOut) return { glyph: 'needs', text: 'Signed out' };
  if (s.lastError) return { glyph: 'needs', text: `Failing: ${s.lastError}` };
  if (!s.enabled) return { glyph: 'idle', text: 'Paused' };
  return { glyph: 'done', text: s.lastSyncAt ? `Synced ${relTime(s.lastSyncAt, now)}` : 'Not synced yet' };
}
