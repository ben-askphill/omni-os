// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The Connect an agent sheet opened from a pairing link: the link fills it in, and Omni reaches out to the address only
// once Ben presses Find. A link from anywhere (a web page, a chat) must not make the server probe an address by itself.

let posts: { path: string; body: unknown }[] = [];
vi.mock('../src/api.ts', () => ({
  api: {
    get: async () => ({}),
    post: async (path: string, body: unknown) => {
      posts.push({ path, body });
      return { url: 'http://127.0.0.1:8642', host: '127.0.0.1:8642', name: 'Hermes on box', kind: 'runs-api', supported: true, signIn: 'pairing', network: 'local', can: [], cannot: [], warnings: [] };
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
});
