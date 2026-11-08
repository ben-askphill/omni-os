import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';

// The APNs secrets as Ben saves them: through Settings, then Secrets, whose field is one line, so a pasted .p8 file
// arrives without its line breaks. The server reports why alerts are off and picks up the key without a restart.

await startRunner({ OMNI_SECRET_STORE: 'file' });
const { app } = await import('../app.ts');
const { startPush } = await import('../push-sender.ts');
const { secretReachesThread } = await import('../secrets.ts');

const PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const req = (method: string, path: string, body?: unknown) =>
  app.request(`http://127.0.0.1:4747/api${path}`, {
    method,
    headers: { host: '127.0.0.1:4747', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const push = async () => ((await (await req('GET', '/capabilities')).json()) as { push: unknown }).push;
const save = async (name: string, value: string) => expect((await req('POST', '/secrets', { scope: 'global', name, value })).status).toBe(200);

describe('APNs secrets', () => {
  it('says which secrets are missing, then turns alerts on once a one-line key is saved, with no restart', async () => {
    await startPush();
    expect(await push()).toEqual({ registration: true, delivery: false, problem: 'missing APNS_KEY_ID, APNS_TEAM_ID, APNS_AUTH_KEY' });

    // The secret store refuses line breaks, and a password field drops them from a paste.
    expect((await req('POST', '/secrets', { scope: 'global', name: 'APNS_AUTH_KEY', value: PEM })).status).not.toBe(200);
    await save('APNS_AUTH_KEY', PEM.replace(/\n/g, ''));
    await save('APNS_KEY_ID', 'ABC123DEFG');
    await save('APNS_TEAM_ID', 'TEAM123456');

    await vi.waitFor(async () => expect(await push()).toEqual({ registration: true, delivery: true, problem: null }));

    expect((await req('DELETE', '/secrets', { scope: 'global', name: 'APNS_TEAM_ID' })).status).toBe(200);
    await vi.waitFor(async () => expect(await push()).toEqual({ registration: true, delivery: false, problem: 'missing APNS_TEAM_ID' }));
  });

  it('keeps the signing key out of every agent environment', () => {
    expect(secretReachesThread('global', 'APNS_AUTH_KEY')).toBe(false);
    expect(secretReachesThread('global', 'APNS_KEY_ID')).toBe(true);
  });
});
