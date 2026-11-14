import { describe, expect, it } from 'vitest';
import { OmniHttpError } from '../src/http.ts';
import { api, at } from './api-helpers.ts';

describe('install token', () => {
  it('rotates it with a POST', async () => {
    const { sent, api: a } = api({ json: { ok: true } });
    expect(await a.rotateInstallToken()).toEqual({ ok: true });
    expect(sent).toEqual([{ method: 'POST', url: at('/auth/rotate-token'), body: {} }]);
  });

  it("passes a 403 through with the server's words", async () => {
    const body = { error: 'Only the install token can rotate it.' };
    const err = await api({ status: 403, json: body }).api.rotateInstallToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OmniHttpError);
    expect((err as OmniHttpError).failure).toMatchObject({ kind: 'http', status: 403, message: 'Only the install token can rotate it.' });
  });
});

describe('MCP clients', () => {
  const client = { id: 'c/1', name: 'claude.ai', status: 'pending', firstSeen: '2026-11-01T10:00:00Z', lastSeen: '2026-11-13T10:00:00Z', via: null };

  it('lists, approves and removes them, encoding the id', async () => {
    const first = api({ json: [client] });
    expect(await first.api.mcpClients()).toEqual([client]);
    const second = api({ json: { ...client, status: 'approved' } });
    expect(await second.api.approveMcpClient('c/1')).toMatchObject({ status: 'approved' });
    const third = api({ json: { ok: true } });
    expect(await third.api.removeMcpClient('c/1')).toEqual({ ok: true });
    expect([first.sent, second.sent, third.sent]).toEqual([
      [{ method: 'GET', url: at('/mcp/clients') }],
      [{ method: 'POST', url: at('/mcp/clients/c%2F1/approve'), body: {} }],
      [{ method: 'DELETE', url: at('/mcp/clients/c%2F1') }],
    ]);
  });
});

describe('signed sync', () => {
  it('lists the machines with their keys and confirms a changed key', async () => {
    const device = { id: 'm-air', name: 'Air', current: false, fingerprint: 'ab12', pinnedFingerprint: 'cd34', keyChanged: true };
    const first = api({ json: [device] });
    expect(await first.api.syncDevices()).toEqual([device]);
    const second = api({ json: { ok: true } });
    expect(await second.api.confirmSyncKey('m air')).toEqual({ ok: true });
    expect([first.sent, second.sent]).toEqual([
      [{ method: 'GET', url: at('/sync/devices') }],
      [{ method: 'POST', url: at('/sync/devices/m%20air/confirm-key'), body: {} }],
    ]);
  });

  it('reads the refused changes, 50 unless asked for another number', async () => {
    const row = { id: 7, at: '2026-11-13T10:00:00Z', machine: 'Air', entity: 'remote_command', entityId: 'rc1', reason: 'Bad signature' };
    const { sent, api: a } = api({ json: [row] });
    expect(await a.refusedChanges()).toEqual([row]);
    await a.refusedChanges(10);
    expect(sent).toEqual([
      { method: 'GET', url: at('/sync/refused?limit=50') },
      { method: 'GET', url: at('/sync/refused?limit=10') },
    ]);
  });
});
