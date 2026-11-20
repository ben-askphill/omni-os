// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The Connect an agent sheet opened from a pairing link: the link fills it in, and Omni reaches out to the address only
// once Ben presses Find. A link from anywhere (a web page, a chat) must not make the server probe an address by itself.

let posts: { path: string; body: unknown }[] = [];
/** What the next Find answers, when a test needs another agent than the Hermes one. */
let found: Record<string, unknown> | null = null;
vi.mock('../src/api.ts', () => ({
  api: {
    get: async () => ({}),
    post: async (path: string, body: unknown) => {
      posts.push({ path, body });
      if (path === '/harnesses/connect/pair') return { draft: 'd1', url: 'https://nomos.example.com', host: 'nomos.example.com', name: 'Nomos', sharedKey: false, revoke: true };
      return found ?? { url: 'http://127.0.0.1:8642', host: '127.0.0.1:8642', name: 'Hermes on box', kind: 'runs-api', supported: true, signIn: 'pairing', network: 'local', can: [], cannot: [], warnings: [] };
    },
  },
  errorText: String,
  ApiError: class extends Error {},
  useApi: () => ({ data: undefined, error: null, reload: () => {} }),
}));

const { ConnectAgentSheet } = await import('../src/components/ConnectAgent.tsx');

const LINK = 'omni://connect-agent?url=http%3A%2F%2F127.0.0.1%3A8642&pair=http%3A%2F%2F127.0.0.1%3A8643&code=GB8Z-DP5J-0TGX-R608-WYSB-WV2T-G8SV';
let root: Root | null = null;
let host: HTMLElement;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  posts = [];
  found = null;
});

describe('Connect an agent sheet', () => {
  it('fills a link in without looking it up, and finds it once Ben presses Find', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(ConnectAgentSheet, { open: true, initial: LINK, onClose: () => {} })));
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
    expect(posts).toEqual([]);
    const dialog = document.querySelector('dialog')!;
    expect((dialog.querySelector('#connect-input') as HTMLInputElement).value).toBe(LINK);
    expect(dialog.querySelector('[data-from-link]')?.textContent).toMatch(/Opened from a link/);
    const find = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Find')!;
    await act(async () => find.click());
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
    expect(posts.map((p) => p.path)).toEqual(['/harnesses/connect/find']);
    expect(posts[0].body).toMatchObject({ url: 'http://127.0.0.1:8642', pair: 'http://127.0.0.1:8643', code: 'GB8Z-DP5J-0TGX-R608-WYSB-WV2T-G8SV' });
    expect(dialog.querySelector('[data-from-link]')).toBeNull();
  });

  it("signs in to an eve agent in one step: Get a code opens its own page, and Pair takes the code typed back", async () => {
    found = { url: 'https://nomos.example.com', host: 'nomos.example.com', name: 'Nomos', kind: 'eve', supported: true, signIn: 'pairing', codeUrl: 'https://nomos.example.com/omni', network: 'https', can: ['Stop'], cannot: ['Steering'], warnings: [] };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(ConnectAgentSheet, { open: true, initial: 'https://nomos.example.com', onClose: () => {} })));
    const dialog = document.querySelector('dialog')!;
    const button = (text: string) => [...dialog.querySelectorAll('button')].find((b) => b.textContent === text)!;
    await act(async () => button('Find').click());
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
    // One code field, under Sign in, next to the agent's own page.
    expect(dialog.querySelector('#connect-code')).toBeNull();
    const link = [...dialog.querySelectorAll('a')].find((a) => a.textContent?.includes('Get a code'))!;
    expect(link.getAttribute('href')).toBe('https://nomos.example.com/omni');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(button('Pair').disabled).toBe(true);
    const input = dialog.querySelector('input[aria-label="Pairing code"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, 'gb8z-dp5j-0tgx-r608-wysb-wv2t-g8sv');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button('Pair').disabled).toBe(false);
    await act(async () => button('Pair').click());
    await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
    expect(posts.at(-1)).toEqual({ path: '/harnesses/connect/pair', body: { url: 'https://nomos.example.com', code: 'gb8z-dp5j-0tgx-r608-wysb-wv2t-g8sv', name: 'Nomos', kind: 'eve' } });
    expect(dialog.textContent).toMatch(/Paired with nomos.example.com/);
  });
});
