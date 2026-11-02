// The run a new-thread draft opens with, for every client that starts threads. The slash rules are in composer-slash.ts.
import { AUTO, AUTO_CHOICE, asksAuto } from './thread-run.ts';

export interface RunDefaults {
  harness?: string | null;
  model?: string | null;
  effort?: string | null;
}

/** Enough of a channel row to read its run defaults. */
export interface ChannelRunRow {
  id: string;
  default_harness: string | null;
  default_model: string | null;
  default_effort: string | null;
}

/** Enough of a crew role to read its run defaults. */
export type RoleRunRow = RunDefaults & { id: string };

/** Enough of the harness catalog to preselect a model. */
export interface CatalogHarness {
  id: string;
  models: { id: string; default?: boolean }[];
}

export interface DraftRun {
  choice: { harness: string; model: string };
  effort: string;
}

/** Whether a role or channel picks anything about the run. Mirrors setsRun in apps/server/harness/resolve.ts. */
export const setsRun = (d: RunDefaults | undefined | null) => !!(d?.harness || d?.model || d?.effort);

export const channelRun = (c: ChannelRunRow | undefined): RunDefaults | undefined =>
  c ? { harness: c.default_harness, model: c.default_model, effort: c.default_effort } : undefined;

/** The Conductor is attached automatically in its channel. Its charter must not hide a saved channel run. */
export const roleRun = <R extends RoleRunRow>(role: R | undefined, channel: ChannelRunRow | undefined): R | undefined =>
  role?.id === 'conductor' && channel?.id === 'conductor' && setsRun(channelRun(channel)) ? undefined : role;

/** Only deliberate draft choices go in the request. The server resolves inherited defaults and retired-model fallbacks. */
export function draftRunRequest(picked: DraftRun | null) {
  if (!picked) return {};
  if (asksAuto(picked.choice)) return { model: AUTO };
  return { harness: picked.choice.harness, model: picked.choice.model || undefined, effort: picked.effort || undefined };
}

/** Follow current defaults until this draft has an explicit pick or a preset. Never remember a previous draft's pick. */
export function draftRun(
  picked: DraftRun | null,
  role: RoleRunRow | undefined,
  channel: ChannelRunRow | undefined,
  harnesses: CatalogHarness[],
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
export function runPreselect(role: RunDefaults | undefined, channel: RunDefaults | undefined, harnesses: CatalogHarness[]): DraftRun {
  const d = setsRun(role) ? role! : setsRun(channel) ? channel! : undefined;
  if (!d || asksAuto(d)) return { choice: AUTO_CHOICE, effort: '' };
  const harness = d.harness && harnesses.some((x) => x.id === d.harness) ? d.harness : 'claude-code';
  const info = harnesses.find((x) => x.id === harness);
  const model = (harness === (d.harness || 'claude-code') && d.model) || info?.models.find((m) => m.default)?.id || info?.models[0]?.id || '';
  return { choice: { harness, model }, effort: d.effort || '' };
}
