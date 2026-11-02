import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function gh(args: string[], cwd?: string, timeout?: number) {
  const { stdout } = await run('gh', args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout });
  return stdout;
}

/** For the worktree checks, which hold a thread's folder while they run (workspace.ts), and the PR lists: a stalled `gh` gives up. */
const CHECK_TIMEOUT = 30_000;

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
  const prs = JSON.parse(await gh(['pr', 'list', '--repo', repo, '--state', state, '--limit', '40', '--json', PR_FIELDS], undefined, CHECK_TIMEOUT));
  return prs.map((p: any) => ({ ...p, checks: summarizeChecks(p.statusCheckRollup), statusCheckRollup: undefined }));
}

type Listed = Awaited<ReturnType<typeof listPRs>>[number];

/**
 * Every repo's open PRs and its 40 newest in any state, each marked with its repo: open ones first, then by last
 * update, newest first. A repo gh cannot read (no access, gone, gh signed out) goes in `failed` and the rest still list.
 */
export async function allPRs(repos: string[]) {
  const results = await Promise.allSettled(
    repos.map(async (repo) => {
      const [open, recent] = await Promise.all([listPRs(repo, 'open'), listPRs(repo, 'all')]);
      const byNumber = new Map<number, Listed>([...recent, ...open].map((p) => [p.number, p]));
      return [...byNumber.values()].map((p) => ({ ...p, repo }));
    }),
  );
  const isOpen = (p: Listed) => (p.state ?? 'OPEN') === 'OPEN';
  const prs = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [{ repo: repos[i], error: ghError(r.reason) }] : []));
  return { repos, prs, failed };
}

/** The last line gh printed to stderr, which says why ("Could not resolve to a Repository", "HTTP 401"). */
function ghError(e: unknown) {
  const err = e as { stderr?: string; message?: string; killed?: boolean };
  if (err.killed) return `gh gave no answer in ${CHECK_TIMEOUT / 1000}s`;
  return (err.stderr || err.message || String(e)).trim().split('\n').pop() || 'gh failed';
}

/** The PR a branch was opened as: its open one, else the newest (gh lists newest first). */
export function pickBranchPR<T extends { state?: string }>(prs: T[]): T | null {
  return prs.find((p) => p.state === 'OPEN') ?? prs[0] ?? null;
}

/** Every PR opened from a branch, newest first, and the one to show for it. */
export async function branchPRs(repo: string, branch: string) {
  const raw = JSON.parse(await gh(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--limit', '30', '--json', PR_FIELDS], undefined, CHECK_TIMEOUT));
  const prs = (raw as any[]).map((p) => ({ ...p, checks: summarizeChecks(p.statusCheckRollup), statusCheckRollup: undefined }));
  return { pr: pickBranchPR(prs), prs };
}

/** The merged PRs a branch was opened as, newest first, with the branch each went into, its head and its merge commit. */
export async function mergedBranchPRs(repo: string, branch: string): Promise<{ number: number; headRefOid: string; baseRefName: string; mergeCommit: { oid: string } | null }[]> {
  return JSON.parse(await gh(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'merged', '--limit', '5', '--json', 'number,headRefOid,baseRefName,mergeCommit'], undefined, CHECK_TIMEOUT));
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
  title: string;
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
    if (pr) out[branch] = { number: pr.number, title: pr.title, state: pr.state, isDraft: pr.isDraft, url: pr.url };
  }
  return out;
}

const markCache = new Map<string, { at: number; marks: Record<string, BranchPRMark> }>();

/** Branch to PR for a whole repo in one gh call, so a thread list does not ask per thread. Cached for 30s. */
export async function threadPRMarks(repo: string) {
  const hit = markCache.get(repo);
  if (hit && Date.now() - hit.at < 30_000) return hit.marks;
  const raw = JSON.parse(await gh(['pr', 'list', '--repo', repo, '--state', 'all', '--limit', '200', '--json', 'number,title,state,isDraft,headRefName,url']));
  const marks = markBranches(raw);
  markCache.set(repo, { at: Date.now(), marks });
  return marks;
}
