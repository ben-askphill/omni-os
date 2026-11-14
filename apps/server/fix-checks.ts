// The Fix checks step's message: the step prompt, then the open PR's failing checks with their log tails, read with gh
// the way a PR watch wake reads them. Composed here so the web, phone and iOS buttons all send the same thing.
import { FAILING_CHECKS_MARK, FIX_CHECKS_PROMPT } from '@omni/shared/thread-glance.ts';
import { channels, type Thread } from './db.ts';
import { branchChecks, checkLog } from './pr-watch/gh.ts';
import { FAILED, type CheckObservation } from './pr-watch/sources.ts';

/** Failing checks listed in the message, each with its log tail when it has one. */
export const MAX_FIX_CHECKS = 5;
/** How long the send waits on gh before it goes out with the plain prompt. */
export const FIX_CHECKS_WAIT_MS = 20_000;

export interface FixChecksDeps {
  branchChecks(repo: string, branch: string): Promise<{ number: number; checks: CheckObservation[] } | null>;
  checkLog(repo: string, check: CheckObservation): Promise<string | null>;
  waitMs?: number;
}

const ghDeps: FixChecksDeps = { branchChecks, checkLog };

/** The step prompt followed by the failing checks: name, state, link and log tail, up to MAX_FIX_CHECKS of them. */
export function composeFixChecks(number: number, failing: CheckObservation[], logs: (string | null)[]): string {
  const listed = failing.slice(0, MAX_FIX_CHECKS);
  const parts = [`${FIX_CHECKS_PROMPT}${FAILING_CHECKS_MARK}${number} (${failing.length}). Start from these log tails; read the full log with gh when a tail is not enough.`];
  for (const [i, c] of listed.entries()) {
    parts.push('', `- ${c.name}: ${c.state.toLowerCase()}${c.url ? ` ${c.url}` : ''}`);
    const log = logs[i];
    if (log) parts.push('```', log, '```');
  }
  if (failing.length > listed.length) parts.push('', `- and ${failing.length - listed.length} more`);
  return parts.join('\n');
}

/**
 * What Fix checks sends for this thread. The plain prompt when the channel has no repo, the thread no branch, the branch
 * no open PR or no failing check, or gh fails or takes longer than the wait.
 */
export async function fixChecksPrompt(t: Pick<Thread, 'channel_id' | 'branch'>, deps: FixChecksDeps = ghDeps): Promise<string> {
  const repo = channels.get(t.channel_id)?.github_repo;
  const branch = t.branch;
  if (!repo || !branch) return FIX_CHECKS_PROMPT;
  const compose = async () => {
    const pr = await deps.branchChecks(repo, branch);
    const failing = pr?.checks.filter((c) => FAILED.has(c.state)) ?? [];
    if (!pr || !failing.length) return FIX_CHECKS_PROMPT;
    const logs = await Promise.all(failing.slice(0, MAX_FIX_CHECKS).map((c) => deps.checkLog(repo, c).catch(() => null)));
    return composeFixChecks(pr.number, failing, logs);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<string>((resolve) => (timer = setTimeout(() => resolve(FIX_CHECKS_PROMPT), deps.waitMs ?? FIX_CHECKS_WAIT_MS)));
  try {
    return await Promise.race([compose().catch(() => FIX_CHECKS_PROMPT), late]);
  } finally {
    clearTimeout(timer);
  }
}
