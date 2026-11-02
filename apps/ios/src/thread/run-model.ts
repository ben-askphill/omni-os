import type { HarnessInfo, Thread } from '@omni/client-core';
import type { Run } from '@omni/shared/run-switch.ts';
import { pickedModelRun, runModel, shownRun, threadChoice, threadRunLabels } from '@omni/shared/thread-run.ts';

/** What the run switch reads of a thread: its run, and the run queued to start after the current turn. */
export type RunThread = Pick<
  Thread,
  'harness' | 'model' | 'effort' | 'auto_reason' | 'queued_harness' | 'queued_model' | 'queued_effort'
>;

export interface EffortRow {
  /** Sent as the effort. Empty: the model's default. */
  value: string;
  label: string;
  selected: boolean;
}

export interface ModelRow {
  id: string;
  label: string;
  note: string | null;
  isDefault: boolean;
  selected: boolean;
}

export interface HarnessSection {
  id: string;
  name: string;
  /** The plan that bills, for an available harness. */
  plan: string;
  available: boolean;
  /** For an unavailable harness: the command that fixes it. */
  fix: string | null;
  models: ModelRow[];
}

export interface RunSheetModel {
  /** Names the model the effort rows belong to. Null when the model has no effort levels. */
  effortTitle: string | null;
  efforts: EffortRow[];
  harnesses: HarnessSection[];
}

/**
 * The model sheet as rows, from `/harnesses` alone: every harness the server reports is listed, so a new one needs no
 * code here. The checked rows are the run the thread shows: the one queued for its next turn, else the one it runs on.
 */
export function runSheetModel(thread: RunThread, harnesses: HarnessInfo[]): RunSheetModel {
  const shown = shownRun(thread);
  const choice = threadChoice(shown, harnesses);
  const { model } = runModel(shown, harnesses);
  const levels = model?.efforts ?? [];
  return {
    effortTitle: levels.length > 0 ? `Effort for ${model?.label ?? 'this model'}` : null,
    efforts:
      levels.length > 0
        ? ['', ...levels].map((value) => ({
            value,
            label: value || (model?.defaultEffort ? `Default (${model.defaultEffort})` : 'Default'),
            selected: shown.effort === value,
          }))
        : [],
    harnesses: harnesses.map((h) => ({
      id: h.id,
      name: h.name,
      plan: h.plan,
      available: h.available,
      fix: h.available ? null : (h.fix ?? null),
      models: h.models.map((m) => ({
        id: m.id,
        label: m.label,
        note: m.note || null,
        isDefault: !!m.default,
        selected: h.id === choice.harness && m.id === choice.model,
      })),
    })),
  };
}

/** The run a tap in the sheet switches to, or null when it changes nothing. */
export function runForPick(
  thread: RunThread,
  harnesses: HarnessInfo[],
  pick: { harness: string; model: string } | { effort: string },
): Run | null {
  const shown = shownRun(thread);
  if ('effort' in pick) return pickedModelRun(shown, harnesses, threadChoice(shown, harnesses), pick.effort);
  return pickedModelRun(shown, harnesses, pick, shown.effort);
}

/**
 * "Sonnet 5.5 · high": the chip's text for the run the thread is on now. A switch queued mid-turn is not here, the next
 * turn chip names it. Null until the catalog loads.
 */
export function runChipLabel(thread: RunThread, harnesses: HarnessInfo[] | null): string | null {
  if (!harnesses) return null;
  const labels = threadRunLabels(thread, harnesses);
  const { model } = runModel(thread, harnesses);
  const effort = model && model.efforts.length > 0 ? thread.effort || model.defaultEffort : '';
  return [labels.model, effort].filter(Boolean).join(' · ');
}

/**
 * The model the next turn runs on when it is not the one running now: a switch picked during a turn waits for the turn
 * to end. Null when nothing is queued.
 */
export function nextTurnLabel(thread: RunThread, harnesses: HarnessInfo[] | null): string | null {
  const shown = shownRun(thread);
  if (shown === thread) return null;
  const label = threadRunLabels(shown, harnesses).model;
  return label || null;
}
