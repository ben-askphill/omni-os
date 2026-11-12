// Ben's messages to a thread another machine holds, while that machine has not taken them yet (PendingMsg.forwarded_to,
// apps/server/run-on.ts): what their row says, and what holds them up when sync is the reason. The web and iOS rows
// both read these.

/** How long a forwarded message is only "on its way" before its row says the other machine has not taken it. */
export const SLOW_MS = 2 * 60_000;

/** The parts of a pending message these rules read. */
export interface ForwardedRow {
  forwarded_to?: string;
  sent_at?: string;
}

/** The parts of GET /sync/status these rules read. */
export interface SyncTroubleInput {
  configured: boolean;
  enabled: boolean;
  signedOut: boolean;
  failures: number;
  lastError: string | null;
}

export const isForwarded = (m: ForwardedRow) => !!m.forwarded_to;

/** Why sync cannot carry anything to the other machine right now, or null while it works. */
export function syncTrouble(s: SyncTroubleInput | null | undefined): string | null {
  if (!s?.configured) return null;
  if (s.signedOut) return 'sync is signed out. Sign in again in Settings, Sync';
  if (!s.enabled) return 'sync is paused. Resume it in Settings, Sync';
  if (s.failures > 0 && s.lastError) return `sync is failing (${s.lastError})`;
  return null;
}

/** The line over a forwarded message: on its way, not taken after a while, or held up by sync. */
export function forwardedLabel(m: ForwardedRow, trouble: string | null, now = Date.now()): string {
  const to = m.forwarded_to ?? 'the other machine';
  if (trouble) return `Not delivered to ${to} yet: ${trouble}`;
  const sent = m.sent_at ? Date.parse(m.sent_at) : NaN;
  if (now - sent > SLOW_MS) return `Waiting for ${to} to take it`;
  return `On its way to ${to}`;
}
