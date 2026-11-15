// Reading a result from Needs you (apps/server/db/repos/needs-you.ts), the same on the Web UI and the iOS app: which
// unread result an open thread shows, and the inbox once it is read, before the server answers. A failed thread under a
// job has no item of its own: its result sits on the job's `child_failed` blocker, in `from` and `results`.

interface ReadBlocker {
  kind: string;
  count: number;
  from?: string[];
  results?: string[];
}

export interface ReadItem {
  thread: { id: string };
  result: { uid: string } | null;
  blockers: ReadBlocker[];
}

/** The unread result a thread shows: its own item's, or the one a job's `child_failed` blocker holds for it. */
export function unreadResultOf(items: readonly ReadItem[], threadId: string): string | null {
  const own = items.find((i) => i.thread.id === threadId)?.result?.uid;
  if (own) return own;
  for (const i of items)
    for (const b of i.blockers) {
      const at = b.kind === 'child_failed' ? (b.from?.indexOf(threadId) ?? -1) : -1;
      if (at >= 0 && b.results?.[at]) return b.results[at];
    }
  return null;
}

/**
 * The items once the result `uid` is read: an item's own result goes, its blockers stay, and a `child_failed` blocker
 * drops the thread that result was from (the blocker goes with its last one). An item left with neither goes.
 */
export function withoutRead<I extends ReadItem>(items: readonly I[], uid: string): I[] {
  return items.flatMap((i) => {
    let blockers = i.blockers;
    const b = blockers.find((x) => x.kind === 'child_failed' && x.results?.includes(uid));
    if (b) {
      const at = b.results!.indexOf(uid);
      const drop = <T>(xs: T[] | undefined) => xs?.filter((_, k) => k !== at);
      blockers = b.count > 1 ? blockers.map((x) => (x === b ? { ...b, count: b.count - 1, from: drop(b.from), results: drop(b.results) } : x)) : blockers.filter((x) => x !== b);
    }
    const result = i.result?.uid === uid ? null : i.result;
    if (result === i.result && blockers === i.blockers) return [i];
    return result || blockers.length ? [{ ...i, result, blockers }] : [];
  });
}
