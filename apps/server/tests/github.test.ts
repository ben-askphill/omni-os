import { afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

vi.mock('../db.ts', () => {
  throw new Error('db.ts must not be imported by github tests');
});

import { allPRs, markBranches, pickBranchPR, summarizeChecks } from '../github.ts';

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

describe('allPRs', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 1, h)).toISOString();
  const pr = (number: number, state: string, h: number) => ({ number, title: `PR ${number}`, author: { login: 'ben' }, state, isDraft: false, updatedAt: at(h), url: `u/${number}`, statusCheckRollup: [] });
  // acme/shop has an old open PR that its 40 newest leave out; acme/gone answers as gh does for a repo it cannot read.
  const answers: Record<string, unknown[]> = {
    'acme/shop open': [pr(1, 'OPEN', 1), pr(5, 'OPEN', 5)],
    'acme/shop all': [pr(9, 'MERGED', 9), pr(5, 'OPEN', 5), pr(4, 'CLOSED', 4)],
    'acme/blog open': [pr(2, 'OPEN', 7)],
    'acme/blog all': [pr(3, 'MERGED', 10), pr(2, 'OPEN', 7)],
  };
  const dir = mkdtempSync(join(tmpdir(), 'omni-gh-'));
  const path = process.env.PATH;
  afterEach(() => {
    process.env.PATH = path;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function fakeGh() {
    const cases = Object.entries(answers)
      .map(([k, v]) => { const [repo, state] = k.split(' '); return `  "${repo} ${state}") echo '${JSON.stringify(v)}';;`; })
      .join('\n');
    writeFileSync(join(dir, 'gh'), `#!/bin/sh\ncase "$4 $6" in\n${cases}\n  *) echo "GraphQL: Could not resolve to a Repository with the name '$4'." >&2; exit 1;;\nesac\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    process.env.PATH = `${dir}${delimiter}${path}`;
  }

  it('lists every repo, open first and newest first, and skips a repo gh cannot read', async () => {
    fakeGh();
    const out = await allPRs(['acme/shop', 'acme/blog', 'acme/gone']);
    expect(out.prs.map((p) => `${p.repo}#${p.number}`)).toEqual(['acme/blog#2', 'acme/shop#5', 'acme/shop#1', 'acme/blog#3', 'acme/shop#9', 'acme/shop#4']);
    expect(out.failed).toEqual([{ repo: 'acme/gone', error: "GraphQL: Could not resolve to a Repository with the name 'acme/gone'." }]);
    expect(out.repos).toEqual(['acme/shop', 'acme/blog', 'acme/gone']);
  });

  it('asks nothing with no repos', async () => {
    expect(await allPRs([])).toEqual({ repos: [], prs: [], failed: [] });
  });
});
