// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Thread } from '../src/api.ts';

vi.mock('../src/store.tsx', () => ({ useApp: () => ({ channels: [], crew: [], status: null }), useFeed: () => {}, useCrewRoles: () => [] }));

import { ReplyComposer } from '../src/components/Composer.tsx';
import { MoComposer } from '../src/mobile/MoComposer.tsx';
import { messageBox, typeIn } from './message-box.ts';

// Both reply composers, desktop and phone, do the same with a message that starts with a command: an Omni command runs
// on Send (packages/shared/composer-slash.ts), and a harness command goes to the thread as typed, for the server to run.

const thread = { id: 't1', channel_id: 'c1', title: 'A thread', status: 'done', role: null, auto_reason: null, harness: 'claude-code', model: 'claude-sonnet-5-5', effort: 'high' } as Thread;
const harnesses = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    available: true,
    capabilities: { steer: true },
    models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['high'], defaultEffort: 'high', default: true }],
  },
];
const commands = { status: 'ready', fetchedAt: 1, commands: [{ name: 'tdd', source: 'personal', description: 'Test first', mentionable: true }] };

let root: Root;
let host: HTMLDivElement;
let calls: { method: string; url: string; body: unknown }[];
let changed: Thread[];
let opened: unknown[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  calls = [];
  changed = [];
  opened = [];
  window.location.hash = '#/t/t1';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/harnesses')) return Response.json(harnesses);
      if (url.startsWith('/api/commands')) return Response.json(commands);
      // What else the composer reads (accounts) is not under test.
      if (method === 'GET') return Response.json({ error: 'not found' }, { status: 404 });
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url === '/api/threads/t1' && method === 'PATCH') return Response.json({ ...thread, title: 'Release notes' });
      if (url === '/api/threads' && method === 'POST') return Response.json({ ...thread, id: 't2' });
      if (url === '/api/threads/t1/messages' && method === 'POST') return Response.json(thread);
      throw new Error(`Unexpected request: ${method} ${url}`);
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
  await act(async () =>
    root.render(
      phone
        ? createElement(MoComposer, {
            thread,
            chips: [],
            placeholder: 'Follow up',
            onSent: () => {},
            onChanged: (t: Thread) => void changed.push(t),
            onFork: () => {},
            onNewThread: (run: unknown) => void opened.push(run),
          })
        : createElement(ReplyComposer, { thread, onChanged: (t: Thread) => void changed.push(t) }),
    ),
  );
};

const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name);
const typed = async (text: string) => {
  await typeIn(messageBox(host)!, text);
  // The command list loads when the box takes focus.
  await act(async () => {});
};

describe.each([false, true])('a command in the reply box, phone=%s', (phone) => {
  it('/rename renames the thread on Send, and the box empties', async () => {
    await mount(phone);
    await typed('/rename Release notes');
    expect(button('Rename')?.disabled).toBe(false);
    await act(async () => button('Rename')!.click());
    expect(calls).toEqual([{ method: 'PATCH', url: '/api/threads/t1', body: { title: 'Release notes' } }]);
    expect(changed.map((t) => t.title)).toEqual(['Release notes']);
    expect(messageBox(host)!.textContent).toBe('');
  });

  it('/rename with no title says what is missing and does not send', async () => {
    await mount(phone);
    // The space closes the `/` menu, which hides the hint while it is open.
    await typed('/rename ');
    expect(button('Rename')?.disabled).toBe(true);
    expect(host.textContent).toContain('Type the new title after /rename.');
  });

  it('/clear with a prompt starts a thread with the same settings and opens it', async () => {
    await mount(phone);
    await typed('/clear Start over');
    await act(async () => button('New thread')!.click());
    expect(calls).toEqual([{ method: 'POST', url: '/api/threads', body: { channel: 'c1', prompt: 'Start over', harness: 'claude-code', model: 'claude-sonnet-5-5', effort: 'high' } }]);
    expect(window.location.hash).toBe('#/t/t2');
  });

  it('a harness command goes to the thread as typed', async () => {
    await mount(phone);
    await typed('/tdd write the cart test');
    await act(async () => button('Send')!.click());
    expect(calls).toEqual([{ method: 'POST', url: '/api/threads/t1/messages', body: expect.objectContaining({ prompt: '/tdd write the cart test' }) }]);
  });
});

describe('a command in the phone reply box', () => {
  it('/clear on its own opens the New sheet set to the thread run, and sends nothing', async () => {
    await mount(true);
    await typed('/clear');
    await act(async () => button('New thread')!.click());
    expect(opened).toEqual([{ choice: { harness: 'claude-code', model: 'claude-sonnet-5-5' }, effort: 'high' }]);
    expect(calls).toEqual([]);
  });

  it('/model opens the model sheet', async () => {
    await mount(true);
    await typed('/model');
    await act(async () => button('Pick model')!.click());
    expect(host.textContent).toContain('Sonnet 5.5');
    expect(calls).toEqual([]);
  });
});
