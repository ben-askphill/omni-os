// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { diffSelection, selectRows } from '@omni/shared/message-context-diff.ts';
import { newContext } from '@omni/shared/message-context.ts';
import type { Thread } from '../src/api.ts';
import { parseDiff } from '../src/diff.ts';

vi.mock('../src/store.tsx', () => ({ useApp: () => ({ channels: [], crew: [], status: null }) }));

import { ReplyComposer } from '../src/components/Composer.tsx';
import { MoComposer } from '../src/mobile/MoComposer.tsx';
import { addDraftContext, draftContext, settleDraftContext } from '../src/message-context/draft.ts';

// Both reply composers send the thread's drafted context with the message, can send it with no text, and drop only
// what the send carried.

const [file] = parseDiff(
  'diff --git a/src/cart.ts b/src/cart.ts\nindex fa9fb2e..a31fcc1 100644\n--- a/src/cart.ts\n+++ b/src/cart.ts\n@@ -1,3 +1,3 @@\n export function total(items: number[]) {\n-  return items.reduce((a, b) => a + b, 0);\n+  return items.reduce((sum, n) => sum + n, 0);\n }\n',
);
const picked = selectRows({ ...file, old_path: null }, 1, 4, { group: 'unstaged', from: '9f2c1e4b7a0d', to: '3f2a1c9b8e7d', turn: null });
if (!picked.ok) throw new Error(picked.error);
const body = picked.value;
let n = 0;
const record = (note: string) => newContext(diffSelection, body, note, { id: () => `ctx-${++n}` });

const thread = { id: 't1', channel_id: 'c1', title: 'A thread', status: 'done', harness: 'claude-code', model: 'claude-sonnet-5-5', effort: 'high' } as Thread;
const harnesses = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    available: true,
    capabilities: { steer: true },
    models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['high'], defaultEffort: 'high', default: true }],
  },
];

let root: Root;
let host: HTMLDivElement;
let sent: Record<string, unknown>[];
let answer: (() => void) | null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  sent = [];
  answer = null;
  settleDraftContext(thread.id, draftContext(thread.id).map((r) => r.id));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/threads/${thread.id}/messages` && init?.method === 'POST') {
        sent.push(JSON.parse(init.body as string));
        if (answer === null) return Response.json(thread);
        return new Promise<Response>((res) => (answer = () => res(Response.json(thread))));
      }
      if (url.startsWith('/api/harnesses')) return Response.json(harnesses);
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
  await act(async () =>
    root.render(
      phone
        ? createElement(MoComposer, { thread, chips: [], placeholder: 'Follow up', onSent: () => {}, onSwitched: () => {} })
        : createElement(ReplyComposer, { thread }),
    ),
  );
};

const sendButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
const textarea = () => host.querySelector('textarea')!;

const type = async (value: string) => {
  const input = textarea();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe.each([false, true])('a reply with context, phone=%s', (phone) => {
  it('sends drafted context with no text, then clears it from the draft', async () => {
    const a = record('this reduce reads better with names');
    addDraftContext(thread.id, a);
    await mount(phone);
    expect(host.textContent).toContain('src/cart.ts:1-3');
    expect(sendButton()?.disabled).toBe(false);
    await act(async () => sendButton()!.click());
    expect(sent).toEqual([{ prompt: '', context: [a], request_id: expect.any(String) }]);
    expect(draftContext(thread.id)).toEqual([]);
    expect(host.textContent).not.toContain('src/cart.ts:1-3');
  });

  it('leaves the text being written alone when context is added', async () => {
    await mount(phone);
    await type('look at this');
    expect(sendButton()?.disabled).toBe(false);
    await act(async () => void addDraftContext(thread.id, record('')));
    expect(textarea().value).toBe('look at this');
    expect(host.querySelector('button[aria-label="Remove src/cart.ts:1-3"]')).toBeTruthy();
  });

  it('keeps a record added while the send was in flight', async () => {
    const [a, b] = [record('first'), record('second')];
    addDraftContext(thread.id, a);
    await mount(phone);
    await type('fix it');
    answer = () => {};
    await act(async () => sendButton()!.click());
    expect(sent).toEqual([{ prompt: 'fix it', context: [a], request_id: expect.any(String) }]);
    await act(async () => void addDraftContext(thread.id, b));
    await act(async () => answer!());
    expect(draftContext(thread.id)).toEqual([b]);
    expect(textarea().value).toBe('');
  });

  it('removes a chip from the draft', async () => {
    addDraftContext(thread.id, record(''));
    await mount(phone);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Remove src/cart.ts:1-3"]')!.click());
    expect(draftContext(thread.id)).toEqual([]);
    expect(sendButton()?.disabled ?? true).toBe(true);
  });

  it('sends no context key without context', async () => {
    await mount(phone);
    await type('plain');
    await act(async () => sendButton()!.click());
    expect(sent).toEqual([{ prompt: 'plain', request_id: expect.any(String) }]);
  });
});
