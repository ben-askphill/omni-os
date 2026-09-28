// What a composer opens with when it starts from a thread. Web UI only; the slash rules are in
// shared/composer-slash.ts.
import type { Thread } from './api.ts';

/** The body that starts a thread with this one's channel, harness, model, effort and role. */
export const newThreadBody = (t: Thread, prompt: string) => ({
  channel: t.channel_id,
  prompt,
  role: t.role || undefined,
  harness: t.harness,
  model: t.model || undefined,
  effort: t.effort || undefined,
});

/** What the new-thread composer starts with when it opens from a thread. */
export interface NewThreadPreset {
  channel: string;
  /** A crew role's id, or '' for none. */
  role: string;
  choice?: { harness: string; model: string };
  effort?: string;
  /** Open the model picker. */
  pickModel?: boolean;
}

/** `/clear` or `/new` on its own: this thread's settings, for a first prompt Ben types next. */
export const sameSettings = (t: Thread): NewThreadPreset => ({
  channel: t.channel_id,
  role: t.role ?? '',
  choice: { harness: t.harness, model: t.model ?? '' },
  effort: t.effort,
});

/** "New thread on another model": the channel and role, and nothing that picks a model. */
export const otherModel = (t: Thread): NewThreadPreset => ({ channel: t.channel_id, role: t.role ?? '', pickModel: true });
