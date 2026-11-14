import { isAbsolute, normalize, sep } from 'node:path';

// Which folders a synced change may point a thread or channel at (PRD #667, S20). A forged thread row could otherwise
// name ~/.ssh or Omni's own data folder as the place an agent runs. Pure: the caller passes this machine's folders.
// - Allowed: under the home folder, the temp folder, a channel checkout this machine has, the repos folder, and Omni's
//   thread folders and worktrees.
// - Never: SSH, GPG and cloud credentials under home, and the rest of Omni's data folder (the database, secrets,
//   browser profiles), even when an allowed root holds them.
// The same check runs before a thread without a branch starts (runner/spawn.ts), since the worktree check skips it.

export interface PathPolicy {
  home: string;
  /** Omni's data folder (config.ts paths.data). */
  dataDir: string;
  /** Extra roots: this machine's channel checkouts and base folders, the repos folder and the temp folder. */
  roots: readonly string[];
  /** The file system ignores case (macOS, Windows): ~/.SSH is ~/.ssh. */
  caseInsensitive?: boolean;
}

export type PathVerdict = { ok: true } | { ok: false; reason: string };

/** Under home, never allowed. */
const DENIED_IN_HOME = ['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config/gcloud', '.config/gh', '.netrc', 'Library/Keychains'];
/** Under the data folder, the only parts a thread may run in. */
const DATA_ALLOWED = ['threads', 'worktrees'];

const clean = (p: string) => normalize(p).replace(/[\\/]+$/, '') || sep;
const under = (p: string, root: string) => {
  const r = clean(root);
  return p === r || p.startsWith(r === sep ? r : r + sep);
};

export function checkSyncedPath(raw: string | null | undefined, policy: PathPolicy): PathVerdict {
  if (raw == null || raw === '') return { ok: true };
  if (raw.includes('\0')) return { ok: false, reason: 'not a path' };
  if (!isAbsolute(raw)) return { ok: false, reason: 'not an absolute path' };
  const fold = (x: string) => (policy.caseInsensitive ? x.toLowerCase() : x);
  const p = fold(clean(raw));
  const home = fold(clean(policy.home));
  const data = fold(clean(policy.dataDir));
  const roots = policy.roots.filter((r) => r && isAbsolute(r)).map(fold);
  for (const d of DENIED_IN_HOME) if (under(p, fold(`${home}${sep}${d}`))) return { ok: false, reason: `inside ~/${d}` };
  if (under(p, data) && !DATA_ALLOWED.some((d) => under(p, `${data}${sep}${d}`) && p !== `${data}${sep}${d}`)) {
    return { ok: false, reason: "inside Omni's data folder" };
  }
  if (under(p, data)) return { ok: true };
  if (under(p, home) || roots.some((r) => under(p, r))) return { ok: true };
  return { ok: false, reason: 'outside the home folder and the channel checkouts' };
}
