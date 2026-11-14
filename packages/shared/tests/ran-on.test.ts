import { describe, expect, it } from 'vitest';
import { elapsedShort, ranOnLine, ranOnTitle, runElapsed, type RanOn } from '../ran-on.ts';

const NOW = Date.parse('2026-11-14T22:00:00.000Z');
const air: RanOn = { id: 'a', name: 'MacBook Air', at: '2026-11-14T21:00:00.000Z', before: [] };
const moved: RanOn = {
  ...air,
  before: [
    { id: 'o', name: 'omarchy', at: '2026-11-14T18:00:00.000Z' },
    { id: 'p', name: 'MacBook Pro', at: null },
  ],
};

describe('elapsedShort', () => {
  it('counts seconds, then minutes, then hours and minutes, then days and hours', () => {
    expect(elapsedShort(0)).toBe('0s');
    expect(elapsedShort(45_900)).toBe('45s');
    expect(elapsedShort(12 * 60_000 + 59_000)).toBe('12m');
    expect(elapsedShort(65 * 60_000)).toBe('1h 05m');
    expect(elapsedShort((26 * 60 + 7) * 60_000)).toBe('1d 02h');
  });

  it('never goes below zero, and says nothing for a bad time', () => {
    expect(elapsedShort(-5000)).toBe('0s');
    expect(elapsedShort(NaN)).toBe('');
  });
});

describe('runElapsed', () => {
  it('is the time since the run started, and null without a start or with a broken one', () => {
    expect(runElapsed({ run_started_at: '2026-11-14T21:48:00.000Z' }, NOW)).toBe('12m');
    expect(runElapsed({ run_started_at: null }, NOW)).toBeNull();
    expect(runElapsed({}, NOW)).toBeNull();
    expect(runElapsed({ run_started_at: 'never' }, NOW)).toBeNull();
  });
});

describe('ranOnLine', () => {
  it('shows the machine and the run time, and keeps the branch for the tooltip', () => {
    const line = ranOnLine({ status: 'running', ran_on: air, run_started_at: '2026-11-14T21:48:00.000Z', branch: 'omni/f3c516ac' }, NOW);
    expect(line).toMatchObject({ machine: 'MacBook Air', elapsed: '12m', branch: null });
    expect(line.title).toBe('Running on MacBook Air · Branch omni/f3c516ac');
  });

  it('falls back to the branch when no machine is known, and shows nothing for a legacy thread with neither', () => {
    expect(ranOnLine({ status: 'idle', ran_on: null, branch: 'omni/x' }, NOW)).toMatchObject({ machine: null, branch: 'omni/x', elapsed: null });
    const bare = ranOnLine({ status: 'idle' }, NOW);
    expect(bare).toMatchObject({ machine: null, branch: null, elapsed: null, title: '' });
    expect(JSON.stringify(bare)).not.toContain('undefined');
  });

  it('names a blank machine neutrally', () => {
    expect(ranOnLine({ status: 'idle', ran_on: { ...air, name: '  ' } }, NOW).machine).toBe('Unnamed machine');
  });
});

describe('ranOnTitle', () => {
  it('says where it ran last, then the machines before, newest first', () => {
    expect(ranOnTitle({ status: 'done', ran_on: moved }, NOW)).toBe('Last ran on MacBook Air · before: MacBook Pro, omarchy (4h ago)');
  });

  it('says queued for a thread waiting for a slot', () => {
    expect(ranOnTitle({ status: 'queued', ran_on: air }, NOW)).toBe('Queued on MacBook Air');
  });

  it('says running for a delegating thread whose own status is done, since its run time is ticking', () => {
    expect(ranOnTitle({ status: 'done', ran_on: air, run_started_at: '2026-11-14T21:48:00.000Z' }, NOW)).toBe('Running on MacBook Air');
  });
});
