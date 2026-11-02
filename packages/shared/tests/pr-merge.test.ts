import { describe, expect, it } from 'vitest';
import { classifyMergeFailure, mergeNote, reviewLine, reviewSummary } from '../pr-merge.ts';

const run = (state: string) => ({ state });
const by = (login: string, state: string, body = '', submittedAt = '2026-01-01T00:00:00Z') => ({ author: { login }, state, body, submittedAt });

describe('merge note', () => {
  it('says nothing for a PR that is ready', () => {
    expect(mergeNote({ checkRuns: [run('SUCCESS'), run('SKIPPED')], mergeable: 'MERGEABLE' })).toBe('');
  });

  it('names failing and running checks and a conflict, and warns that merging skips the running ones', () => {
    expect(mergeNote({ checkRuns: [run('FAILURE'), run('TIMED_OUT'), run('IN_PROGRESS'), run('SUCCESS')], mergeable: 'CONFLICTING' })).toBe(
      '2 checks failing. 1 check still running. Merging now skips them. It conflicts with the base branch.',
    );
  });
});

describe('review summary', () => {
  it('keeps each reviewer\'s newest verdict, and a plain comment does not overturn it', () => {
    const s = reviewSummary({
      reviews: [by('maya', 'CHANGES_REQUESTED'), by('sam', 'APPROVED'), by('maya', 'APPROVED'), by('sam', 'COMMENTED', 'one more thing'), by('lee', 'COMMENTED', 'looks fine')],
      comments: [],
    });
    expect(s.reviewers).toEqual([
      { login: 'maya', verdict: 'approved' },
      { login: 'sam', verdict: 'approved' },
      { login: 'lee', verdict: 'commented' },
    ]);
    expect([s.approvals, s.changeRequests]).toEqual([2, 0]);
  });

  it('drops a dismissed review and counts a change request', () => {
    const s = reviewSummary({ reviews: [by('maya', 'APPROVED'), by('maya', 'DISMISSED'), by('sam', 'CHANGES_REQUESTED')], comments: [] });
    expect(s.reviewers).toEqual([{ login: 'sam', verdict: 'changes' }]);
    expect(reviewLine(s)).toBe('1 change request');
  });

  it('lists the newest comments first, cut to an excerpt, with HTML comments removed', () => {
    const long = 'x'.repeat(300);
    const s = reviewSummary({
      reviews: [by('maya', 'COMMENTED', 'Please rename this', '2026-01-02T00:00:00Z')],
      comments: [
        { author: { login: 'bot' }, body: '<!-- hidden -->  Deployed  to preview', createdAt: '2026-01-03T00:00:00Z' },
        { author: null, body: long, createdAt: '2026-01-01T00:00:00Z' },
        { author: { login: 'sam' }, body: '   ', createdAt: '2026-01-04T00:00:00Z' },
      ],
    });
    expect(s.comments).toBe(3);
    expect(s.latest.map((l) => [l.login, l.excerpt.length > 100 ? 'long' : l.excerpt])).toEqual([
      ['bot', 'Deployed to preview'],
      ['maya', 'Please rename this'],
      ['someone', 'long'],
    ]);
    expect(s.latest[2].excerpt.endsWith('…')).toBe(true);
    expect(reviewLine(s)).toBe('3 comments');
  });

  it('has no line when nothing happened', () => {
    expect(reviewLine(reviewSummary({ reviews: [], comments: [] }))).toBeNull();
  });
});

describe('merge refusals', () => {
  it.each([
    ['Pull request #12 is not mergeable: the merge commit cannot be cleanly created.', 'conflict', 'Merge conflicts'],
    ['Pull request #12 is not mergeable: the base branch policy prohibits the merge.', 'blocked', 'Merge blocked'],
    ['X At least 1 approving review is required by reviewers with write access.', 'blocked', 'Merge blocked'],
    ['Pull request #12 is still a draft', 'draft', 'Still a draft'],
    ['Pull request #12 was already merged', 'closed', 'Already closed'],
    ['gh: Bad gateway', 'other', 'Merge failed'],
  ])('sorts %j as %s', (message, kind, title) => {
    expect(classifyMergeFailure(message)).toEqual({ kind, title, detail: message });
  });
});
