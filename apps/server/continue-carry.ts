// A continued thread's worktree (apps/server/continue.ts): at setup, before anything runs in it, its branch is cut at
// the source's HEAD and, when the source had its own worktree, the source's snapshot is laid in, uncommitted. Apart from
// continue.ts so runner/setup.ts can call it without loading the runner's API.
import { channels, continuations, type Thread } from './db.ts';
import { git, gitOr } from './changes.ts';
import { prepareWorktree } from './sandbox.ts';

/** Where a continued thread's snapshot commit is kept, so it is never garbage collected. */
export const continueRef = (threadId: string) => `refs/omni/continue/${threadId}`;

/** Who the snapshot commit is by. It never reaches a branch. */
const IDENT = { GIT_AUTHOR_NAME: 'Omni', GIT_AUTHOR_EMAIL: 'omni@localhost', GIT_COMMITTER_NAME: 'Omni', GIT_COMMITTER_EMAIL: 'omni@localhost' };

/**
 * Setup's first step for a continued thread (runner/setup.ts): its branch at the source's HEAD and, when the source
 * had its own worktree, the snapshot laid into the new worktree, uncommitted, as a handoff lays one out
 * (handoff/worktree.ts). Safe to run again until applied: the snapshot commit and the branch are found again rather
 * than made twice. Once applied it never touches the worktree. Throws, saying why, for setup to show.
 */
export async function carryInto(t: Thread): Promise<void> {
  const c = continuations.get(t.id);
  if (!c?.head || c.applied_at || !t.branch) return;
  const repo = channels.get(t.channel_id)?.repo_path;
  if (!repo) throw new Error('The channel has no repository set.');
  let sha = c.snapshot_sha;
  if (c.tree && !sha) {
    sha = await gitOr(repo, ['rev-parse', '--verify', '--quiet', `${continueRef(t.id)}^{commit}`]);
    if (!sha) {
      sha = (await git(repo, ['commit-tree', c.tree, '-p', c.head, '-m', `Omni continue ${t.id}`], undefined, IDENT)).trim();
      // An empty old value: the ref must be new, so two setups never both make one.
      await git(repo, ['update-ref', '--no-deref', continueRef(t.id), sha, '']);
    }
    continuations.setSnapshot(t.id, sha);
  }
  const branch = await gitOr(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${t.branch}^{commit}`]);
  if (!branch) await git(repo, ['update-ref', `refs/heads/${t.branch}`, c.head, '']);
  else if (branch !== c.head) {
    throw new Error(`Branch ${t.branch} already exists at another commit, so Omni left it alone. Rename or delete it, then retry.`);
  }
  await prepareWorktree(repo, t.cwd, t.branch);
  if (sha) {
    await git(t.cwd, ['read-tree', '-u', '--reset', sha]);
    // The index back at HEAD: the changes are uncommitted, and new files untracked, as they were in the source.
    await git(t.cwd, ['reset', '--quiet']);
  }
  continuations.applied(t.id);
}
