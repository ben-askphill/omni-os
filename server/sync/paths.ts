import { homedir } from 'node:os';
import { kv } from '../db.ts';

// Paths travel between Macs with the home dir as "~", so /Users/ben/work/x on one is /Users/ben/work/x on the other
// even when the account names differ. A Mac whose folders live elsewhere sets kv `sync.path_map`, applied to paths
// coming in: {"~/work": "~/code"} turns a remote "~/work/volero" into "~/code/volero" here.

export type PathMap = Record<string, string>;

/** A local absolute path, with the home dir as "~". Null stays null. */
export function toPortable<T extends string | null>(p: T, home = homedir()): T {
  if (!p) return p;
  if (p === home) return '~' as T;
  return (p.startsWith(home + '/') ? `~${p.slice(home.length)}` : p) as T;
}

/** A path from another machine, through this machine's path map, with "~" expanded. Null stays null. */
export function fromPortable<T extends string | null>(p: T, opts: { home?: string; map?: PathMap } = {}): T {
  if (!p) return p;
  const home = opts.home ?? homedir();
  const map = opts.map ?? pathMap();
  // The longest matching prefix wins, and only on a whole path segment.
  const from = Object.keys(map)
    .filter((k) => p === k || p.startsWith(k.endsWith('/') ? k : k + '/'))
    .sort((a, b) => b.length - a.length)[0];
  const mapped = from ? map[from] + p.slice(from.length) : p;
  if (mapped === '~') return home as T;
  return (mapped.startsWith('~/') ? home + mapped.slice(1) : mapped) as T;
}

/** This machine's path map, from kv `sync.path_map`. */
export const pathMap = (): PathMap => kv.get<PathMap>('sync.path_map') ?? {};
