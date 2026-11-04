import { OmniHttpError } from '@omni/client-core';
import { newDraft, choose, type Answer, type Question } from '@omni/shared/question.ts';
import { describe, expect, it } from 'vitest';

import { advance, ASKING, elsewhereLabel, goBack, phaseAfter, SENDING, submitAnswers } from '../src/questions/card-state';

const single: Question = {
  question: 'Which goal first?',
  header: 'Goal',
  multiSelect: false,
  options: [
    { label: 'Ship', description: 'Release it' },
    { label: 'Test', description: 'Cover it' },
  ],
};
const multi: Question = {
  question: 'Which clients?',
  multiSelect: true,
  options: [
    { label: 'A', description: '' },
    { label: 'B', description: '' },
  ],
};

const http = (status: number, body: unknown) => new OmniHttpError({ kind: 'http', status, message: 'refused', body, retryAfter: null });

describe('advance', () => {
  it('moves to the next page, and sends the answers from the last one', () => {
    const draft = newDraft([single, multi]);
    const first = advance(draft, false);
    expect(first).toMatchObject({ kind: 'page', draft: { page: 1 } });
    if (first.kind !== 'page') throw new Error('expected a page');

    const picked = { ...first.draft, picks: first.draft.picks.map((p, i) => (i === 1 ? choose(multi, p, 'B') : p)) };
    const last = advance(picked, false);
    expect(last).toMatchObject({ kind: 'send', answers: [{ selected: ['Ship'], other: null }, { selected: ['B'], other: null }] });
  });

  it('holds on a question with no answer until one is chosen', () => {
    const draft = { ...newDraft([multi]) };
    expect(advance(draft, false)).toEqual({ kind: 'blocked' });
    expect(advance(draft, true)).toMatchObject({ kind: 'send', answers: [null] });
  });

  it('skips only the shown question', () => {
    const step = advance(newDraft([single, single]), true);
    if (step.kind !== 'page') throw new Error('expected a page');
    expect(step.draft.skipped).toEqual([true, false]);
    const last = advance(step.draft, false);
    expect(last).toMatchObject({ kind: 'send', answers: [null, { selected: ['Ship'], other: null }] });
  });

  it('does not answer with Other chosen and nothing typed', () => {
    const d = newDraft([single]);
    const other = { ...d, picks: [choose(single, d.picks[0], null)] };
    expect(advance(other, false)).toEqual({ kind: 'blocked' });
    const typed = { ...other, picks: [{ ...other.picks[0], other: '  Both  ' }] };
    expect(advance(typed, false)).toMatchObject({ kind: 'send', answers: [{ selected: [], other: 'Both' }] });
  });

  it('goes back a page and stops at the first', () => {
    const d = { ...newDraft([single, single]), page: 1 };
    expect(goBack(d).page).toBe(0);
    expect(goBack(goBack(d)).page).toBe(0);
  });
});

describe('submitAnswers', () => {
  const answers: Answer[] = [{ selected: ['Ship'], other: null }];

  it('settles with what the server says and what Ben sent', async () => {
    const out = await submitAnswers(async () => ({ state: 'answered' }), answers);
    expect(out).toEqual({ kind: 'sent', settled: { state: 'answered', answers } });
  });

  it('settles as skipped when the server says every question was skipped', async () => {
    const out = await submitAnswers(async () => ({ state: 'skipped' }), [null]);
    expect(out).toMatchObject({ kind: 'sent', settled: { state: 'skipped' } });
  });

  it('reads a 409 as answered elsewhere, with the state it left', async () => {
    const out = await submitAnswers(async () => Promise.reject(http(409, { error: 'already answered', state: 'answered' })), answers);
    expect(out).toEqual({ kind: 'elsewhere', state: 'answered' });
  });

  it('keeps a 409 without a state as a failure that says why', async () => {
    const out = await submitAnswers(async () => Promise.reject(http(409, { error: 'This thread is running on Box.' })), answers);
    expect(out).toMatchObject({ kind: 'failed' });
  });

  it('keeps any other failure as a failure Ben can retry', async () => {
    const out = await submitAnswers(async () => Promise.reject(http(500, { error: 'down' })), answers);
    expect(out).toEqual({ kind: 'failed', message: 'refused' });
    const offline = await submitAnswers(async () => Promise.reject(new OmniHttpError({ kind: 'unreachable', detail: 'x' })), answers);
    expect(offline).toMatchObject({ kind: 'failed', message: 'Cannot reach the Omni server. Is it running?' });
  });
});

describe('phase', () => {
  it('goes from asking, to sending, to what the answer came to', () => {
    expect(ASKING).toEqual({ kind: 'asking', busy: false, error: null });
    expect(SENDING).toEqual({ kind: 'asking', busy: true, error: null });
    expect(phaseAfter({ kind: 'sent', settled: { state: 'answered', answers: [null] } })).toMatchObject({ kind: 'sent' });
    expect(phaseAfter({ kind: 'elsewhere', state: 'answered' })).toEqual({ kind: 'elsewhere', state: 'answered' });
  });

  it('returns to asking with the error after a failure, so Ben can send again', () => {
    expect(phaseAfter({ kind: 'failed', message: 'down' })).toEqual({ kind: 'asking', busy: false, error: 'down' });
  });

  it('names a question settled elsewhere, and does not claim an answer for one that was dismissed', () => {
    expect(elsewhereLabel('answered')).toBe('Answered elsewhere');
    expect(elsewhereLabel(null)).toBe('Answered elsewhere');
    expect(elsewhereLabel('dismissed')).toBe('Not answered');
  });
});
