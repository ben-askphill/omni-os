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

const harnesses = [{
  id: 'claude-code', name: 'Claude Code', available: true, plan: 'Claude plan', models: [
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['high'], defaultEffort: 'high', default: true },
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['high'], defaultEffort: 'high' },
  ],
}];

let root: Root;
let host: HTMLDivElement;
let requests: Record<string, unknown>[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  requests = [];
  state.channels = [{ id: 'conductor', name: 'Conductor', kind: 'system', default_model: 'auto' }] as Channel[];
  state.crew = [{ id: 'conductor', name: 'Conductor', model: 'claude-opus-5-5' }] as CrewRole[];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/threads' && init?.method === 'POST') {
      requests.push(JSON.parse(init.body as string));
      return Response.json({ id: 'created' });
    }
    if (url.startsWith('/api/harnesses')) return Response.json(harnesses);
    if (url.startsWith('/api/commands')) return Response.json({ status: 'ready', commands: [] });
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

const mount = async (phone: boolean) => {
  await act(async () => root.render(phone ? createElement(NewSheet) : createElement(NewThreadComposer, { channelId: 'conductor' })));
};

const click = async (button: Element | undefined | null) => {
  expect(button).toBeTruthy();
  await act(async () => (button as HTMLElement).click());
};

const typeAndSend = async (phone: boolean) => {
  const input = host.querySelector('textarea')!;
  await act(async () => {
    // Use the native setter so React sees the input event as an edit.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Fix the typo');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(phone ? host.querySelector('button[aria-label="Send"]') : [...host.querySelectorAll('button')].find((b) => b.textContent === 'Start'));
  expect(requests).toHaveLength(1);
  return requests[0];
};

describe.each([false, true])('serialized new-thread submission, phone=%s', (phone) => {
  it.each(['auto', 'claude-sonnet-5-5', 'claude-retired-1'])('leaves an untouched %s default for server resolution', async (model) => {
    state.channels[0].default_model = model;
    await mount(phone);
    expect(await typeAndSend(phone)).toEqual({ channel: 'conductor', prompt: 'Fix the typo', role: 'conductor' });
  });

  it('updates an untouched picker after settings change and keeps an explicit draft choice', async () => {
    await mount(phone);
    state.channels = [{ ...state.channels[0], default_model: 'claude-sonnet-5-5' }];
    await mount(phone);
    expect(host.textContent).toContain('Sonnet 5.5');
    if (phone) {
      await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Sonnet 5.5 · high'));
      await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Opus 5.5'));
      await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Done'));
    } else {
      await click(host.querySelector('button[aria-label^="Model:"]'));
      await click([...host.querySelectorAll('[role="option"]')].find((b) => b.textContent === 'Opus 5.5'));
    }
    state.channels = [{ ...state.channels[0], default_model: 'auto' }];
    await mount(phone);
    expect(host.textContent).toContain('Opus 5.5');
    expect(await typeAndSend(phone)).toEqual({
      channel: 'conductor', prompt: 'Fix the typo', role: 'conductor', harness: 'claude-code', model: 'claude-opus-5-5',
    });
  });
});
