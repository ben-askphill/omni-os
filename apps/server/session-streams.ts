// The SSE streams each device session holds open, so ending a session ends them (apps/server/sse.ts registers them).
// A stream is a long-lived authenticated request: without this, a revoked session keeps receiving events until the
// client hangs up.

const open = new Map<string, Set<() => void>>();

/** Register a stream held by `sessionId`. Returns the function that forgets it when the stream ends on its own. */
export function trackStream(sessionId: string, close: () => void): () => void {
  let set = open.get(sessionId);
  if (!set) open.set(sessionId, (set = new Set()));
  set.add(close);
  return () => {
    set.delete(close);
    if (!set.size && open.get(sessionId) === set) open.delete(sessionId);
  };
}

/** End every stream these sessions hold, now. */
export function closeSessionStreams(sessionIds: Iterable<string>) {
  for (const id of sessionIds) {
    const set = open.get(id);
    if (!set) continue;
    open.delete(id);
    for (const close of set) {
      try {
        close();
      } catch {
        // The stream is already gone.
      }
    }
  }
}

/** Sessions with at least one open stream. */
export const sessionsWithStreams = () => [...open.keys()];
