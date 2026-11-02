import { describe, expect, it } from 'vitest';
import { startError } from '@omni/shared/continue-flow.ts';
import type { ContinueBody } from '@omni/shared/continue.ts';
import { OmniHttpError } from '../src/http.ts';
import { api, at } from './api-helpers.ts';

type Api = ReturnType<typeof api>['api'];

/** The failure of a call that is refused. */
async function refusal(call: Promise<unknown>) {
  const err = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(OmniHttpError);
  return (err as OmniHttpError).failure;
}

describe('machines', () => {
  it('reads the sync status, the other synced machines and the server status', async () => {
    const sync = { configured: true, enabled: true, signedOut: false };
    const first = api({ json: sync });
    expect(await first.api.syncStatus()).toEqual(sync);
    const devices = [{ id: 'm-air', name: 'Air', reachability: 'online', dnsName: 'air.tail.ts.net', lastSeen: null }];
    const second = api({ json: devices });
    expect(await second.api.devices()).toEqual(devices);
    const third = api({ json: { device: { name: "Ben's MacBook Pro", here: true } } });
    expect((await third.api.status()).device?.name).toBe("Ben's MacBook Pro");
    expect([first.sent, second.sent, third.sent]).toEqual([
      [{ method: 'GET', url: at('/sync/status') }],
      [{ method: 'GET', url: at('/devices') }],
      [{ method: 'GET', url: at('/status') }],
    ]);
  });

  it('hands a thread to a machine by device id, takes it over, and cancels', async () => {
    const answer = { thread: { id: 't/1', status: 'stopped' }, handoff: null };
    const { sent, api: a } = api({ json: answer });
    expect(await a.handOff('t/1', 'm-air')).toEqual(answer);
    await a.takeOver('t/1');
    await a.cancelHandoff('t/1');
    expect(sent).toEqual([
      { method: 'POST', url: at('/threads/t%2F1/handoff'), body: { to: 'm-air' } },
      { method: 'POST', url: at('/threads/t%2F1/takeover'), body: {} },
      { method: 'POST', url: at('/threads/t%2F1/handoff/cancel'), body: {} },
    ]);
  });

  it("passes a refusal's status, message and body through", async () => {
    const body = { error: 'It runs on another Mac.' };
    const calls: ((a: Api) => Promise<unknown>)[] = [(a) => a.handOff('t1', 'm-air'), (a) => a.takeOver('t1'), (a) => a.cancelHandoff('t1')];
    for (const call of calls) {
      expect(await refusal(call(api({ status: 409, json: body }).api))).toMatchObject({ kind: 'http', status: 409, message: 'It runs on another Mac.', body });
    }
  });
});

describe('continuing a thread', () => {
  const run = { harness: 'codex', model: 'codex-b', effort: '' };

  it('asks for the preview of a run and the attachments picked', async () => {
    const preview = { carryover: {}, revision: 'r1', workspace: 'worktree', blocked: null };
    const { sent, api: a } = api({ json: preview });
    expect(await a.continuePreview('t 1', { ...run, attachments: ['u1:0'] })).toEqual(preview);
    await a.continuePreview('t 1', run);
    expect(sent).toEqual([
      { method: 'POST', url: at('/threads/t%201/continue/preview'), body: { ...run, attachments: ['u1:0'] } },
      { method: 'POST', url: at('/threads/t%201/continue/preview'), body: run },
    ]);
  });

  it('starts the continued thread with the whole body, and closes the terminal', async () => {
    const body: ContinueBody = { ...run, attachments: [], text: 'Carry on', request_id: 'req-1', revision: 'r1' };
    const started = { thread: { id: 'new' }, duplicate: false };
    const first = api({ json: started });
    expect(await first.api.continueThread('t1', body)).toEqual(started);
    const closed = { open: false, running: false, code: null };
    const second = api({ json: closed });
    expect(await second.api.closeTerminal('t1')).toEqual(closed);
    expect(first.sent).toEqual([{ method: 'POST', url: at('/threads/t1/continue'), body }]);
    expect(second.sent).toEqual([{ method: 'DELETE', url: at('/threads/t1/terminal') }]);
  });

  it('leaves a 409 body for startError: busy, changed and request_reused', async () => {
    const body: ContinueBody = { ...run, text: 'Carry on', request_id: 'req-1', revision: 'r1' };
    const preview = { carryover: {}, revision: 'r2', workspace: 'worktree', blocked: null };
    const block = { code: 'running', message: 'A turn is running in it.' };
    const refused = async (json: unknown) => {
      const { api: a } = api({ status: 409, json });
      return a.continueThread('t1', body).catch((e: unknown) => e);
    };
    expect(startError(await refused({ error: 'busy', code: 'busy', block }))).toEqual({ kind: 'busy', block });
    expect(startError(await refused({ error: 'changed', code: 'changed', preview }))).toEqual({ kind: 'changed', preview });
    expect(startError(await refused({ error: 'That request id was used for another start.', code: 'request_reused' }))).toEqual({
      kind: 'reused',
      error: 'That request id was used for another start.',
    });
  });

  it('passes a refused preview and a refused terminal close through', async () => {
    const body = { error: 'No such thread' };
    expect(await refusal(api({ status: 404, json: body }).api.continuePreview('nope', { harness: 'codex', model: '', effort: '' }))).toMatchObject({ kind: 'http', status: 404, message: 'No such thread', body });
    expect(await refusal(api({ status: 404, json: body }).api.closeTerminal('nope'))).toMatchObject({ kind: 'http', status: 404, body });
  });
});
