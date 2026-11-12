// Ben's messages to a thread another machine holds, while that machine has not taken them yet (PendingMsg.forwarded_to,
// apps/server/run-on.ts): what their row says, and what holds them up when sync is the reason.
import { useEffect } from 'react';
import { useApi, type PendingMsg, type SyncStatus } from './api.ts';

/** How long a forwarded message is only "on its way" before its row says the other machine has not taken it. */
export const SLOW_MS = 2 * 60_000;

export const isForwarded = (m: PendingMsg) => !!m.forwarded_to;

/** Why sync cannot carry anything to the other machine right now, or null while it works. */
export function syncTrouble(s: SyncStatus | undefined): string | null {
  if (!s?.configured) return null;
  if (s.signedOut) return 'sync is signed out. Sign in again in Settings, Sync';
  if (!s.enabled) return 'sync is paused. Resume it in Settings, Sync';
  if (s.failures > 0 && s.lastError) return `sync is failing (${s.lastError})`;
  return null;
}

/** The line over a forwarded message: on its way, not taken after a while, or held up by sync. */
export function forwardedLabel(m: PendingMsg, trouble: string | null, now = Date.now()): string {
  const to = m.forwarded_to ?? 'the other machine';
  if (trouble) return `Not delivered to ${to} yet: ${trouble}`;
  const sent = m.sent_at ? Date.parse(m.sent_at) : NaN;
  if (now - sent > SLOW_MS) return `Waiting for ${to} to take it`;
  return `On its way to ${to}`;
}

/** Sync's state while a forwarded message waits, read again every 15 s, so the row says when sync is the hold-up. */
export function useSyncTrouble(waiting: boolean): string | null {
  const { data, reload } = useApi<SyncStatus>(waiting ? '/sync/status' : null);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [waiting, reload]);
  return waiting ? syncTrouble(data) : null;
}
