// Deliveries of an event to an event-triggered automation (apps/server/automation-triggers.ts). Pure types and labels,
// shared by the server and the Web UI. apps/mac/OmniKit/Sources/OmniKit/Automation.swift ports them.

/**
 * Where a delivery came from. A successful Artifact publish in any thread (packages/shared/published.ts), or a signed
 * GitHub webhook posted to the automation's endpoint (apps/server/github-webhook-api.ts).
 */
export type TriggerSource = 'artifact_published' | 'github_webhook';

/**
 * Where a delivery is. `received`: seen, not yet matched to the automation. `accepted`: saved on the Mac that runs
 * automations, which starts it. `queued`: saved on another Mac and held for that one. Then `started` (its thread
 * exists), `failed` (making the thread threw) or `skipped` (with the reason it never ran: expired, paused, by hand).
 * Only a `failed` one with no thread can go again (a retry), as the next attempt; nothing else leaves its state.
 */
export const TRIGGER_DELIVERY_STATES = ['received', 'accepted', 'queued', 'started', 'failed', 'skipped'] as const;
export type TriggerDeliveryState = (typeof TRIGGER_DELIVERY_STATES)[number];

/**
 * Within one attempt a delivery only moves to a higher rank, so a copy from the other Mac never takes it back. `started`
 * is highest because it is a fact, a thread exists: a skip that raced the start loses to it on both Macs. A skip beats
 * a failure, so a delivery skipped by hand is not offered a retry again.
 */
export const DELIVERY_RANK: Record<TriggerDeliveryState, number> = { received: 0, accepted: 1, queued: 1, failed: 2, skipped: 3, started: 4 };

/** Not started, failed or skipped yet. */
export const isPendingDelivery = (s: TriggerDeliveryState) => DELIVERY_RANK[s] < 2;

/**
 * True when `next` should replace `cur`: a later attempt (a retry) beats every state of an earlier one, and within an
 * attempt the higher rank wins. The one rule the repo, the sync handler and both clients' lists apply.
 */
export const isDeliveryAhead = (next: { attempt: number; state: TriggerDeliveryState }, cur: { attempt: number; state: TriggerDeliveryState }) =>
  next.attempt > cur.attempt || (next.attempt === cur.attempt && DELIVERY_RANK[next.state] > DELIVERY_RANK[cur.state]);

export const DELIVERY_STATE_LABELS: Record<TriggerDeliveryState, string> = {
  received: 'Received',
  accepted: 'Accepted',
  queued: 'Held for owner',
  started: 'Started',
  failed: 'Failed',
  skipped: 'Skipped',
};

/** A delivery as GET /api/automations lists it, newest first under its automation. */
export interface TriggerDelivery {
  /** Derived from the automation, source and source_id, so a replay or the other Mac's copy is the same row. */
  id: string;
  automation: string;
  source: TriggerSource;
  /** The event's stable identity at its source: `<thread id>:<tool use id>` for a publish, the X-GitHub-Delivery id for a webhook. */
  source_id: string;
  /** One line on what happened, for the list. */
  summary: string;
  /** Bounded fields captured from the event. Data, never instructions. */
  context: Record<string, string>;
  state: TriggerDeliveryState;
  /** Why it was skipped or failed. */
  reason: string | null;
  /** The sync id of the Mac that runs automations, as the Mac that saved it knew it. Null with sync off. */
  owner: string | null;
  /** The thread that published, for a publish. */
  source_thread: string | null;
  /** The automation thread it started. */
  thread_id: string | null;
  /** 1 for the first go. A retry makes it 2, and so on: each attempt has its own thread id (db/repos/trigger-deliveries.ts). */
  attempt: number;
  /** When the event arrived. Event age and retry age count from here: a retry keeps it. */
  created_at: string;
  updated_at: string;
}

/**
 * A delivery as the routes send it: the row, plus what the server knows about it right now. The clients show these
 * and never work them out again. Nothing here is a raw request: `context` is the bounded fields kept from the event,
 * and no signature or header is ever stored.
 */
export interface DeliveryView extends TriggerDelivery {
  /** The status of the thread it started, the run's own outcome. Null with no thread, or a thread that was removed. */
  thread_status: string | null;
  /** When the trigger's max age skips it, while it has not started. Null once it has started or been skipped. */
  expires_at: string | null;
  /** Why a pending delivery has not started yet: the automation's runs are at its limit, or it is backing off. */
  waiting: string | null;
  /** A pending or failed delivery nothing is starting: skipping it is final. */
  can_skip: boolean;
  /** A failed delivery with no thread that could duplicate a run. */
  can_retry: boolean;
  /** For a failed delivery that cannot go again, why not. Null otherwise. */
  retry_blocked: string | null;
}

/** One line of a delivery's detail: what happened at that stage of its way from event to outcome. */
export interface DeliveryStage {
  name: 'Trigger' | 'Run' | 'Execution';
  label: string;
  /** done: went through. needs: went wrong. live: in progress. quiet: will not happen. plain: waiting. */
  tone: 'done' | 'needs' | 'live' | 'quiet' | 'plain';
  /** More on the label: the reason, or why it waits. */
  note: string | null;
}

const EXECUTION: Record<string, Pick<DeliveryStage, 'label' | 'tone'>> = {
  queued: { label: 'Queued', tone: 'plain' },
  running: { label: 'Running', tone: 'live' },
  done: { label: 'Finished', tone: 'done' },
  failed: { label: 'Failed', tone: 'needs' },
  stopped: { label: 'Stopped', tone: 'quiet' },
};

/**
 * The three things a delivery went through. Trigger: it was taken in, held or skipped. Run: its thread was made, or
 * could not be. Execution: what that thread did, the thread's own status. A delivery whose thread exists is never
 * called a failure of the run, whatever it reported: its thread says, and a follow-up goes there.
 * apps/mac/OmniKit/Sources/OmniKit/Automation.swift ports it.
 */
export function deliveryStages(d: Pick<DeliveryView, 'state' | 'reason' | 'thread_id' | 'thread_status' | 'waiting'>): DeliveryStage[] {
  const trigger: DeliveryStage =
    d.state === 'received'
      ? { name: 'Trigger', label: 'Received', tone: 'plain', note: null }
      : d.state === 'queued'
        ? { name: 'Trigger', label: 'Held for owner', tone: 'plain', note: null }
        : d.state === 'skipped'
          ? { name: 'Trigger', label: 'Skipped', tone: 'quiet', note: d.reason }
          : { name: 'Trigger', label: 'Accepted', tone: 'done', note: null };
  const run: DeliveryStage = isPendingDelivery(d.state)
    ? { name: 'Run', label: 'Waiting to start', tone: 'plain', note: d.waiting }
    : d.state === 'started'
      ? { name: 'Run', label: 'Thread created', tone: 'done', note: null }
      : d.state === 'failed'
        ? { name: 'Run', label: d.thread_id ? 'Started, then reported an error' : 'Could not start', tone: 'needs', note: d.reason }
        : { name: 'Run', label: 'Never started', tone: 'quiet', note: null };
  const seen = d.thread_id ? (EXECUTION[d.thread_status ?? ''] ?? { label: d.thread_status ?? 'Thread removed', tone: 'quiet' as const }) : null;
  const execution: DeliveryStage = seen ? { name: 'Execution', ...seen, note: null } : { name: 'Execution', label: 'No run', tone: 'quiet', note: null };
  return [trigger, run, execution];
}

/** The reply to POST /api/deliveries/:id/retry and /skip, and the page GET /api/automations/:id/deliveries returns. */
export interface DeliveryPage {
  deliveries: DeliveryView[];
  /** Older ones exist: ask again with before set to the last id. */
  more: boolean;
}
