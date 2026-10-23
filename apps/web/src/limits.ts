// A turn stopped at the harness's usage limit (apps/server/runner/limits.ts), from the Web UI's side: when it resets and
// what the card offers. Limits.swift is the Mac app's copy.
import type { Thread } from './api.ts';
import { clock } from './format.ts';

const DAY = 86_400_000;

/** When a limit resets: the time today or tomorrow, else the weekday and time. */
export function resetLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const t = d.getTime();
  if (!Number.isFinite(t)) return '';
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = Math.floor((t - today.getTime()) / DAY);
  if (day === 0) return clock(d);
  if (day === 1) return `tomorrow ${clock(d)}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${clock(d)}`;
}

export type LimitAction = 'schedule' | 'cancel' | 'resume';

/** Each action's button and its route under /threads/:id/limit/. */
export const LIMIT_ACTION: Record<LimitAction, { label: string; icon: 'clock' | 'play' | 'x'; path: string }> = {
  schedule: { label: 'Resume at reset', icon: 'clock', path: 'schedule' },
  cancel: { label: 'Cancel', icon: 'x', path: 'cancel' },
  resume: { label: 'Resume now', icon: 'play', path: 'resume' },
};

export interface LimitView {
  title: string;
  body: string;
  /** In the order they show; the first is the main one. */
  actions: LimitAction[];
}

/**
 * What the card says for a thread's limit stop, or null when it has none. A stop from the other Mac (sync) is only
 * shown: that Mac ran the turn and is the one that resumes it.
 */
export function limitView(
  thread: Pick<Thread, 'limit_state' | 'limit_resets_at'> & { limit_elsewhere?: number },
  harness: string,
  now = Date.now(),
): LimitView | null {
  if (!thread.limit_state) return null;
  const at = thread.limit_resets_at ? resetLabel(thread.limit_resets_at, now) : null;
  if (thread.limit_elsewhere) {
    const when = thread.limit_state === 'scheduled' && at ? `It resumes there at ${at}.` : at ? `It resets at ${at}.` : 'It did not say when it resets.';
    return {
      title: thread.limit_state === 'scheduled' && at ? `Resumes at ${at} on your other Mac` : 'Usage limit reached on your other Mac',
      body: `${harness} stopped this turn at your plan's limit on your other Mac. ${when} Resume it there.`,
      actions: [],
    };
  }
  if (thread.limit_state === 'scheduled' && at) {
    return {
      title: `Resumes at ${at}`,
      body: 'Omni continues this thread once the limit resets. A new message, Stop or Archive cancels it.',
      actions: ['cancel', 'resume'],
    };
  }
  if (at) {
    return { title: 'Usage limit reached', body: `${harness} stopped this turn at your plan's limit. It resets at ${at}.`, actions: ['schedule', 'resume'] };
  }
  return { title: 'Usage limit reached', body: `${harness} stopped this turn at your plan's limit and did not say when it resets.`, actions: ['resume'] };
}
