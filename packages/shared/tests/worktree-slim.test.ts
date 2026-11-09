import { describe, expect, it } from 'vitest';
import { slimCandidates, slimPreview } from '../worktree-slim.ts';
import type { KeepReason, WorktreeItem } from '../worktree-inventory.ts';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 24 * 3600 * 1000).toISOString();
const why = (code: KeepReason['code']): KeepReason => ({ code, message: code });

const item = (over: Partial<WorktreeItem>): WorktreeItem => ({
  id: 'a', kind: 'managed', verdict: 'kept', dir: '/d/a', repo: '/r', branch: 'omni/a', threadId: 'a', threadTitle: 'A', lastActiveAt: daysAgo(10),
  channelId: 'c', channelName: 'C', folder: true, registered: true, bytes: 1000, cacheBytes: 600, sharedWith: [], reasons: [why('open-thread')], eligibleBecause: null, errors: [], ...over,
});

describe('slimCandidates', () => {
  it('takes idle thread worktrees with caches, whatever keeps them, and a deleted thread', () => {
    const items = [
      item({ id: 'open' }),
      item({ id: 'work', reasons: [why('open-thread'), why('untracked'), why('unpushed'), why('pr-open')] }),
      item({ id: 'eligible', verdict: 'eligible', reasons: [], eligibleBecause: 'archived' }),
      item({ id: 'gone', threadId: null, lastActiveAt: null, verdict: 'eligible', reasons: [], eligibleBecause: 'deleted' }),
    ];
    expect(slimCandidates(items, 7, NOW).map((c) => c.id)).toEqual(['open', 'work', 'eligible', 'gone']);
    expect(slimCandidates(items, 7, NOW)[0]).toMatchObject({ bytes: 600, threadTitle: 'A', branch: 'omni/a' });
  });

  it('leaves out a thread active within the idle days', () => {
    expect(slimCandidates([item({ lastActiveAt: daysAgo(3) })], 7, NOW)).toEqual([]);
    expect(slimCandidates([item({ lastActiveAt: daysAgo(3) })], 2, NOW)).toHaveLength(1);
  });

  it('leaves out a worktree in use, one with no caches or none measured, unknown verdicts and folders no thread owns', () => {
    const items = [
      ...(['running', 'queued', 'warm', 'preparing', 'terminal', 'action', 'shared'] as const).map((code) => item({ id: code, reasons: [why(code)] })),
      item({ id: 'empty', cacheBytes: 0 }),
      item({ id: 'unmeasured', cacheBytes: null }),
      item({ id: 'unknown', verdict: 'unknown', reasons: [] }),
      item({ id: 'orphan', kind: 'orphan', reasons: [why('unowned')] }),
      item({ id: 'stale', kind: 'stale-registration', folder: false }),
    ];
    expect(slimCandidates(items, 7, NOW)).toEqual([]);
  });

  it('totals the caches in the preview', () => {
    expect(slimPreview([item({ id: 'x' }), item({ id: 'y', cacheBytes: 400 })], 7, NOW)).toMatchObject({ bytes: 1000 });
  });
});
