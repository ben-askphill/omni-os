import { getCrew } from './crew.ts';
import { threads, type Thread } from './db.ts';
import { getPR } from './github.ts';
import { createThread } from './runner.ts';
import { refusal } from './runner/state.ts';

/** The role the Review PR action runs as: it resolves conflicts and pushes fixes, so a review role (read only) would not do. */
const REVIEW_PR_ROLE = 'builder';

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
  // Refused before GitHub is asked, with a way out, rather than the role check's list of other roles.
  const builder = getCrew(REVIEW_PR_ROLE);
  if (!builder) throw refusal(`Review PR runs as the ${REVIEW_PR_ROLE} agent, and this machine has none.`, 409);
  if (builder.hidden) throw refusal(`Review PR runs as ${builder.name}, which is hidden on this machine. Show it in Settings > Agents to use Review PR.`, 409);
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
    role: REVIEW_PR_ROLE,
    title: `Review PR #${number}`,
    prompt,
    ...(parent ? { parent_id: parent.id, source: 'conductor' as const } : {}),
  });
  return { thread_id: child.id, destination_thread_id: parent?.id ?? child.id };
}
