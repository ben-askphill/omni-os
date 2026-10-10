// What a composer opens with when it starts from a thread. Web UI only; the slash rules are in
// shared/composer-slash.ts.
import type { Channel, HarnessInfo, Thread } from './api.ts';

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
  /** A crew role's id, or '' for none. Unset leaves the composer's own default. */
  role?: string;
  choice?: { harness: string; model: string };
  effort?: string;
  /** Open the model picker. */
  pickModel?: boolean;
  /** The sidebar folder to file the new thread in: "New thread here" on a folder. */
  folder?: { id: string; name: string };
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

/** What a role or a channel picks for a new thread's run. */
export interface RunDefaults {
  harness?: string | null;
  model?: string | null;
  effort?: string | null;
}

/** Whether a role or channel picks anything about the run. Mirrors setsRun in server/harness/resolve.ts. */
export const setsRun = (d: RunDefaults | undefined | null) => !!(d?.harness || d?.model || d?.effort);

/** A channel's run defaults, from its row. */
export const channelRun = (c: Channel | undefined): RunDefaults | undefined =>
  c ? { harness: c.default_harness, model: c.default_model, effort: c.default_effort } : undefined;

/**
 * The model and effort the new-thread composer preselects: the role's defaults when it sets any, else the
 * channel's, else Claude Code's default model. A harness it can't show falls back to Claude Code.
 */
export function runPreselect(
  role: RunDefaults | undefined,
  channel: RunDefaults | undefined,
  harnesses: Pick<HarnessInfo, 'id' | 'models'>[],
): { choice: { harness: string; model: string }; effort: string } {
  const d = setsRun(role) ? role! : setsRun(channel) ? channel! : {};
  const harness = d.harness && harnesses.some((x) => x.id === d.harness) ? d.harness : 'claude-code';
  const info = harnesses.find((x) => x.id === harness);
  const model = (harness === (d.harness || 'claude-code') && d.model) || info?.models.find((m) => m.default)?.id || info?.models[0]?.id || '';
  return { choice: { harness, model }, effort: d.effort || '' };
}
