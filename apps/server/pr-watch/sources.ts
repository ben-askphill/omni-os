// What a PR watch reacts to. One poll observes a PR once for every watch on it; each source turns that observation
// into events, keyed so the same event is the same key on every poll. The worker wakes a thread for keys it has not
// woken it for, and records them. A new kind of event (review feedback) is a new source here, not a new loop.
import { summarizeChecks } from '../github.ts';

/** One check on the PR head, from statusCheckRollup. */
export interface CheckObservation {
  /** The check's identity on any head: its workflow and job name, or a status context. */
  id: string;
  name: string;
  /** Upper case, as the PR pages show it: SUCCESS, FAILURE, IN_PROGRESS, ... */
  state: string;
  url: string | null;
}

/** A PR as one poll saw it. Shared by every watch on that PR. */
export interface PRObservation {
  repo: string;
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  headSha: string;
  checks: CheckObservation[];
}

/** Something new on the PR, worth waking the thread for once. */
export interface WatchEvent {
  source: string;
  /** Same event, same key, on every poll and after a restart. */
  key: string;
  /** Its short name in the transcript line: a check's name. */
  label: string;
}

/** Reads a source may make, only when it is about to wake a thread. */
export interface EvidenceDeps {
  /** The failing log tail of a check, already cut to size. Null when there is none to read. */
  checkLog(repo: string, check: CheckObservation): Promise<string | null>;
}

export interface WatchSource {
  source: string;
  events(obs: PRObservation): WatchEvent[];
  /** The transcript's line for this source's new events, e.g. "CI failed: build, lint". */
  summary(events: WatchEvent[]): string;
  /** The prompt's section for this source's new events, with bounded evidence. */
  section(events: WatchEvent[], obs: PRObservation, deps: EvidenceDeps): Promise<string>;
}

const FAILED = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
/** Checks listed in one wake, and those of them whose logs ride along. */
export const MAX_LISTED = 15;
export const MAX_LOGS = 4;

const checkKey = (headSha: string, id: string) => `check:${headSha}:${id}`;

export const checksSource: WatchSource = {
  source: 'checks',
  events(obs) {
    return obs.checks
      .filter((c) => FAILED.has(c.state))
      .map((c) => ({ source: 'checks', key: checkKey(obs.headSha, c.id), label: c.name }));
  },
  summary: (events) => `CI failed: ${events.slice(0, 5).map((e) => e.label).join(', ')}${events.length > 5 ? ` and ${events.length - 5} more` : ''}`,
  async section(events, obs, deps) {
    const keys = new Set(events.map((e) => e.key));
    const failing = obs.checks.filter((c) => keys.has(checkKey(obs.headSha, c.id)));
    const listed = failing.slice(0, MAX_LISTED);
    const parts = [`Failing checks (${failing.length}):`, ...listed.map((c) => `- ${c.name}: ${c.state.toLowerCase()}${c.url ? ` ${c.url}` : ''}`)];
    if (failing.length > listed.length) parts.push(`- and ${failing.length - listed.length} more`);
    for (const c of listed.slice(0, MAX_LOGS)) {
      const log = await deps.checkLog(obs.repo, c).catch(() => null);
      if (log) parts.push('', `Log tail of ${c.name}:`, '```', log, '```');
    }
    return parts.join('\n');
  },
};

/** Every source a watch polls for. */
export const SOURCES: WatchSource[] = [checksSource];

export const checkCounts = (obs: PRObservation) => summarizeChecks(obs.checks.map((c) => ({ conclusion: c.state })));
