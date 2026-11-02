import { OmniHttpError } from '@omni/client-core';
import { answersOf, canAdvance, isLastPage, type Answer, type Draft, type QuestionState } from '@omni/shared/question.ts';

export type SettledState = Exclude<QuestionState, 'pending'>;

export interface Settled {
  state: SettledState;
  answers: Answer[] | null;
}

const SETTLED: readonly string[] = ['answered', 'skipped', 'dismissed'];
const isSettled = (s: unknown): s is SettledState => typeof s === 'string' && SETTLED.includes(s);

export const STATE_LABEL: Record<SettledState, string> = { answered: 'Answered', skipped: 'Skipped', dismissed: 'Not answered' };

/** The status a thread shows while a question waits on Ben. */
export const ASKING_LABEL = 'Needs your input';

export type Step = { kind: 'blocked' } | { kind: 'page'; draft: Draft } | { kind: 'send'; draft: Draft; answers: Answer[] };

/** Next, or Send on the last page. Skip marks the shown question skipped first. */
export function advance(draft: Draft, skip: boolean): Step {
  if (!skip && !canAdvance(draft)) return { kind: 'blocked' };
  const next: Draft = { ...draft, skipped: draft.skipped.map((s, i) => (i === draft.page ? skip : s)) };
  if (isLastPage(next)) return { kind: 'send', draft: next, answers: answersOf(next) };
  return { kind: 'page', draft: { ...next, page: next.page + 1 } };
}

export const goBack = (draft: Draft): Draft => (draft.page > 0 ? { ...draft, page: draft.page - 1 } : draft);

export type Outcome =
  | { kind: 'sent'; settled: Settled }
  /** The server had it answered already, from another device or by a message. `state` is how, when it said. */
  | { kind: 'elsewhere'; state: SettledState | null }
  | { kind: 'failed'; message: string };

/** Sends the answers. A 409 is not a failure: the question is settled and the stream brings that answer. */
export async function submitAnswers(send: (answers: Answer[]) => Promise<{ state: QuestionState }>, answers: Answer[]): Promise<Outcome> {
  try {
    const res = await send(answers);
    return { kind: 'sent', settled: { state: isSettled(res.state) ? res.state : 'answered', answers } };
  } catch (e) {
    if (e instanceof OmniHttpError && e.failure.kind === 'http' && e.failure.status === 409) {
      const body = e.failure.body;
      const state = body && typeof body === 'object' ? (body as { state?: unknown }).state : null;
      return { kind: 'elsewhere', state: isSettled(state) ? state : null };
    }
    return { kind: 'failed', message: e instanceof Error && e.message ? e.message : 'Something went wrong' };
  }
}

/** What the card shows between Send and the stream's answer event. */
export type Phase =
  | { kind: 'asking'; busy: boolean; error: string | null }
  | { kind: 'sent'; settled: Settled }
  | { kind: 'elsewhere'; state: SettledState | null };

export const ASKING: Phase = { kind: 'asking', busy: false, error: null };
export const SENDING: Phase = { kind: 'asking', busy: true, error: null };

export function phaseAfter(o: Outcome): Phase {
  switch (o.kind) {
    case 'sent':
      return { kind: 'sent', settled: o.settled };
    case 'elsewhere':
      return { kind: 'elsewhere', state: o.state };
    case 'failed':
      return { kind: 'asking', busy: false, error: o.message };
  }
}

/** The label over a question the server had settled already. */
export const elsewhereLabel = (state: SettledState | null): string => (state === 'dismissed' ? STATE_LABEL.dismissed : 'Answered elsewhere');
