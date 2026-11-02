import { describe, expect, it } from 'vitest';
import { canSteer, type HarnessId } from '../src/api/harnesses.ts';
import { OmniHttpError } from '../src/http.ts';
import { api, at } from './api-helpers.ts';

describe('harnesses', () => {
  it('lists them, and as one channel sees them', async () => {
    const info = [{ id: 'codex', name: 'Codex', available: false, fix: 'codex login', models: [], cap: 2, running: 0 }];
    const { sent, api: a } = api({ json: info });
    expect(await a.harnesses()).toEqual(info);
    await a.harnesses('client x');
    expect(sent).toEqual([
      { method: 'GET', url: at('/harnesses') },
      { method: 'GET', url: at('/harnesses?channel=client%20x') },
    ]);
  });
});

describe('thread edits', () => {
  it('renames, pins and unpins, archives and restores, each as one field', async () => {
    const { sent, api: a } = api();
    await a.rename('t1', 'New name');
    await a.setPinned('t1', true);
    await a.setPinned('t1', false);
    await a.setArchived('t1', true);
    await a.setArchived('t1', false);
    expect(sent).toEqual([
      { method: 'PATCH', url: at('/threads/t1'), body: { title: 'New name' } },
      { method: 'PATCH', url: at('/threads/t1'), body: { pinned: true } },
      { method: 'PATCH', url: at('/threads/t1'), body: { pinned: false } },
      { method: 'PATCH', url: at('/threads/t1'), body: { archived: true } },
      { method: 'PATCH', url: at('/threads/t1'), body: { archived: false } },
    ]);
  });

  it('moves a thread into a folder and takes it out with null', async () => {
    const { sent, api: a } = api();
    await a.moveToFolder('t1', 'f 1');
    await a.moveToFolder('t1', null);
    expect(sent.map((s) => s.body)).toEqual([{ folder_id: 'f 1' }, { folder_id: null }]);
  });

  it('sends several edits in one patch', async () => {
    const { sent, api: a } = api();
    await a.patchThread('t/1', { title: 'T', folder_id: null, done: true });
    expect(sent).toEqual([{ method: 'PATCH', url: at('/threads/t%2F1'), body: { title: 'T', folder_id: null, done: true } }]);
  });

  it('switches model, effort and harness through the run route', async () => {
    const { sent, api: a } = api();
    await a.switchRun('t1', { harness: 'claude-code', model: 'opus', effort: 'high' });
    expect(sent).toEqual([{ method: 'POST', url: at('/threads/t1/run'), body: { harness: 'claude-code', model: 'opus', effort: 'high' } }]);
  });

  it('rejects pinning an archived thread with the server message', async () => {
    const { api: a } = api({ status: 409, json: { error: 'an archived thread cannot be pinned' } });
    const err = await a.setPinned('t1', true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OmniHttpError);
    expect((err as OmniHttpError).failure).toMatchObject({ kind: 'http', status: 409 });
  });
});

describe('recovery', () => {
  const recovered = { thread: { id: 't1' }, pending: [{ uuid: 'u1' }] };

  it('resumes every parked message, or only those named', async () => {
    const { sent, api: a } = api({ json: recovered });
    expect(await a.resumeRequests('t1')).toEqual(recovered);
    await a.resumeRequests('t1', ['u1', 'u2']);
    expect(sent).toEqual([
      { method: 'POST', url: at('/threads/t1/requests/resume'), body: {} },
      { method: 'POST', url: at('/threads/t1/requests/resume'), body: { ids: ['u1', 'u2'] } },
    ]);
  });

  it('discards the messages named', async () => {
    const { sent, api: a } = api({ json: recovered });
    await a.discardRequests('t1', ['u1']);
    expect(sent).toEqual([{ method: 'POST', url: at('/threads/t1/requests/discard'), body: { ids: ['u1'] } }]);
  });

  it('retries a worktree setup with no body', async () => {
    const { sent, api: a } = api({ json: recovered });
    expect(await a.retrySetup('t 1')).toEqual(recovered);
    expect(sent).toEqual([{ method: 'POST', url: at('/threads/t%201/setup/retry') }]);
  });

  it('schedules, cancels and sends a limit continuation', async () => {
    const { sent, api: a } = api({ json: recovered });
    await a.scheduleLimit('t1');
    await a.cancelLimit('t1');
    await a.resumeLimit('t1');
    expect(sent).toEqual([
      { method: 'POST', url: at('/threads/t1/limit/schedule') },
      { method: 'POST', url: at('/threads/t1/limit/cancel') },
      { method: 'POST', url: at('/threads/t1/limit/resume') },
    ]);
  });

  it('rejects scheduling a limit the harness gave no reset time for', async () => {
    const { api: a } = api({ status: 409, json: { error: 'no reset time' } });
    const err = await a.scheduleLimit('t1').catch((e: unknown) => e);
    expect((err as OmniHttpError).failure).toMatchObject({ kind: 'http', status: 409 });
  });
});

describe('needs you', () => {
  it('reads the whole list, one channel, or one thread', async () => {
    const list = { items: [], unread: 0, blocked: 0 };
    const { sent, api: a } = api({ json: list });
    expect(await a.needsYou()).toEqual(list);
    await a.needsYou({ channel: 'inbox' });
    await a.needsYou({ thread: 't1' });
    expect(sent.map((s) => s.url)).toEqual([at('/needs-you'), at('/needs-you?channel=inbox'), at('/needs-you?thread=t1')]);
  });

  it('marks a result read by uid and resolves with the thread item as it is now', async () => {
    const { sent, api: a } = api({ json: { thread_id: 't1', item: null } });
    expect(await a.markResultRead('c-1')).toEqual({ thread_id: 't1', item: null });
    expect(sent).toEqual([{ method: 'POST', url: at('/needs-you/read'), body: { uid: 'c-1' } }]);
  });

  it('rejects a result this server does not have', async () => {
    const { api: a } = api({ status: 404, json: { error: 'No such result' } });
    const err = await a.markResultRead('gone').catch((e: unknown) => e);
    expect((err as OmniHttpError).failure).toMatchObject({ kind: 'http', status: 404 });
  });
});

describe('sending', () => {
  it('keeps the request id across a retry and passes the duplicate flag through', async () => {
    const accepted = { id: 't1', request: { id: 'm1', request_id: 'r-1', state: 'accepted', accepted_at: 'x', duplicate: true } };
    const { sent, api: a } = api({ json: accepted });
    const first = await a.sendMessage('t1', { prompt: 'hi', request_id: 'r-1' });
    const again = await a.sendMessage('t1', { prompt: 'hi', request_id: 'r-1' });
    expect(again.request.duplicate).toBe(true);
    expect(first).toEqual(again);
    expect(sent.map((s) => s.body)).toEqual([{ prompt: 'hi', request_id: 'r-1' }, { prompt: 'hi', request_id: 'r-1' }]);
  });

  it('stops a thread with no body', async () => {
    const { sent, api: a } = api();
    await a.stop('t1');
    expect(sent).toEqual([{ method: 'POST', url: at('/threads/t1/stop') }]);
  });
});

describe('canSteer', () => {
  const row = (id: string, steer: boolean) => ({ id: id as HarnessId, capabilities: { steer, warmProcess: true, interrupt: true, inlineImages: true, usage: 'none' as const } });

  it('falls back to every harness but Cursor and Cursor Cloud while the catalog is missing', () => {
    for (const catalog of [null, undefined, []]) {
      expect(canSteer('claude-code', catalog)).toBe(true);
      expect(canSteer('hermes', catalog)).toBe(true);
      expect(canSteer('cursor', catalog)).toBe(false);
      expect(canSteer('cursor-cloud', catalog)).toBe(false);
    }
  });

  it("uses the harness's own row even when it disagrees with the fallback", () => {
    expect(canSteer('cursor', [row('cursor', true)])).toBe(true);
    expect(canSteer('codex', [row('codex', false)])).toBe(false);
  });
});

describe('push registration', () => {
  it('registers, reads and deletes the device token on the auth routes', async () => {
    const { sent, api: a } = api();
    const body = { token: 'ab'.repeat(32), platform: 'ios', environment: 'sandbox', bundleId: 'app.omni-os.ios' } as const;
    await a.registerPushToken(body);
    await a.pushTokenStatus();
    await a.deletePushToken();
    expect(sent).toEqual([
      { method: 'PUT', url: at('/auth/push-token'), body },
      { method: 'GET', url: at('/auth/push-token') },
      { method: 'DELETE', url: at('/auth/push-token') },
    ]);
  });

  it('reads the alert choices and sends only the keys that change', async () => {
    const { sent, api: a } = api();
    await a.pushPreferences();
    await a.setPushPreferences({ finished: false });
    expect(sent).toEqual([
      { method: 'GET', url: at('/auth/push-preferences') },
      { method: 'PUT', url: at('/auth/push-preferences'), body: { finished: false } },
    ]);
  });
});

describe('channel actions in a thread', () => {
  it("reads a thread's actions and runs, in one call", async () => {
    const reply = { actions: [{ id: 'a1', name: 'Tests' }], runs: [], blocked: null, setup_run: null };
    const { sent, api: a } = api({ json: reply });
    expect(await a.threadActions('t 1')).toEqual(reply);
    expect(sent).toEqual([{ method: 'GET', url: at('/threads/t%201/actions') }]);
  });

  it('runs, stops and retries with no body, each answering with the run', async () => {
    const run = { id: 'r1', state: 'running' };
    const { sent, api: a } = api({ status: 201, json: run });
    expect(await a.runAction('t1', 'a/1')).toEqual(run);
    await a.stopActionRun('t1', 'r1');
    await a.retryActionRun('t1', 'r1');
    expect(sent).toEqual([
      { method: 'POST', url: at('/threads/t1/actions/a%2F1/run') },
      { method: 'POST', url: at('/threads/t1/action-runs/r1/stop') },
      { method: 'POST', url: at('/threads/t1/action-runs/r1/retry') },
    ]);
  });

  it("surfaces the server's reason when a thread cannot run an action", async () => {
    const { api: a } = api({ status: 409, json: { error: 'Its worktree is still being prepared.' } });
    const error = await a.runAction('t1', 'a1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OmniHttpError);
    expect((error as OmniHttpError).failure).toMatchObject({ kind: 'http', status: 409, message: 'Its worktree is still being prepared.' });
  });
});

describe('folders', () => {
  it('opens and closes one by id, sending only collapsed', async () => {
    const { sent, api: a } = api({ json: { id: 'f 1', collapsed: 1 } });
    expect(await a.setFolderCollapsed('f 1', true)).toEqual({ id: 'f 1', collapsed: 1 });
    await a.setFolderCollapsed('f 1', false);
    expect(sent).toEqual([
      { method: 'PATCH', url: at('/folders/f%201'), body: { collapsed: true } },
      { method: 'PATCH', url: at('/folders/f%201'), body: { collapsed: false } },
    ]);
  });
});
