import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { paths, threadDir } from '../config.ts';
import { channels, outbox, threads, type Thread } from '../db.ts';
import { restoreCheckout } from '../workspace.ts';
import { handoffBlock } from '../handoff/records.ts';
import { heldElsewhere, ownedElsewhere } from '../ownership.ts';
import { deviceName } from './devices.ts';

// Whether this machine may start a turn in a thread: its worktree is ready, and for a synced thread, it runs here.
// The one place that decides it, for Ben's replies and for Omni's own wakes alike (docs/adr/0005-one-execution-owner.md).

/** A machine as the refusals name it. */
export const machineName = (id: string) => deviceName(id) ?? 'your other Mac';

/** The owner, when the thread is running or queued on another machine. Null between turns: a reply here then brings the thread here. */
const busyElsewhere = (t: Pick<Thread, 'id' | 'status'>) => (t.status === 'running' || t.status === 'queued' ? heldElsewhere(t.id) : null);

/** True when the thread is running or queued on another machine. A new turn here would fork the session, so the runner must refuse one. */
export const runningElsewhere = (t: Pick<Thread, 'id' | 'status'>) => !!busyElsewhere(t);

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
 * message to the thread is refused with it. A worktree thread is blocked while its worktree is prepared or after
 * that failed; otherwise, with sync never set up here, this is always null.
 * `here`: the runner has the thread (live or waiting for a slot), so a remote write that says running is about this Mac's run.
 * `taking`: this Mac is picking the thread up from a handoff (apps/server/handoff.ts), which its own wait must not block.
 */
export function turnBlocked(t: Thread, here = false, taking = false): string | null {
  // A worktree thread runs only in its own worktree, once Omni has made and checked it (apps/server/runner/setup.ts).
  if (t.setup === 'preparing') return "Omni is still preparing this thread's worktree.";
  if (t.setup === 'failed') return `This thread's worktree could not be prepared: ${(t.setup_error ?? 'unknown error').replace(/\.?$/, '.')} Retry to try again.`;
  const elsewhere = here ? null : busyElsewhere(t);
  if (elsewhere) return `This thread is running on ${machineName(elsewhere.machine)}.`;
  const handoff = handoffBlock(t, taking);
  if (handoff) return handoff;
  if (!outbox.machineId() || existsSync(t.cwd) || rebuildable(t)) return null;
  return `This thread's folder is not on this Mac: ${t.cwd}. Continue it on the Mac that has it, or map the folder to one here in sync.path_map.`;
}

/**
 * Why a wake of Omni's own (a PR watch, a crew report, a limit resume) may not start a turn here, or null. Everything
 * turnBlocked refuses, and a thread another machine holds between turns: a wake never moves a thread, only Ben's
 * reply or Take over does, so it waits here for Resume (docs/adr/0005-one-execution-owner.md).
 */
export function wakeBlocked(t: Thread, here = false): string | null {
  const blocked = turnBlocked(t, here);
  if (blocked) return blocked;
  // A warm process left from a turn here does not make the thread this machine's: the assignment does.
  const owner = ownedElsewhere(t);
  return owner ? `This thread is on ${machineName(owner.machine)}. Resume it to run it here.` : null;
}

/**
 * Before a turn: refuse it with the reason turnBlocked gives, and make the thread's folder here when Omni can,
 * checking its branch out again for a worktree thread (made on the other Mac, or removed by a cleanup).
 * Returns the thread, with its cwd moved when it was.
 */
export async function prepareTurn(t: Thread, here = false, taking = false): Promise<Thread> {
  const blocked = turnBlocked(t, here, taking);
  if (blocked) throw refused(blocked);
  if (existsSync(t.cwd)) return t;
  // A worktree a cleanup removed (apps/server/worktree-cleanup.ts) is cut again from its branch, synced or not.
  const target = rebuildable(t);
  if (!target) return t;
  if (!existsSync(target.cwd)) {
    if (!target.worktree) mkdirSync(target.cwd, { recursive: true });
    else {
      try {
        await restoreCheckout(target.worktree.repo, target.cwd, target.worktree.branch);
      } catch (err) {
        throw refused(`This thread's worktree is not on this Mac and Omni could not make it again: ${(err as Error).message}`);
      }
    }
  }
  // Keep its place in the lists: the turn itself will move it up.
  return target.cwd === t.cwd ? t : threads.update(t.id, { cwd: target.cwd, updated_at: t.updated_at })!;
}
