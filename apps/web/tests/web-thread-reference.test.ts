// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readContexts } from '@omni/shared/message-context-kinds.ts';
import type { Thread } from '../src/api.ts';
import { attachReference, type ReferenceCandidate } from '../src/message-context/thread-picker.ts';

vi.mock('../src/store.tsx', () => ({ useApp: () => ({ channels: [], crew: [], status: null }) }));

import { ReplyComposer } from '../src/components/Composer.tsx';
import { ThreadReferenceButton, ThreadReferencePanel } from '../src/components/ThreadReference.tsx';
import { MoComposer } from '../src/mobile/MoComposer.tsx';
import { ContextInspector } from '../src/message-context/ContextChips.tsx';
import { addDraftContext, draftContext, settleDraftContext } from '../src/message-context/draft.ts';

// The thread reference picker in the thread header (a sheet on a phone): it searches this channel by default, offers other channels only
// from All channels, attaches a reference to the draft without displacing the `@` menu, and shows the captured identity.

const thread = { id: 't1', channel_id: 'shop', title: 'Asking', status: 'done', harness: 'claude-code', model: 'claude-sonnet-5-5', effort: 'high' } as Thread;
const harnesses = [
  { id: 'claude-code', name: 'Claude Code', available: true, capabilities: { steer: true }, models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['high'], defaultEffort: 'high', default: true }] },
];
const cand = (over: Partial<ReferenceCandidate> = {}): ReferenceCandidate => ({
  id: '7d3e91a0-5c2b-4e48-9f16-0a8b4c6d2e51',
  short_id: '7d3e91a0',
  title: 'Fix the cart total',
  channel: 'shop',
  channel_name: 'Shop',
  status: 'done',
  archived: false,
  updated_at: '2026-10-25T08:00:00.000Z',
  same_channel: true,
  ...over,
});
const same = cand();
const twin = cand({ id: '9b1c2d3e-0000-4000-8000-000000000001', short_id: '9b1c2d3e' });
const other = cand({ id: '1a2b3c4d-0000-4000-8000-000000000002', short_id: '1a2b3c4d', title: 'Nails page', channel: 'pink', channel_name: 'Pink Gellac', same_channel: false });

let root: Root;
let host: HTMLDivElement;
let searches: string[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  searches = [];
  settleDraftContext(thread.id, draftContext(thread.id).map((r) => r.id));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/thread-references')) {
        searches.push(url);
        const q = new URL(url, 'http://x').searchParams;
        const rows = q.get('scope') === 'all' ? [same, twin, other] : [same, twin];
        return Response.json(rows.filter((r) => `${r.title} ${r.channel_name}`.toLowerCase().includes((q.get('q') ?? '').toLowerCase())));
      }
      if (url.startsWith('/api/harnesses')) return Response.json(harnesses);
      if (url.startsWith('/api/commands')) return Response.json({ status: 'ready', commands: [] });
      if (url.startsWith('/api/mentions')) return Response.json([]);
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
        ? createElement(Fragment, null, createElement(MoComposer, { thread, chips: [], placeholder: 'Follow up', onSent: () => {}, onSwitched: () => {}, onFork: () => {} }), createElement(ThreadReferencePanel, { thread, touch: true, onPicked: () => {} }))
        : createElement(Fragment, null, createElement(ReplyComposer, { thread }), createElement(ThreadReferenceButton, { thread })),
    ),
  );
};
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const byText = (text: string) => [...host.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.includes(text));
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 200))));
const open = async (phone: boolean, typed = '') => {
  await mount(phone);
  if (typed) {
    const box = host.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, typed);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  if (!phone) await act(async () => button('Reference another thread')!.click());
  await settle();
};
const rows = () => [...host.querySelectorAll<HTMLElement>('[role="listitem"]')];

describe.each([false, true])('the picker, phone=%s', (phone) => {
  it('lists this channel first and attaches the pick as a chip, without touching the text or sending anything', async () => {
    await open(phone, 'look at');
    expect(searches.at(-1)).toContain('scope=channel');
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Fix the cart total'), expect.stringContaining('Fix the cart total')]);
    await act(async () => rows()[0].click());
    const [r] = readContexts(draftContext(thread.id));
    expect(r).toMatchObject({ as: 'known', kind: 'thread_reference', body: { thread: same.id, title: 'Fix the cart total', channel: 'shop', cross_channel: false } });
    expect(host.textContent).toContain('Thread: Fix the cart total (Shop · 7d3e91a0)');
    expect(host.querySelector('textarea')!.value).toBe('look at');
    // Only the draft changed: nothing was posted anywhere.
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('shows two threads of one title apart by their id', async () => {
    await open(phone);
    const texts = rows().map((r) => r.textContent!);
    expect(texts[0]).toContain('7d3e91a0');
    expect(texts[1]).toContain('9b1c2d3e');
  });

  it('offers another channel only from All channels, and marks the record cross-channel then', async () => {
    await open(phone);
    expect(rows().some((r) => r.textContent!.includes('Nails page'))).toBe(false);
    await act(async () => byText('All channels')!.click());
    await settle();
    expect(searches.at(-1)).toContain('scope=all');
    const nails = rows().find((r) => r.textContent!.includes('Nails page'))!;
    expect(nails.textContent).toContain('other channel');
    await act(async () => nails.click());
    expect(readContexts(draftContext(thread.id))[0]).toMatchObject({ body: { thread: other.id, channel: 'pink', cross_channel: true } });
  });

  it('does not add the same thread twice, and says so', async () => {
    addDraftContext(thread.id, (() => {
      expect(attachReference(thread.id, 'shop', same)).toBeNull();
      return draftContext(thread.id)[0];
    })());
    await open(phone);
    const first = rows()[0] as HTMLButtonElement;
    expect(first.disabled).toBe(true);
    expect(attachReference(thread.id, 'shop', same)).toBe('That thread is already attached.');
    expect(draftContext(thread.id)).toHaveLength(1);
  });

  it('says when nothing matches', async () => {
    await open(phone);
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'zzz');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
    expect(host.textContent).toContain('No thread matches.');
  });
});

describe('a sent reference', () => {
  it('shows the captured title and channel and links to the thread', async () => {
    attachReference(thread.id, 'shop', other);
    const [r] = readContexts(draftContext(thread.id));
    await act(async () => root.render(createElement(ContextInspector, { reading: r })));
    expect(host.textContent).toContain('Nails page');
    expect(host.textContent).toContain('Pink Gellac');
    expect(host.textContent).toContain('other channel');
    expect(host.querySelector('a')!.getAttribute('href')).toBe(`#/t/${other.id}`);
  });

  it('keeps the title it was sent with when the record is read again', async () => {
    attachReference(thread.id, 'shop', same);
    const [r] = readContexts(draftContext(thread.id));
    expect(r.as === 'known' && r.kind === 'thread_reference' && r.body.title).toBe('Fix the cart total');
  });
});
