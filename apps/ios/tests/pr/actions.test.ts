import { OmniHttpError } from '@omni/client-core';
import { describe, expect, it, vi } from 'vitest';

import { mergePR, rerunChecks, setAutoMerge, setWatch, type AutoMergeApi, type MergeApi, type RerunApi, type WatchApi } from '../../src/pr/actions';

const http = (status: number, message: string) => new OmniHttpError({ kind: 'http', status, message, body: null, retryAfter: null });
const mergeVia = (merge: MergeApi['mergePullRequest']) => {
  const api = { mergePullRequest: vi.fn(merge) };
  return { api, call: <T>(fn: (a: MergeApi) => Promise<T>) => fn(api as MergeApi) };
};

describe('setAutoMerge', () => {
  const via = (fn: AutoMergeApi['setAutoMerge']) => {
    const api = { setAutoMerge: vi.fn(fn) };
    return { api, call: <T>(f: (a: AutoMergeApi) => Promise<T>) => f(api as AutoMergeApi) };
  };

  it('turns it on with the repo method, and off', async () => {
    const { api, call } = via(async () => ({ ok: true as const, output: '', method: 'squash', state: 'OPEN', autoMergeRequest: null }));
    expect(await setAutoMerge(call, 'shop', 12, true)).toEqual({ kind: 'set' });
    expect(await setAutoMerge(call, 'shop', 12, false)).toEqual({ kind: 'set' });
    expect(api.setAutoMerge.mock.calls).toEqual([
      ['shop', 12, true],
      ['shop', 12, false],
    ]);
  });

  it("keeps gh's words when the repo has auto-merge off", async () => {
    const { call } = via(async () => {
      throw http(422, 'GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)');
    });
    expect(await setAutoMerge(call, 'shop', 12, true)).toEqual({ kind: 'failed', message: 'GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)' });
  });
});

describe('mergePR', () => {
  it('squashes and deletes the branch', async () => {
    const { api, call } = mergeVia(async () => ({ ok: true as const, output: '' }));
    expect(await mergePR(call, 'shop', 12)).toEqual({ kind: 'merged' });
    expect(api.mergePullRequest).toHaveBeenCalledWith('shop', 12, { method: 'squash', delete_branch: true });
  });

  it.each([
    ['conflict', 'Pull request is not mergeable: the merge commit cannot be cleanly created'],
    ['blocked', 'the base branch policy prohibits the merge'],
    ['draft', 'Pull request is still a draft'],
    ['closed', 'Pull request was already merged'],
    ['other', 'something unexpected'],
  ] as const)('sorts a refusal that is a %s', async (kind, message) => {
    const { call } = mergeVia(async () => {
      throw http(500, message);
    });
    expect(await mergePR(call, 'shop', 12)).toMatchObject({ kind: 'refused', failure: { kind, detail: message } });
  });

  it('does not call a lost reply a refusal', async () => {
    const { call } = mergeVia(async () => {
      throw new OmniHttpError({ kind: 'unreachable', detail: 'Network request failed' });
    });
    const out = await mergePR(call, 'shop', 12);
    expect(out).toMatchObject({ kind: 'unknown' });
    expect(out.kind === 'unknown' && out.message).toMatch(/#12 merged/);
  });

  it('reports a revoked phone as signed out', async () => {
    const { call } = mergeVia(async () => {
      throw http(401, 'unauthorized');
    });
    expect(await mergePR(call, 'shop', 12)).toMatchObject({ kind: 'signed-out', message: expect.stringMatching(/no longer accepts this phone/) });
  });
});

describe('setWatch', () => {
  const watchVia = (over: Partial<WatchApi>) => {
    const api = { watchPR: vi.fn(async () => null as never), stopPRWatch: vi.fn(async () => null), ...over };
    return { api, call: <T>(fn: (a: WatchApi) => Promise<T>) => fn(api as WatchApi) };
  };

  it('starts and stops the watch', async () => {
    const { api, call } = watchVia({});
    expect(await setWatch(call, 't1', true)).toEqual({ kind: 'set', watch: null });
    expect(api.watchPR).toHaveBeenCalledWith('t1');
    await setWatch(call, 't1', false);
    expect(api.stopPRWatch).toHaveBeenCalledWith('t1');
  });

  it('gives the server\'s reason for a refused start', async () => {
    const { call } = watchVia({
      watchPR: async () => {
        throw http(409, 'No open PR to watch.');
      },
    });
    expect(await setWatch(call, 't1', true)).toEqual({ kind: 'failed', message: 'No open PR to watch.' });
  });
});

describe('rerunChecks', () => {
  const via = (rerun: RerunApi['rerunFailedChecks']) => {
    const api = { rerunFailedChecks: vi.fn(rerun) };
    return { api, call: <T>(fn: (a: RerunApi) => Promise<T>) => fn(api as RerunApi) };
  };

  it('says how many runs started again', async () => {
    const { api, call } = via(async () => ({ runs: [{ id: '200', ok: true }], skipped: 0 }));
    expect(await rerunChecks(call, 'shop', 12)).toEqual({ kind: 'started', text: 'Rerunning the failed jobs of 1 workflow run.' });
    expect(api.rerunFailedChecks).toHaveBeenCalledWith('shop', 12);
  });

  it("gives gh's reason when no run started again", async () => {
    const { call } = via(async () => {
      throw http(502, 'run 900 cannot be rerun');
    });
    expect(await rerunChecks(call, 'shop', 12)).toEqual({ kind: 'failed', message: 'run 900 cannot be rerun' });
  });
});
