// A workspace checkpoint: a checkout saved as a commit on top of its HEAD under a hidden ref, and laid out again as
// uncommitted changes. Turn snapshots (turns.ts), Continue (continue.ts, continue-carry.ts) and a worktree handoff
// (handoff/worktree.ts) all capture and apply through here. Capturing builds the tree in a temporary index outside the
// repo, so the checkout's branch, HEAD and index are never touched. What a capture holds is the caller's policy:
// `text` keeps what a diff can show (untracked text files, capped), `all` keeps everything git does not ignore, for a
// checkout that moves to another Mac whole.
import { copyFileSync, existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import type { SkippedFile } from './db.ts';
import { MAX_UNTRACKED_BYTES, git as changesGit, head, real } from './changes.ts';

/** Who checkpoint commits are by. They never reach a branch, so no identity of Ben's is needed or used. */
export const CHECKPOINT_IDENT = { GIT_AUTHOR_NAME: 'Omni', GIT_AUTHOR_EMAIL: 'omni@localhost', GIT_COMMITTER_NAME: 'Omni', GIT_COMMITTER_EMAIL: 'omni@localhost' };

/** Untracked files a `text` capture saves. Past this they are listed as left out. */
export const MAX_SNAPSHOT_UNTRACKED = 2_000;
/** Left-out files remembered per capture. */
const MAX_SKIPPED = 200;
/** Paths per `git add`, to stay under the argument limit. */
const ADD_CHUNK = 200;

/** Runs git in dir and gives its output, throwing with its reason. A handoff passes its own, with its timeout. */
export type GitRun = (dir: string, args: string[], env?: Record<string, string>) => Promise<string>;
const local: GitRun = (dir, args, env) => changesGit(dir, args, 8 * 1024 * 1024, env);
const out = (p: Promise<string>) => p.then((s) => s.trim());
const orNull = (run: GitRun, dir: string, args: string[]) => out(run(dir, args)).then((s) => s || null, () => null);

/** `text`: tracked changes and untracked text files, capped. `all`: everything git does not ignore. */
export type CapturePolicy = 'text' | 'all';

export interface Captured {
  /** The tree a commit of the checkout would have. */
  tree: string;
  /** HEAD when it was captured. */
  head: string;
  /** Untracked files a `text` capture left out: binary, too large, or past its limit. Always empty for `all`. */
  skipped: SkippedFile[];
}

/** Untracked files that are not ignored, split into those a `text` capture saves and those it leaves out. */
async function untracked(run: GitRun, dir: string, env: Record<string, string>) {
  const listed = (await run(dir, ['ls-files', '-z', '--others', '--exclude-standard'], env)).split('\0').filter(Boolean);
  const root = real(dir);
  const save: string[] = [];
  const skipped: SkippedFile[] = [];
  const skip = (path: string, reason: SkippedFile['reason']) => skipped.length < MAX_SKIPPED && skipped.push({ path, reason });
  for (const path of listed) {
    // A nested repository: git lists its folder, and it is not this checkout's to save.
    if (path.endsWith('/')) continue;
    const full = join(dir, path);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    // A symlink is saved as the link itself, never followed.
    if (!st.isSymbolicLink()) {
      if (!st.isFile()) continue;
      let at: string;
      try {
        at = realpathSync(full);
      } catch {
        continue;
      }
      if (!at.startsWith(root + sep)) continue;
      if (st.size > MAX_UNTRACKED_BYTES) {
        skip(path, 'too_large');
        continue;
      }
      if (head(full, 8000).includes(0)) {
        skip(path, 'binary');
        continue;
      }
    }
    if (save.length >= MAX_SNAPSHOT_UNTRACKED) skip(path, 'limit');
    else save.push(path);
  }
  return { save, skipped };
}

/**
 * The tree a checkpoint of the checkout at dir holds under `policy`, and HEAD then. Throws with git's reason. Writes
 * only objects and a temporary index outside the repo.
 */
export async function captureTree(dir: string, policy: CapturePolicy, run: GitRun = local): Promise<Captured> {
  const headSha = await orNull(run, dir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (!headSha) throw new Error('The checkout has no commit yet.');
  const tmp = mkdtempSync(join(tmpdir(), 'omni-checkpoint-'));
  const env = { ...CHECKPOINT_IDENT, GIT_INDEX_FILE: join(tmp, 'index') };
  try {
    if (policy === 'all') {
      await run(dir, ['read-tree', headSha], env);
      await run(dir, ['add', '-A'], env);
      return { tree: await out(run(dir, ['write-tree'], env)), head: headSha, skipped: [] };
    }
    // A copy of Ben's index: its stat cache spares hashing files that did not change. Only the copy is written.
    const own = await orNull(run, dir, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
    if (own && existsSync(own)) copyFileSync(own, env.GIT_INDEX_FILE);
    else await run(dir, ['read-tree', headSha], env);
    await run(dir, ['add', '--update'], env);
    const { save, skipped } = await untracked(run, dir, env);
    for (let i = 0; i < save.length; i += ADD_CHUNK) await run(dir, ['--literal-pathspecs', 'add', '--', ...save.slice(i, i + ADD_CHUNK)], env);
    return { tree: await out(run(dir, ['write-tree'], env)), head: headSha, skipped };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface CommitCheckpoint {
  tree: string;
  /** The commit it sits on: the checkout's HEAD when it was captured. */
  parent: string;
  message: string;
  /** The hidden ref that keeps it from garbage collection. */
  ref: string;
  /** `new`: the ref must not exist yet, so two captures never both write it. `replace`: it is moved to this commit. */
  mode: 'new' | 'replace';
}

/** Commit a captured tree and keep it under its ref. Gives the commit. Throws with git's reason. */
export async function commitCheckpoint(repo: string, c: CommitCheckpoint, run: GitRun = local): Promise<string> {
  const sha = await out(run(repo, ['commit-tree', c.tree, '-p', c.parent, '-m', c.message], CHECKPOINT_IDENT));
  // An empty old value: the ref must be new.
  await run(repo, ['update-ref', '--no-deref', c.ref, sha, ...(c.mode === 'new' ? [''] : [])], CHECKPOINT_IDENT);
  return sha;
}

/** The commit a checkpoint ref holds, or null when there is none. */
export const findCheckpoint = (repo: string, ref: string, run: GitRun = local) => orNull(run, repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);

/**
 * Lay a checkpoint out in the checkout at dir, which must be at the checkpoint's parent: its files written, the index
 * back at HEAD, so the changes are uncommitted and new files untracked, as they were where it was captured.
 */
export async function applyCheckpoint(dir: string, sha: string, run: GitRun = local): Promise<void> {
  await run(dir, ['read-tree', '-u', '--reset', sha]);
  await run(dir, ['reset', '--quiet']);
}
