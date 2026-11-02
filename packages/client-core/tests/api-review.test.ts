import { describe, expect, it } from 'vitest';
import { OmniHttpError } from '../src/http.ts';
import { api, at } from './api-helpers.ts';

describe('changes', () => {
  it('reads a thread\'s changes since its base, and says why there are none without a worktree', async () => {
    const none = { available: false, reason: 'This thread has no worktree.' };
    const { sent, api: a } = api({ json: none });
    expect(await a.changes('t 1')).toEqual(none);
    expect(sent).toEqual([{ method: 'GET', url: at('/threads/t%201/changes') }]);
  });

  it('reads the newest turn, or the turn named', async () => {
    const { sent, api: a } = api({ json: { available: true, turns: [], turn: null, groups: [] } });
    await a.turnChanges('t1');
    await a.turnChanges('t1', 'turn/2');
    expect(sent.map((s) => s.url)).toEqual([at('/threads/t1/turns'), at('/threads/t1/turns?turn=turn%2F2')]);
  });

  it('rejects a turn the thread does not have with the server message', async () => {
    const { api: a } = api({ status: 404, json: { error: 'no such turn' } });
    const err = await a.turnChanges('t1', 'gone').catch((e: unknown) => e);
    expect((err as OmniHttpError).failure).toMatchObject({ kind: 'http', status: 404, message: 'no such turn' });
  });
});

describe('pull requests', () => {
  it('finds the PR for a thread, and a PR through its channel', async () => {
    const { sent, api: a } = api({ json: { pr: null, prs: [] } });
    expect(await a.threadPR('t1')).toEqual({ pr: null, prs: [] });
    await a.pullRequest('c 1', 12);
    expect(sent.map((s) => [s.method, s.url])).toEqual([
      ['GET', at('/threads/t1/pr')],
      ['GET', at('/channels/c%201/prs/12')],
    ]);
  });

  it('squashes and deletes the branch by default, and always sends the confirmation the server wants', async () => {
    const { sent, api: a } = api({ json: { ok: true, output: 'merged' } });
    expect(await a.mergePullRequest('c1', 12)).toEqual({ ok: true, output: 'merged' });
    await a.mergePullRequest('c1', 12, { method: 'rebase', delete_branch: false });
    expect(sent).toEqual([
      { method: 'POST', url: at('/channels/c1/prs/12/merge'), body: { method: 'squash', delete_branch: true, confirm: true } },
      { method: 'POST', url: at('/channels/c1/prs/12/merge'), body: { method: 'rebase', delete_branch: false, confirm: true } },
    ]);
  });

  it('rejects a merge GitHub refuses with gh\'s own message', async () => {
    const { api: a } = api({ status: 500, json: { error: 'Pull request #12 is not mergeable: the merge commit cannot be cleanly created.' } });
    const err = await a.mergePullRequest('c1', 12).catch((e: unknown) => e);
    expect((err as OmniHttpError).failure).toMatchObject({ kind: 'http', status: 500, message: expect.stringContaining('not mergeable') });
  });

  it('starts a watch on the branch\'s PR or a named one, stops it, and reads it', async () => {
    const { sent, api: a } = api({ json: null });
    await a.prWatch('t1');
    await a.watchPR('t1');
    await a.watchPR('t1', 12);
    await a.stopPRWatch('t1');
    expect(sent).toEqual([
      { method: 'GET', url: at('/threads/t1/pr-watch') },
      { method: 'PUT', url: at('/threads/t1/pr-watch'), body: {} },
      { method: 'PUT', url: at('/threads/t1/pr-watch'), body: { number: 12 } },
      { method: 'DELETE', url: at('/threads/t1/pr-watch') },
    ]);
  });

  it('rejects a watch the server refuses with its reason', async () => {
    const { api: a } = api({ status: 409, json: { error: 'This thread has no open PR to watch.' } });
    const err = await a.watchPR('t1').catch((e: unknown) => e);
    expect((err as OmniHttpError).failure).toMatchObject({ kind: 'http', status: 409, message: 'This thread has no open PR to watch.' });
  });
});
