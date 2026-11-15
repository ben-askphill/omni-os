// Which of the phone's delivered alerts Ben has dealt with, here or on another device, so the app clears them from
// Notification Center (apps/ios/src/notifications/clear.ts). The phone asks with what each alert carried: its kind,
// its thread, `at`, the server time it was sent, and `sender`, the server that sent it (push-sender.ts payloadFor).
// Only the sender settles an alert: with two paired Macs, the one behind on sync may not have the question yet and
// would take it for answered. An alert is settled when:
// - its thread was archived or marked done;
// - a question: no question waits on the thread any more (answered anywhere);
// - anything else: nothing waits on the thread in Needs you, it is not running, and its result was read after the alert.
// A thread this server does not have is never settled: the phone may pair with another server that sent it.
import { z } from 'zod';
import { needsYou, resultReads, threads } from './db.ts';
import { APP_PUSH_SETTLED_MAX, type AppPushAlertRef } from '@omni/shared/app-pairing.ts';
import { pushSenderId } from './push-sender.ts';

export const PushSettledBody = z
  .object({
    alerts: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            kind: z.enum(['needsInput', 'finished', 'failed', 'crewReport', 'prAttention']),
            threadId: z.string().min(1).max(200),
            at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'at must be a date'),
            sender: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(APP_PUSH_SETTLED_MAX),
  })
  .strict();

const RUNNING = new Set(['running', 'queued']);

function settled(a: AppPushAlertRef, self: string): boolean {
  if (a.sender !== self) return false;
  const t = threads.get(a.threadId);
  if (!t) return false;
  if (t.archived || t.done_at) return true;
  const waiting = needsYou(undefined, t.id).items.find((i) => i.thread.id === t.id);
  if (a.kind === 'needsInput') return !waiting?.blockers.some((b) => b.kind === 'question');
  if (waiting || RUNNING.has(t.status)) return false;
  const read = resultReads.get(t.id);
  return !!read && Date.parse(read.read_at) >= Date.parse(a.at);
}

/** The ids of the alerts to clear, in the order asked. */
export function settledAlerts(alerts: readonly AppPushAlertRef[]): string[] {
  const self = pushSenderId();
  return alerts.filter((a) => settled(a, self)).map((a) => a.id);
}
