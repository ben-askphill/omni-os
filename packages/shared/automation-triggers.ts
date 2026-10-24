// Deliveries of an event to an event-triggered automation (apps/server/automation-triggers.ts). Pure types and labels,
// shared by the server and the Web UI. apps/mac/OmniKit/Sources/OmniKit/Automation.swift ports them.

/**
 * Where a delivery came from. A successful Artifact publish in any thread (packages/shared/published.ts), or a signed
 * GitHub webhook posted to the automation's endpoint (apps/server/github-webhook-api.ts).
 */
export type TriggerSource = 'artifact_published' | 'github_webhook';

/**
 * Where a delivery is. `received`: seen, not yet matched to the automation. `accepted`: saved on the Mac that runs
 * automations, which starts it. `queued`: saved on another Mac and held for that one. Terminal: `started` (its thread
 * exists), `failed` (making the thread threw) and `skipped` (with the reason it never ran).
 */
export const TRIGGER_DELIVERY_STATES = ['received', 'accepted', 'queued', 'started', 'failed', 'skipped'] as const;
export type TriggerDeliveryState = (typeof TRIGGER_DELIVERY_STATES)[number];

/** States that only ever move forward: a copy from the other Mac never takes a delivery back to an earlier one. */
export const DELIVERY_RANK: Record<TriggerDeliveryState, number> = { received: 0, accepted: 1, queued: 1, started: 2, failed: 2, skipped: 2 };

/** Not started, failed or skipped yet. */
export const isPendingDelivery = (s: TriggerDeliveryState) => DELIVERY_RANK[s] < 2;

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
  created_at: string;
  updated_at: string;
}
