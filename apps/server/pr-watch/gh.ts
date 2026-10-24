// The gh reads a PR watch makes: one view of the PR per poll, and a failing check's log only when a wake needs it.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CheckObservation, PRObservation } from './sources.ts';

const run = promisify(execFile);

/** A gh `pr view --json number,state,headRefOid,statusCheckRollup` answer as the watch sees it. */
export function parseObservation(repo: string, raw: any): PRObservation {
  const checks = ((raw.statusCheckRollup ?? []) as any[]).map((c): CheckObservation => {
    const name: string = c.name || c.context || 'check';
    const full = c.workflowName ? `${c.workflowName} / ${name}` : name;
    return { id: full, name: full, state: String(c.conclusion || c.state || c.status || '').toUpperCase(), url: c.detailsUrl || c.targetUrl || null };
  });
  return { repo, number: raw.number, state: raw.state, headSha: raw.headRefOid, checks };
}

export async function observePR(repo: string, number: number): Promise<PRObservation> {
  const { stdout } = await run('gh', ['pr', 'view', String(number), '--repo', repo, '--json', 'number,state,headRefOid,statusCheckRollup'], {
    maxBuffer: 8 * 1024 * 1024,
  });
  return parseObservation(repo, JSON.parse(stdout));
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
