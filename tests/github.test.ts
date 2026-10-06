import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/db.ts', () => {
  throw new Error('db.ts must not be imported by github tests');
});

import { markBranches, pickBranchPR, summarizeChecks } from '../server/github.ts';

describe('summarizeChecks', () => {
  it('returns zeros for null, undefined and empty rollups', () => {
    const zero = { passed: 0, failed: 0, pending: 0 };
    expect(summarizeChecks(null)).toEqual(zero);
    expect(summarizeChecks(undefined)).toEqual(zero);
    expect(summarizeChecks([])).toEqual(zero);
  });

  it('counts CheckRun conclusions', () => {
    const rollup = [
      { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { __typename: 'CheckRun', name: 'opt', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
      { __typename: 'CheckRun', name: 'e2e', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
      { __typename: 'CheckRun', name: 'deploy', status: 'COMPLETED', conclusion: 'CANCELLED' },
      { __typename: 'CheckRun', name: 'gate', status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' },
      { __typename: 'CheckRun', name: 'boot', status: 'COMPLETED', conclusion: 'STARTUP_FAILURE' },
    ];
    expect(summarizeChecks(rollup)).toEqual({ passed: 3, failed: 5, pending: 0 });
  });

  it('treats in-flight runs (empty conclusion) as pending via status', () => {
    const rollup = [
      { __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: '' },
      { __typename: 'CheckRun', name: 'queued', status: 'QUEUED', conclusion: null },
    ];
    expect(summarizeChecks(rollup)).toEqual({ passed: 0, failed: 0, pending: 2 });
  });

  it('reads StatusContext state', () => {
    const rollup = [
      { __typename: 'StatusContext', context: 'vercel', state: 'SUCCESS' },
      { __typename: 'StatusContext', context: 'ci/legacy', state: 'ERROR' },
      { __typename: 'StatusContext', context: 'shopify', state: 'PENDING' },
      { __typename: 'StatusContext', context: 'other', state: 'EXPECTED' },
    ];
    expect(summarizeChecks(rollup)).toEqual({ passed: 1, failed: 1, pending: 2 });
  });

  it('is case-insensitive and counts blank entries as pending', () => {
    expect(summarizeChecks([{ conclusion: 'success' }, { state: 'failure' }, {}])).toEqual({ passed: 1, failed: 1, pending: 1 });
  });
});

describe('pickBranchPR', () => {
  it('prefers the open PR, else the newest, else none', () => {
    expect(pickBranchPR([{ number: 3, state: 'MERGED' }, { number: 2, state: 'OPEN' }])).toEqual({ number: 2, state: 'OPEN' });
    expect(pickBranchPR([{ number: 3, state: 'MERGED' }, { number: 1, state: 'CLOSED' }])).toEqual({ number: 3, state: 'MERGED' });
    expect(pickBranchPR([])).toBeNull();
  });
});

describe('markBranches', () => {
  const pr = (number: number, state: string, headRefName: string) => ({ number, state, isDraft: false, url: `u/${number}`, headRefName });
  it('marks a branch with its open PR, else its newest merged one', () => {
    const marks = markBranches([pr(3, 'MERGED', 'a'), pr(2, 'OPEN', 'a'), pr(1, 'MERGED', 'b'), pr(0, 'MERGED', 'b')]);
    expect(marks.a.number).toBe(2);
    expect(marks.b.number).toBe(1);
  });
  it('leaves out branches whose PRs were closed unmerged', () => {
    expect(markBranches([pr(4, 'CLOSED', 'c')])).toEqual({});
  });
});
