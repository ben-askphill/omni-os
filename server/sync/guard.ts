import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { paths, threadDir } from '../config.ts';
import { channels, outbox, syncMeta, threads, type Thread } from '../db.ts';
import { restoreWorktree } from '../sandbox.ts';

// Whether this machine may start a turn in a synced thread.

/**
 * True when the thread is running or queued on another machine: the last write to it came from there.
 * A new turn here would fork the session, so the runner must refuse one.
 */
export function runningElsewhere(t: Pick<Thread, 'id' | 'status'>): boolean {
  if (t.status !== 'running' && t.status !== 'queued') return false;
  const self = outbox.machineId();
  const last = syncMeta.get('thread', t.id);
  return !!self && !!last && last.machine_id !== self;
}

/** A refused turn. app.ts answers it as a 409 with the message. */
const refused = (message: string) => Object.assign(new Error(message), { status: 409 });

/**
 * Where a thread whose folder is not here can run on this Mac, when Omni can make that folder: its own data
 * folder, or its worktree, cut again from its branch. Both sit under the data dir, which may live elsewhere
 * on the other Mac, so they are matched by shape (".../threads/<id>", ".../worktrees/<id>") and put in this one's.
 */
function rebuildable(t: Thread): { cwd: string; worktree?: { repo: string; branch: string } } | null {
  if (basename(t.cwd) !== t.id) return null;
  const area = basename(dirname(t.cwd));
  if (area === 'threads') return { cwd: threadDir(t.id) };
  const repo = channels.get(t.channel_id)?.repo_path;
  if (area === 'worktrees' && t.branch && repo && existsSync(repo)) return { cwd: join(paths.worktrees, t.id), worktree: { repo, branch: t.branch } };
  return null;
}

/**
 * Why this Mac cannot start a turn in the thread, or null when it can. GET /api/threads/:id shows it, and a
 * message to the thread is refused with it. With sync never set up here this is always null: nothing changes.
 * `here`: the runner has the thread (live or waiting for a slot), so a remote write that says running is about this Mac's run.
 */
export function turnBlocked(t: Thread, here = false): string | null {
  if (!here && runningElsewhere(t)) return 'This thread is running on your other Mac. Wait for it to finish there, or reply there.';
  if (!outbox.machineId() || existsSync(t.cwd) || rebuildable(t)) return null;
  return `This thread's folder is not on this Mac: ${t.cwd}. Continue it on the Mac that has it, or map the folder to one here in sync.path_map.`;
}

/**
 * Before a turn: refuse it with the reason turnBlocked gives, and make the thread's folder here when Omni can,
 * checking its branch out again for a worktree thread. Returns the thread, with its cwd moved when it was.
 */
export async function prepareTurn(t: Thread, here = false): Promise<Thread> {
  const blocked = turnBlocked(t, here);
  if (blocked) throw refused(blocked);
  if (!outbox.machineId() || existsSync(t.cwd)) return t;
  const target = rebuildable(t)!;
  if (!existsSync(target.cwd)) {
    if (!target.worktree) mkdirSync(target.cwd, { recursive: true });
    else {
      try {
        await restoreWorktree(target.worktree.repo, target.cwd, target.worktree.branch);
      } catch (err) {
        throw refused(`This thread's worktree is not on this Mac and Omni could not make it again: ${(err as Error).message}`);
      }
    }
  }
  // Keep its place in the lists: the turn itself will move it up.
  return target.cwd === t.cwd ? t : threads.update(t.id, { cwd: target.cwd, updated_at: t.updated_at })!;
}
