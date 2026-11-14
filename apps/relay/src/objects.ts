// Conditional writes of a user's file objects (PRD #667, F3). A thread's manifest is read, changed and written back by
// every Mac that syncs the thread, so a write names the version it read (If-Match), or says there was none
// (If-None-Match: *), and a write that lost the race gets 412 and plans again. The check and the write run under a
// per-key lock in this Durable Object, the only writer of the user's objects, so nothing slips in between them.

export interface BucketLike {
  head(key: string): Promise<{ httpEtag: string } | null>;
  put(key: string, body: ArrayBuffer, opts: { httpMetadata: { contentType: string } }): Promise<{ httpEtag: string } | null>;
}

/** What a PUT asks for: no condition, the version it read, or that there be none yet. */
export type PutCondition = null | { ifMatch: string } | { ifNoneMatch: true };

const bare = (etag: string) => etag.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');

export function conditionOf(headers: Headers): PutCondition {
  const none = headers.get('if-none-match');
  if (none?.trim() === '*') return { ifNoneMatch: true };
  const match = headers.get('if-match');
  return match ? { ifMatch: match } : null;
}

/** Holds one write per key at a time. */
export class KeyLock {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

/** Put the object when the condition holds. Its new ETag, or null when the condition failed (412). */
export async function conditionalPut(bucket: BucketLike, lock: KeyLock, key: string, body: ArrayBuffer, contentType: string, cond: PutCondition): Promise<string | null> {
  const write = async () => (await bucket.put(key, body, { httpMetadata: { contentType } }))?.httpEtag ?? '';
  if (!cond) return lock.run(key, write);
  return lock.run(key, async () => {
    const current = await bucket.head(key);
    if ('ifNoneMatch' in cond ? !!current : !current || bare(current.httpEtag) !== bare(cond.ifMatch)) return null;
    return write();
  });
}
