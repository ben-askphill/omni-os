import type { Run } from './run-switch.ts';

/** The model that asks for Auto, which picks the harness, model and effort from the prompt (apps/server/harness/auto.ts). */
export const AUTO = 'auto';

/** Auto as a model picker choice. */
export const AUTO_CHOICE = { harness: AUTO, model: AUTO } as const;

/**
 * Whether a run choice or default asks for Auto. Mirrors asksAuto in apps/server/harness/auto.ts: Cursor has a model of
 * its own called "auto", and `{ harness: 'cursor', model: 'auto' }` stays that.
 */
export const asksAuto = (d: { harness?: string | null; model?: string | null } | undefined | null) =>
  !!d && (d.harness === AUTO || (d.model === AUTO && !d.harness));

/** Enough of the harness catalog to name a thread's model and effort. */
export interface RunCatalogModel {
  id: string;
  label: string;
  efforts: string[];
  /** Empty when the model has no levels. */
  defaultEffort: string;
  default?: boolean;
}

export interface RunCatalogHarness {
  id: string;
  name: string;
  models: RunCatalogModel[];
}

export interface ThreadRunLabels {
  /** The model's display name, the stored id, or "default". Prefixed "Auto · " when Auto picked it. */
  model: string;
  /** The harness's display name. Empty until the catalog names it. */
  harnessName: string;
  /** The chosen level, "Default (x)", "Auto effort", or "default". */
  effort: string;
}

/**
 * What the reply composer's pills show for a thread. An empty model is the harness default. An empty effort is that
 * model's default.
 */
export function threadRunLabels(
  thread: { harness: string; model: string | null; effort: string; auto_reason?: string | null },
  harnesses: RunCatalogHarness[] | null | undefined,
): ThreadRunLabels {
  const { harness, model } = runModel(thread, harnesses);
  const label = model?.label || thread.model || 'default';
  return {
    model: thread.auto_reason ? `Auto · ${label}` : label,
    harnessName: harness?.name ?? '',
    effort: effortLabel(thread.effort, model, !!harness),
  };
}

/** The catalog's entry for a thread's harness and model. An empty model is the harness default. */
export function runModel(thread: { harness: string; model: string | null }, harnesses: RunCatalogHarness[] | null | undefined) {
  const harness = harnesses?.find((h) => h.id === thread.harness);
  const picked = thread.model ? harness?.models.find((m) => m.id === thread.model) : undefined;
  const model = picked ?? (thread.model ? undefined : harness?.models.find((m) => m.default) ?? harness?.models[0]);
  return { harness, model };
}

/** The model a thread's model pill marks as picked: the stored one, or the harness default it runs when none is stored. */
export function threadChoice(thread: { harness: string; model: string | null }, harnesses: RunCatalogHarness[] | null | undefined) {
  return { harness: thread.harness, model: runModel(thread, harnesses).model?.id ?? thread.model ?? '' };
}

type QueuedFields = { queued_harness?: string | null; queued_model?: string | null; queued_effort?: string | null };

/** The run Ben picked while a turn ran, which the thread switches to once the turn ends (apps/server/runner/switch.ts). */
export const queuedRun = (thread: QueuedFields): Run | null =>
  thread.queued_harness ? { harness: thread.queued_harness, model: thread.queued_model ?? '', effort: thread.queued_effort ?? '' } : null;

/**
 * The run a thread's pills show and pick from: the one queued for after this turn, else the one it runs on. Auto's
 * reason belongs to the run Auto picked, so a queued one has none.
 */
export function shownRun<T extends { harness: string; model: string | null; effort: string; auto_reason?: string | null } & QueuedFields>(thread: T) {
  const q = queuedRun(thread);
  return q ? { harness: q.harness, model: q.model || null, effort: q.effort, auto_reason: null } : thread;
}

/** The thread's current run as the switch request sends it: posted while a switch is queued, it drops that switch. */
export const currentRun = (thread: { harness: string; model: string | null; effort: string }): Run => ({
  harness: thread.harness,
  model: thread.model ?? '',
  effort: thread.effort,
});

/** A pick in a thread's model pill or effort pill. */
export type RunPick = { harness: string; model: string } | { effort: string };

/**
 * The run a pick in a thread's pills switches to (POST /api/threads/:id/run), or null when it changes nothing. A new
 * model starts at its default effort, as in the new-thread composer. A new effort keeps the model.
 */
export function pickedRun(
  thread: { harness: string; model: string | null; effort: string },
  harnesses: RunCatalogHarness[] | null | undefined,
  pick: RunPick,
): Run | null {
  if ('effort' in pick) return pick.effort === thread.effort ? null : { harness: thread.harness, model: thread.model ?? '', effort: pick.effort };
  const now = threadChoice(thread, harnesses);
  return pick.harness === now.harness && pick.model === now.model ? null : { harness: pick.harness, model: pick.model, effort: '' };
}

/**
 * The run a pick in the model sheet switches to: the model and effort it shows, as one pick. The same model with another
 * effort keeps the model. Another model starts at its default effort, whatever effort the sheet showed.
 */
export function pickedModelRun(
  thread: { harness: string; model: string | null; effort: string },
  harnesses: RunCatalogHarness[] | null | undefined,
  choice: { harness: string; model: string },
  effort: string,
): Run | null {
  const now = threadChoice(thread, harnesses);
  return pickedRun(thread, harnesses, choice.harness === now.harness && choice.model === now.model ? { effort } : choice);
}

function effortLabel(effort: string, model: RunCatalogModel | undefined, catalogKnown: boolean): string {
  if (!catalogKnown || !model) return effort || 'default';
  if (model.efforts.length === 0) return 'Auto effort';
  if (effort) return effort;
  if (model.defaultEffort) return `Default (${model.defaultEffort})`;
  return 'Default';
}
