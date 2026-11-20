// Collisions (ADR 0019): files two agents of one thread both edited while their turns overlapped. The server raises a
// flag as a `collision` row in the thread's transcript (apps/server/runner/collisions.ts), and a `collision_cleared`
// row takes one down, at the next commit or when Ben dismisses it, so the flags travel with the thread like any row.
// Pure; the Web UI and the iOS app read it.

/** A `collision` row: one file, the agents that both edited it, and HEAD when it was raised. */
export interface CollisionP {
  /** The flag's own id, the same on every machine: row ids are each machine's own, so a clearing names this. */
  key: string;
  /** Relative to the thread's worktree. */
  path: string;
  agents: string[];
  head?: string | null;
}

/** A `collision_cleared` row: the flags it takes down, by key, and why. */
export interface CollisionClearedP {
  keys: string[];
  by: 'commit' | 'dismiss';
}

/** A flag as the clients draw it. */
export interface Collision {
  /** The `collision` row's id on this machine: what Dismiss names. */
  id: number;
  key: string;
  path: string;
  /** The file with its folder (`thread/Composer.tsx`); the full path is for the hover (Q56). */
  label: string;
  agents: string[];
  at: string;
  /** Null while the flag is up. */
  cleared: CollisionClearedP['by'] | null;
}

/** The file with its folder: `thread/Composer.tsx`, or the file alone at the top of the worktree. */
export function collisionLabel(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

/** The tools every harness's edits arrive as (Codex and Cursor Agent map theirs onto these, apps/server/harness/). */
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Delete']);

/** The file an edit call changed, as its input names it, or null for a call that edits no file. */
export function editedPath(call: { name: string; input: Record<string, unknown> }): string | null {
  if (!EDIT_TOOLS.has(call.name)) return null;
  const p = call.input.file_path ?? call.input.notebook_path ?? call.input.path;
  return typeof p === 'string' && p ? p : null;
}

/** A path relative to the worktree when it is under it. */
export function worktreePath(path: string, cwd: string | null | undefined): string {
  if (cwd && path.startsWith(`${cwd.replace(/\/+$/, '')}/`)) return path.slice(cwd.replace(/\/+$/, '').length + 1);
  return path;
}

const parse = <T>(payload: string): Partial<T> => {
  try {
    return JSON.parse(payload) as Partial<T>;
  } catch {
    return {};
  }
};

/** Every flag a thread's rows raised, oldest first, each with whether a later row cleared it. */
export function collisionsIn(events: readonly { id: number; kind: string; payload: string; created_at: string }[]): Collision[] {
  const cleared = new Map<string, CollisionClearedP['by']>();
  for (const e of events) {
    if (e.kind !== 'collision_cleared') continue;
    const p = parse<CollisionClearedP>(e.payload);
    if (!Array.isArray(p.keys)) continue;
    for (const k of p.keys) if (typeof k === 'string' && !cleared.has(k)) cleared.set(k, p.by === 'commit' ? 'commit' : 'dismiss');
  }
  const out: Collision[] = [];
  for (const e of events) {
    if (e.kind !== 'collision') continue;
    const p = parse<CollisionP>(e.payload);
    if (typeof p.path !== 'string' || !p.path) continue;
    const key = typeof p.key === 'string' && p.key ? p.key : `row:${e.id}`;
    const agents = Array.isArray(p.agents) ? p.agents.filter((a): a is string => typeof a === 'string') : [];
    out.push({ id: e.id, key, path: p.path, label: collisionLabel(p.path), agents, at: e.created_at, cleared: cleared.get(key) ?? null });
  }
  return out;
}

/** The flags still up. */
export const openCollisions = (events: Parameters<typeof collisionsIn>[0]) => collisionsIn(events).filter((c) => !c.cleared);
