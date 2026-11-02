import { OmniHttpError } from '@omni/client-core';
import { describe, expect, it, vi } from 'vitest';

import { mergePR, setWatch, type MergeApi, type WatchApi } from '../../src/pr/actions';

const http = (status: number, message: string) => new OmniHttpError({ kind: 'http', status, message, body: null, retryAfter: null });
const mergeVia = (merge: MergeApi['mergePullRequest']) => {
  const api = { mergePullRequest: vi.fn(merge) };
  return { api, call: <T>(fn: (a: MergeApi) => Promise<T>) => fn(api as MergeApi) };
};

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
