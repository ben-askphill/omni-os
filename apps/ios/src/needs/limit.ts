import type { Thread } from '@omni/client-core';

const DAY = 86_400_000;

const HARNESS_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  hermes: 'Hermes',
  'cursor-cloud': 'Cursor Cloud',
};

export const harnessLabel = (id: string): string => HARNESS_LABEL[id] ?? id;

const clock = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

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

export const LIMIT_LABEL: Record<LimitAction, string> = {
  schedule: 'Resume at reset',
  cancel: 'Cancel',
  resume: 'Resume now',
};

export interface LimitView {
  title: string;
  body: string;
  /** In the order they show; the first is the main one. */
  actions: LimitAction[];
  scheduled: boolean;
}

/** What the card says for a thread's limit stop, or null when it has none. A stop from the other Mac has no actions. */
export function limitView(
  thread: Pick<Thread, 'limit_state' | 'limit_resets_at' | 'limit_elsewhere'>,
  harness: string,
  now = Date.now(),
): LimitView | null {
  if (!thread.limit_state) return null;
  const scheduled = thread.limit_state === 'scheduled';
  const at = thread.limit_resets_at ? resetLabel(thread.limit_resets_at, now) : null;
  if (thread.limit_elsewhere) {
    const when = scheduled && at ? `It resumes there at ${at}.` : at ? `It resets at ${at}.` : 'It did not say when it resets.';
    return {
      title: scheduled && at ? `Resumes at ${at} on your other machine` : 'Usage limit reached on your other machine',
      body: `${harness} stopped this turn at your plan's limit on your other machine. ${when} Resume it there.`,
      actions: [],
      scheduled,
    };
  }
  if (scheduled && at) {
    return {
      title: `Resumes at ${at}`,
      body: 'Omni continues this thread once the limit resets. A new message, Stop or Archive cancels it.',
      actions: ['cancel', 'resume'],
      scheduled,
    };
  }
  if (at) {
    return { title: 'Usage limit reached', body: `${harness} stopped this turn at your plan's limit. It resets at ${at}.`, actions: ['schedule', 'resume'], scheduled };
  }
  return { title: 'Usage limit reached', body: `${harness} stopped this turn at your plan's limit and did not say when it resets.`, actions: ['resume'], scheduled };
}
