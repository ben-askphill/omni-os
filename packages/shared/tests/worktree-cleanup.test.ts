import { describe, expect, it } from 'vitest';
import { cleanupCandidates, cleanupPreview, DEFAULT_RETENTION } from '../worktree-cleanup.ts';
import type { WorktreeItem } from '../worktree-inventory.ts';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 24 * 3600 * 1000).toISOString();

const item = (over: Partial<WorktreeItem>): WorktreeItem => ({
  id: 'a', kind: 'managed', verdict: 'eligible', dir: '/d/a', repo: '/r', branch: 'omni/a', threadId: 'a', threadTitle: 'A', lastActiveAt: daysAgo(30),
  channelId: 'c', channelName: 'C', folder: true, registered: true, bytes: 100, sharedWith: [], reasons: [], eligibleBecause: 'archived', errors: [], ...over,
});

const on = { enabled: true, idleDays: 14 };

describe('cleanupCandidates', () => {
  it('takes eligible managed folders of archived, merged and deleted threads', () => {
    const items = [
      item({ id: 'arch' }),
      item({ id: 'merged', eligibleBecause: 'merged' }),
      item({ id: 'gone', eligibleBecause: 'deleted', threadId: null, lastActiveAt: null }),
    ];
    expect(cleanupCandidates(items, 'manual', DEFAULT_RETENTION, NOW).map((c) => [c.id, c.because])).toEqual([
      ['arch', 'archived'],
      ['merged', 'merged'],
      ['gone', 'deleted'],
    ]);
  });

  it('never takes a kept, unknown, leftover or stale item', () => {
    const items = [
      item({ id: 'kept', verdict: 'kept', eligibleBecause: null }),
      item({ id: 'unknown', verdict: 'unknown', eligibleBecause: null }),
      item({ id: 'orphan', kind: 'orphan', eligibleBecause: null }),
      item({ id: 'stale', kind: 'stale-registration', eligibleBecause: 'stale', folder: false }),
    ];
    expect(cleanupCandidates(items, 'manual', DEFAULT_RETENTION, NOW)).toEqual([]);
    expect(cleanupCandidates(items, 'retention', on, NOW)).toEqual([]);
  });

  it('leaves out of a retention pass a thread active within the policy, but not out of a manual cleanup', () => {
    const items = [item({ id: 'old', lastActiveAt: daysAgo(15) }), item({ id: 'recent', lastActiveAt: daysAgo(3) }), item({ id: 'gone', eligibleBecause: 'deleted', lastActiveAt: null })];
    expect(cleanupCandidates(items, 'retention', on, NOW).map((c) => c.id)).toEqual(['old', 'gone']);
    expect(cleanupCandidates(items, 'manual', on, NOW).map((c) => c.id)).toEqual(['old', 'recent', 'gone']);
  });
});

describe('cleanupPreview', () => {
  it('adds up what the candidates use, counting an unmeasured one as nothing', () => {
    const p = cleanupPreview([item({ id: 'a', bytes: 300 }), item({ id: 'b', bytes: null })], 'manual', DEFAULT_RETENTION, NOW);
    expect(p).toMatchObject({ trigger: 'manual', bytes: 300 });
    expect(p.candidates.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('is off by default', () => {
    expect(DEFAULT_RETENTION.enabled).toBe(false);
  });
});
