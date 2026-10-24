// What Ben can do with a delivery of an event automation (apps/server/automation-triggers.ts saves and starts them):
// see where it got to, skip it, or retry one that failed before any run was made. The rule behind all of it: a retry
// must never duplicate a run that was admitted, so it is offered only when no thread of the attempt exists, and one
// whose outcome is uncertain (a thread exists, whatever it reported) only links to that thread. Nothing here starts
// a run: a retry makes the delivery pending again and the worker starts it. Tested in tests/automation-deliveries.test.ts.
import { isPendingDelivery, type DeliveryView, type TriggerDelivery } from '@omni/shared/automation-triggers.ts';
import { isPrTrigger } from './automation-events.ts';
import { publishFeed } from './bus.ts';
import { threads } from './db.ts';
import { deliveryThreadId, triggerDeliveries } from './db/repos/trigger-deliveries.ts';
import { expiresAt, holdReason, isExpired, maxAgeMs, span } from './delivery-policy.ts';
import { loadAutomations, type Automation } from './automations.ts';
import { automationsOwner } from './sync/owner.ts';

/** The reason a skipped-by-hand delivery carries, on both Macs. */
export const SKIPPED_BY_HAND = 'Skipped by hand';

/** The `max_age` and `concurrency` of an event automation. A PR trigger has none: its events are not deliveries. */
const limitsOf = (a: Automation | undefined) => (a?.on && !isPrTrigger(a.on) ? a.on : undefined);

/** Why a failed delivery cannot go again, or null when it can. Not for a delivery in any other state. */
function retryBlock(d: TriggerDelivery, a: Automation | undefined, made: boolean, now: number): string | null {
  if (d.thread_id || made) return 'Its thread exists, so what it did is unknown. Open the thread and send a follow-up there.';
  if (triggerDeliveries.isStarting(d.id)) return 'It is being started right now.';
  if (!a) return 'No automation with this id on this Mac.';
  if (a.error) return `The automation is invalid: ${a.error}`;
  if (!a.enabled && automationsOwner().isThisMac) return 'The automation is paused.';
  if (isExpired(d.created_at, limitsOf(a), now)) return `The event is older than the automation's ${span(maxAgeMs(limitsOf(a)))} limit.`;
  return null;
}

/** A delivery as the routes send it: the row and what is true of it right now. `live` counts runs going, by automation, for one request. */
export function viewOf(d: TriggerDelivery, a: Automation | undefined, live: Map<string, number> = new Map(), now = Date.now()): DeliveryView {
  const limits = limitsOf(a);
  const pending = isPendingDelivery(d.state);
  const made = !!threads.get(deliveryThreadId(d.id, d.attempt));
  const retryable = d.state === 'failed' && !d.thread_id;
  const runs = (id: string) => live.get(id) ?? live.set(id, triggerDeliveries.liveRuns(id)).get(id)!;
  const block = d.state === 'failed' ? retryBlock(d, a, made, now) : null;
  return {
    ...d,
    thread_status: d.thread_id ? (threads.get(d.thread_id)?.status ?? null) : null,
    expires_at: pending || retryable ? expiresAt(d.created_at, limits).toISOString() : null,
    waiting: pending && a && !isExpired(d.created_at, limits, now) ? holdReason(a.id, limits, runs(a.id), now, d.attempt > 1) : null,
    can_skip: (pending || retryable) && !made && !triggerDeliveries.isStarting(d.id),
    can_retry: d.state === 'failed' && block === null,
    retry_blocked: block,
  };
}

/** The views of some deliveries, reading the automations once. */
export function viewsOf(rows: TriggerDelivery[]): DeliveryView[] {
  const automations = new Map(loadAutomations().map((a) => [a.id, a]));
  const live = new Map<string, number>();
  return rows.map((d) => viewOf(d, automations.get(d.automation), live));
}

export const viewById = (id: string): DeliveryView | undefined => {
  const d = triggerDeliveries.get(id);
  return d && viewsOf([d])[0];
};

/** What the automation's card shows: its latest few, and whether older ones are on the history page. */
export function recentDeliveries(automation: string, limit = 5) {
  const { rows, more } = triggerDeliveries.page(automation, limit);
  return { deliveries: viewsOf(rows), deliveries_more: more };
}

export type DeliveryAction = { ok: true; delivery: DeliveryView } | { ok: false; status: 404 | 409; error: string; delivery?: DeliveryView };

const missing: DeliveryAction = { ok: false, status: 404, error: 'no delivery with this id' };
const moved = (delivery: DeliveryView): DeliveryAction => ({ ok: false, status: 409, error: 'This delivery moved on since you looked. Reload it.', delivery });

/**
 * Retry a failed delivery that made no thread: it becomes the next attempt, pending, and the worker starts it, here if
 * this Mac runs automations, on the Mac that does after sync if not. `attempt` is the one the caller was looking at, so
 * a second click, or a click on a copy that is out of date, changes nothing. A retry is Ben's call, so the pause after a
 * failed start does not hold it; it is still held by the automation's limit on runs going and by the event's age.
 */
export function retryDelivery(id: string, attempt: number): DeliveryAction {
  const d = triggerDeliveries.get(id);
  if (!d) return missing;
  const view = viewsOf([d])[0];
  if (d.attempt !== attempt) return moved(view);
  if (!view.can_retry) return { ok: false, status: 409, error: view.retry_blocked ?? `Only a failed delivery can be retried, and this one is ${d.state}.`, delivery: view };
  const owner = automationsOwner();
  // Checked and set in this one tick: no thread can appear between the checks above and the update.
  if (!triggerDeliveries.retry(id, attempt, owner.isThisMac ? 'accepted' : 'queued', owner.owner)) return moved(viewById(id)!);
  publishFeed({ type: 'automation_delivery', automation: d.automation });
  return { ok: true, delivery: viewById(id)! };
}

/**
 * Skip a delivery nothing has started: final, the same on both Macs. Refused once a thread exists or while the worker is
 * starting it, with the reason, so a skip never reads as done when the run went ahead.
 */
export function skipDelivery(id: string, attempt?: number): DeliveryAction {
  const d = triggerDeliveries.get(id);
  if (!d) return missing;
  const view = viewsOf([d])[0];
  if (attempt !== undefined && d.attempt !== attempt) return moved(view);
  if (!view.can_skip) {
    const error = triggerDeliveries.isStarting(id)
      ? 'It is being started right now. Its thread opens in a moment.'
      : d.state === 'started' || d.thread_id
        ? 'It already started. Open its thread.'
        : d.state === 'skipped'
          ? 'It was already skipped.'
          : 'Its thread was already made. Open it.';
    return { ok: false, status: 409, error, delivery: view };
  }
  if (!triggerDeliveries.skip(id, d.attempt, SKIPPED_BY_HAND)) return moved(viewById(id)!);
  publishFeed({ type: 'automation_delivery', automation: d.automation });
  return { ok: true, delivery: viewById(id)! };
}
