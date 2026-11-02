// What a composer opens with when it starts from a thread. Web UI only; the slash rules are in
// packages/shared/composer-slash.ts.
import type { Thread } from './api.ts';
import { AUTO, AUTO_CHOICE } from '@omni/shared/thread-run.ts';

/** The body that starts a thread with this one's channel, harness, model, effort and role. A thread Auto picked for starts on Auto. */
export const newThreadBody = (t: Thread, prompt: string) => ({
  channel: t.channel_id,
  prompt,
  role: t.role || undefined,
  ...(t.auto_reason ? { model: AUTO } : { harness: t.harness, model: t.model || undefined, effort: t.effort || undefined }),
});

/** What the new-thread composer starts with when it opens from a thread. */
export interface NewThreadPreset {
  channel: string;
  /** A crew role's id, or '' for none. Unset leaves the composer's own default. */
  role?: string;
  choice?: { harness: string; model: string };
  effort?: string;
  /** Open the model picker. */
  pickModel?: boolean;
  /** The sidebar folder to file the new thread in: "New thread here" on a folder. */
  folder?: { id: string; name: string };
  /** The first prompt to start with, in place of the channel's draft: Edit on a suggested new thread. */
  prompt?: string;
}

/** `/clear` or `/new` on its own: this thread's settings, for a first prompt Ben types next. Auto stays Auto. */
export const sameSettings = (t: Thread): NewThreadPreset => ({
  channel: t.channel_id,
  role: t.role ?? '',
  ...(t.auto_reason ? { choice: AUTO_CHOICE, effort: '' } : { choice: { harness: t.harness, model: t.model ?? '' }, effort: t.effort }),
});
