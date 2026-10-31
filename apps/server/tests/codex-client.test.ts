import { afterEach, describe, expect, it } from 'vitest';
import { CodexClient } from '../harness/codex/client.ts';
import { FAKE_CODEX } from './support.ts';

const clients: CodexClient[] = [];
const open = (silent: string, requestTimeoutMs?: number) => {
  const client = new CodexClient({ bin: FAKE_CODEX, env: { ...process.env, FAKE_CODEX_SILENT: silent }, requestTimeoutMs });
  clients.push(client);
  return client;
};
const alive = (c: CodexClient) => c.child.exitCode === null && c.child.signalCode === null;

afterEach(() => {
  for (const c of clients.splice(0)) c.kill();
});

describe('CodexClient request deadlines', () => {
  it('rejects a request a living process never answers, and stops waiting for it', async () => {
    const client = open('initialize', 300);
    const started = Date.now();
    await expect(client.request('initialize', {})).rejects.toThrow('codex app-server did not answer initialize within 0.3s');
    expect(Date.now() - started).toBeLessThan(3000);
    expect(alive(client)).toBe(true);
    expect(client.waiting).toEqual([]);
    // The process still answers what it isn't wedged on.
    await expect(client.request('config/read', {})).resolves.toMatchObject({ config: expect.any(Object) });
  });

  it('takes a deadline per request over the client default', async () => {
    const client = open('account/read', 60_000);
    await expect(client.request('account/read', {}, { timeoutMs: 200 })).rejects.toThrow('did not answer account/read');
    expect(client.waiting).toEqual([]);
  });

  it('cancels a request when its signal aborts', async () => {
    const client = open('skills/list');
    const ac = new AbortController();
    const asked = client.request('skills/list', { cwds: ['/tmp'] }, { signal: ac.signal });
    expect(client.waiting).toEqual(['skills/list']);
    ac.abort();
    await expect(asked).rejects.toThrow('codex skills/list was cancelled');
    expect(client.waiting).toEqual([]);
    await expect(client.request('skills/list', {}, { signal: ac.signal })).rejects.toThrow('cancelled');
  });

  it('rejects what is still waiting when the process exits', async () => {
    const client = open('initialize');
    const asked = client.request('initialize', {});
    client.kill();
    await expect(asked).rejects.toThrow('codex app-server exited');
    expect(client.waiting).toEqual([]);
  });

  it('answers as before when the process does answer', async () => {
    const client = open('');
    await expect(client.request('initialize', {})).resolves.toMatchObject({ userAgent: expect.stringContaining('fake-codex') });
    expect(client.waiting).toEqual([]);
  });
});
