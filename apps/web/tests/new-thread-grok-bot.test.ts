// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Channel, CrewRole } from '../src/api.ts';

// Grok Bot on the new-thread Machine chip, desktop composer and phone sheet: the text goes to POST /api/grokbot (the
// route Send to Grok Bot uses) and no thread starts. The server's error shows as it is, and attachments stop the send.

const state = vi.hoisted(() => ({
  channels: [] as Channel[],
  crew: [] as CrewRole[],
  status: { grokBot: true } as { grokBot: boolean } | null,
  toasts: [] as string[],
  sheet: vi.fn(),
}));
vi.mock('../src/store.tsx', () => ({ useApp: () => ({ channels: state.channels, crew: state.crew, status: state.status }), useHereName: () => 'omarchy' }));
vi.mock('../src/mobile/shell.tsx', () => ({ useShell: () => ({ open: vi.fn(), sheet: state.sheet, toast: (t: string) => state.toasts.push(t) }) }));
vi.mock('../src/components/Toaster.tsx', () => ({ useToast: () => (t: { title: string }) => state.toasts.push(t.title) }));

import { NewThreadComposer } from '../src/components/Composer.tsx';
import { NewSheet } from '../src/mobile/NewSheet.tsx';

const harnesses = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    available: true,
    plan: 'Claude plan',
    models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['high'], defaultEffort: 'high', default: true }],
  },
];

let root: Root;
let host: HTMLDivElement;
let posts: { url: string; body: unknown }[];
let grokAnswer: () => Response;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  posts = [];
  state.toasts = [];
  state.sheet = vi.fn();
  state.status = { grokBot: true };
  grokAnswer = () => Response.json({ ok: true });
  state.channels = [
    { id: 'conductor', name: 'Conductor', kind: 'system', default_model: 'auto' },
    { id: 'omni-os', name: 'omni-os', kind: 'project', default_model: 'auto' },
  ] as Channel[];
  state.crew = [{ id: 'conductor', name: 'Conductor', model: 'auto' }] as CrewRole[];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(init.body as string) });
        return url === '/api/grokbot' ? grokAnswer() : Response.json({ id: 'created' });
      }
      if (url === '/api/devices') return Response.json([]);
      if (url === '/api/setup') return Response.json({ config: {} });
      if (url.startsWith('/api/harnesses')) return Response.json(harnesses);
      if (url.startsWith('/api/channels/')) return Response.json({ available: false, reason: 'No repository.' });
      if (url.startsWith('/api/commands')) return Response.json({ status: 'ready', commands: [] });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const mount = async (phone: boolean) => {
  await act(async () => root.render(phone ? createElement(NewSheet, { channel: 'omni-os' }) : createElement(NewThreadComposer, { channelId: 'omni-os' })));
};

const buttons = () => [...document.body.querySelectorAll('button')];

const click = async (button: Element | undefined | null) => {
  expect(button).toBeTruthy();
  await act(async () => (button as HTMLElement).click());
};

/** Open the Machine chip and pick a row by its label. */
const pick = async (label: string) => {
  await click(document.body.querySelector('button[aria-label^="Run on:"]'));
  await click(buttons().find((b) => b.textContent?.startsWith(label) && b.getAttribute('aria-label') === null));
};

const type = async (text: string) => {
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const sendButton = (phone: boolean) =>
  phone ? host.querySelector<HTMLButtonElement>('button[aria-label="Send to Grok Bot"]') : buttons().find((b) => b.textContent === 'Send') ?? null;

const attach = async () => {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(['hello'], 'shot.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
};

describe.each([false, true])('Grok Bot on the new-thread Machine chip, phone=%s', (phone) => {
  it('sends the text and the channel to /api/grokbot and starts no thread', async () => {
    await mount(phone);
    expect(document.body.querySelector('button[aria-label="Run on: omarchy"]')).toBeTruthy();
    await pick('Grok Bot');
    expect(document.body.querySelector('button[aria-label="Run on: Grok Bot"]')?.textContent).toContain('To');
    // The run's own pickers step aside: Grok Bot has no model.
    expect(host.textContent).not.toContain('Sonnet 5.5');
    expect(host.querySelector('textarea')!.placeholder).toBe('Message Grok Bot. Its reply comes back in Grok Bot, not here.');
    expect(host.textContent).toContain('No thread starts in Omni.');

    await type('  Check the cart drawer  ');
    await click(sendButton(phone));
    expect(posts).toEqual([{ url: '/api/grokbot', body: { request: 'Check the cart drawer', context: { channel_id: 'omni-os' } } }]);
    expect(state.toasts).toEqual(['Sent to Grok Bot']);
    if (phone) expect(state.sheet).toHaveBeenCalledWith(null);
    else expect(host.querySelector('textarea')!.value).toBe('');
  });

  it("shows the server's error and keeps the text", async () => {
    const reason = 'Grok Bot returned HTTP 401. Check that the Authorization value is the key from the Omni OS requests routine.';
    grokAnswer = () => Response.json({ error: reason }, { status: 502 });
    await mount(phone);
    await pick('Grok Bot');
    await type('Check the cart drawer');
    await click(sendButton(phone));
    expect(host.textContent).toContain(reason);
    expect(host.querySelector('textarea')!.value).toBe('Check the cart drawer');
    expect(state.toasts).toEqual([]);
    expect(posts.map((p) => p.url)).toEqual(['/api/grokbot']);
  });

  it('says Grok Bot takes text only and does not send while a file is attached', async () => {
    await mount(phone);
    await pick('Grok Bot');
    await type('Look at this');
    await attach();
    expect(host.textContent).toContain('Grok Bot takes text only. Remove the attachment to send.');
    expect(sendButton(phone)?.disabled).toBe(true);
    expect(posts).toEqual([]);
  });

  it('hides the chip with no other machine and no Grok Bot webhook, and starts threads as before', async () => {
    state.status = { grokBot: false };
    await mount(phone);
    expect(document.body.querySelector('button[aria-label^="Run on:"]')).toBeNull();
    await type('Fix the typo');
    await click(phone ? host.querySelector('button[aria-label="Send"]') : buttons().find((b) => b.textContent === 'Start'));
    expect(posts.map((p) => p.url)).toEqual(['/api/threads']);
  });
});
