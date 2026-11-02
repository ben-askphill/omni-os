import { threads, type Thread } from './db.ts';
import { getPR } from './github.ts';
import { createThread } from './runner.ts';

/** Prefer the nearest Conductor ancestor, even through a team lead. Otherwise keep the branch owner. */
function reviewParent(origin: Thread): Thread {
  const seen = new Set([origin.id]);
  let id = origin.parent_id;
  while (id && !seen.has(id)) {
    seen.add(id);
    const parent = threads.get(id);
    if (!parent) break;
    if (parent.role === 'conductor' || parent.channel_id === 'conductor') return parent;
    id = parent.parent_id;
  }
  return origin;
}

export async function requestPRReview(channel: string, repo: string, number: number) {
  const pr = await getPR(repo, number);
  // A fork's branch with the same name does not belong to a thread in the base repo.
  const owners = pr.isCrossRepository ? [] : threads.byRepoBranch(repo, pr.headRefName);
  // Multiple threads can share a branch. Its generated name identifies the original owner when possible.
  const named = owners.filter((t) => pr.headRefName === `omni/${t.id}` || pr.headRefName === `omni/${t.id.slice(0, 8)}`);
  const origin = named.length === 1 ? named[0] : owners.length === 1 ? owners[0] : null;
  const parent = origin ? reviewParent(origin) : null;
  const prompt = [
    `Review PR #${number} in ${repo}: summarize the change, risks, and anything that should block merge.`,
    `PR: ${pr.url}. Head branch: ${pr.headRefName}. Base branch: ${pr.baseRefName}.`,
    ...(pr.mergeable === 'CONFLICTING' ? [
      'This PR has merge conflicts. Resolve them against the latest base branch, run the relevant checks, and push the resolution to the existing PR head branch.',
    ] : []),
    'Fetch the existing PR head and base your work on that commit before editing. Keep your dedicated worktree on its assigned branch; push any fixes with an explicit HEAD:<PR head branch> refspec. Do not open a replacement PR or merge this PR.',
    ...(origin ? [`Originating builder thread: ${origin.id}. Report the result to the parent thread that delegated this review.`] : []),
  ].join('\n\n');
  const child = await createThread({
    channel: origin?.channel_id ?? channel,
    role: 'builder',
    title: `Review PR #${number}`,
    prompt,
    ...(parent ? { parent_id: parent.id, source: 'conductor' as const } : {}),
  });
  return { thread_id: child.id, destination_thread_id: parent?.id ?? child.id };
}
