// The PRs a thread's crew opened, so the Conductor that delegated work sees what came of it. Each thread it delegated
// to, at any depth (a team's members under their lead), gives the PR from its branch. Asked of GitHub on every read
// and never stored, so a merge or a close shows on the parent as soon as it shows on the child.
import { channels, threads } from './db.ts';
import { openPRStates, threadPRMarks, type BranchPRMark, type PRMergeState } from './github.ts';

/** An open one also carries its merge state (`mergeable`, `checks`, `reviewDecision`), left out when gh could not say. */
export interface CrewPR extends BranchPRMark, Partial<PRMergeState> {
  repo: string;
  /** The delegated thread whose branch it came from. */
  thread_id: string;
  thread_title: string;
  channel_id: string;
  task_id: string | null;
}

/**
 * One PR a delegated thread's branch was opened as (its open one, else its newest merged one), oldest delegation first.
 * A PR two threads share shows once, under the first. One `gh` call per repo, cached (github.ts threadPRMarks); a repo
 * gh cannot read is left out. A repo with an open one costs a second call for the merge states (openPRStates).
 */
export async function crewPRs(threadId: string): Promise<CrewPR[]> {
  const crew = threads.descendants(threadId).flatMap((t) => {
    const repo = t.branch ? channels.get(t.channel_id)?.github_repo : null;
    return repo ? [{ t, repo, branch: t.branch! }] : [];
  });
  const marks = new Map(
    [...new Set(crew.map((c) => c.repo))].map((repo) => [repo, threadPRMarks(repo).catch((): Record<string, BranchPRMark> => ({}))]),
  );
  const seen = new Set<string>();
  const out: CrewPR[] = [];
  for (const { t, repo, branch } of crew) {
    const pr = (await marks.get(repo)!)[branch];
    if (!pr || seen.has(pr.url)) continue;
    seen.add(pr.url);
    out.push({ ...pr, repo, thread_id: t.id, thread_title: t.title, channel_id: t.channel_id, task_id: t.task_id });
  }
  const open = [...new Set(out.filter((p) => p.state === 'OPEN').map((p) => p.repo))];
  const states = new Map(await Promise.all(open.map(async (repo) => [repo, await openPRStates(repo).catch((): Record<number, PRMergeState> => ({}))] as const)));
  return out.map((p) => {
    const s = p.state === 'OPEN' ? states.get(p.repo)?.[p.number] : undefined;
    return s ? { ...p, ...s } : p;
  });
}

/** The thread a PR came from, and the thread that delegated it, for a link back from the PR page. */
export interface PRThread {
  id: string;
  title: string;
  channel_id: string;
  parent: { id: string; title: string } | null;
}

/** The newest thread on the PR's head branch in a channel on the same repo. null for a PR opened outside Omni. */
export function prThread(repo: string, branch: string): PRThread | null {
  const t = threads.withBranch(branch).find((t) => channels.get(t.channel_id)?.github_repo === repo);
  if (!t) return null;
  const parent = t.parent_id ? threads.get(t.parent_id) : null;
  return { id: t.id, title: t.title, channel_id: t.channel_id, parent: parent ? { id: parent.id, title: parent.title } : null };
}
