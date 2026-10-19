// Each turn's saved diff. Before a worktree thread's turn starts and once it ends, Omni saves its checkout as a commit
// under a hidden ref (refs/omni/turns/<thread>/<turn>/before and /after): HEAD's tree plus every tracked change and
// every untracked text file git does not ignore. The commits are built in a temporary index, so Ben's branch, HEAD
// and index are never touched, and the refs keep them from garbage collection, so the turn's diff reads the same
// after later edits and restarts. It is a before/after snapshot: commits, pulls and other git operations made during
// the turn are part of it.
import { copyFileSync, existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { turnSnapshots, type SkippedFile, type Thread, type TurnSnapshot, type TurnSnapshotState } from './db.ts';
import { isRemoteHarness, remoteWhere } from './harness/types.ts';
import { MAX_UNTRACKED_BYTES, changesCheckout, commitsGroup, git, gitOr, head, real, type ChangeGroup, type ChangedFile } from './changes.ts';

export const TURN_REFS = 'refs/omni/turns';
/** A turn's hidden ref: one per side, named by the thread and the turn's id. */
export const turnRef = (threadId: string, turnId: string, side: 'before' | 'after') => `${TURN_REFS}/${threadId}/${turnId}/${side}`;

/** Untracked files saved per snapshot. Past this they are listed as left out. */
export const MAX_SNAPSHOT_UNTRACKED = 2_000;
/** Left-out files remembered per snapshot. */
const MAX_SKIPPED = 200;
/** Paths per `git add`, to stay under the argument limit. */
const ADD_CHUNK = 200;

/** Who the snapshot commits are by. They never reach a branch. */
const IDENT = { GIT_AUTHOR_NAME: 'Omni', GIT_AUTHOR_EMAIL: 'omni@localhost', GIT_COMMITTER_NAME: 'Omni', GIT_COMMITTER_EMAIL: 'omni@localhost' };

export interface Snapshot {
  /** The snapshot commit, whose parent is HEAD. */
  sha: string;
  /** HEAD when it was taken. */
  head: string;
  skipped: SkippedFile[];
}

/**
 * The checkout a thread's turns are saved from, or why none is. Only a thread's own worktree, checked to be its
 * worktree on its branch: a thread that runs in the channel's repo shares it with Ben, so its turns are not saved.
 */
export async function snapshotCheckout(t: Thread | undefined): Promise<{ dir: string } | { reason: string }> {
  if (!t) return { reason: 'The thread is gone.' };
  if (isRemoteHarness(t.harness)) return { reason: `This thread runs ${remoteWhere(t.harness)}, so its files are not on this Mac.` };
  if (!t.branch) return { reason: 'Turns are saved only for a thread with a worktree of its own.' };
  return changesCheckout(t);
}

/** Untracked files that are not ignored, split into those a snapshot saves and those it leaves out. */
async function untracked(dir: string, env: Record<string, string>) {
  const listed = (await git(dir, ['ls-files', '-z', '--others', '--exclude-standard'], 8 * 1024 * 1024, env)).split('\0').filter(Boolean);
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
 * Save the checkout at dir as a commit under ref, which must not exist yet. Throws with git's reason. Writes only
 * objects, a temporary index outside the repo and the one ref.
 */
export async function snapshot(dir: string, ref: string): Promise<Snapshot> {
  const headSha = await gitOr(dir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (!headSha) throw new Error('The checkout has no commit yet.');
  const tmp = mkdtempSync(join(tmpdir(), 'omni-turn-'));
  const env = { ...IDENT, GIT_INDEX_FILE: join(tmp, 'index') };
  try {
    // A copy of Ben's index: its stat cache spares hashing files that did not change. Only the copy is written.
    const own = await gitOr(dir, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
    if (own && existsSync(own)) copyFileSync(own, env.GIT_INDEX_FILE);
    else await git(dir, ['read-tree', headSha], undefined, env);
    await git(dir, ['add', '--update'], undefined, env);
    const { save, skipped } = await untracked(dir, env);
    for (let i = 0; i < save.length; i += ADD_CHUNK) await git(dir, ['--literal-pathspecs', 'add', '--', ...save.slice(i, i + ADD_CHUNK)], undefined, env);
    const tree = (await git(dir, ['write-tree'], undefined, env)).trim();
    const sha = (await git(dir, ['commit-tree', tree, '-p', headSha, '-m', `Omni turn snapshot ${ref}`], undefined, env)).trim();
    // An empty old value: the ref must be new, so a snapshot is never replaced.
    await git(dir, ['update-ref', '--no-deref', ref, sha, ''], undefined, env);
    return { sha, head: headSha, skipped };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** One side of a turn, as the clients get it. */
export interface TurnSide {
  /** The snapshot commit, kept under `ref`. */
  sha: string;
  ref: string;
  /** HEAD at that moment. A different HEAD after means the turn committed, pulled or switched commits. */
  head: string;
}

/** One turn's saved diff, without its files (GET /api/threads/:id/turns). */
export interface TurnView {
  id: string;
  n: number;
  state: TurnSnapshotState;
  error: string | null;
  before: TurnSide | null;
  after: TurnSide | null;
  /** The Result the turn ended with, the same id as in Needs you. Null while it runs, or when it left none. */
  completion_uid: string | null;
  started_at: string;
  ended_at: string | null;
}

export function turnView(s: TurnSnapshot): TurnView {
  return {
    id: s.id,
    n: s.n,
    state: s.state,
    error: s.error,
    before: s.before_sha && s.before_head ? { sha: s.before_sha, ref: turnRef(s.thread_id, s.id, 'before'), head: s.before_head } : null,
    after: s.after_sha && s.after_head ? { sha: s.after_sha, ref: turnRef(s.thread_id, s.id, 'after'), head: s.after_head } : null,
    completion_uid: s.completion_uid,
    started_at: s.started_at,
    ended_at: s.ended_at,
  };
}

/** GET /api/threads/:id/turns: the thread's saved turns, newest first, and the diff of one of them. */
export interface TurnChanges {
  /** False when this thread's turns are not saved here; `reason` says why. */
  available: boolean;
  reason: string | null;
  turns: TurnView[];
  /** The turn shown: the one asked for, else the newest. */
  turn: TurnView | null;
  /** Its files, once both snapshots are saved: one `turn` group. */
  groups: ChangeGroup[];
}

const parseSkipped = (s: string | null): SkippedFile[] => {
  try {
    return s ? (JSON.parse(s) as SkippedFile[]) : [];
  } catch {
    return [];
  }
};

/** An untracked file the after snapshot left out and the before one did not: listed without its text. */
const skippedFile = (f: SkippedFile): ChangedFile => ({
  path: f.path,
  old_path: null,
  status: 'added',
  additions: null,
  deletions: null,
  binary: f.reason === 'binary',
  omitted: f.reason,
  diff: '',
});

/** A thread's saved turns and the diff of `turnId` (the newest when not given). Null when that turn is not the thread's. */
export async function turnChanges(t: Thread, turnId?: string): Promise<TurnChanges | null> {
  const at = await snapshotCheckout(t);
  if ('reason' in at) return turnId ? null : { available: false, reason: at.reason, turns: [], turn: null, groups: [] };
  const rows = turnSnapshots.forThread(t.id);
  const row = turnId ? turnSnapshots.get(turnId) : rows[0];
  if (turnId && row?.thread_id !== t.id) return null;
  const turns = rows.map(turnView);
  if (!row) return { available: true, reason: null, turns, turn: null, groups: [] };
  let turn = turnView(row);
  if (turn.state !== 'ready' || !turn.before || !turn.after) return { available: true, reason: null, turns, turn, groups: [] };
  // The refs are the snapshots' only hold in the repo: read them only while they still name the saved commits.
  const [b, a] = await Promise.all([turn.before, turn.after].map((s) => gitOr(at.dir, ['rev-parse', '--verify', '--quiet', `${s.ref}^{commit}`])));
  if (b !== turn.before.sha || a !== turn.after.sha) {
    turn = { ...turn, state: 'failed', error: "This turn's snapshots are no longer in the repository." };
    return { available: true, reason: null, turns: turns.map((x) => (x.id === turn.id ? turn : x)), turn, groups: [] };
  }
  const group = await commitsGroup(at.dir, 'turn', turn.before.sha, turn.after.sha);
  const before = new Set(parseSkipped(row.before_skipped).map((f) => f.path));
  const listed = new Set(group.files.map((f) => f.path));
  const left = parseSkipped(row.after_skipped).filter((f) => !before.has(f.path) && !listed.has(f.path));
  return { available: true, reason: null, turns, turn, groups: [{ ...group, files: [...group.files, ...left.map(skippedFile)] }] };
}
