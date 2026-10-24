import { describe, expect, it } from 'vitest';
import { createBroker } from './handler.ts';

const ID = 'AbCdEfGhIjKlMnOp-_0123';
const OMNI = 'https://bens-mac.tail1234.ts.net';
const b64url = (s: string) => Buffer.from(s).toString('base64url');
const stateFor = (origin: string, id = ID) => `${id}.${b64url(origin)}`;

/** Every answer must carry no-store and no-referrer, since the request URL carries a code. `call` checks it for all. */
function setup(returnOrigins = [OMNI]) {
  const broker = createBroker({ returnOrigins });
  const call = async (method: string, path: string) => {
    const res = await broker(new Request(`https://ref.supabase.co${path}`, { method }));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect([...res.headers.keys()].filter((h) => h.startsWith('access-control-'))).toEqual([]);
    return res;
  };
  const callback = (params: Record<string, string>) => call('GET', `/functions/v1/omni-oauth-broker/callback?${new URLSearchParams(params)}`);
  return { call, callback };
}

describe('GET /callback', () => {
  it("sends Google's code on to the Omni that started, state unchanged, to be checked against the browser there", async () => {
    const state = stateFor(OMNI);
    const res = await setup().callback({ state, code: '4/0AQ-code', scope: 'openid email', authuser: '0' });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(to.origin + to.pathname).toBe(`${OMNI}/api/auth/google/callback`);
    expect([...to.searchParams]).toEqual([
      ['state', state],
      ['code', '4/0AQ-code'],
    ]);
  });

  it("passes on Google's error as a bare code, and nothing else from the URL", async () => {
    const errorFor = async (error: string) => new URL((await setup().callback({ state: stateFor(OMNI), error })).headers.get('location')!);
    const denied = await errorFor('access_denied');
    expect([...denied.searchParams.keys()]).toEqual(['state', 'error']);
    expect(denied.searchParams.get('error')).toBe('access_denied');
    expect((await errorFor('"><img src=x>')).searchParams.get('error')).toBe('imgsrcx');
    const empty = new URL((await setup().callback({ state: stateFor(OMNI) })).headers.get('location')!);
    expect(empty.searchParams.get('error')).toBe('error');
  });

  it('caps the code it passes on', async () => {
    const res = await setup().callback({ state: stateFor(OMNI), code: 'c'.repeat(5000) });
    expect(new URL(res.headers.get('location')!).searchParams.get('code')).toHaveLength(2048);
  });

  it('sends nobody to an origin off BROKER_RETURN_ORIGINS, however close', async () => {
    const { callback } = setup();
    for (const origin of ['https://evil.tail9999.ts.net', 'http://bens-mac.tail1234.ts.net', 'https://bens-mac.tail1234.ts.net:8443', 'http://127.0.0.1:4747']) {
      const res = await callback({ state: stateFor(origin), code: 'x' });
      expect(res.status, origin).toBe(403);
      expect(res.headers.get('location')).toBeNull();
      expect(await res.text()).toContain('BROKER_RETURN_ORIGINS');
    }
  });

  it('refuses a state that is not an attempt id and an exact origin', async () => {
    const { callback } = setup();
    const bad = [
      '',
      ID,
      `${ID}.`,
      `short.${b64url(OMNI)}`,
      `${ID}.${b64url(`${OMNI}/path`)}`,
      `${ID}.${b64url(`${OMNI}?q=1`)}`,
      `${ID}.${b64url('https://user@bens-mac.tail1234.ts.net')}`,
      `${ID}.${b64url(OMNI)}!`,
      `${ID}.${'A'.repeat(2000)}`,
      `${ID}.${Buffer.from([0xff, 0xfe]).toString('base64url')}`,
    ];
    for (const state of bad) {
      const res = await callback({ state, code: 'x' });
      expect(res.status, state).toBe(400);
      expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    }
  });

  it('serves under the public /functions/v1 prefix, the function name Supabase hands over, and bare', async () => {
    const { call } = setup();
    const q = `state=${encodeURIComponent(stateFor(OMNI))}&code=x`;
    for (const path of ['/functions/v1/omni-oauth-broker/callback', '/omni-oauth-broker/callback', '/callback']) {
      expect((await call('GET', `${path}?${q}`)).status, path).toBe(302);
    }
  });
});

describe('everything else', () => {
  it('answers 405 to other methods on /callback and 404 elsewhere, including the old claim API', async () => {
    const { call } = setup();
    const post = await call('POST', '/omni-oauth-broker/callback');
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
    for (const path of ['/omni-oauth-broker', '/omni-oauth-broker/attempts', `/omni-oauth-broker/attempts/${ID}/claim`, '/elsewhere']) {
      expect((await call('POST', path)).status, path).toBe(404);
    }
  });
});

describe('createBroker', () => {
  it('will not start without BROKER_RETURN_ORIGINS, or with an entry that is not exactly an origin', () => {
    expect(() => createBroker({ returnOrigins: [] })).toThrow(/BROKER_RETURN_ORIGINS is not set/);
    for (const bad of [`${OMNI}/`, `${OMNI}/path`, 'bens-mac.tail1234.ts.net', 'not a url']) {
      expect(() => createBroker({ returnOrigins: [OMNI, bad] }), bad).toThrow(/scheme:\/\/host/);
    }
  });

  it('allows several origins, each exactly', async () => {
    const { callback } = setup([OMNI, 'http://192.168.1.20:4747']);
    expect((await callback({ state: stateFor('http://192.168.1.20:4747'), code: 'x' })).headers.get('location')).toMatch(/^http:\/\/192\.168\.1\.20:4747\/api\//);
  });
});
