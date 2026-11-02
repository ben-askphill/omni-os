import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api.ts';
import { clock, NEEDS_INSTALL_TOKEN, pairingErrorText, pairingOptions, pairingPayload, parseEnteredAddress, parsePairingCode, remoteHttpsOrigin, secondsLeft } from '../src/pair-ios.ts';

// Which address the iOS pairing QR names, what it holds, and what is said when there is no code.

const connected = { enabled: true, url: 'https://bens-mac-a1b2c3.omni-os.app', tunnel: { state: 'connected' } };

describe('remoteHttpsOrigin', () => {
  it('keeps the origin of an HTTPS name a phone can reach', () => {
    expect(remoteHttpsOrigin('https://bens-mac-a1b2c3.omni-os.app/#/connect?x=1')).toBe('https://bens-mac-a1b2c3.omni-os.app');
    expect(remoteHttpsOrigin('https://mac.tail1234.ts.net:8443/path')).toBe('https://mac.tail1234.ts.net:8443');
  });

  it.each([
    'http://bens-mac.omni-os.app',
    'http://localhost:4747',
    'https://localhost:4747',
    'https://127.0.0.1',
    'https://192.168.1.20',
    'https://[::1]:4747',
    'https://bens-mac.local',
    'https://app.localhost',
    'https://intranet',
    'https://user:pass@bens-mac.omni-os.app',
    'omni://pair',
    'not a url',
    '',
    null,
    undefined,
  ])('refuses %s', (raw) => {
    expect(remoteHttpsOrigin(raw)).toBeNull();
  });
});

describe('pairingOptions', () => {
  const off = { enabled: false, url: null, tunnel: { state: 'off' } };

  it('offers the address the page is on, first', () => {
    expect(pairingOptions({ pageOrigin: 'https://mac.tail1234.ts.net', connect: connected }).addresses).toEqual([
      { url: 'https://mac.tail1234.ts.net', source: 'page' },
      { url: 'https://bens-mac-a1b2c3.omni-os.app', source: 'connect' },
    ]);
    expect(pairingOptions({ pageOrigin: 'https://mac.tail1234.ts.net' }).addresses).toEqual([{ url: 'https://mac.tail1234.ts.net', source: 'page' }]);
  });

  it('offers the Omni Connect address from localhost once the tunnel is up', () => {
    expect(pairingOptions({ pageOrigin: 'http://localhost:4747', connect: connected }).addresses).toEqual([{ url: 'https://bens-mac-a1b2c3.omni-os.app', source: 'connect' }]);
  });

  it('offers an entered Tailscale address with Omni Connect off, and does not need a tunnel', () => {
    const o = pairingOptions({ pageOrigin: 'http://localhost:4747', connect: off, entered: 'https://mac.tail1234.ts.net' });
    expect(o).toEqual({ addresses: [{ url: 'https://mac.tail1234.ts.net', source: 'entered' }], problem: null });
  });

  it('lists an entered address after the others, once', () => {
    const o = pairingOptions({ pageOrigin: 'http://localhost:4747', connect: connected, entered: 'https://mac.tail1234.ts.net' });
    expect(o.addresses.map((a) => a.source)).toEqual(['connect', 'entered']);
    expect(pairingOptions({ pageOrigin: 'http://localhost:4747', connect: connected, entered: 'https://bens-mac-a1b2c3.omni-os.app' }).addresses).toHaveLength(1);
  });

  it('works before, or without, the Omni Connect status', () => {
    expect(pairingOptions({ pageOrigin: 'http://localhost:4747', entered: 'https://mac.tail1234.ts.net' }).addresses).toHaveLength(1);
    expect(pairingOptions({ pageOrigin: 'http://localhost:4747' })).toEqual({ addresses: [], problem: expect.stringContaining('enter an HTTPS address') });
  });

  it('says what to do when Omni Connect is off', () => {
    const p = pairingOptions({ pageOrigin: 'http://localhost:4747', connect: off }).problem;
    expect(p).toContain('localhost:4747');
    expect(p).toContain('Turn on Omni Connect');
    expect(p).toContain('Tailscale name');
  });

  it.each([
    ['starting', 'still starting'],
    ['restarting', 'restarting'],
    ['missing', 'cloudflared is not installed'],
    ['off', 'is off'],
  ])('says why a %s tunnel has no address, and still offers entry', (state, words) => {
    const o = pairingOptions({ pageOrigin: 'http://localhost:4747', connect: { ...connected, tunnel: { state } } });
    expect(o.addresses).toEqual([]);
    expect(o.problem).toContain(words);
    expect(o.problem).toContain('enter an HTTPS address');
  });

  it('never offers an address that is not HTTPS', () => {
    for (const url of ['http://bens-mac.omni-os.app', null]) {
      const o = pairingOptions({ pageOrigin: 'http://localhost:4747', connect: { ...connected, url } });
      expect(o.addresses).toEqual([]);
      expect(o.problem).toContain('no HTTPS address');
    }
  });
});

describe('parseEnteredAddress', () => {
  it('takes an HTTPS origin, with or without the scheme, and drops the rest', () => {
    expect(parseEnteredAddress('https://Mac.Tail1234.ts.net/')).toEqual({ url: 'https://mac.tail1234.ts.net' });
    expect(parseEnteredAddress('  mac.tail1234.ts.net  ')).toEqual({ url: 'https://mac.tail1234.ts.net' });
    expect(parseEnteredAddress('https://mac.tail1234.ts.net:8443/#/x?y=1')).toEqual({ url: 'https://mac.tail1234.ts.net:8443' });
  });

  it.each([
    ['', 'Enter an address'],
    ['http://mac.tail1234.ts.net', 'starts with http://'],
    ['ftp://mac.tail1234.ts.net', 'starts with https://'],
    ['https://localhost:4747', 'only means something on this machine'],
    ['localhost', 'only means something on this machine'],
    ['https://100.101.102.103', 'IP address'],
    ['http://192.168.1.20:4747', 'starts with http://'],
    ['https://bens-mac.local', 'only means something'],
    ['https://user:pw@mac.tail1234.ts.net', 'user name and password'],
    ['not a url', 'not a web address'],
  ])('refuses %j and says why', (text, words) => {
    const r = parseEnteredAddress(text);
    expect(r).toEqual({ problem: expect.stringContaining(words) });
  });
});

describe('pairingPayload', () => {
  it('holds the version, the address and the code, in that order, and nothing else', () => {
    expect(pairingPayload('https://bens-mac.omni-os.app', 'AB12-CD34')).toBe('{"version":1,"serverUrl":"https://bens-mac.omni-os.app","code":"AB12-CD34"}');
  });
});

describe('parsePairingCode', () => {
  it('reads {code, expiresAt}', () => {
    expect(parsePairingCode({ code: 'x1', expiresAt: '2026-11-02T10:05:00.000Z' })).toEqual({ code: 'x1', expiresAt: '2026-11-02T10:05:00.000Z' });
  });

  it.each([null, 'text', {}, { code: '', expiresAt: '2026-11-02T10:05:00Z' }, { code: 'x', expiresAt: 'soon' }, { code: 1, expiresAt: '2026-11-02T10:05:00Z' }])('refuses %j', (raw) => {
    expect(parsePairingCode(raw)).toBeNull();
  });

  it('drops anything else the server sent, like a token', () => {
    expect(parsePairingCode({ code: 'x1', expiresAt: '2026-11-02T10:05:00Z', token: 'secret' })).toEqual({ code: 'x1', expiresAt: '2026-11-02T10:05:00Z' });
  });
});

describe('pairingErrorText', () => {
  it('names an old server', () => {
    expect(pairingErrorText(new ApiError('Not Found', 404))).toContain('Update it, restart it');
  });
  it('names a rate limit', () => {
    expect(pairingErrorText(new ApiError('slow down', 429))).toContain('Wait a minute');
  });
  it('tells a refused session to use the Mac app or a browser paired with the install token', () => {
    const text = pairingErrorText(new ApiError('Forbidden: a Google session cannot pair an app', 403));
    expect(text).toContain('Forbidden: a Google session cannot pair an app.');
    expect(text).toContain('Mac app');
    expect(text).toContain('install token');
  });
  it('names the Google session in the instruction shown before any request', () => {
    expect(NEEDS_INSTALL_TOKEN).toContain('signed in with Google');
    expect(NEEDS_INSTALL_TOKEN).toContain('Mac app');
  });
  it('passes on what the server says about other failures', () => {
    expect(pairingErrorText(new ApiError('Cannot reach the Omni server. Is it running?', 0))).toBe('Cannot reach the Omni server. Is it running?');
  });
});

describe('the countdown', () => {
  const at = Date.parse('2026-11-02T10:00:00Z');
  it('counts whole seconds up to the expiry and stops at 0', () => {
    expect(secondsLeft('2026-11-02T10:05:00Z', at)).toBe(300);
    expect(secondsLeft('2026-11-02T10:05:00Z', at + 299_100)).toBe(1);
    expect(secondsLeft('2026-11-02T10:05:00Z', at + 301_000)).toBe(0);
  });
  it('shows minutes and seconds', () => {
    expect(clock(300)).toBe('5:00');
    expect(clock(61)).toBe('1:01');
    expect(clock(9)).toBe('0:09');
  });
});
