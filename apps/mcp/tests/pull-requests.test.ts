import { describe, expect, it } from 'vitest';
import { prList } from '../pull-requests.ts';

const pr = (number: number, state: 'OPEN' | 'MERGED' | 'CLOSED', over: Record<string, unknown> = {}) => ({
  repo: 'org/repo-a',
  number,
  title: `PR #${number}`,
  author: { login: 'dev' },
  headRefName: `branch-${number}`,
  state,
  isDraft: false,
  updatedAt: `2026-11-${String((number % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
  reviewDecision: null,
  checks: { passed: 1, failed: 0, pending: 0 },
  labels: [],
  url: `https://github.com/org/repo-a/pull/${number}`,
  ...over,
});

describe('prList filtering and defaults (#1009)', () => {
  const fixture = {
    prs: [
      pr(10, 'OPEN'),
      pr(11, 'OPEN', { isDraft: true }),
      pr(12, 'MERGED', { repo: 'org/repo-b' }),
      pr(13, 'CLOSED'),
    ],
    failed: [],
  };

  it('defaults to open PRs (including drafts) and omits total when not truncated', () => {
    const out = prList(fixture);
    expect(out.prs.map((p) => [p.number, p.state])).toEqual([
      [11, 'DRAFT'],
      [10, 'OPEN'],
    ]);
    expect(out).not.toHaveProperty('total');
  });

  it('supports state, repo, search and limit filters with total when truncated', () => {
    expect(prList(fixture, { state: 'merged' }).prs.map((p) => p.number)).toEqual([12]);
    expect(prList(fixture, { state: 'closed' }).prs.map((p) => p.number)).toEqual([13]);
    expect(prList(fixture, { state: 'draft' }).prs.map((p) => p.number)).toEqual([11]);
    expect(prList(fixture, { state: 'all', repo: 'org/repo-b' }).prs.map((p) => p.number)).toEqual([12]);

    const capped = prList(fixture, { state: 'all', limit: 2 });
    expect(capped.prs).toHaveLength(2);
    expect(capped.total).toBe(4);
  });
});
