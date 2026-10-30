// A continued thread's worktree (apps/server/continue.ts): at setup, before anything runs in it, its branch is cut at
// the source's HEAD and, when the source had its own worktree, the source's snapshot is laid in, uncommitted. Apart from
// continue.ts so runner/setup.ts can call it without loading the runner's API.
import { channels, continuations, type Thread } from './db.ts';
import { git, gitOr } from './changes.ts';
import { applyCheckpoint, commitCheckpoint, findCheckpoint } from './checkpoint.ts';
import { prepareWorktree } from './sandbox.ts';

/** Where a continued thread's snapshot commit is kept, so it is never garbage collected. */
export const continueRef = (threadId: string) => `refs/omni/continue/${threadId}`;

/**
 * Setup's first step for a continued thread (runner/setup.ts): its branch at the source's HEAD and, when the source
 * had its own worktree, the snapshot laid into the new worktree, uncommitted, as a handoff lays one out (both through
 * checkpoint.ts). Safe to run again until applied: the snapshot commit and the branch are found again rather
 * than made twice. Once applied it never touches the worktree. Throws, saying why, for setup to show.
 */
export async function carryInto(t: Thread): Promise<void> {
  const c = continuations.get(t.id);
  if (!c?.head || c.applied_at || !t.branch) return;
  const repo = channels.get(t.channel_id)?.repo_path;
  if (!repo) throw new Error('The channel has no repository set.');
  let sha = c.snapshot_sha;
  if (c.tree && !sha) {
    // A new ref only, so two setups never both make one.
    sha = (await findCheckpoint(repo, continueRef(t.id))) ?? (await commitCheckpoint(repo, { tree: c.tree, parent: c.head, message: `Omni continue ${t.id}`, ref: continueRef(t.id), mode: 'new' }));
    continuations.setSnapshot(t.id, sha);
  }
  const branch = await gitOr(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${t.branch}^{commit}`]);
  if (!branch) await git(repo, ['update-ref', `refs/heads/${t.branch}`, c.head, '']);
  else if (branch !== c.head) {
    throw new Error(`Branch ${t.branch} already exists at another commit, so Omni left it alone. Rename or delete it, then retry.`);
  }
  await prepareWorktree(repo, t.cwd, t.branch);
  // The changes uncommitted, and new files untracked, as they were in the source.
  if (sha) await applyCheckpoint(t.cwd, sha);
  continuations.applied(t.id);
}
