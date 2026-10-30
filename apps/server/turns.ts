// Each turn's saved diff. Before a worktree thread's turn starts and once it ends, Omni saves its checkout as a commit
// under a hidden ref (refs/omni/turns/<thread>/<turn>/before and /after): HEAD's tree plus every tracked change and
// every untracked text file git does not ignore, saved as checkpoints (checkpoint.ts), so Ben's branch, HEAD and index
// are never touched, and the refs keep them from garbage collection, so the turn's diff reads the same after later
// edits and restarts. It is a before/after snapshot: commits, pulls and other git operations made during
// the turn are part of it.
import { turnSnapshots, type SkippedFile, type Thread, type TurnSnapshot, type TurnSnapshotState } from './db.ts';
import { isRemoteHarness, remoteWhere } from './harness/types.ts';
import { changesCheckout, commitsGroup, gitOr, type ChangeGroup, type ChangedFile } from './changes.ts';
import { captureTree, commitCheckpoint } from './checkpoint.ts';

export const TURN_REFS = 'refs/omni/turns';
/** A turn's hidden ref: one per side, named by the thread and the turn's id. */
export const turnRef = (threadId: string, turnId: string, side: 'before' | 'after') => `${TURN_REFS}/${threadId}/${turnId}/${side}`;

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

/**
 * Save the checkout at dir as a checkpoint under ref, which must not exist yet: tracked changes and untracked text
 * files, what the turn's diff shows. Throws with git's reason. Writes only objects, a temporary index outside the repo
 * and the one ref.
 */
export async function snapshot(dir: string, ref: string): Promise<Snapshot> {
  const { tree, head, skipped } = await captureTree(dir, 'text');
  // A new ref only, so a snapshot is never replaced.
  const sha = await commitCheckpoint(dir, { tree, parent: head, message: `Omni turn snapshot ${ref}`, ref, mode: 'new' });
  return { sha, head, skipped };
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
