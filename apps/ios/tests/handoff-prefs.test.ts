import { describe, expect, it } from 'vitest';

import { createHandoffPrefs, MAX_CLOSED, type PrefStorage } from '../src/live/handoff-prefs';

function memory(initial: string | null = null) {
  const box = { value: initial, writes: [] as string[] };
  const storage: PrefStorage = {
    read: async () => box.value,
    write: async (v) => {
      box.value = v;
      box.writes.push(v);
    },
  };
  return { box, storage };
}

describe('createHandoffPrefs', () => {
  it('starts with every parent open', async () => {
    const prefs = createHandoffPrefs(memory().storage);
    await prefs.ready;
    expect(prefs.closed.get().size).toBe(0);
  });

  it('closes and reopens a parent, saving each change', async () => {
    const m = memory();
    const prefs = createHandoffPrefs(m.storage);
    await prefs.ready;
    prefs.toggle('p1');
    expect([...prefs.closed.get()]).toEqual(['p1']);
    prefs.toggle('p1');
    expect(prefs.closed.get().size).toBe(0);
    await Promise.resolve();
    expect(m.box.writes).toEqual(['["p1"]', '[]']);
  });

  it('reads what an earlier launch closed', async () => {
    const prefs = createHandoffPrefs(memory('["a","b"]').storage);
    await prefs.ready;
    expect(prefs.closed.get()).toEqual(new Set(['a', 'b']));
  });

  it('shrugs off a damaged or unreadable save', async () => {
    for (const text of ['{oops', '{"a":1}', '[1,"x"]']) {
      const prefs = createHandoffPrefs(memory(text).storage);
      await prefs.ready;
      expect([...prefs.closed.get()]).toEqual(text === '[1,"x"]' ? ['x'] : []);
    }
    const prefs = createHandoffPrefs({ read: async () => Promise.reject(new Error('locked')), write: async () => {} });
    await prefs.ready;
    expect(prefs.closed.get().size).toBe(0);
  });

  it('keeps a toggle made before the read finished', async () => {
    const m = memory('["old"]');
    const prefs = createHandoffPrefs(m.storage);
    prefs.toggle('new');
    await prefs.ready;
    expect(prefs.closed.get()).toEqual(new Set(['old', 'new']));
    await Promise.resolve();
    expect(JSON.parse(m.box.value!)).toEqual(['old', 'new']);
  });

  it('forgets the oldest closed parent past the limit', async () => {
    const prefs = createHandoffPrefs(memory().storage);
    await prefs.ready;
    for (let i = 0; i <= MAX_CLOSED; i++) prefs.toggle(`p${i}`);
    expect(prefs.closed.get().size).toBe(MAX_CLOSED);
    expect(prefs.closed.get().has('p0')).toBe(false);
    expect(prefs.closed.get().has(`p${MAX_CLOSED}`)).toBe(true);
  });

  it('survives a failing write', async () => {
    const prefs = createHandoffPrefs({ read: async () => null, write: async () => Promise.reject(new Error('full')) });
    await prefs.ready;
    prefs.toggle('p');
    await Promise.resolve();
    expect(prefs.closed.get().has('p')).toBe(true);
  });
});
