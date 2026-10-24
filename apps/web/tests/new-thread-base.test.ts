// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Channel, CrewRole } from '../src/api.ts';

const state = vi.hoisted(() => ({ channels: [] as Channel[], crew: [] as CrewRole[] }));
vi.mock('../src/store.tsx', () => ({ useApp: () => ({ ...state, status: null }) }));
vi.mock('../src/mobile/shell.tsx', () => ({ useShell: () => ({ open: vi.fn(), sheet: vi.fn() }) }));

import { NewThreadComposer } from '../src/components/Composer.tsx';
import { NewSheet } from '../src/mobile/NewSheet.tsx';

// Choosing the base of a new worktree thread, on the desktop composer and the phone sheet (apps/web/src/components/BasePicker.tsx).

const harnesses = [{
  id: 'claude-code', name: 'Claude Code', available: true, plan: 'Claude plan', models: [
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['high'], defaultEffort: 'high', default: true },
  ],
}];
const bases = {
  available: true,
  head: { ref: 'main', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' },
  refs: [{ ref: 'release/1.2', kind: 'branch', sha: 'b'.repeat(40), current: false }],
  remote: { remote: 'origin', branch: 'main', sha: null },
};

let root: Root;
let host: HTMLDivElement;
let requests: Record<string, unknown>[];
let failNext: string | null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  requests = [];
  failNext = null;
  state.channels = [{ id: 'web', name: 'web', kind: 'system', default_model: 'claude-sonnet-5-5' }] as Channel[];
  state.crew = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/threads' && init?.method === 'POST') {
      requests.push(JSON.parse(init.body as string));
      if (failNext) return Response.json({ error: failNext }, { status: 400 });
      return Response.json({ id: 'created' });
    }
    if (url.startsWith('/api/harnesses')) return Response.json(harnesses);
    if (url.startsWith('/api/commands')) return Response.json({ status: 'ready', commands: [] });
    if (url === '/api/channels/web/bases') return Response.json(bases);
    throw new Error(`Unexpected request: ${url}`);
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const buttons = () => [...host.querySelectorAll('button')];
const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
};
const type = async (text: string) => {
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe.each([false, true])('base of a new thread, phone=%s', (phone) => {
  const mount = async () => {
    await act(async () => root.render(phone ? createElement(NewSheet, { channel: 'web' }) : createElement(NewThreadComposer, { channelId: 'web' })));
  };
  const open = () => click(host.querySelector('button[aria-label^="Base:"]'));
  const choose = async (label: string) => {
    await open();
    await click(phone ? buttons().find((b) => b.textContent?.startsWith(label)) : [...host.querySelectorAll('[role="option"]')].find((o) => o.textContent?.startsWith(label)));
  };
  const send = () => click(phone ? host.querySelector('button[aria-label="Send"]') : buttons().find((b) => b.textContent === 'Start'));

  it('shows the current checkout as the default and leaves base out of the request', async () => {
    await mount();
    expect(host.querySelector('button[aria-label="Base: main · a1b2c3d"]')).toBeTruthy();
    await type('Fix it');
    await send();
    expect(requests).toEqual([expect.not.objectContaining({ base: expect.anything() })]);
  });

  it.each([
    ['origin/main', { kind: 'remote-default' }],
    ['release/1.2', { kind: 'ref', ref: 'release/1.2' }],
  ])('sends %s as the base', async (label, base) => {
    await mount();
    await choose(label);
    await type('Fix it');
    await send();
    expect(requests[0].base).toEqual(base);
  });

  it('keeps the draft, the pick and the server error when the base is refused', async () => {
    failNext = 'No branch named "release/1.2".';
    await mount();
    await choose('release/1.2');
    await type('Fix it');
    await send();
    expect(host.textContent).toContain('No branch named "release/1.2".');
    expect(host.querySelector('textarea')!.value).toBe('Fix it');
    expect(host.querySelector('button[aria-label="Base: release/1.2 · bbbbbbb"]')).toBeTruthy();
  });
});
