import { createStore, type Store } from './store';

/** Where the closed parents are kept between launches. */
export interface PrefStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

/** Closed parents kept before the oldest is forgotten. A parent that is gone from the Conductor leaves its id behind. */
export const MAX_CLOSED = 50;

export interface HandoffPrefs {
  /** The parents whose delegated threads Ben closed. Everything else is open, as on phone web. */
  readonly closed: Store<ReadonlySet<string>>;
  toggle(parentId: string): void;
  /** Resolves once the saved state is read. */
  readonly ready: Promise<void>;
}

function parse(text: string | null): string[] {
  try {
    const value: unknown = text ? JSON.parse(text) : [];
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Whether each Conductor parent shows the threads it delegated. Phone web keeps this per device in local storage with
 * the default open. Here the closed ones are one list, oldest first, so a long history does not grow without bound.
 */
export function createHandoffPrefs(storage: PrefStorage): HandoffPrefs {
  const closed = createStore<ReadonlySet<string>>(new Set());
  let order: string[] = [];
  let loaded = false;

  const save = () => storage.write(JSON.stringify(order)).catch(() => {});

  const ready = storage
    .read()
    .then(parse, () => [])
    .then((saved) => {
      // A toggle made before the read finished wins over what was saved.
      const early = order;
      order = [...saved.filter((id) => !early.includes(id)), ...early].slice(-MAX_CLOSED);
      closed.set(new Set(order));
      loaded = true;
    });

  return {
    closed,
    ready,
    toggle(parentId) {
      order = order.includes(parentId) ? order.filter((id) => id !== parentId) : [...order, parentId].slice(-MAX_CLOSED);
      closed.set(new Set(order));
      if (loaded) void save();
      else void ready.then(save);
    },
  };
}
