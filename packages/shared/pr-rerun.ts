// Rerunning a PR's failed GitHub Actions runs (POST /api/channels/:id/prs/:n/rerun-failed): which checks it covers and
// what its answer says. The server, the Web UI (desktop and phone) and the iOS app share it.
import { checkTone } from './thread-glance.ts';

export interface RerunCheck {
  state: string;
  url?: string | null;
}

/**
 * The workflow runs behind a PR's failing checks, each once, by id. A failing check that is not a GitHub Actions job (a
 * commit status, another app's check) has no run to rerun and is left out.
 */
export function failedRunIds(checks: readonly RerunCheck[]): string[] {
  const ids = new Set<string>();
  for (const c of checks) {
    if (checkTone(String(c.state ?? '').toUpperCase()) !== 'needs') continue;
    const m = c.url?.match(/\/actions\/runs\/(\d+)/);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

export interface RerunResult {
  /** Each failing run, in check order: `ok` when gh started its failed jobs again, else gh's last error line. */
  runs: { id: string; ok: boolean; error?: string }[];
  /** Failing checks with no workflow run behind them. */
  skipped: number;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** One line for the PR view: how many runs started again, and why any did not. */
export function rerunText(r: RerunResult): string {
  const started = r.runs.filter((x) => x.ok).length;
  const failed = r.runs.filter((x) => !x.ok);
  const head =
    failed.length === 0
      ? `Rerunning the failed jobs of ${plural(started, 'workflow run')}.`
      : `Reran ${started} of ${plural(r.runs.length, 'workflow run')}. ${failed.map((x) => `Run ${x.id}: ${x.error ?? 'gh failed'}`).join(' ')}`;
  return r.skipped ? `${head} ${plural(r.skipped, 'failing check')} outside GitHub Actions left as is.` : head;
}
