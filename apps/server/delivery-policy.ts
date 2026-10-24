// What holds a delivery back before it starts an automation run: how old the event may be, how many of the
// automation's runs may be going, and the pause after a start that failed. Pure apart from the backoff, which is
// per process and starts over with a restart. Tested directly (tests/delivery-policy.test.ts); the worker is
// apps/server/automation-triggers.ts and the actions are apps/server/automation-deliveries.ts.
import { CONCURRENCY_MAX, parseDuration, type ArtifactTrigger, type WebhookTrigger } from './automation-events.ts';

/** An event nobody set a `max_age` for is dropped after this. A Mac that slept over a weekend does not start a week of them. */
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60_000;
/** Runs of one automation going at once, unless its `concurrency` says. */
export const DEFAULT_CONCURRENCY = 2;
/** After a start that fails the automation waits this long, doubling for each failure in a row, up to the cap. */
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 15 * 60_000;

type Limits = Pick<ArtifactTrigger | WebhookTrigger, 'max_age' | 'concurrency'>;

export const maxAgeMs = (on: Limits | undefined) => parseDuration(on?.max_age) ?? DEFAULT_MAX_AGE_MS;
export const concurrencyOf = (on: Limits | undefined) => Math.min(on?.concurrency ?? DEFAULT_CONCURRENCY, CONCURRENCY_MAX);

/** When an event that arrived at `createdAt` stops being worth starting. */
export const expiresAt = (createdAt: string, on: Limits | undefined) => new Date(new Date(createdAt).getTime() + maxAgeMs(on));

export const isExpired = (createdAt: string, on: Limits | undefined, now = Date.now()) => expiresAt(createdAt, on).getTime() <= now;

/** `15m`, `2h 5m`: how long, to the minute (to the second under one). */
export function span(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
}

export const backoffMs = (failures: number) => Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS);

const backoff = new Map<string, { failures: number; until: number }>();

/** A start for this automation failed: no new event of it starts until the pause is over. */
export function recordFailedStart(automation: string, now = Date.now()) {
  const failures = (backoff.get(automation)?.failures ?? 0) + 1;
  backoff.set(automation, { failures, until: now + backoffMs(failures) });
}

/** A start worked: the pause is over. */
export const clearBackoff = (automation: string) => void backoff.delete(automation);

export const backoffUntil = (automation: string, now = Date.now()): number | null => {
  const b = backoff.get(automation);
  return b && b.until > now ? b.until : null;
};

/**
 * Why a pending delivery of this automation must not start right now, or null when it may. `live` is how many of the
 * automation's runs are going. A `retried` one, Ben's own call on another attempt, ignores the pause after a failed
 * start (that is a fact of the delivery, so it holds on whichever Mac starts it) but not the limit on runs going. The
 * delivery stays pending: the worker looks again when a run ends and every minute.
 */
export function holdReason(automation: string, on: Limits | undefined, live: number, now = Date.now(), retried = false): string | null {
  const until = retried ? null : backoffUntil(automation, now);
  if (until) return `Backing off after a start that failed. Next try in ${span(until - now)}`;
  const cap = concurrencyOf(on);
  if (live >= cap) return `Waiting for a free slot: ${live} of ${cap} runs are going`;
  return null;
}
