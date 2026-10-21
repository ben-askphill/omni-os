// The sidebar's Pinned section: threads Ben pinned from any channel, the latest pin first. Pure, so the rules are tested
// on their own (apps/web/tests/pins.test.ts).
import type { ThreadStub } from './api.ts';

/** A pinned thread as GET /api/pinned sends it: the whole row, of which the sidebar reads a stub and when it was pinned. */
export type PinnedThread = ThreadStub & { pinned_at: string | null };

/** The rows to show: the open thread's fresher copy in its own place, so its status follows the page without a refetch. */
export function pinnedRows(pinned: PinnedThread[], open: ThreadStub | null): PinnedThread[] {
  return pinned.map((t) => (open && open.id === t.id ? { ...t, ...open, pinned_at: t.pinned_at } : t));
}

/** The list with `t` pinned (on top) or unpinned, ahead of the server, so the click shows at once. */
export function withPin(pinned: PinnedThread[], t: ThreadStub, on: boolean, at = new Date().toISOString()): PinnedThread[] {
  const rest = pinned.filter((x) => x.id !== t.id);
  if (!on) return rest;
  const was = pinned.find((x) => x.id === t.id);
  return was ? pinned : [{ ...t, pinned_at: at }, ...rest];
}
