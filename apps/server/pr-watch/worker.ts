// Polls watched PRs and wakes their threads (issue #219). One gh read per PR per poll, however many threads watch
// it; an unchanged poll costs no agent turn. A wake is a durable request (db/repos/requests.ts) saved in the same
// transaction that records its events as seen, so a replayed observation, a second poll or a restart between saving
// and waking never wakes the thread twice: a killed server leaves the request for Resume, as any other.
// Polling, not webhooks: the server sits on loopback behind the tailnet, so GitHub cannot reach it.
import { createHash } from 'node:crypto';
import { messageRequests, outbox, threads, tx, type MessageRequest } from '../db.ts';
import { emitThread, runsHere, saveOwn, wake } from '../runner.ts';
import { wakeBlocked } from '../sync/guard.ts';
import { checkLog, observePR } from './gh.ts';
import { MAX_WAKE_ITEMS } from '@omni/shared/pr-watch.ts';
import { checkCounts, SOURCES, type EvidenceDeps, type PRObservation, type WatchEvent } from './sources.ts';
import { prWatches, type PRWatchRow } from './store.ts';

/** Seconds between polls while checks run or right after a change. */
export const BASE_S = 60;
/** The longest wait between polls while nothing changes. */
export const IDLE_MAX_S = 15 * 60;
/** The longest wait after failed polls, and how many failures in a row stop a watch. */
export const BACKOFF_MAX_S = 30 * 60;
export const MAX_FAILURES = 5;
/** How long a rate-limited GitHub is left alone. It does not count against the failure budget. */
export const RATE_LIMIT_S = 15 * 60;

export interface PRWatchDeps extends EvidenceDeps {
  observe(repo: string, number: number): Promise<PRObservation>;
  now(): number;
  /** Hand a saved wake to the runner. */
  wake(r: MessageRequest): void;
}

const ghDeps: PRWatchDeps = { observe: observePR, checkLog, now: () => Date.now(), wake };

const iso = (ms: number) => new Date(ms).toISOString();
const firstLine = (err: unknown) => String((err as Error)?.message ?? err).split('\n').find((l) => l.trim() && !l.startsWith('Command failed')) ?? 'gh failed';
const rateLimited = (err: unknown) => /rate limit/i.test(String((err as Error)?.message ?? err));

/** Nothing is polled until then: GitHub said the account is rate limited. */
let pausedUntil = 0;

/** One pass over the watches that are due. Returns how many threads it woke. */
export async function pollOnce(deps: PRWatchDeps = ghDeps): Promise<number> {
  const at = deps.now();
  if (at < pausedUntil) return 0;
  const due: PRWatchRow[] = [];
  for (const w of prWatches.due(iso(at), outbox.machineId())) {
    const t = threads.get(w.thread_id);
    if (t?.archived) prWatches.stop(w.thread_id, 'archived', iso(at));
    else if (t) due.push(w);
  }
  const byPR = new Map<string, PRWatchRow[]>();
  for (const w of due) byPR.set(`${w.repo}#${w.number}`, [...(byPR.get(`${w.repo}#${w.number}`) ?? []), w]);
  let woke = 0;
  for (const list of byPR.values()) {
    let obs: PRObservation;
    try {
      obs = await deps.observe(list[0].repo, list[0].number);
    } catch (err) {
      if (rateLimited(err)) {
        // The limit is the account's: every watch waits, not only this PR's.
        pausedUntil = at + RATE_LIMIT_S * 1000;
        for (const w of due) prWatches.failed(w.thread_id, 'GitHub rate limit: waiting before the next poll', false, iso(pausedUntil), iso(at));
        break;
      }
      for (const w of list) {
        const next = Math.min(BASE_S * 2 ** (w.failures + 1), BACKOFF_MAX_S);
        const after = prWatches.failed(w.thread_id, firstLine(err), true, iso(at + next * 1000), iso(at));
        if (after.failures >= MAX_FAILURES) prWatches.stop(w.thread_id, 'error_limit', iso(at));
      }
      continue;
    }
    for (const w of list) {
      // One watch that cannot be applied (its thread deleted mid-poll) must not hold up the others.
      try {
        if (await apply(w, obs, deps)) woke++;
      } catch (err) {
        console.error(`[pr-watch] ${w.repo}#${w.number} for thread ${w.thread_id}:`, err);
      }
    }
  }
  return woke;
}

/** One watch's share of an observation: record it, and wake the thread for events it has not seen. */
async function apply(w: PRWatchRow, obs: PRObservation, deps: PRWatchDeps): Promise<boolean> {
  const at = deps.now();
  if (obs.state === 'MERGED' || obs.state === 'CLOSED') {
    prWatches.observed(w.thread_id, { head_sha: obs.headSha, checks: checkCounts(obs), interval_s: w.interval_s, next_poll_at: iso(at), at: iso(at) });
    prWatches.stop(w.thread_id, obs.state === 'MERGED' ? 'merged' : 'closed', iso(at));
    return false;
  }
  const all = SOURCES.flatMap((s) => s.events(obs, w));
  const seen = prWatches.seen(w.thread_id, all.map((e) => e.key));
  const fresh = all.filter((e) => !seen.has(e.key));
  const checks = checkCounts(obs);
  const changed = w.head_sha !== obs.headSha || fresh.length > 0 || checks.pending > 0;
  const interval = changed ? BASE_S : Math.min(w.interval_s * 2, IDLE_MAX_S);
  prWatches.observed(w.thread_id, { head_sha: obs.headSha, checks, interval_s: interval, next_poll_at: iso(at + interval * 1000), at: iso(at) });
  if (!fresh.length) return false;

  const prompt = await notification(obs, fresh, deps);
  // Ben may have stopped the watch, or archived the thread, while the evidence was read.
  if (prWatches.get(w.thread_id)?.state !== 'watching' || threads.get(w.thread_id)?.archived) return false;
  const row = save(w, obs, fresh, prompt, iso(at));
  if (!row) return false;
  deliver(row, deps);
  return true;
}

/** The wake's request id: the PR and the events it is about, so the same events make the same request. */
const requestKey = (obs: PRObservation, events: WatchEvent[]) =>
  `pr-watch:${obs.repo}#${obs.number}:${createHash('sha256').update(events.map((e) => e.key).sort().join('\n')).digest('hex').slice(0, 16)}`;

/** Save the wake and mark its events seen together. Null when this exact wake was saved before. */
function save(w: PRWatchRow, obs: PRObservation, events: WatchEvent[], prompt: string, at: string): MessageRequest | null {
  const short = obs.headSha.slice(0, 7);
  const said = SOURCES.flatMap((s) => {
    const mine = events.filter((e) => e.source === s.source);
    return mine.length ? [s.summary(mine)] : [];
  });
  const text = `#${obs.number} at ${short}. ${said.join('. ')}`;
  // What the transcript lists under the line: the first few events, so the message stays small however many there were.
  const items = events.slice(0, MAX_WAKE_ITEMS).map((e) => e.item);
  const payload = { text, source: 'pr-watch', repo: obs.repo, number: obs.number, head_sha: obs.headSha, items, more: Math.max(0, events.length - items.length) };
  return tx(() => {
    const row = saveOwn(w.thread_id, requestKey(obs, events), { prompt, kind: 'user', payload, source: 'pr-watch', mode: 'queue' });
    if (row) prWatches.woke(w.thread_id, events, row.id, at);
    return row;
  });
}

/**
 * Wake the thread, unless this Mac may not start a turn in it (another machine holds it, running or between turns,
 * or its worktree is not ready): then the wake waits for Resume, like a crew report to a parent that cannot run.
 */
function deliver(row: MessageRequest, deps: PRWatchDeps) {
  const t = threads.get(row.thread_id);
  if (!t) return;
  if (wakeBlocked(t, runsHere(t.id))) {
    messageRequests.mark(row.id, 'recovered');
    return emitThread(t.id);
  }
  deps.wake(row);
}

/** What the agent reads: the PR, the head it is about, and each source's bounded evidence. */
async function notification(obs: PRObservation, events: WatchEvent[], deps: EvidenceDeps): Promise<string> {
  const sections: string[] = [];
  for (const s of SOURCES) {
    const mine = events.filter((e) => e.source === s.source);
    if (mine.length) sections.push(await s.section(mine, obs, deps));
  }
  return [
    `[pr watch] ${obs.repo}#${obs.number}, head ${obs.headSha}`,
    '',
    ...sections.flatMap((s) => [s, '']),
    'Omni is watching this PR for you. If a newer push already dealt with all of this, say so in one line and stop.',
  ].join('\n');
}

let timer: NodeJS.Timeout | undefined;
let polling = false;

/** Poll now, unless a poll is running. */
export async function tick(deps: PRWatchDeps = ghDeps) {
  if (polling) return;
  polling = true;
  try {
    await pollOnce(deps);
  } catch (err) {
    console.error('[pr-watch] poll failed:', err);
  } finally {
    polling = false;
  }
}

let started: PRWatchDeps | null = null;

/** Poll soon after a watch starts, so its first status shows at once. Nothing before startPRWatch. */
export const kick = () => started && void tick(started);

/** Look for due watches every 15 seconds. Each watch keeps its own pace inside that. */
export function startPRWatch(deps: PRWatchDeps = ghDeps) {
  started = deps;
  clearInterval(timer);
  timer = setInterval(() => void tick(deps), 15_000);
  timer.unref();
  void tick(deps);
}

/** Tests: forget a rate-limit pause. */
export const resetPause = () => (pausedUntil = 0);
