// Whether Ben opened or closed a job's tree on the Activity tab, and in which phase (@omni/shared/thread-tree.ts
// SavedOpen). Phone web keeps this per job in local storage (tree.inbox.<id>); here it is one map on this device, newest
// last and capped, so a long history does not grow without bound.
import type { SavedOpen, TreePhase } from '@omni/shared/thread-tree.ts';

import type { PrefStorage } from './handoff-prefs';
import { createStore, type Store } from './store';

/** Choices kept before the oldest is forgotten. */
export const MAX_TREE_CHOICES = 50;

export interface TreePrefs {
  readonly saved: Store<ReadonlyMap<string, SavedOpen>>;
  set(jobId: string, choice: SavedOpen): void;
  /**
   * Drops each choice whose job moved to the other phase since, so a tree closed while it ran opens by itself in its next
   * run. `phases` is what the lists know now; a job they do not list keeps its choice.
   */
  prune(phases: ReadonlyMap<string, TreePhase>): void;
  readonly ready: Promise<void>;
}

const isPhase = (v: unknown): v is TreePhase => v === 'running' || v === 'finished';

function parse(text: string | null): [string, SavedOpen][] {
  try {
    const value: unknown = text ? JSON.parse(text) : [];
    if (!Array.isArray(value)) return [];
    return value.flatMap((e): [string, SavedOpen][] => {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || !e[1] || typeof e[1] !== 'object') return [];
      const { open, phase } = e[1] as Record<string, unknown>;
      return typeof open === 'boolean' && isPhase(phase) ? [[e[0], { open, phase }]] : [];
    });
  } catch {
    return [];
  }
}

export function createTreePrefs(storage: PrefStorage): TreePrefs {
  const saved = createStore<ReadonlyMap<string, SavedOpen>>(new Map());
  let order: [string, SavedOpen][] = [];
  let loaded = false;

  const commit = (next: [string, SavedOpen][]) => {
    order = next.slice(-MAX_TREE_CHOICES);
    saved.set(new Map(order));
    const write = () => storage.write(JSON.stringify(order)).catch(() => {});
    if (loaded) void write();
    else void ready.then(write);
  };

  const ready = storage
    .read()
    .then(parse, () => [])
    .then((stored) => {
      // A choice made before the read finished wins over what was saved.
      const early = new Set(order.map(([id]) => id));
      order = [...stored.filter(([id]) => !early.has(id)), ...order].slice(-MAX_TREE_CHOICES);
      saved.set(new Map(order));
      loaded = true;
    });

  return {
    saved,
    ready,
    set(jobId, choice) {
      commit([...order.filter(([id]) => id !== jobId), [jobId, choice]]);
    },
    prune(phases) {
      const next = order.filter(([id, c]) => !phases.has(id) || phases.get(id) === c.phase);
      if (next.length !== order.length) commit(next);
    },
  };
}
