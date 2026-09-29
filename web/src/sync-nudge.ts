// Coming back to the tab asks the server to sync, so the other Mac's work is there by the time Ben looks.
// The server syncs on its own too (Realtime, the network, a 60s timer); this only makes the wait shorter.

export interface SyncNudgeOptions {
  /** POST /api/sync/now. Rejects with an error carrying `status` when the server says no. */
  post: () => Promise<unknown>;
  /** Wait this long after the last nudge, so a focus and a visibilitychange make one request. */
  delayMs?: number;
  /** At most one request this often. Nudges inside the gap are dropped; the server's timer covers them. */
  minGapMs?: number;
  /** After a 409 (sync is off on this server), stay quiet this long. */
  offMs?: number;
}

export interface SyncNudge {
  nudge(): void;
  cancel(): void;
}

export function createSyncNudge({ post, delayMs = 750, minGapMs = 15_000, offMs = 10 * 60_000 }: SyncNudgeOptions): SyncNudge {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastAt = -Infinity;
  let quietUntil = -Infinity;

  const fire = () => {
    timer = undefined;
    const now = Date.now();
    if (now < quietUntil || now - lastAt < minGapMs) return;
    lastAt = now;
    post().catch((e: unknown) => {
      if ((e as { status?: number })?.status === 409) quietUntil = Date.now() + offMs;
    });
  };

  return {
    nudge() {
      clearTimeout(timer);
      timer = setTimeout(fire, delayMs);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
