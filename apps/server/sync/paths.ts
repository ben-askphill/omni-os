import { homedir } from 'node:os';
import { kv } from '../db.ts';

// Paths travel between Macs with the home dir as "~", so /Users/ben/work/x on one is /Users/ben/work/x on the other
// even when the account names differ. A Mac whose folders live elsewhere sets kv `sync.path_map`, applied to paths
// coming in: {"~/work": "~/code"} turns a remote "~/work/volero" into "~/code/volero" here, and is undone going out
// (toRemote), so an edit made here sends the other Mac its own path back.

export type PathMap = Record<string, string>;

/** A local absolute path, with the home dir as "~". Null stays null. */
export function toPortable<T extends string | null>(p: T, home = homedir()): T {
  if (!p) return p;
  if (p === home) return '~' as T;
  return (p.startsWith(home + '/') ? `~${p.slice(home.length)}` : p) as T;
}

/** The longest key of map that p equals or sits under, on a whole path segment. */
const longestPrefix = (p: string, keys: string[]) =>
  keys.filter((k) => p === k || p.startsWith(k.endsWith('/') ? k : k + '/')).sort((a, b) => b.length - a.length)[0];

/** A local path on its way to the relay: portable, with this machine's path map undone. Null stays null. */
export function toRemote<T extends string | null>(p: T, opts: { home?: string; map?: PathMap } = {}): T {
  if (!p) return p;
  const home = opts.home ?? homedir();
  const portable = toPortable(p, home);
  // Undo the map by its targets, in the same portable form.
  const back = new Map(Object.entries(opts.map ?? pathMap()).map(([from, to]) => [toPortable(to, home), from]));
  const to = longestPrefix(portable, [...back.keys()]);
  return (to ? back.get(to)! + portable.slice(to.length) : portable) as T;
}

/** A path from another machine, through this machine's path map, with "~" expanded. Null stays null. */
export function fromPortable<T extends string | null>(p: T, opts: { home?: string; map?: PathMap } = {}): T {
  if (!p) return p;
  const home = opts.home ?? homedir();
  const map = opts.map ?? pathMap();
  // The longest matching prefix wins, and only on a whole path segment.
  const from = longestPrefix(p, Object.keys(map));
  const mapped = from ? map[from] + p.slice(from.length) : p;
  if (mapped === '~') return home as T;
  return (mapped.startsWith('~/') ? home + mapped.slice(1) : mapped) as T;
}

/**
 * True when an id from another machine is one plain folder name: no separators, no "." or "..", no NUL.
 * Thread ids and session ids become folder names here (data/threads/<id>, a Cursor chat's folder), and the
 * relay's data is not trusted to stay inside them.
 */
export const safeSegment = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= 200 && id !== '.' && id !== '..' && !/[/\\\0]/.test(id);

/**
 * True when a relative path from another machine stays inside its folder: no empty part, no absolute path,
 * no backslash, no NUL, no "." or "..".
 */
export const safeRel = (rel: string) =>
  typeof rel === 'string' && rel.length > 0 && !rel.startsWith('/') && !rel.includes('\\') && !rel.includes('\0') &&
  rel.split('/').every((part) => part && part !== '.' && part !== '..');

/** This machine's path map, from kv `sync.path_map`. */
export const pathMap = (): PathMap => kv.get<PathMap>('sync.path_map') ?? {};
