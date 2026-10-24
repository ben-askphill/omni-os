import { describe, expect, it } from 'vitest';
import { watchLine, type PRWatchView } from '@omni/shared/pr-watch.ts';
import type { PendingMsg } from '../src/api.ts';
import { watchCopy } from '../src/components/thread/PRWatch.tsx';
import { isOmnis, parkedHeading, parkedLabel } from '../src/requests.ts';

const at = '2026-10-24T10:00:00.000Z';
const watch = (over: Partial<PRWatchView> = {}): PRWatchView => ({
  thread_id: 't1',
  repo: 'ben-askphill/omni-os',
  number: 219,
  state: 'watching',
  stop_reason: null,
  head_sha: 'abc1234',
  checks: null,
  wakes: 0,
  max_wakes: 5,
  last_wake_at: null,
  last_polled_at: null,
  next_poll_at: null,
  error: null,
  created_at: at,
  updated_at: at,
  ...over,
});

describe('watchLine', () => {
  it('says what a running watch sees, worst first', () => {
    expect(watchLine(watch())).toBe('Watching checks');
    expect(watchLine(watch({ checks: { passed: 0, failed: 0, pending: 0 } }))).toBe('Watching checks');
    expect(watchLine(watch({ checks: { passed: 3, failed: 0, pending: 0 } }))).toBe('Watching checks: all passed');
    expect(watchLine(watch({ checks: { passed: 3, failed: 0, pending: 2 } }))).toBe('Watching checks: 2 running');
    expect(watchLine(watch({ checks: { passed: 3, failed: 1, pending: 2 } }))).toBe('Watching checks: 1 failing');
    expect(watchLine(watch({ error: 'HTTP 502', checks: { passed: 0, failed: 1, pending: 0 } }))).toBe('Watching checks, retrying GitHub');
  });

  it('says why a watch stopped', () => {
    const stopped = (stop_reason: PRWatchView['stop_reason']) => watchLine(watch({ state: 'stopped', stop_reason }));
    expect(stopped(null)).toBe('Watch stopped');
    expect(stopped('stopped')).toBe('Watch stopped');
    expect(stopped('archived')).toBe('Watch stopped: thread archived');
    expect(stopped('merged')).toBe('Watch ended: PR merged');
    expect(stopped('closed')).toBe('Watch ended: PR closed');
    expect(stopped('wake_limit')).toBe('Watch stopped after its wake limit');
    expect(stopped('error_limit')).toBe('Watch stopped: GitHub kept failing');
  });
});

describe('the watch toggle', () => {
  it('offers to start with no watch or a stopped one, and to stop a running one', () => {
    expect(watchCopy(undefined)).toEqual({ action: 'Watch checks', line: 'Wakes this thread when a check fails' });
    expect(watchCopy(null)).toEqual({ action: 'Watch checks', line: 'Wakes this thread when a check fails' });
    expect(watchCopy(watch({ state: 'stopped', stop_reason: 'wake_limit' }))).toEqual({ action: 'Watch checks', line: 'Watch stopped after its wake limit' });
    expect(watchCopy(watch({ checks: { passed: 1, failed: 2, pending: 0 } }))).toEqual({ action: 'Stop watching', line: 'Watching checks: 2 failing' });
  });
});

describe('a PR watch wake waiting for Resume', () => {
  const wake: PendingMsg = { uuid: 'w', kind: 'user', text: '#219 at abc1234. CI failed', source: 'pr-watch', mode: 'queue', state: 'held', request_id: 'pr-watch:x', delivery: 'recovered' };
  const ben: PendingMsg = { uuid: 'b', kind: 'user', text: 'x', source: 'ben', mode: 'queue', state: 'held', request_id: 'r1', delivery: 'recovered' };

  it("is Omni's, labelled as the watch's, and not blamed on a restart", () => {
    expect(isOmnis(wake)).toBe(true);
    expect(parkedLabel(wake)).toBe('PR watch, held for Resume');
    expect(parkedLabel({ ...wake, delivery: 'uncertain' })).toBe('May have reached the agent before the restart');
    expect(parkedHeading([wake])).toBe('1 message is waiting for Resume');
    expect(parkedHeading([wake, ben])).toBe('2 messages are waiting for Resume');
    expect(parkedHeading([ben])).toBe('1 message was waiting when Omni restarted');
  });
});
