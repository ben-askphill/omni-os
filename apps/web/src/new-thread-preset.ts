// What a composer opens with when it starts from a thread. Web UI only; the slash rules, and the body `/clear <prompt>`
// sends, are in packages/shared/composer-slash.ts.
import type { Thread } from './api.ts';
import { sameRun } from '@omni/shared/composer-slash.ts';

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
export const sameSettings = (t: Thread): NewThreadPreset => ({ channel: t.channel_id, role: t.role ?? '', ...sameRun(t) });
