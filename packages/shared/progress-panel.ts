// The Progress card under the thread's quick card (desktop web, the desktop app and the phone's quick actions): the
// latest step list the agent or its harness made (steps.ts), so a glance at the side shows where the work stands
// without scrolling the transcript. Grouped phases are left out: they are Omni's guess, not a plan, and a thread with
// no list shows no card. Pure, on top of the transcript fold.
import { turnSteps, turnsOf, type Step, type StepState, type StepsView } from './steps.ts';
import type { Item } from './transcript-fold.ts';

export interface ProgressPanel {
  /** The list it shows, from the newest turn that has one. */
  view: StepsView;
  /**
   * What closing the card hides: the turn's first item and the list's step keys (its titles as listed, not the active
   * step's "doing" words, so moving on keeps it closed). A new list, or one in a later turn, brings the card back.
   */
  key: string;
}

/**
 * The newest turn's step list the agent (set_steps) or its harness (TodoWrite, TaskCreate) made, or null when no turn
 * has one. Only the newest turn can still run: `live` is whether the thread runs, `asking` whether a question waits.
 */
export function progressPanel(items: readonly Item[], { live, asking = false }: { live: boolean; asking?: boolean }): ProgressPanel | null {
  const turns = turnsOf(items);
  for (let i = turns.length - 1; i >= 0; i--) {
    const newest = i === turns.length - 1;
    const view = turnSteps(turns[i], { live: live && newest, asking: live && newest && asking });
    if (!view || view.source === 'phases' || !view.steps.length) continue;
    return { view, key: `${turns[i][0]?.key ?? i}:${view.steps.map((s) => s.key).join('|')}` };
  }
  return null;
}

/** How a step's row reads: done ones step back, the one it is on stands out, the rest wait in between. */
export type ProgressTone = 'done' | 'current' | 'pending';

export const progressTone = (s: StepState): ProgressTone => (s === 'done' ? 'done' : s === 'pending' ? 'pending' : 'current');

/** The status mark beside the step it is on (status.ts marks). Done and pending steps carry none, only the rail. */
export const PROGRESS_MARK: Record<StepState, 'working' | 'question' | 'failed' | 'stopped' | 'done' | null> = {
  done: null,
  pending: null,
  active: 'working',
  needs: 'question',
  failed: 'failed',
  stopped: 'stopped',
};

/** Every step is done: the list is finished, and its last step carries the done check the rail runs into. */
export const progressFinished = (v: Pick<StepsView, 'steps'>) => v.steps.length > 0 && v.steps.every((s) => s.state === 'done');

/**
 * A step's mark on the rail: the step it is on carries its status, and the last step of a finished list the done check,
 * so a list that is all done ends on a check, like Claude's Progress card, instead of a rail with nothing at its end.
 */
export const progressMark = (state: StepState, { last, finished }: { last: boolean; finished: boolean }) => (finished && last ? 'done' : PROGRESS_MARK[state]);

/** The line under the step it is on: what it does now while the turn runs. */
export const progressNow = (s: Step): string | null => (s.state === 'active' || s.state === 'needs' ? s.now : null);

/** The card's label for screen readers and its header's count: "2 of 4 done". */
export const progressCount = (v: StepsView) => `${v.done} of ${v.steps.length} done`;
