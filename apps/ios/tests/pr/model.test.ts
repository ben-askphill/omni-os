import { describe, expect, it } from 'vitest';

import { NO_BRANCH, NO_PR, noRepo, prContent, prPage, type PRPageInput } from '../../src/pr/model';
import type { ReviewFailure } from '../../src/review/failure';
import { prDetail } from './fixtures';

const failure: ReviewFailure = { kind: 'offline', message: 'x', retryable: true };
const summary = prDetail();

const input = (over: Partial<PRPageInput> = {}): PRPageInput => ({
  thread: { branch: 'omni/5313f55a' },
  githubRepo: 'acme/shop',
  prs: { data: { pr: summary, prs: [summary] }, failure: null },
  detail: { data: prDetail(), failure: null },
  ...over,
});

describe('prPage', () => {
  it('waits for the thread', () => {
    expect(prPage(input({ thread: null }))).toEqual({ kind: 'loading' });
  });

  it('says a thread without a branch has no pull request, and offers no Open PR', () => {
    expect(prPage(input({ thread: { branch: null } }))).toEqual({ kind: 'empty', text: NO_BRANCH, canOpen: false });
  });

  it('offers Open PR for a branch without a PR', () => {
    expect(prPage(input({ prs: { data: { pr: null, prs: [] }, failure: null } }))).toEqual({ kind: 'empty', text: NO_PR, canOpen: true });
  });

  it('tells Ben to set the repo when the channel has none', () => {
    expect(prPage(input({ githubRepo: null }))).toEqual({ kind: 'empty', text: noRepo(12), canOpen: false });
  });

  it('shows the PR once its detail is in', () => {
    expect(prPage(input())).toMatchObject({ kind: 'pr', pr: { number: 12 } });
  });

  it('keeps loading while the detail is on its way', () => {
    expect(prPage(input({ detail: { data: null, failure: null } }))).toEqual({ kind: 'loading' });
  });

  it('does not show another PR\'s detail when the branch moved to a new one', () => {
    expect(prPage(input({ detail: { data: prDetail({ number: 9 }), failure: null } }))).toEqual({ kind: 'loading' });
  });

  it('fails on the list before the detail', () => {
    expect(prPage(input({ prs: { data: null, failure }, detail: { data: null, failure } }))).toMatchObject({ kind: 'failed', of: 'list' });
    expect(prPage(input({ detail: { data: null, failure } }))).toMatchObject({ kind: 'failed', of: 'detail' });
  });

  it('keeps the PR on screen when a refresh of the list fails', () => {
    expect(prPage(input({ prs: { data: { pr: summary, prs: [summary] }, failure } }))).toMatchObject({ kind: 'pr' });
  });
});

describe('prContent', () => {
  it('reads an open PR with passing checks as mergeable', () => {
    const c = prContent(prDetail({ checkRuns: [{ name: 'build', state: 'SUCCESS' }, { name: 'e2e', state: 'IN_PROGRESS' }] }));
    expect(c).toMatchObject({ open: true, canMerge: true, branches: 'omni/5313f55a → main', badge: { label: 'open' } });
    expect(c.checks).toEqual([
      { key: 'build:0', name: 'build', state: 'success', tone: 'done' },
      { key: 'e2e:1', name: 'e2e', state: 'in progress', tone: 'running' },
    ]);
    expect(c.note).toBe('1 check still running. Merging now skips them.');
  });

  it('blocks a draft and says it conflicts', () => {
    const c = prContent(prDetail({ isDraft: true, mergeable: 'CONFLICTING', checkRuns: [] }));
    expect(c).toMatchObject({ open: true, canMerge: false, badge: { label: 'draft' }, note: 'It conflicts with the base branch.' });
    expect(c.next).toMatchObject({ kind: 'conflicts' });
  });

  it('has nothing to merge once merged or closed', () => {
    expect(prContent(prDetail({ state: 'MERGED' }))).toMatchObject({ open: false, canMerge: false, badge: { label: 'merged' } });
    expect(prContent(prDetail({ state: 'CLOSED' }))).toMatchObject({ open: false, canMerge: false, badge: { label: 'closed' } });
  });

  it('sums the reviews', () => {
    const c = prContent(
      prDetail({
        reviews: [{ author: { login: 'sam' }, state: 'APPROVED', body: 'Looks good', submittedAt: '2026-11-02T09:00:00Z' }],
        comments: [{ author: { login: 'lee' }, body: 'Nit on the drawer', createdAt: '2026-11-02T09:30:00Z' }],
      }),
    );
    expect(c.reviewLine).toBe('1 approval, 2 comments');
    expect(c.review.latest[0]).toEqual({ login: 'lee', excerpt: 'Nit on the drawer' });
  });

  it('has no review line without review activity', () => {
    expect(prContent(prDetail()).reviewLine).toBeNull();
  });
});
