import type { PendingMsg } from '@omni/client-core';
import { lastReply, offersPR, STEP_PROMPTS, STEP_WORKING, stepOf, stepParked, stepUnderway, type PRStep, type StepPrompts } from '@omni/shared/thread-glance.ts';

/** A transcript row as the step rules read it. */
type Row = { kind: string; payload: string };

/** What the branch steps (Open PR, Fix conflicts, Fix checks) read from the thread. */
export interface StepThread {
  rows: readonly Row[];
  pending: readonly PendingMsg[];
  /** A turn runs or waits for a slot. */
  busy: boolean;
}

/**
 * The step the agent is on, and a step prompt parked before it reached the agent (its `uuid` resumes it). `prompts` are
 * the channel's own step prompts (`stepPrompts`), so its wording reads as the step too.
 */
export function stepState(t: StepThread, prompts: StepPrompts = STEP_PROMPTS): { underway: PRStep | null; parked: { step: PRStep; uuid: string } | null } {
  const queued = t.pending.map((m) => ({ kind: m.kind, text: m.text, uuid: m.uuid, delivery: m.delivery }));
  return { underway: stepUnderway(t.rows, queued, t.busy, prompts), parked: stepParked(queued, prompts) };
}

/** The idle thread's agent ended its reply by asking whether to open a PR. Whether the branch has one yet is the caller's to check. */
export function agentOffersPR(t: StepThread): boolean {
  return !t.busy && t.pending.length === 0 && offersPR(lastReply(t.rows));
}

/** The step's button while the agent works on it, or null when it is free to press. */
export const stepWorking = (underway: PRStep | null, step: PRStep): string | null => (underway === step ? STEP_WORKING[step] : null);

/**
 * The step the button shows as working: the one this phone just asked for, from the press until the thread has shown it
 * and gone idle again, else the one the thread shows. The thread alone blinks off in between: the send returns before
 * the stream has the message.
 */
export function shownStep(asked: { step: PRStep; seen: boolean } | null, underway: PRStep | null): PRStep | null {
  return underway ?? (asked ? asked.step : null);
}

/** Whether a press of this prompt should resume the parked copy instead of sending it again. */
export const resumes = (parked: { step: PRStep } | null, prompt: string, prompts: StepPrompts = STEP_PROMPTS) => parked !== null && parked.step === stepOf(prompt, prompts);

/** Each step's button label when free to press. */
export const STEP_LABEL: Record<PRStep, string> = { open: 'Open PR', conflicts: 'Fix conflicts', checks: 'Fix checks' };

export type StepChip = { kind: 'working'; label: string } | { kind: 'ask'; label: string; prompt: string; hint: string } | null;

/**
 * The chip over the composer for the branch steps: the step the agent works on, a parked step to press again, or Open PR
 * when the agent just asked whether to open one and the branch has none.
 */
export function stepChip(working: PRStep | null, parked: { step: PRStep } | null, offered: boolean, prompts: StepPrompts = STEP_PROMPTS): StepChip {
  if (working) return { kind: 'working', label: STEP_WORKING[working] };
  if (parked) return { kind: 'ask', label: STEP_LABEL[parked.step], prompt: prompts[parked.step], hint: 'Sends the step again. It did not reach the agent' };
  if (offered) return { kind: 'ask', label: 'Open PR', prompt: prompts.open, hint: 'Asks the agent to push the branch and open a pull request' };
  return null;
}
