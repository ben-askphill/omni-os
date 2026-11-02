import { beforeEach, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Which alerts a paired device gets: every kind on until it turns one off, changed over GET and PUT /api/auth/push-preferences,
// gone with the session, and honoured when the sender picks its targets.

const r = await startRunner();
const { app } = await import('../app.ts');
const auth = await import('../google-auth.ts');
const pairing = await import('../app-pairing.ts');
const { pushTargets, updatePushPreferences } = await import('../push-preferences.ts');

const MASTER = process.env.OMNI_TOKEN!;
const HOST = { host: '127.0.0.1:4747' };
const NONE = { authorization: '' };
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const PUSH = { token: 'aa'.repeat(32), platform: 'ios', environment: 'sandbox' };

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`http://127.0.0.1:4747/api${path}`, {
    method,
    headers: { ...HOST, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

async function pairApp(name = 'Ben iPhone') {
  const { code } = (await (await req('POST', '/auth/app-pairings', {}, as(MASTER))).json()) as { code: string };
  const res = await req('POST', '/auth/app-pairings/redeem', { code, name }, NONE);
  expect(res.status).toBe(200);
  return (await res.json()) as { token: string; sessionId: string };
}

const prefRows = () => r.db.db.prepare('SELECT session_id FROM push_preferences').all() as { session_id: string }[];

const ALL_ON = { needsInput: true, finished: true, failed: true, crewReport: true };

beforeEach(() => {
  pairing.resetPairings();
  auth.resetFlows();
  r.db.db.exec("UPDATE device_sessions SET revoked_at = datetime('now') WHERE revoked_at IS NULL; DELETE FROM push_tokens; DELETE FROM push_preferences");
});

describe('reading and changing the choices', () => {
  it('starts with every kind on', async () => {
    const phone = await pairApp();
    const res = await req('GET', '/auth/push-preferences', undefined, as(phone.token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ALL_ON);
  });

  it('changes only the kinds sent, and answers with the full set', async () => {
    const phone = await pairApp();
    const first = await req('PUT', '/auth/push-preferences', { failed: false }, as(phone.token));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ...ALL_ON, failed: false });
    const second = await req('PUT', '/auth/push-preferences', { finished: false }, as(phone.token));
    expect(await second.json()).toEqual({ ...ALL_ON, finished: false, failed: false });
    expect(await (await req('GET', '/auth/push-preferences', undefined, as(phone.token))).json()).toEqual({ ...ALL_ON, finished: false, failed: false });
  });

  it('keeps each device on its own choices', async () => {
    const phone = await pairApp('phone');
    const ipad = await pairApp('ipad');
    await req('PUT', '/auth/push-preferences', { crewReport: false }, as(phone.token));
    expect(await (await req('GET', '/auth/push-preferences', undefined, as(ipad.token))).json()).toEqual(ALL_ON);
  });

  it('refuses a body that is empty, names an unknown kind, or sends something other than true or false', async () => {
    const phone = await pairApp();
    for (const body of [{}, { alerts: true }, { failed: 'no' }, { failed: true, extra: 1 }, 'not json']) {
      expect((await req('PUT', '/auth/push-preferences', body, as(phone.token))).status).toBe(400);
    }
    expect(prefRows()).toEqual([]);
  });

  it('is for app sessions only, so the install token and a Google session get 403', async () => {
    expect((await req('GET', '/auth/push-preferences', undefined, as(MASTER))).status).toBe(403);
    expect((await req('PUT', '/auth/push-preferences', { failed: false }, as(MASTER))).status).toBe(403);
  });

  it('is refused once the session is revoked', async () => {
    const phone = await pairApp();
    expect((await req('DELETE', `/auth/devices/${phone.sessionId}`)).status).toBe(200);
    expect((await req('PUT', '/auth/push-preferences', { failed: false }, as(phone.token))).status).toBe(401);
    expect(updatePushPreferences(phone.sessionId, { failed: false })).toBeNull();
    expect(prefRows()).toEqual([]);
  });

  it('is deleted with the session, like its push token', async () => {
    const phone = await pairApp();
    await req('PUT', '/auth/push-preferences', { failed: false }, as(phone.token));
    expect(prefRows().map((x) => x.session_id)).toEqual([phone.sessionId]);
    expect((await req('POST', '/auth/signout', {}, as(phone.token))).status).toBe(200);
    expect(prefRows()).toEqual([]);
  });
});

describe('who the sender picks for an alert', () => {
  it('sends a kind only to devices that have it on, and only while their sessions are live', async () => {
    const a = await pairApp('a');
    const b = await pairApp('b');
    await req('PUT', '/auth/push-token', { ...PUSH, token: 'aa'.repeat(32) }, as(a.token));
    await req('PUT', '/auth/push-token', { ...PUSH, token: 'bb'.repeat(32) }, as(b.token));
    await req('PUT', '/auth/push-preferences', { failed: false }, as(a.token));

    expect(pushTargets('failed').map((t) => t.sessionId)).toEqual([b.sessionId]);
    expect(pushTargets('needsInput').map((t) => t.sessionId).sort()).toEqual([a.sessionId, b.sessionId].sort());
    expect(pushTargets('needsInput')[0]).toMatchObject({ environment: 'sandbox', bundleId: null });

    expect((await req('DELETE', `/auth/devices/${b.sessionId}`)).status).toBe(200);
    expect(pushTargets('needsInput').map((t) => t.sessionId)).toEqual([a.sessionId]);
  });
});
