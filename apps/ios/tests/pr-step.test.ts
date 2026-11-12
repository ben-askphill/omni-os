import type { PendingMsg } from '@omni/client-core';
import { FIX_CONFLICTS_PROMPT, OPEN_PR_PROMPT } from '@omni/shared/thread-glance.ts';
import { describe, expect, it } from 'vitest';

import { agentOffersPR, resumes, stepChip, stepState, stepWorking } from '../src/pr/step';

// Phone web has offered Open PR in the composer since #653 and kept a step's button working from the press to the end
// of its turn since #633/#645. iOS sent the prompt and showed nothing, so a slow turn looked like a press that did not take.

const user = (text: string) => ({ kind: 'user', payload: JSON.stringify({ text }) });
const reply = (text: string) => ({ kind: 'assistant_text', payload: JSON.stringify({ text }) });
const msg = (text: string, extra: Partial<PendingMsg> = {}): PendingMsg => ({ uuid: 'm1', kind: 'user', text, mode: 'steer', state: 'sent', ...extra }) as PendingMsg;

describe('the branch steps on iOS', () => {
  it('offers Open PR when the idle agent ends by asking whether to open one', () => {
    const rows = [user('fix the header'), reply('Done, tests pass.\n\nWant me to open a PR for this?')];
    expect(agentOffersPR({ rows, pending: [], busy: false })).toBe(true);
    expect(agentOffersPR({ rows, pending: [], busy: true })).toBe(false);
    expect(agentOffersPR({ rows: [reply('Done.')], pending: [], busy: false })).toBe(false);
  });

  it('shows a step as working while its prompt waits or its turn runs', () => {
    expect(stepState({ rows: [], pending: [msg(FIX_CONFLICTS_PROMPT)], busy: false }).underway).toBe('conflicts');
    expect(stepState({ rows: [user(OPEN_PR_PROMPT)], pending: [], busy: true }).underway).toBe('open');
    expect(stepState({ rows: [user(OPEN_PR_PROMPT)], pending: [], busy: false }).underway).toBeNull();
    expect(stepWorking('open', 'open')).toBe('Opening PR');
    expect(stepWorking('open', 'conflicts')).toBeNull();
  });

  it('counts a message forwarded to the machine that holds the thread as underway', () => {
    const forwarded = msg(FIX_CONFLICTS_PROMPT, { forwarded_to: 'omarchy', sent_at: '2026-11-12T07:00:00.000Z' });
    expect(stepState({ rows: [], pending: [forwarded], busy: false }).underway).toBe('conflicts');
  });

  it('resumes a parked step instead of sending it twice', () => {
    const parked = msg(OPEN_PR_PROMPT, { uuid: 'p1', delivery: 'recovered' });
    const s = stepState({ rows: [], pending: [parked], busy: false });
    expect(s).toEqual({ underway: null, parked: { step: 'open', uuid: 'p1' } });
    expect(resumes(s.parked, OPEN_PR_PROMPT)).toBe(true);
    expect(resumes(s.parked, FIX_CONFLICTS_PROMPT)).toBe(false);
  });

  it('picks one chip over the composer: working, then parked, then offered', () => {
    expect(stepChip('open', { step: 'conflicts' }, true)).toEqual({ kind: 'working', label: 'Opening PR' });
    expect(stepChip(null, { step: 'conflicts' }, true)).toMatchObject({ kind: 'ask', label: 'Fix conflicts', prompt: FIX_CONFLICTS_PROMPT });
    expect(stepChip(null, null, true)).toMatchObject({ kind: 'ask', label: 'Open PR', prompt: OPEN_PR_PROMPT });
    expect(stepChip(null, null, false)).toBeNull();
  });
});
