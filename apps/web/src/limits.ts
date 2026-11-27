// A turn stopped at the harness's usage limit (apps/server/runner/limits.ts), from the Web UI's side: when it resets and
// what the card offers.
import { useEffect, useRef } from 'react';
import { clock } from '@omni/shared/format.ts';
import type { Thread } from './api.ts';

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

/**
 * A limit stop in the one status line every surface shows (header pill, run divider, quick card): "Limited · resumes
 * 13:00" once Omni will resume it, "Limited · resets 13:00" before, plain "Limited" without a reset time. Null without one.
 */
export function limitLabel(thread: Pick<Thread, 'limit_state' | 'limit_resets_at'>, now = Date.now()): string | null {
  if (!thread.limit_state) return null;
  const at = thread.limit_resets_at ? resetLabel(thread.limit_resets_at, now) : null;
  if (!at) return 'Limited';
  return `Limited · ${thread.limit_state === 'scheduled' ? 'resumes' : 'resets'} ${at}`;
}

/** `switch` opens the thread's model picker (pickModelFor) and calls no route: the others post to the server. */
export type LimitAction = 'schedule' | 'cancel' | 'resume' | 'switch';

/** Each action's button and its route under /threads/:id/limit/. */
export const LIMIT_ACTION: Record<LimitAction, { label: string; icon: 'clock' | 'play' | 'x' | 'sliders'; path: string }> = {
  schedule: { label: 'Resume at reset', icon: 'clock', path: 'schedule' },
  cancel: { label: 'Cancel', icon: 'x', path: 'cancel' },
  resume: { label: 'Resume now', icon: 'play', path: 'resume' },
  switch: { label: 'Switch model', icon: 'sliders', path: '' },
};

/** Ask the thread's composer to open its model picker: the free limit's Switch model, a gone model's Pick a model. */
export const PICK_MODEL_EVENT = 'omni:pick-model';
export function pickModelFor(threadId: string) {
  window.dispatchEvent(new CustomEvent(PICK_MODEL_EVENT, { detail: { threadId } }));
}

/** Run `open` when a card asks this thread's composer for its model picker (pickModelFor). */
export function usePickModelRequest(threadId: string, open: () => void) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<{ threadId?: string }>).detail?.threadId === threadId) latest.current();
    };
    window.addEventListener(PICK_MODEL_EVENT, on);
    return () => window.removeEventListener(PICK_MODEL_EVENT, on);
  }, [threadId]);
}

/** Harnesses whose limit is a free tier's, not a plan's: their card offers another model first. */
const FREE_TIER = new Set(['opencode']);

/** The picker's line under a harness at its free limit: "Free limit. Back tomorrow 01:42". Null for any other stop. */
export function freeLimitLine(thread: Pick<Thread, 'harness' | 'limit_state' | 'limit_resets_at'>, now = Date.now()): string | null {
  if (!thread.limit_state || !FREE_TIER.has(thread.harness)) return null;
  const at = thread.limit_resets_at ? resetLabel(thread.limit_resets_at, now) : null;
  return at ? `Free limit. Back ${at}` : 'Free limit';
}

/** The `limits` a thread's model picker takes: its harness's free-limit line while the thread is stopped at it. */
export function freeLimits(thread: Pick<Thread, 'harness' | 'limit_state' | 'limit_resets_at'>, now = Date.now()): Record<string, string> | undefined {
  const line = freeLimitLine(thread, now);
  return line ? { [thread.harness]: line } : undefined;
}

/** ", in about 15 hours" for a reset more than an hour away. */
function inAbout(iso: string, now: number): string {
  const h = Math.round((Date.parse(iso) - now) / 3_600_000);
  return h > 1 ? `, in about ${h} hours` : '';
}

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
  thread: Pick<Thread, 'limit_state' | 'limit_resets_at'> & { limit_elsewhere?: number; harness?: string },
  harness: string,
  now = Date.now(),
): LimitView | null {
  if (!thread.limit_state) return null;
  const at = thread.limit_resets_at ? resetLabel(thread.limit_resets_at, now) : null;
  if (thread.limit_elsewhere) {
    const when = thread.limit_state === 'scheduled' && at ? `It resumes there at ${at}.` : at ? `It resets at ${at}.` : 'It did not say when it resets.';
    return {
      title: thread.limit_state === 'scheduled' && at ? `Resumes at ${at} on your other machine` : 'Usage limit reached on your other machine',
      body: `${harness} stopped this turn at your plan's limit on your other machine. ${when} Resume it there.`,
      actions: [],
    };
  }
  // A free tier (OpenCode Zen) can be out for about 15 hours: another model comes first, and nothing switches by itself.
  if (thread.harness && FREE_TIER.has(thread.harness)) {
    if (thread.limit_state === 'scheduled' && at) {
      return { title: `Resumes ${at}`, body: 'Omni continues this thread once the free limit resets. A new message, Stop or Archive cancels it.', actions: ['switch', 'cancel'] };
    }
    if (at) {
      return {
        title: 'Free limit reached',
        body: `${harness}'s free tier stopped this turn. It resets ${at}${inAbout(thread.limit_resets_at!, now)}. Switch model to keep going now.`,
        actions: ['switch', 'schedule'],
      };
    }
    return { title: 'Free limit reached', body: `${harness}'s free tier stopped this turn and did not say when it resets. Switch model to keep going now.`, actions: ['switch', 'resume'] };
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
