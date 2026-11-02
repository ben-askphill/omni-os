// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Settings, Sharing & access, Omni for iOS: the card asks the server for a code only when you press the button, puts
// the address and that code, and only those, in the QR, and drops the code when it runs out.

const CONNECTED = { enabled: true, relayReady: true, signedIn: true, hostname: 'bens-mac-a1b2c3.omni-os.app', url: 'https://bens-mac-a1b2c3.omni-os.app', connectPage: null, tunnel: { state: 'connected', error: null }, error: null };
let connect: Omit<typeof CONNECTED, 'url'> & { url: string | null } = CONNECTED;
let via = 'token';
let reply: () => Promise<unknown> = async () => ({ code: 'AB12', expiresAt: new Date(Date.now() + 120_000).toISOString() });
const posts: string[] = [];

vi.mock('../src/api.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/api.ts')>();
  actual.api.get = vi.fn(async (path: string) => (path === '/auth/account' ? { available: true, issuer: null, owner: null, via } : connect)) as typeof actual.api.get;
  actual.api.post = vi.fn(async (path: string) => {
    posts.push(path);
    return reply();
  }) as typeof actual.api.post;
  return actual;
});

vi.mock('../src/components/QrCode.tsx', () => ({
  QrCode: ({ text }: { text: string }) => createElement('div', { 'data-qr': text }),
}));

import { ApiError } from '../src/api.ts';
import { IosPairingSection } from '../src/pages/IosPairing.tsx';

let root: Root;
let host: HTMLDivElement;
const flush = () => act(async () => {});
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined;
const qr = () => host.querySelector('[data-qr]')?.getAttribute('data-qr') ?? null;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  posts.length = 0;
  via = 'token';
  reply = async () => ({ code: 'AB12', expiresAt: new Date(Date.now() + 120_000).toISOString() });
  connect = CONNECTED;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const type = async (input: HTMLInputElement, text: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const useAddress = async (text: string) => {
  if (!host.querySelector('#ios-address')) await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Use another address'))!.click());
  await type(host.querySelector('#ios-address') as HTMLInputElement, text);
  await act(async () => button('Use address')!.click());
  await flush();
};

const mount = async () => {
  await act(async () => root.render(createElement(IosPairingSection)));
  await flush();
};

it('asks for no code until you press the button', async () => {
  await mount();
  expect(posts).toEqual([]);
  expect(qr()).toBeNull();
  expect(host.textContent).toContain('bens-mac-a1b2c3.omni-os.app');
});

it('puts the Omni Connect address and the code in the QR', async () => {
  await mount();
  await act(async () => button('Show pairing code')!.click());
  await flush();
  expect(posts).toEqual(['/auth/app-pairings']);
  expect(qr()).toBe('{"version":1,"serverUrl":"https://bens-mac-a1b2c3.omni-os.app","code":"AB12"}');
  expect(host.textContent).toContain('in 2:00');
  expect(host.querySelector('[data-manual-code]')?.textContent).toBe('AB12');
});

it('drops the code when it expires', async () => {
  await mount();
  await act(async () => button('Show pairing code')!.click());
  await flush();
  await act(async () => void vi.advanceTimersByTime(121_000));
  expect(qr()).toBeNull();
  expect(host.querySelector('[data-manual-code]')).toBeNull();
  expect(host.textContent).toContain('The last code expired.');
  expect(button('Show pairing code')).toBeDefined();
});

it('does not offer a code while the tunnel is down', async () => {
  connect = { ...connect, tunnel: { state: 'starting', error: null } };
  await mount();
  expect(button('Show pairing code')).toBeUndefined();
  expect(host.textContent).toContain('still starting');
});

it('says so when this Omni cannot make a code', async () => {
  reply = async () => {
    throw new ApiError('Not Found', 404);
  };
  await mount();
  await act(async () => button('Show pairing code')!.click());
  await flush();
  expect(qr()).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('cannot pair the iOS app yet');
});

it('refuses a reply that is not a code', async () => {
  reply = async () => ({ token: 'secret' });
  await mount();
  await act(async () => button('Show pairing code')!.click());
  await flush();
  expect(qr()).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('did not send a pairing code');
  expect(host.textContent).not.toContain('secret');
});

it('offers an entered Tailscale address while Omni Connect is off, and puts it in the QR with the manual code', async () => {
  connect = { ...connect, enabled: false, url: null, tunnel: { state: 'off', error: null } };
  await mount();
  expect(button('Show pairing code')).toBeUndefined();
  expect(host.textContent).toContain('enter an HTTPS address');
  await useAddress('mac.tail1234.ts.net');
  expect(host.textContent).toContain('Omni cannot check from here');
  await act(async () => button('Show pairing code')!.click());
  await flush();
  expect(qr()).toBe('{"version":1,"serverUrl":"https://mac.tail1234.ts.net","code":"AB12"}');
  expect(host.querySelector('[data-manual-code]')?.textContent).toBe('AB12');
});

it.each([
  ['http://mac.tail1234.ts.net', 'starts with http://'],
  ['localhost:4747', 'only means something on this machine'],
  ['100.64.0.2', 'IP address'],
])('refuses an entered address of %s and says why', async (text, words) => {
  connect = { ...connect, enabled: false, url: null, tunnel: { state: 'off', error: null } };
  await mount();
  await useAddress(text);
  expect(host.textContent).toContain(words);
  expect(button('Show pairing code')).toBeUndefined();
});

it('lets you pick between Omni Connect and an entered address', async () => {
  await mount();
  await useAddress('https://mac.tail1234.ts.net');
  const pick = (name: string) => [...host.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes(name)) as HTMLElement;
  await act(async () => (host.querySelector('[aria-haspopup="listbox"]') as HTMLElement).click());
  await act(async () => pick('bens-mac-a1b2c3.omni-os.app').click());
  await act(async () => button('Show pairing code')!.click());
  await flush();
  expect(JSON.parse(qr()!).serverUrl).toBe('https://bens-mac-a1b2c3.omni-os.app');
});

it('drops a shown code when the address is switched', async () => {
  await mount();
  await act(async () => button('Show pairing code')!.click());
  await flush();
  expect(qr()).not.toBeNull();
  await useAddress('https://mac.tail1234.ts.net');
  expect(qr()).toBeNull();
});

it('sends a browser that signed in with Google to the Mac app, with no way to ask for a code', async () => {
  via = 'session';
  await mount();
  expect(button('Show pairing code')).toBeUndefined();
  expect(host.querySelector('#ios-address')).toBeNull();
  expect(host.textContent).toContain('signed in with Google');
  expect(host.textContent).toContain('Mac app');
  expect(host.textContent).toContain('install token');
  expect(posts).toEqual([]);
});

it('tells a refused browser the same when the server says no', async () => {
  reply = async () => {
    throw new ApiError('Forbidden: only the install token can pair an app', 403);
  };
  await mount();
  await act(async () => button('Show pairing code')!.click());
  await flush();
  const text = host.querySelector('[role="alert"]')?.textContent ?? '';
  expect(text).toContain('Forbidden: only the install token can pair an app.');
  expect(text).toContain('Mac app');
});
