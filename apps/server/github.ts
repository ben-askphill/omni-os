import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function gh(args: string[], cwd?: string) {
  const { stdout } = await run('gh', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

export async function detectRepo(repoPath: string): Promise<string | null> {
  try {
    return JSON.parse(await gh(['repo', 'view', '--json', 'nameWithOwner'], repoPath)).nameWithOwner;
  } catch {
    return null;
  }
}

const PR_FIELDS = 'number,title,author,headRefName,baseRefName,state,isDraft,updatedAt,reviewDecision,statusCheckRollup,url,additions,deletions,mergeable';

export function summarizeChecks(rollup: any[] | null | undefined) {
  const s = { passed: 0, failed: 0, pending: 0 };
  for (const c of rollup ?? []) {
    const v = (c.conclusion || c.state || c.status || '').toUpperCase();
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(v)) s.passed++;
    else if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(v)) s.failed++;
    else s.pending++;
  }
  return s;
}

export async function listPRs(repo: string, state = 'open') {
  const prs = JSON.parse(await gh(['pr', 'list', '--repo', repo, '--state', state, '--limit', '40', '--json', PR_FIELDS]));
  return prs.map((p: any) => ({ ...p, checks: summarizeChecks(p.statusCheckRollup), statusCheckRollup: undefined }));
}

/** The PR a branch was opened as: its open one, else the newest (gh lists newest first). */
export function pickBranchPR<T extends { state?: string }>(prs: T[]): T | null {
  return prs.find((p) => p.state === 'OPEN') ?? prs[0] ?? null;
}

/** Every PR opened from a branch, newest first, and the one to show for it. */
export async function branchPRs(repo: string, branch: string) {
  const raw = JSON.parse(await gh(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--limit', '30', '--json', PR_FIELDS]));
  const prs = (raw as any[]).map((p) => ({ ...p, checks: summarizeChecks(p.statusCheckRollup), statusCheckRollup: undefined }));
  return { pr: pickBranchPR(prs), prs };
}

export async function getPR(repo: string, n: number) {
  const [view, diff] = await Promise.all([
    gh(['pr', 'view', String(n), '--repo', repo, '--json', `${PR_FIELDS},body,files,reviews,comments`]),
    gh(['pr', 'diff', String(n), '--repo', repo]).catch((e) => `Could not load diff: ${e.message}`),
  ]);
  const pr = JSON.parse(view);
  return {
    ...pr,
    checks: summarizeChecks(pr.statusCheckRollup),
    checkRuns: (pr.statusCheckRollup ?? []).map((c: any) => ({
      name: c.name || c.context,
      state: (c.conclusion || c.state || c.status || '').toUpperCase(),
      url: c.detailsUrl || c.targetUrl,
    })),
    statusCheckRollup: undefined,
    diff: diff.length > 400_000 ? diff.slice(0, 400_000) + '\n... diff truncated ...' : diff,
  };
}

export async function mergePR(repo: string, n: number, method: 'squash' | 'merge' | 'rebase', deleteBranch: boolean) {
  const args = ['pr', 'merge', String(n), '--repo', repo, `--${method}`];
  if (deleteBranch) args.push('--delete-branch');
  return gh(args);
}

export interface BranchPRMark {
  number: number;
  state: string;
  isDraft: boolean;
  url: string;
}

/** The one PR to mark each branch with: its open one, else its newest. Closed PRs that never merged are left out. */
export function markBranches(prs: (BranchPRMark & { headRefName: string })[]): Record<string, BranchPRMark> {
  const byBranch = new Map<string, (BranchPRMark & { headRefName: string })[]>();
  for (const p of prs) byBranch.set(p.headRefName, [...(byBranch.get(p.headRefName) ?? []), p]);
  const out: Record<string, BranchPRMark> = {};
  for (const [branch, list] of byBranch) {
    const pr = pickBranchPR(list.filter((p) => p.state === 'OPEN' || p.state === 'MERGED'));
    if (pr) out[branch] = { number: pr.number, state: pr.state, isDraft: pr.isDraft, url: pr.url };
  }
  return out;
}

const markCache = new Map<string, { at: number; marks: Record<string, BranchPRMark> }>();

/** Branch to PR for a whole repo in one gh call, so a thread list does not ask per thread. Cached for 30s. */
export async function threadPRMarks(repo: string) {
  const hit = markCache.get(repo);
  if (hit && Date.now() - hit.at < 30_000) return hit.marks;
  const raw = JSON.parse(await gh(['pr', 'list', '--repo', repo, '--state', 'all', '--limit', '200', '--json', 'number,state,isDraft,headRefName,url']));
  const marks = markBranches(raw);
  markCache.set(repo, { at: Date.now(), marks });
  return marks;
}
