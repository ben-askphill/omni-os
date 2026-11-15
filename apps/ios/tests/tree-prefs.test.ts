import { describe, expect, it } from 'vitest';

import type { PrefStorage } from '../src/live/handoff-prefs';
import { createTreePrefs, MAX_TREE_CHOICES } from '../src/live/tree-prefs';

function memory(initial: string | null = null) {
  const box = { value: initial };
  const storage: PrefStorage = {
    read: async () => box.value,
    write: async (v) => {
      box.value = v;
    },
  };
  return { box, storage };
}

describe('createTreePrefs', () => {
  it('keeps a choice per job with its phase, and saves it', async () => {
    const m = memory();
    const prefs = createTreePrefs(m.storage);
    await prefs.ready;
    prefs.set('job', { open: false, phase: 'running' });
    expect(prefs.saved.get().get('job')).toEqual({ open: false, phase: 'running' });
    await Promise.resolve();
    const again = createTreePrefs(m.storage);
    await again.ready;
    expect(again.saved.get().get('job')).toEqual({ open: false, phase: 'running' });
  });

  it('drops a choice once its job moved to the other phase, and keeps jobs the lists do not know', async () => {
    const prefs = createTreePrefs(memory().storage);
    await prefs.ready;
    prefs.set('a', { open: false, phase: 'running' });
    prefs.set('b', { open: true, phase: 'finished' });
    prefs.set('c', { open: true, phase: 'finished' });
    prefs.prune(new Map([['a', 'finished'], ['b', 'finished']]));
    expect([...prefs.saved.get().keys()]).toEqual(['b', 'c']);
  });

  it('ignores what it cannot read, and forgets the oldest past the cap', async () => {
    const prefs = createTreePrefs(memory('[["x",{"open":"yes","phase":"running"}],["y",{"open":true,"phase":"finished"}],7]').storage);
    await prefs.ready;
    expect([...prefs.saved.get().keys()]).toEqual(['y']);
    for (let i = 0; i < MAX_TREE_CHOICES + 5; i++) prefs.set(`j${i}`, { open: true, phase: 'running' });
    expect(prefs.saved.get().size).toBe(MAX_TREE_CHOICES);
    expect(prefs.saved.get().has('y')).toBe(false);
  });
});
