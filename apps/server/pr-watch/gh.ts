// The gh reads a PR watch makes: one view of the PR per poll, and a failing check's log only when a wake needs it.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { trustedPR, type PRInfo } from '../automation-events.ts';
import { MAX_BODY, type CheckObservation, type FeedbackObservation, type PRObservation } from './sources.ts';

const run = promisify(execFile);

/** A gh `pr view --json number,state,headRefOid,statusCheckRollup` answer as the watch sees it. */
export function parseObservation(repo: string, raw: any, viewer = '', feedback: FeedbackObservation[] = []): PRObservation {
  const checks = ((raw.statusCheckRollup ?? []) as any[]).map((c): CheckObservation => {
    const name: string = c.name || c.context || 'check';
    const full = c.workflowName ? `${c.workflowName} / ${name}` : name;
    return { id: full, name: full, state: String(c.conclusion || c.state || c.status || '').toUpperCase(), url: c.detailsUrl || c.targetUrl || null };
  });
  return { repo, number: raw.number, state: raw.state, headSha: raw.headRefOid, checks, viewer, feedback };
}

/**
 * The gh api projections the three kinds of feedback are read through: one JSON object per line, whatever the page, with
 * the body cut so a huge bot comment is not carried around. Reviews and conversation comments sit on the PR's issue.
 */
const FEEDBACK_JQ = (extra: string) =>
  `.[] | {id, user: (.user.login // "ghost"), bot: ((.user.type // "") == "Bot"), assoc: (.author_association // ""), body: ((.body // "")[:${MAX_BODY}]), url: .html_url${extra}}`;
const FEEDBACK_READS = [
  { kind: 'review', path: 'pulls/{n}/reviews', jq: FEEDBACK_JQ(', at: (.submitted_at // ""), commit: .commit_id, state')},
  { kind: 'inline', path: 'pulls/{n}/comments', jq: FEEDBACK_JQ(', at: (.updated_at // .created_at), commit: .commit_id, path, line: (.line // .original_line)') },
  { kind: 'comment', path: 'issues/{n}/comments', jq: FEEDBACK_JQ(', at: (.updated_at // .created_at)') },
] as const;

/** The lines one feedback read printed, as observations. A line that is not JSON is left out. */
export function parseFeedback(kind: FeedbackObservation['kind'], stdout: string): FeedbackObservation[] {
  const out: FeedbackObservation[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let r: any;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    out.push({
      kind,
      id: r.id,
      author: r.user ?? 'ghost',
      bot: !!r.bot,
      association: r.assoc ?? '',
      body: r.body ?? '',
      url: r.url ?? null,
      at: r.at ?? '',
      commit: r.commit ?? null,
      path: r.path ?? null,
      line: r.line ?? null,
      state: r.state ?? null,
    });
  }
  return out;
}

let viewerAt = 0;
let viewerLogin: Promise<string> | null = null;

/** The account gh is signed in as, asked once an hour. A failure is not remembered. */
function viewer(now: number): Promise<string> {
  if (!viewerLogin || now - viewerAt > 3600_000) {
    viewerAt = now;
    viewerLogin = run('gh', ['api', 'user', '--jq', '.login']).then(({ stdout }) => stdout.trim());
    viewerLogin.catch(() => (viewerLogin = null));
  }
  return viewerLogin;
}

export async function observePR(repo: string, number: number): Promise<PRObservation> {
  const [view, who, ...reads] = await Promise.all([
    run('gh', ['pr', 'view', String(number), '--repo', repo, '--json', 'number,state,headRefOid,statusCheckRollup'], { maxBuffer: 8 * 1024 * 1024 }),
    viewer(Date.now()),
    ...FEEDBACK_READS.map((f) =>
      run('gh', ['api', '--paginate', `repos/${repo}/${f.path.replace('{n}', String(number))}`, '--jq', f.jq], { maxBuffer: 32 * 1024 * 1024 }),
    ),
  ]);
  const feedback = FEEDBACK_READS.flatMap((f, i) => parseFeedback(f.kind, reads[i].stdout));
  return parseObservation(repo, JSON.parse(view.stdout), who, feedback);
}

/** The last lines of a failing log, without gh's job and step columns or timestamps, cut to `max` characters. */
export function logTail(log: string, lines = 40, max = 3000): string | null {
  const tail = log
    .split('\n')
    .filter((l) => l.trim())
    .slice(-lines)
    .map((l) => (l.split('\t').at(-1) ?? l).replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '').slice(0, 300))
    .join('\n');
  if (!tail) return null;
  return tail.length > max ? tail.slice(-max) : tail;
}

/** A GitHub Actions job's failing log tail. Null for any other kind of check. */
export async function checkLog(repo: string, check: CheckObservation): Promise<string | null> {
  const m = check.url?.match(/\/actions\/runs\/(\d+)\/job\/(\d+)/);
  if (!m) return null;
  const { stdout } = await run('gh', ['run', 'view', m[1], '--repo', repo, '--job', m[2], '--log-failed'], { maxBuffer: 32 * 1024 * 1024 });
  return logTail(stdout);
}

/**
 * The PR a branch name means in `repo`: the first open one whose head lives in the repo itself. A fork can open a PR
 * from a branch of the same name, and its checks run the fork's code, so its PRs never count.
 */
export function ownBranchPR(repo: string, list: any[]): number | null {
  const owner = repo.split('/')[0].toLowerCase();
  const pr = list.find((p) => !p.isCrossRepository && String(p.headRepositoryOwner?.login ?? '').toLowerCase() === owner);
  return pr ? Number(pr.number) : null;
}

/**
 * A PR's checks, when they are safe to hand an agent: the PR is open, its head is in the repo itself and its author has
 * a role on the repo (the trustedPR rule in automation-events.ts). Null otherwise.
 */
export function trustedChecks(repo: string, view: any, association: string | undefined): { number: number; checks: CheckObservation[] } | null {
  if ((view.state ?? 'OPEN') !== 'OPEN') return null;
  if (!trustedPR({ isCrossRepository: view.isCrossRepository, authorAssociation: association } as PRInfo)) return null;
  return { number: view.number, checks: parseObservation(repo, view).checks };
}

/**
 * The checks on the open PR `number` names, else on the branch's own open PR (`ownBranchPR`). Null when there is none,
 * or it fails `trustedChecks`.
 */
export async function branchChecks(repo: string, branch: string, number?: number | null): Promise<{ number: number; checks: CheckObservation[] } | null> {
  const opts = { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 };
  let n = number ?? null;
  if (!n) {
    const { stdout } = await run('gh', ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--limit', '10', '--json', 'number,isCrossRepository,headRepositoryOwner,author'], opts);
    n = ownBranchPR(repo, JSON.parse(stdout));
    if (!n) return null;
  }
  // gh pr view has no authorAssociation, so it comes from the REST answer.
  const [view, assoc] = await Promise.all([
    run('gh', ['pr', 'view', String(n), '--repo', repo, '--json', 'number,state,isCrossRepository,headRefOid,statusCheckRollup'], opts),
    run('gh', ['api', `repos/${repo}/pulls/${n}`, '--jq', '.author_association'], opts),
  ]);
  return trustedChecks(repo, JSON.parse(view.stdout), assoc.stdout.trim());
}
