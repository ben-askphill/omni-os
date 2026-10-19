// Replies from cloud sessions. A Stop hook in the session's repo POSTs each turn's final message to
// /api/cloud/reply/:sessionId (scripts/cloud-reply-hook.sh); a waiting turn picks it up here. A reply with no turn
// waiting is kept briefly, so one that lands just before the wait starts is not lost, and never answers a later turn.
import { normalizeSessionId } from './dispatch.ts';

interface Waiter {
  since: number;
  resolve: (text: string) => void;
}

const waiters = new Map<string, Waiter>();
const early = new Map<string, { at: number; text: string }>();
/** How long an unclaimed reply is kept. */
const KEEP_MS = 10 * 60 * 1000;

/** Deliver a reply. True when a waiting turn took it. */
export function deliverReply(sessionId: string, text: string, now = Date.now()): boolean {
  const id = normalizeSessionId(sessionId);
  const w = waiters.get(id);
  if (w) {
    waiters.delete(id);
    w.resolve(text);
    return true;
  }
  early.set(id, { at: now, text });
  for (const [k, v] of early) if (now - v.at > KEEP_MS) early.delete(k);
  return false;
}

/**
 * Wait for the session's next reply after `since`. Resolves null on timeout or abort. A second wait on the same
 * session replaces the first, which resolves null.
 */
export function awaitReply(sessionId: string, ms: number, signal?: AbortSignal, since = Date.now()): Promise<string | null> {
  const id = normalizeSessionId(sessionId);
  const kept = early.get(id);
  if (kept && kept.at >= since) {
    early.delete(id);
    return Promise.resolve(kept.text);
  }
  waiters.get(id)?.resolve('');
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (waiters.get(id) === w) waiters.delete(id);
      resolve(v);
    };
    const w: Waiter = { since, resolve: (t) => finish(t || null) };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), ms);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
    waiters.set(id, w);
    if (signal?.aborted) finish(null);
  });
}

/** Whether a turn is waiting on this session. */
export const isWaiting = (sessionId: string) => waiters.has(normalizeSessionId(sessionId));

/** For tests. */
export function resetReplies() {
  for (const w of waiters.values()) w.resolve('');
  waiters.clear();
  early.clear();
}
