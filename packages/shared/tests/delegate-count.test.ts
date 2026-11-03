import { describe, expect, it } from 'vitest';
import { delegateLabel, delegateSummary, delegatedIds, isWorking, shownStatus, showsRunning, type DelegateNeeds } from '../delegate-count.ts';

const kid = (id: string, status: string, done_at: string | null = null) => ({
  id,
  status,
  done_at,
});

describe('delegateSummary', () => {
  it('is null for a thread that delegated nothing', () => {
    expect(delegateSummary([])).toBeNull();
  });

  it('counts every delegated thread, finished ones too, and settles once none is active', () => {
    const s = delegateSummary([kid('a', 'done'), kid('b', 'stopped')], () => undefined)!;
    expect(s).toMatchObject({ total: 2, active: 0, state: 'settled' });
    expect(delegateLabel(s)).toBe('2 delegated threads, 0 active');
  });

  it('works while any delegated thread runs or queues', () => {
    const s = delegateSummary([kid('a', 'running'), kid('b', 'queued'), kid('c', 'done')], () => undefined)!;
    expect(s).toMatchObject({ total: 3, active: 2, state: 'working' });
    expect(delegateLabel(s)).toBe('3 delegated threads, 2 active');
  });

  it('puts needs you over failed, and failed over working', () => {
    const inbox: Record<string, DelegateNeeds> = {
      b: { blocked: false, failed: true },
      c: { blocked: true, failed: false },
    };
    const needs = (id: string) => inbox[id];
    expect(delegateSummary([kid('a', 'running'), kid('b', 'failed')], needs)!.state).toBe('failed');
    const s = delegateSummary([kid('a', 'running'), kid('b', 'failed'), kid('c', 'running')], needs)!;
    expect(s).toMatchObject({
      total: 3,
      active: 3,
      needs: 1,
      failed: 1,
      state: 'needs',
    });
    expect(delegateLabel(s)).toBe('3 delegated threads, 3 active, 1 needs you, 1 failed');
  });

  it('greys a failure Ben has seen, which left the inbox', () => {
    expect(delegateSummary([kid('a', 'failed')], () => undefined)!.state).toBe('settled');
  });

  it('falls back to the failed status without an inbox, unless the thread is marked done', () => {
    expect(delegateSummary([kid('a', 'failed')])!.state).toBe('failed');
    expect(delegateSummary([kid('a', 'failed', '2026-11-02')])!.state).toBe('settled');
  });

  it('never lets a thread marked done need Ben', () => {
    const s = delegateSummary([kid('a', 'done', '2026-11-02')], () => ({
      blocked: true,
      failed: true,
    }))!;
    expect(s).toMatchObject({ active: 0, state: 'settled' });
  });
});

describe('delegatedIds', () => {
  it('collects every child across groups', () => {
    expect([...delegatedIds([{ children: [{ id: 'a' }] }, { children: [{ id: 'b' }, { id: 'c' }] }])]).toEqual(['a', 'b', 'c']);
    expect(delegatedIds(undefined).size).toBe(0);
  });
});

describe('a thread at work through what it delegated', () => {
  it('shows running while a delegated thread works, though its own turn ended', () => {
    const idle = { status: 'done', delegating: true };
    expect(showsRunning(idle)).toBe(true);
    expect(isWorking(idle)).toBe(true);
    expect(shownStatus(idle)).toBe('running');
  });

  it('goes back to its own status once nothing it delegated works', () => {
    for (const status of ['done', 'failed', 'stopped']) {
      const t = { status, delegating: false };
      expect([showsRunning(t), isWorking(t), shownStatus(t)]).toEqual([false, false, status]);
    }
    expect(shownStatus({ status: 'done' })).toBe('done');
  });

  it('keeps queued as queued: it waits for a slot', () => {
    const t = { status: 'queued', delegating: true };
    expect(showsRunning(t)).toBe(true);
    expect(shownStatus(t)).toBe('queued');
    expect(showsRunning({ status: 'queued' })).toBe(false);
    expect(isWorking({ status: 'queued' })).toBe(true);
  });

  it('counts a delegated thread whose own delegates work as working', () => {
    expect(delegateSummary([{ id: 'a', status: 'done', delegating: true }])!.state).toBe('working');
  });
});
