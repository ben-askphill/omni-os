// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Pair this machine on a remote agent's Server card: an agent Omni paired on another machine synced here without its
// key, so the card offers a code of this machine's own. The sheet opens on the agent's own code page, and Pair (or
// Enter in the field) sends the code to this server, never a key. The card sits inside the agent editor's form, so
// Enter must not reach that form and save the agent.

let posts: { path: string; body: unknown }[] = [];
let pairAnswer: Record<string, unknown> = { ok: true, reply: 'Nomos here.', model: 'gpt', totalMs: 900 };
vi.mock('../src/api.ts', () => ({
  api: {
    get: async () => ({}),
    del: async () => ({}),
    post: async (path: string, body: unknown) => {
      posts.push({ path, body });
      if (path === '/harnesses/connect/find') return { url: 'https://nomos.example.com', host: 'nomos.example.com', name: 'Nomos', kind: 'eve', supported: true, signIn: 'pairing', codeUrl: 'https://nomos.example.com/omni', network: 'https', can: [], cannot: [], warnings: [] };
      if (path === '/crew/nomos/server/pair') return pairAnswer;
      return {};
    },
  },
  errorText: String,
  ApiError: class extends Error {},
  useApi: () => ({ data: undefined, error: null, reload: () => {} }),
}));
vi.mock('../src/display.ts', () => ({ useTechnical: () => false }));

const { ServerCard } = await import('../src/pages/RemoteAgentCards.tsx');

const agent = (pairAt?: string) =>
  ({
    id: 'nomos',
    name: 'Nomos',
    server: { harness: 'custom:nomos', builtIn: false, kind: 'eve', url: 'https://nomos.example.com', host: 'nomos.example.com', secret: 'AGENT_NOMOS_KEY', cap: 12, available: !pairAt, ...(pairAt && { fix: 'AGENT_NOMOS_KEY holds a pairing code, not a key. Press Pair this machine', pairAt }) },
  }) as never;

let root: Root;
let host: HTMLElement;
let submits: number;
let changed: number;

async function render(a: unknown) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await draw(a);
}
/** The agent editor's form, as SettingsCrew puts the card in it. A change reloads the agent: connected, no pairAt. */
const draw = (a: unknown) =>
  act(async () =>
    root.render(
      createElement(
        'form',
        { onSubmit: (e: Event) => (e.preventDefault(), submits++) },
        createElement(ServerCard, {
          agent: a as never,
          onChanged: () => {
            changed++;
            void draw(agent());
          },
        }),
      ),
    ),
  );
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  posts = [];
  submits = 0;
  changed = 0;
  pairAnswer = { ok: true, reply: 'Nomos here.', model: 'gpt', totalMs: 900 };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('offers Pair this machine only when the server says this machine pairs', async () => {
  await render(agent());
  expect(button(host, 'Pair this machine')).toBeUndefined();
  act(() => root.unmount());
  host.remove();
  await render(agent('https://nomos.example.com'));
  expect(host.querySelector('[data-server-status]')?.textContent).toMatch(/holds a pairing code, not a key/);
  expect(button(host, 'Pair this machine')).toBeDefined();
});

it("opens on the agent's own code page, pairs on Enter without saving the agent, and refreshes the card", async () => {
  await render(agent('https://nomos.example.com'));
  await act(async () => button(host, 'Pair this machine')!.click());
  await tick();
  const dialog = document.querySelector('dialog')!;
  expect(dialog.textContent).toMatch(/Pair this machine with Nomos/);
  expect(posts[0]).toEqual({ path: '/harnesses/connect/find', body: { url: 'https://nomos.example.com' } });
  expect([...dialog.querySelectorAll('a')].find((a) => a.textContent?.includes('Get a code'))?.getAttribute('href')).toBe('https://nomos.example.com/omni');
  expect(dialog.querySelector('form')).toBeNull();
  const input = dialog.querySelector('input[aria-label="Pairing code"]') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, 'gb8z-dp5j-0tgx-r608-wysb-wv2t-g8sv');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => void input.dispatchEvent(enter));
  await tick();
  expect(enter.defaultPrevented).toBe(true);
  expect(submits).toBe(0);
  expect(posts.at(-1)).toEqual({ path: '/crew/nomos/server/pair', body: { code: 'gb8z-dp5j-0tgx-r608-wysb-wv2t-g8sv' } });
  expect(dialog.textContent).toMatch(/Nomos here\./);
  // The card no longer offers pairing, and the sheet stays open on what happened.
  expect(changed).toBe(1);
  expect(button(host, 'Pair this machine')).toBeUndefined();
  expect(dialog.isConnected && dialog.textContent).toMatch(/Paired\. Threads on this machine reach Nomos/);
  expect(button(dialog, 'Done')).toBeDefined();
});

it('says why a failed pairing failed, and keeps the card as it was', async () => {
  pairAnswer = { ok: false, failed: 'turn', detail: 'No answer within 60 seconds.' };
  await render(agent('https://nomos.example.com'));
  await act(async () => button(host, 'Pair this machine')!.click());
  await tick();
  const dialog = document.querySelector('dialog')!;
  const input = dialog.querySelector('input[aria-label="Pairing code"]') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, 'GB8Z-DP5J-0TGX-R608-WYSB-WV2T-G8SV');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button(dialog, 'Pair')!.click());
  await tick();
  expect(dialog.textContent).toMatch(/The test turn failed: No answer within 60 seconds\./);
  expect(changed).toBe(0);
  expect(button(dialog, 'Cancel')).toBeDefined();
});
