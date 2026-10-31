// What a composer opens with when it starts from a thread. Web UI only; the slash rules are in
// packages/shared/composer-slash.ts.
import type { Channel, CrewRole, HarnessInfo, Thread } from './api.ts';
import { AUTO, AUTO_CHOICE, asksAuto } from './thread-run.ts';

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

/** What a role or a channel picks for a new thread's run. */
export interface RunDefaults {
  harness?: string | null;
  model?: string | null;
  effort?: string | null;
}

/** Whether a role or channel picks anything about the run. Mirrors setsRun in apps/server/harness/resolve.ts. */
export const setsRun = (d: RunDefaults | undefined | null) => !!(d?.harness || d?.model || d?.effort);

/** A channel's run defaults, from its row. */
export const channelRun = (c: Channel | undefined): RunDefaults | undefined =>
  c ? { harness: c.default_harness, model: c.default_model, effort: c.default_effort } : undefined;

/** The Conductor is attached automatically in its channel. Its charter must not hide a saved channel run. */
export const roleRun = (role: CrewRole | undefined, channel: Channel | undefined): RunDefaults | undefined =>
  role?.id === 'conductor' && channel?.id === 'conductor' && setsRun(channelRun(channel)) ? undefined : role;

export interface DraftRun {
  choice: { harness: string; model: string };
  effort: string;
}

/** Only deliberate draft choices go in the request. The server resolves inherited defaults and retired-model fallbacks. */
export function draftRunRequest(picked: DraftRun | null) {
  if (!picked) return {};
  if (asksAuto(picked.choice)) return { model: AUTO };
  return { harness: picked.choice.harness, model: picked.choice.model || undefined, effort: picked.effort || undefined };
}

/** Follow current defaults until this draft has an explicit pick or a preset. Never remember a previous draft's pick. */
export function draftRun(
  picked: DraftRun | null,
  role: CrewRole | undefined,
  channel: Channel | undefined,
  harnesses: Pick<HarnessInfo, 'id' | 'models'>[],
): DraftRun {
  if (!picked) return runPreselect(roleRun(role, channel), channelRun(channel), harnesses);
  const h = harnesses.find((h) => h.id === picked.choice.harness);
  const model = picked.choice.model || h?.models.find((m) => m.default)?.id || h?.models[0]?.id || '';
  return { choice: { ...picked.choice, model }, effort: picked.effort };
}

/**
 * The model and effort the new-thread composer preselects: the role's defaults when it sets any, else the
 * channel's, else Auto. Either can ask for Auto too. A harness it can't show falls back to Claude Code.
 */
export function runPreselect(
  role: RunDefaults | undefined,
  channel: RunDefaults | undefined,
  harnesses: Pick<HarnessInfo, 'id' | 'models'>[],
): { choice: { harness: string; model: string }; effort: string } {
  const d = setsRun(role) ? role! : setsRun(channel) ? channel! : undefined;
  if (!d || asksAuto(d)) return { choice: AUTO_CHOICE, effort: '' };
  const harness = d.harness && harnesses.some((x) => x.id === d.harness) ? d.harness : 'claude-code';
  const info = harnesses.find((x) => x.id === harness);
  const model = (harness === (d.harness || 'claude-code') && d.model) || info?.models.find((m) => m.default)?.id || info?.models[0]?.id || '';
  return { choice: { harness, model }, effort: d.effort || '' };
}
