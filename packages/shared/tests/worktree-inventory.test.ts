import { describe, expect, it } from 'vitest';
import { formatBytes, summarize, type WorktreeItem } from '../worktree-inventory.ts';

const item = (over: Partial<WorktreeItem>): WorktreeItem => ({
  id: 'a', kind: 'managed', verdict: 'kept', dir: '/d/a', repo: '/r', branch: null, threadId: null, threadTitle: null, channelId: null, channelName: null,
  folder: true, registered: true, bytes: 100, sharedWith: [], reasons: [], eligibleBecause: null, errors: [], ...over,
});

describe('summarize', () => {
  it('totals each verdict and keeps stale registrations out of the disk use', () => {
    const s = summarize([
      item({ verdict: 'eligible', bytes: 300 }),
      item({ verdict: 'kept', bytes: 50 }),
      item({ verdict: 'kept', bytes: null }),
      item({ verdict: 'unknown', bytes: 10 }),
      item({ kind: 'stale-registration', verdict: 'eligible', folder: false, bytes: 0 }),
    ]);
    expect(s).toEqual({
      eligible: { count: 1, bytes: 300 },
      kept: { count: 2, bytes: 50 },
      unknown: { count: 1, bytes: 10 },
      folders: 4,
      stale: 1,
      bytes: 360,
    });
  });
});

describe('formatBytes', () => {
  it('picks a unit', () => {
    expect(formatBytes(null)).toBe('unknown size');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5 MB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
    expect(formatBytes(45 * 1024 ** 3)).toBe('45 GB');
  });
});
