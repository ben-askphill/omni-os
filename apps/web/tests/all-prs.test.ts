import { describe, expect, it } from 'vitest';
import type { AllPRs, Async } from '../src/api.ts';
import { allPRsEmpty } from '../src/pages/AllPRs.tsx';

const q = (data?: AllPRs, error: string | null = null): Async<AllPRs> => ({ data, error, loading: !data && !error, reload: () => {}, setData: () => {} });
const pr = { number: 1, title: 'A', author: null, headRefName: 'a', baseRefName: 'main', state: 'OPEN', isDraft: false, updatedAt: '', reviewDecision: null, url: 'u', additions: 0, deletions: 0, mergeable: '', checks: { passed: 0, failed: 0, pending: 0 }, repo: 'acme/shop' };

describe('the PRs list in place of rows', () => {
  it('says why it has none', () => {
    expect(allPRsEmpty(q())?.kind).toBe('loading');
    expect(allPRsEmpty(q(undefined, 'HTTP 500'))).toEqual({ kind: 'error', text: 'HTTP 500' });
    expect(allPRsEmpty(q({ repos: [], prs: [], failed: [] }))?.text).toMatch(/No channel has a GitHub repo/);
    expect(allPRsEmpty(q({ repos: ['acme/shop'], prs: [], failed: [] }))).toEqual({ kind: 'empty', text: 'No pull requests yet.' });
  });

  it('is an error only when every repo failed', () => {
    const failed = [{ repo: 'acme/gone', error: 'HTTP 404' }];
    expect(allPRsEmpty(q({ repos: ['acme/gone'], prs: [], failed }))).toEqual({ kind: 'error', text: 'Could not read acme/gone: HTTP 404' });
    expect(allPRsEmpty(q({ repos: ['acme/gone', 'acme/shop'], prs: [], failed }))?.kind).toBe('empty');
    expect(allPRsEmpty(q({ repos: ['acme/gone', 'acme/shop'], prs: [pr], failed }))).toBeNull();
  });
});
