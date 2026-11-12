// A thread's branch follows its worktree. An agent that checks out a branch of its own (git checkout -b feat/x) pushes
// and opens its PR from that one, and everything that finds a thread's PR by its branch (the PRs tab, list marks,
// webhooks, the PR watch, the worktree sweep) would miss it while the row still names omni/<id>.
import { gitOr } from './changes.ts';
import { threads } from './db.ts';
import { inOwnWorktree } from './handoff/worktree.ts';

/**
 * Store the branch checked out in the thread's own worktree when it differs from the stored one. A detached HEAD, a
 * missing folder and the repo's default branch leave the row alone. Returns whether it changed.
 */
export async function followBranch(id: string): Promise<boolean> {
  const t = threads.get(id);
  if (!t || !inOwnWorktree(t)) return false;
  const [current, originHead] = await Promise.all([gitOr(t.cwd, ['branch', '--show-current']), gitOr(t.cwd, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])]);
  if (!current || current === t.branch || `origin/${current}` === originHead) return false;
  // Re-read: the row may have moved on while git ran.
  const now = threads.get(id);
  if (!now || now.branch !== t.branch) return false;
  threads.update(id, { branch: current, updated_at: now.updated_at });
  return true;
}
