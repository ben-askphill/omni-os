// The PRs a thread's crew opened, so the Conductor that delegated work sees what came of it. Each thread it delegated
// to, at any depth (a team's members under their lead), gives the PR from its branch. Asked of GitHub on every read
// and never stored, so a merge or a close shows on the parent as soon as it shows on the child.
import { channels, threads } from './db.ts';
import { threadPRMarks, type BranchPRMark } from './github.ts';

export interface CrewPR extends BranchPRMark {
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
 * gh cannot read is left out.
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
  return out;
}
