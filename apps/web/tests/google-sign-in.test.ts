import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ApiError, finishGoogleSignIn, revokeDevice, type AuthState, type SignInAvailability, type SignInFinished, type SignedInDevice } from '../src/api.ts';
import { accountView, deviceRows, onboardingSteps, pairingVariant, signInStep, takeHashParam } from '../src/sign-in.ts';

// What the Web UI shows about Sign in with Google (apps/web/src/sign-in.ts), against the same recorded server answers
// the Mac app's Swift tests decode (apps/server/tests/mac-fixtures.test.ts records them).

const FIXTURES = join(resolve(import.meta.dirname, '../..'), 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');
const fixture = <T>(name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;

const viaToken = () => fixture<AuthState>('auth-token.json');
const viaSession = () => fixture<AuthState>('auth-session.json');
const availability = (over: Partial<SignInAvailability> = {}): SignInAvailability => ({ ...fixture<SignInAvailability>('signin-availability.json'), ...over });
const notYet = availability({ available: false, reason: 'Pair with the install token first.' });
const notSetUp = availability({ configured: false, available: false, reason: 'Google sign-in is not set up on this Omni yet.' });

describe('the address Google sends the browser back to', () => {
  it('takes the attempt out and leaves the route', () => {
    expect(takeHashParam('#/?signin=abc123', 'signin')).toEqual({ value: 'abc123', rest: '#/' });
    expect(takeHashParam('#/t/t1?signin=abc123&turn=2', 'signin')).toEqual({ value: 'abc123', rest: '#/t/t1?turn=2' });
  });

  it('takes the pairing token the same way', () => {
    expect(takeHashParam('#/t/t1?pair=TOKEN', 'pair')).toEqual({ value: 'TOKEN', rest: '#/t/t1' });
  });

  it('leaves an address without the parameter as it is', () => {
    expect(takeHashParam('#/settings', 'signin')).toEqual({ value: null, rest: '#/settings' });
    expect(takeHashParam('#/search?q=a', 'signin')).toEqual({ value: null, rest: '#/search?q=a' });
    expect(takeHashParam('#/?signin=', 'signin')).toEqual({ value: null, rest: '#/?signin=' });
    expect(takeHashParam('', 'signin')).toEqual({ value: null, rest: '' });
  });
});

describe('finishing a sign-in', () => {
  afterEach(() => vi.unstubAllGlobals());

  const finished = (): SignInFinished => {
    const { credential: _credential, expiresAt: _expiresAt, ...web } = fixture<SignInFinished & { credential: string; expiresAt: string }>('signin-finished.json');
    return web;
  };
  /** The server's answers in order; the last one repeats. */
  const answers = (...list: [number, unknown][]) => {
    let n = 0;
    const fetch = vi.fn(async () => {
      const [status, body] = list[Math.min(n++, list.length - 1)];
      return new Response(JSON.stringify(body), { status });
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('asks again each second while Google has not answered, then returns who signed in', async () => {
    const fetch = answers([202, { pending: true }], [202, { pending: true }], [200, finished()]);
    const pause = vi.fn(async () => {});
    expect(await finishGoogleSignIn('a1', pause)).toEqual(finished());
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledWith('/api/auth/google/finish', expect.objectContaining({ method: 'POST', body: JSON.stringify({ attempt: 'a1' }) }));
    expect(pause.mock.calls).toEqual([[1000], [1000]]);
  });

  it('gives up after ten answers of "not yet"', async () => {
    const fetch = answers([202, { pending: true }]);
    const pause = vi.fn(async () => {});
    await expect(finishGoogleSignIn('a1', pause)).rejects.toThrow('Google took too long to answer. Start again.');
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(pause).toHaveBeenCalledTimes(9);
  });

  it('shows the server\'s own words when it refuses, without asking again', async () => {
    const fetch = answers([403, { error: 'mallory@example.net is not allowed to sign in to this Omni.' }]);
    const pause = vi.fn(async () => {});
    const refused = await finishGoogleSignIn('a1', pause).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ message: 'mallory@example.net is not allowed to sign in to this Omni.', status: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });
});

describe('the pairing screen', () => {
  it('offers Google first when it can be used', () => {
    expect(pairingVariant(availability())).toEqual({ kind: 'google' });
  });

  it('keeps the token form and says why when Google is set up but cannot be used yet', () => {
    expect(pairingVariant(notYet)).toEqual({ kind: 'token', note: 'Pair with the install token first.' });
  });

  it('is today\'s screen when Google is not set up, or the server did not say', () => {
    expect(pairingVariant(notSetUp)).toEqual({ kind: 'token', note: null });
    expect(pairingVariant(null)).toEqual({ kind: 'token', note: null });
  });
});

describe('onboarding', () => {
  it('starts with Sign in only when asked to', () => {
    expect(onboardingSteps(false)).toEqual(['You', 'Workspace', 'Harnesses', 'Channel', 'Done']);
    expect(onboardingSteps(true)).toEqual(['Sign in', 'You', 'Workspace', 'Harnesses', 'Channel', 'Done']);
  });

  it('offers Google to a paired browser when it can be used, and otherwise has no such step', () => {
    expect(signInStep(viaToken(), availability())).toEqual({ kind: 'offer' });
    expect(signInStep(viaToken(), notYet)).toBeNull();
    expect(signInStep(viaToken(), notSetUp)).toBeNull();
    expect(signInStep(viaToken(), null)).toBeNull();
  });

  it('shows a signed-in browser who it is, whatever Google says now', () => {
    const user = { email: 'ada@example.com', name: 'Ada Lovelace' };
    expect(signInStep(viaSession(), availability())).toEqual({ kind: 'signed-in', user });
    expect(signInStep(viaSession(), null)).toEqual({ kind: 'signed-in', user });
  });
});

describe('Settings > Account', () => {
  it('shows a signed-in browser who it is, which device, and who may sign in', () => {
    expect(accountView(viaSession(), availability())).toEqual({
      identity: { kind: 'session', email: 'ada@example.com', device: "Ada's MacBook Pro" },
      canSignIn: false,
      note: null,
      allowed: 'Who may sign in: ada@example.com.',
      listDevices: true,
    });
  });

  it('offers a paired browser Google, and says nobody owns the install yet', () => {
    const view = accountView(viaToken(), availability());
    expect(view).toMatchObject({ identity: { kind: 'token' }, canSignIn: true, note: null, listDevices: true });
    expect(view.allowed).toMatch(/^Nobody has signed in yet/);
  });

  it('says why a paired browser cannot sign in with Google here', () => {
    expect(accountView(viaToken(), notYet)).toMatchObject({ canSignIn: false, note: 'Pair with the install token first.' });
  });

  it('lists addresses and a Workspace domain together', () => {
    const auth = viaSession();
    auth.google = { loopback: true, broker: false, allowedEmails: ['a@x.com', 'b@x.com'], allowedHd: 'example.com' };
    expect(accountView(auth, availability()).allowed).toBe('Who may sign in: a@x.com, b@x.com, anyone at example.com.');
  });

  it('says nothing about Google when this install has not set it up', () => {
    const token = viaToken();
    token.google = { loopback: false, broker: false, allowedEmails: [], allowedHd: null };
    expect(accountView(token, notSetUp)).toEqual({ identity: { kind: 'token' }, canSignIn: false, note: null, allowed: null, listDevices: false });
    const session = viaSession();
    session.google = { loopback: false, broker: false, allowedEmails: ['ada@example.com'], allowedHd: null };
    expect(accountView(session, notSetUp)).toMatchObject({ identity: { kind: 'session' }, canSignIn: false, allowed: null, listDevices: false });
  });
});

describe('Settings > Devices', () => {
  afterEach(() => vi.unstubAllGlobals());

  const listed = () => fixture<SignedInDevice[]>('devices-signed-in.json');
  const at = (iso: string, plusMs: number) => Date.parse(iso) + plusMs;

  it('makes a row per device in the server\'s order, marking this one instead of giving a time', () => {
    const [imac, macbook] = listed();
    expect(deviceRows(listed(), at(macbook.lastSeenAt, 3 * 60_000))).toEqual([
      { id: imac.id, name: "Ada's iMac", icon: 'monitor', detail: 'ada@example.com · last seen 3m ago', current: false },
      { id: macbook.id, name: "Ada's MacBook Pro", icon: 'monitor', detail: 'ada@example.com · This device', current: true },
    ]);
  });

  it('draws a browser with the browser glyph and says when it was last seen', () => {
    const now = new Date(2026, 0, 5, 15, 0).getTime();
    const browser: SignedInDevice = { ...listed()[0], kind: 'browser', name: 'Chrome on Mac', lastSeenAt: new Date(now - 2 * 3_600_000).toISOString() };
    expect(deviceRows([browser], now)).toEqual([{ id: browser.id, name: 'Chrome on Mac', icon: 'browser', detail: 'ada@example.com · last seen 2h ago', current: false }]);
    expect(deviceRows([{ ...browser, lastSeenAt: new Date(now - 10_000).toISOString() }], now)[0].detail).toBe('ada@example.com · last seen just now');
  });

  it('has no rows for no devices', () => {
    expect(deviceRows([], Date.now())).toEqual([]);
  });

  it('signs a device out by its id, and says whether it was this browser', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(fixture('device-revoked.json')), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await revokeDevice('a b')).toEqual({ ok: true, current: false });
    expect(fetch).toHaveBeenCalledWith('/api/auth/devices/a%20b', expect.objectContaining({ method: 'DELETE' }));
  });

  it('shows the server\'s words when the device is already gone', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'No such signed-in device.' }), { status: 404 }));
    await expect(revokeDevice('x')).rejects.toMatchObject({ message: 'No such signed-in device.', status: 404 });
  });
});
