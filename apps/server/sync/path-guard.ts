import { homedir, tmpdir } from 'node:os';
import { config, paths } from '../config.ts';
import { db } from '../db.ts';
import { resolved } from '../user-config.ts';
import { checkSyncedPath, type PathPolicy, type PathVerdict } from './path-policy.ts';

// sync/path-policy.ts with this machine's folders: its home, data folder, temp folder, repos folder, brain and the checkouts
// and base folders of the channels it has now. A synced channel change is checked against the channels as they are
// here before it, so a forged one cannot widen the roots it is checked against.

/** The system temp folders, besides this process's own (TMPDIR can point elsewhere). */
const TEMP = ['/tmp', '/private/tmp', '/var/tmp'];

export function localPathPolicy(): PathPolicy {
  const rows = db.prepare('SELECT repo_path, base_dir FROM channels').all() as { repo_path: string | null; base_dir: string | null }[];
  const roots = [tmpdir(), ...TEMP, resolved.reposDir(), config.brainDir, ...rows.flatMap((r) => [r.repo_path, r.base_dir])].filter((r): r is string => !!r);
  return { home: homedir(), dataDir: paths.data, roots };
}

/** The first of these fields whose path is not allowed, with why, or null when all are. */
export function pathProblem(fields: Record<string, string | null | undefined>, policy = localPathPolicy()): string | null {
  for (const [field, value] of Object.entries(fields)) {
    const v: PathVerdict = checkSyncedPath(value, policy);
    if (!v.ok) return `${field} ${v.reason}`;
  }
  return null;
}
