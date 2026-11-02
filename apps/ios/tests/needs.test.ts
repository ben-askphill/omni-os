import type { NeedsYou, NeedsYouItem, PendingMsg, Recovered, Thread } from '@omni/client-core';
import { describe, expect, it, vi } from 'vitest';

import { runNeedsAction, type RecoveryApi } from '../src/needs/actions';
import { shownResult, withoutResult } from '../src/needs/inbox';
import { limitView, resetLabel } from '../src/needs/limit';
import { parkedHeading, parkedLabel } from '../src/needs/parked';
import { liveMessages, threadCards } from '../src/needs/thread-cards';

const NOW = new Date(2026, 10, 2, 12, 0, 0).getTime();
const at = (days: number, h: number, m = 0) => new Date(2026, 10, 2 + days, h, m, 0).toISOString();

const thread = (over: Partial<Thread> = {}): Thread =>
  ({
    id: 't1',
    channel_id: 'c',
    title: 'Fix build',
    status: 'done',
    harness: 'claude-code',
    branch: null,
    setup: null,
    setup_error: null,
    limit_state: null,
    limit_resets_at: null,
    limit_elsewhere: 0,
    ...over,
  }) as Thread;

const msg = (over: Partial<PendingMsg> = {}): PendingMsg => ({ uuid: 'm1', kind: 'user', text: 'Please continue', mode: 'steer', state: 'waiting', ...over });

describe('limit view', () => {
  it('offers a schedule and a resume when the harness gave a reset time', () => {
    const v = limitView({ limit_state: 'limited', limit_resets_at: at(0, 15, 30), limit_elsewhere: 0 }, 'Claude Code', NOW);
    expect(v).toMatchObject({ title: 'Usage limit reached', actions: ['schedule', 'resume'], scheduled: false });
    expect(v?.body).toContain('Claude Code stopped this turn');
    expect(v?.body).toContain('15:30');
  });

  it('offers Cancel and Resume now once scheduled', () => {
    const v = limitView({ limit_state: 'scheduled', limit_resets_at: at(1, 9), limit_elsewhere: 0 }, 'Codex', NOW);
    expect(v).toMatchObject({ title: 'Resumes at tomorrow 09:00', actions: ['cancel', 'resume'], scheduled: true });
  });

  it('only offers Resume now with no reset time', () => {
    expect(limitView({ limit_state: 'limited', limit_resets_at: null, limit_elsewhere: 0 }, 'Codex', NOW)?.actions).toEqual(['resume']);
  });

  it('shows a stop from the other machine without buttons', () => {
    const v = limitView({ limit_state: 'scheduled', limit_resets_at: at(0, 18), limit_elsewhere: 1 }, 'Codex', NOW);
    expect(v?.actions).toEqual([]);
    expect(v?.title).toBe('Resumes at 18:00 on your other machine');
  });

  it('is absent without a limit', () => {
    expect(limitView({ limit_state: null, limit_resets_at: null, limit_elsewhere: 0 }, 'Codex', NOW)).toBeNull();
  });

  it('labels a reset by day', () => {
    expect(resetLabel(at(0, 7), NOW)).toBe('07:00');
    expect(resetLabel(at(1, 7), NOW)).toBe('tomorrow 07:00');
    expect(resetLabel(at(3, 7), NOW)).toMatch(/^\w{3} 07:00$/);
    expect(resetLabel('nonsense', NOW)).toBe('');
  });
});

describe('parked messages', () => {
  it('says why each one waits', () => {
    expect(parkedLabel(msg({ delivery: 'recovered' }))).toBe('Held after a restart, waiting for Resume');
    expect(parkedLabel(msg({ delivery: 'recovered' }), true)).toBe('Waiting for a session that is up to date');
    expect(parkedLabel(msg({ delivery: 'uncertain' }))).toBe('May have reached the agent before the restart');
    expect(parkedLabel(msg({ kind: 'crew_report', task_id: 'T-1', role: 'coder', delivery: 'recovered' }))).toBe('Crew report T-1 from coder, held for Resume');
    expect(parkedLabel(msg({ delivery: 'sent' }))).toBeNull();
  });

  it('counts them in the heading', () => {
    expect(parkedHeading([msg()])).toBe('1 message was waiting when Omni restarted');
    expect(parkedHeading([msg(), msg({ uuid: 'm2' })])).toBe('2 messages were waiting when Omni restarted');
    expect(parkedHeading([msg({ kind: 'crew_report' })])).toBe('1 crew report is waiting for Resume');
    expect(parkedHeading([msg({ kind: 'crew_report' }), msg()])).toBe('2 messages and crew reports are waiting for Resume');
  });
});

describe('thread cards', () => {
  const cards = (t: Thread, pending: PendingMsg[] = [], blocked = false) => threadCards({ thread: t, pending, blocked, now: NOW });

  it('has no card for a thread nothing holds up', () => {
    expect(cards(thread(), [msg({ delivery: 'accepted' })])).toEqual([]);
  });

  it('offers Retry setup on a failed worktree, with the reason', () => {
    const [card] = cards(thread({ setup: 'failed', setup_error: 'git: no space left', branch: 'omni/x', status: 'failed' }));
    expect(card).toMatchObject({ kind: 'setup', failed: true, title: 'Setup failed', detail: 'git: no space left', branch: 'omni/x' });
    expect(card?.buttons).toEqual([{ key: 'retry', label: 'Retry setup', action: { kind: 'retry-setup' }, primary: true }]);
  });

  it('calls a stopped setup stopped, and shows a preparing one without a button', () => {
    expect(cards(thread({ setup: 'failed', status: 'stopped' }))[0]).toMatchObject({ title: 'Setup stopped' });
    expect(cards(thread({ setup: 'preparing' }))[0]).toMatchObject({ kind: 'setup', failed: false, title: 'Preparing worktree', buttons: [] });
  });

  it('turns a limit into buttons in order', () => {
    const [card] = cards(thread({ limit_state: 'limited', limit_resets_at: at(0, 15) }));
    expect(card).toMatchObject({ kind: 'limit', title: 'Usage limit reached' });
    expect(card?.buttons.map((b) => [b.label, b.primary])).toEqual([
      ['Resume at reset', true],
      ['Resume now', false],
    ]);
    expect(card?.buttons[0]?.action).toEqual({ kind: 'limit', action: 'schedule' });
  });

  it('offers Resume N for recovered messages and Send again for an uncertain one', () => {
    const pending = [
      msg({ uuid: 'a', delivery: 'recovered' }),
      msg({ uuid: 'b', delivery: 'recovered' }),
      msg({ uuid: 'c', delivery: 'uncertain', text: 'Deploy it' }),
      msg({ uuid: 'live', delivery: 'accepted' }),
    ];
    const [card] = cards(thread(), pending);
    if (card?.kind !== 'parked') throw new Error('expected the parked card');
    expect(card.heading).toBe('3 messages were waiting when Omni restarted');
    expect(card.buttons).toEqual([{ key: 'resume', label: 'Resume 2', action: { kind: 'resume' }, primary: true }]);
    expect(card.rows.map((r) => r.uuid)).toEqual(['a', 'b', 'c']);
    expect(card.rows[2]?.buttons).toEqual([{ key: 'again:c', label: 'Send again', action: { kind: 'resume', ids: ['c'] }, primary: false }]);
    expect(card.rows[0]?.buttons).toEqual([]);
  });

  it('lets Ben discard what Omni wrote, not what he did', () => {
    const [card] = cards(thread(), [msg({ uuid: 'r', kind: 'crew_report', delivery: 'recovered' }), msg({ uuid: 'u', delivery: 'recovered' })]);
    if (card?.kind !== 'parked') throw new Error('expected the parked card');
    expect(card.rows[0]?.buttons.map((b) => b.label)).toEqual(['Discard']);
    expect(card.rows[0]?.buttons[0]?.action).toEqual({ kind: 'discard', id: 'r' });
    expect(card.rows[1]?.buttons).toEqual([]);
  });

  it('holds parked messages for the worktree while it is not ready, and offers no Resume', () => {
    const cs = cards(thread({ setup: 'failed' }), [msg({ delivery: 'recovered' })]);
    expect(cs.map((c) => c.kind)).toEqual(['setup', 'parked']);
    expect(cs[1]).toMatchObject({ heading: 'Sends once the worktree is ready', buttons: [], rows: [{ label: 'Waits for the worktree' }] });
  });

  it('keeps messages the agent has out of the parked card', () => {
    const pending = [msg({ uuid: 'a', delivery: 'recovered' }), msg({ uuid: 'b', delivery: 'accepted' })];
    expect(liveMessages(pending).map((m) => m.uuid)).toEqual(['b']);
  });
});

describe('recovery actions', () => {
  const recovered: Recovered = { thread: thread(), pending: [] };
  const api = () => {
    const fn = () => vi.fn(async (..._args: unknown[]) => recovered);
    return { retrySetup: fn(), scheduleLimit: fn(), cancelLimit: fn(), resumeLimit: fn(), resumeRequests: fn(), discardRequests: fn() } satisfies Record<keyof RecoveryApi, unknown>;
  };

  it('maps each button to its own call', async () => {
    const a = api();
    const run = (x: Parameters<typeof runNeedsAction>[2]) => runNeedsAction(a as unknown as RecoveryApi, 't1', x);
    await run({ kind: 'retry-setup' });
    await run({ kind: 'limit', action: 'schedule' });
    await run({ kind: 'limit', action: 'cancel' });
    await run({ kind: 'limit', action: 'resume' });
    await run({ kind: 'resume' });
    await run({ kind: 'resume', ids: ['m1'] });
    await run({ kind: 'discard', id: 'm2' });
    expect(a.retrySetup).toHaveBeenCalledWith('t1');
    expect(a.scheduleLimit).toHaveBeenCalledWith('t1');
    expect(a.cancelLimit).toHaveBeenCalledWith('t1');
    expect(a.resumeLimit).toHaveBeenCalledWith('t1');
    expect(a.resumeRequests.mock.calls).toEqual([['t1', undefined], ['t1', ['m1']]]);
    expect(a.discardRequests).toHaveBeenCalledWith('t1', ['m2']);
  });
});

describe('inbox', () => {
  const item = (id: string, over: Partial<NeedsYouItem> = {}): NeedsYouItem => ({
    thread: thread({ id, channel_id: id === 'z' ? 'other' : 'c' }),
    result: { uid: `r-${id}`, status: 'done', event_uid: null, at: '' },
    blockers: [],
    at: '',
    ...over,
  });
  const all = (items: NeedsYouItem[]): NeedsYou => ({ items, unread: items.filter((i) => i.result).length, blocked: items.filter((i) => i.blockers.length).length });

  it('shows the unread result of a thread once it is not running', () => {
    const inbox = all([item('a')]);
    expect(shownResult(inbox, 'a', 'done')).toBe('r-a');
    expect(shownResult(inbox, 'a', 'failed')).toBe('r-a');
    expect(shownResult(inbox, 'a', 'running')).toBeNull();
    expect(shownResult(inbox, 'a', 'queued')).toBeNull();
    expect(shownResult(inbox, 'a', undefined)).toBeNull();
    expect(shownResult(inbox, 'other', 'done')).toBeNull();
    expect(shownResult(null, 'a', 'done')).toBeNull();
  });

  it('drops a read result, and keeps a thread that a blocker still holds', () => {
    const inbox = all([item('a'), item('b', { blockers: [{ kind: 'recovered', detail: null, count: 1 }] })]);
    expect(withoutResult(inbox, 'r-a')).toMatchObject({ unread: 1, blocked: 1, items: [{ thread: { id: 'b' } }] });
    const kept = withoutResult(inbox, 'r-b');
    expect(kept).toMatchObject({ unread: 1, blocked: 1 });
    expect(kept.items.find((i) => i.thread.id === 'b')?.result).toBeNull();
  });
});
