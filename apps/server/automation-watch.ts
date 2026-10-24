// Starts event automations (`on:` in automations/*.yaml). Polls gh for the open PRs of each repo an enabled event
// automation watches, hands them to detect() (apps/server/automation-events.ts), and starts one run per event.
// Polling, not webhooks: the server sits on loopback behind the tailnet, so GitHub cannot reach it.
// With sync on, only the Mac that owns automations polls, as with cron (apps/server/sync/owner.ts).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.ts';
import { channels, kv } from './db.ts';
import { detect, eventPrompt, isPrTrigger, type AutomationEventState, type PRInfo, type PrTrigger } from './automation-events.ts';
import { loadAutomations, runAutomation, type Automation } from './automations.ts';
import { runsAutomationsHere } from './sync/owner.ts';

const run = promisify(execFile);
// Reviews and comments carry authorAssociation; the PR's own does not come from gh pr list, so ASSOCIATIONS fetches it.
const PR_FIELDS = 'number,title,url,headRefName,headRefOid,isDraft,isCrossRepository,mergeable,author,statusCheckRollup,reviews,comments';
const ASSOCIATIONS = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { pullRequests(states: OPEN, first: 100, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { number authorAssociation } } }
}`;
const stateKey = (id: string) => `automations.events.${id}`;

export interface WatchDeps {
  listPRs(repo: string): Promise<PRInfo[]>;
  /** The gh login, so Omni's own review replies do not trigger the next run. */
  self(): Promise<string | null>;
  start(a: Automation, prompt: string, title: string): Promise<unknown>;
}

const ghDeps: WatchDeps = {
  async listPRs(repo) {
    const [owner, name] = repo.split('/');
    const [list, assoc] = await Promise.all([
      run('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '30', '--json', PR_FIELDS], { maxBuffer: 32 * 1024 * 1024 }),
      run('gh', ['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${ASSOCIATIONS}`, '--jq', '.data.repository.pullRequests.nodes']),
    ]);
    // A PR missing from the second list keeps no association, so detect() treats its author as untrusted.
    const byNumber = new Map<number, string>((JSON.parse(assoc.stdout) as { number: number; authorAssociation: string }[]).map((n) => [n.number, n.authorAssociation]));
    return (JSON.parse(list.stdout) as PRInfo[]).map((pr) => ({ ...pr, authorAssociation: byNumber.get(pr.number) }));
  },
  self: (() => {
    let login: Promise<string | null> | undefined;
    return () =>
      (login ??= run('gh', ['api', 'user', '--jq', '.login']).then(
        (r) => r.stdout.trim() || null,
        () => ((login = undefined), null),
      ));
  })(),
  start: (a, prompt, title) => runAutomation(a, 'event', { prompt, title }),
};

/** The gh login, asked once. Webhook reviews by it are an automation's own (github-webhook.ts). */
export const ghLogin = () => ghDeps.self();

/** The repo an event automation watches: its own `on.repo`, else its channel's GitHub repo. */
export function watchedRepo(a: Automation & { on: PrTrigger }): string | null {
  return a.on.repo ?? channels.get(a.channel)?.github_repo ?? null;
}

/** Last poll error per automation, for GET /api/automations. Cleared by the next good poll. */
export const pollErrors = new Map<string, string>();

/** One poll of every enabled event automation. One gh call per repo, however many automations watch it. */
export async function pollOnce(deps: WatchDeps = ghDeps): Promise<number> {
  if (!runsAutomationsHere()) return 0;
  const watching = loadAutomations().filter((a): a is Automation & { on: PrTrigger } => isPrTrigger(a.on) && a.enabled && !a.error);
  const byRepo = new Map<string, (Automation & { on: PrTrigger })[]>();
  for (const a of watching) {
    const repo = watchedRepo(a);
    if (!repo) {
      pollErrors.set(a.id, `no repo to watch: set on.repo, or a GitHub repo on #${a.channel}`);
      continue;
    }
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), a]);
  }
  const self = byRepo.size ? await deps.self() : null;
  let started = 0;
  for (const [repo, list] of byRepo) {
    let prs: PRInfo[];
    try {
      prs = await deps.listPRs(repo);
    } catch (err) {
      for (const a of list) pollErrors.set(a.id, `gh pr list ${repo} failed: ${(err as Error).message.split('\n')[0]}`);
      continue;
    }
    for (const a of list) {
      pollErrors.delete(a.id);
      const before = kv.get<AutomationEventState>(stateKey(a.id));
      const { fired, state } = detect(a.on, before, prs, self);
      // Saved before the runs start: a crash mid-way skips an event rather than firing it twice.
      if (JSON.stringify(state) !== JSON.stringify(before)) kv.set(stateKey(a.id), state);
      for (const e of fired) {
        try {
          await deps.start(a, eventPrompt(a.prompt, repo, e), `${a.name} · #${e.pr.number}`);
          started++;
        } catch (err) {
          console.error(`[automations] ${a.id} event run for #${e.pr.number} failed:`, err);
        }
      }
    }
  }
  return started;
}

let timer: NodeJS.Timeout | undefined;
let polling = false;

export function startEventWatch(deps: WatchDeps = ghDeps) {
  const tick = async () => {
    if (polling) return;
    polling = true;
    try {
      await pollOnce(deps);
    } catch (err) {
      console.error('[automations] event poll failed:', err);
    } finally {
      polling = false;
    }
  };
  clearInterval(timer);
  timer = setInterval(tick, config.automationPollSeconds * 1000);
  timer.unref();
  void tick();
}
