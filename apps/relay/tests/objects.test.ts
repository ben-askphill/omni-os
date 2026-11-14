// Conditional writes of file objects (PRD #667, F3): two Macs writing one manifest from the same read, and only one
// of them landing.
import { describe, expect, it } from 'vitest';
import { conditionalPut, conditionOf, KeyLock, type BucketLike } from '../src/objects.ts';

function bucket() {
  const objects = new Map<string, { body: ArrayBuffer; etag: string }>();
  let n = 0;
  const b: BucketLike & { objects: typeof objects } = {
    objects,
    async head(key) {
      await Promise.resolve();
      const o = objects.get(key);
      return o ? { httpEtag: `"${o.etag}"` } : null;
    },
    async put(key, body) {
      await Promise.resolve();
      const etag = `e${++n}`;
      objects.set(key, { body, etag });
      return { httpEtag: `"${etag}"` };
    },
  };
  return b;
}
const body = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const text = (b: ReturnType<typeof bucket>, k: string) => new TextDecoder().decode(b.objects.get(k)!.body);

describe('conditionalPut', () => {
  it('reads the condition from the headers', () => {
    expect(conditionOf(new Headers({ 'if-none-match': '*' }))).toEqual({ ifNoneMatch: true });
    expect(conditionOf(new Headers({ 'if-match': '"e1"' }))).toEqual({ ifMatch: '"e1"' });
    expect(conditionOf(new Headers())).toBeNull();
  });

  it('creates only when there is none, and replaces only the version it names', async () => {
    const b = bucket();
    const lock = new KeyLock();
    const first = await conditionalPut(b, lock, 'm', body('one'), 'application/json', { ifNoneMatch: true });
    expect(first).toBe('"e1"');
    expect(await conditionalPut(b, lock, 'm', body('again'), 'application/json', { ifNoneMatch: true })).toBeNull();
    expect(await conditionalPut(b, lock, 'm', body('two'), 'application/json', { ifMatch: 'e1' })).toBe('"e2"');
    expect(await conditionalPut(b, lock, 'm', body('stale'), 'application/json', { ifMatch: '"e1"' })).toBeNull();
    expect(text(b, 'm')).toBe('two');
  });

  it('lets one of two writes from the same read land, even when they arrive together', async () => {
    const b = bucket();
    const lock = new KeyLock();
    await conditionalPut(b, lock, 'm', body('base'), 'application/json', null);
    const results = await Promise.all([
      conditionalPut(b, lock, 'm', body('from A'), 'application/json', { ifMatch: '"e1"' }),
      conditionalPut(b, lock, 'm', body('from B'), 'application/json', { ifMatch: '"e1"' }),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(['from A', 'from B']).toContain(text(b, 'm'));
  });

  it('writes with no condition, as an older Omni does', async () => {
    const b = bucket();
    expect(await conditionalPut(b, new KeyLock(), 'blob', body('x'), 'application/octet-stream', null)).toBe('"e1"');
  });
});
