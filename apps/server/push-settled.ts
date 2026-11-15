// Which of the phone's delivered alerts Ben has dealt with, here or on another device, so the app clears them from
// Notification Center (apps/ios/src/notifications/clear.ts). The phone asks with what each alert carried: its kind,
// its thread and `at`, the server time it was sent (push-sender.ts payloadFor). An alert is settled when:
// - its thread was archived or marked done;
// - a question: no question waits on the thread any more (answered anywhere);
// - anything else: nothing waits on the thread in Needs you, it is not running, and its result was read after the alert.
// A thread this server does not have is never settled: the phone may pair with another server that sent it.
import { z } from 'zod';
import { needsYou, resultReads, threads } from './db.ts';
import type { AppPushAlertRef } from '@omni/shared/app-pairing.ts';

/** How many alerts one request may ask about. Notification Center keeps few per app; this is ample. */
export const SETTLED_MAX = 100;

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
          })
          .strict(),
      )
      .max(SETTLED_MAX),
  })
  .strict();

const RUNNING = new Set(['running', 'queued']);

function settled(a: AppPushAlertRef): boolean {
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
  return alerts.filter(settled).map((a) => a.id);
}
