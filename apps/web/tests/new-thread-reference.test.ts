// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MessageContext } from '@omni/shared/message-context.ts';
import type { Channel, CrewRole } from '../src/api.ts';
import type { ReferenceCandidate } from '../src/message-context/thread-picker.ts';

// Referencing a thread from the new-thread composer (desktop, and the phone's New sheet): the picker searches from the
// channel the thread will start in, a pick shows as a removable chip, and Start sends the reference with the first
// message, the same thread_reference record a reply carries. Nothing is ever posted to the referenced thread.

const state = vi.hoisted(() => ({ channels: [] as Channel[], crew: [] as CrewRole[] }));
vi.mock('../src/store.tsx', () => ({ useApp: () => ({ ...state, status: null }), useHereName: () => undefined, useFeed: () => {} }));
const shell = vi.hoisted(() => ({ open: vi.fn(), sheet: vi.fn(), toast: vi.fn() }));
vi.mock('../src/mobile/shell.tsx', () => ({ useShell: () => shell }));

import { NewThreadComposer } from '../src/components/Composer.tsx';
import { NewSheet, NEW_SHEET_DRAFT } from '../src/mobile/NewSheet.tsx';
import { clearDraftContext, draftContext } from '../src/message-context/draft.ts';
import { attachReference, referencesFor } from '../src/message-context/thread-picker.ts';
import { messageBox, typeIn } from './message-box.ts';

const harnesses = [
  { id: 'claude-code', name: 'Claude Code', available: true, models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['high'], defaultEffort: 'high', default: true }] },
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
const cart = cand();
const nails = cand({ id: '1a2b3c4d-0000-4000-8000-000000000002', short_id: '1a2b3c4d', title: 'Nails page', channel: 'pink', channel_name: 'Pink Gellac', same_channel: false });

let root: Root;
let host: HTMLDivElement;
let searches: string[];
let posts: { url: string; body: Record<string, unknown> }[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  searches = [];
  posts = [];
  for (const key of ['new:shop', 'new:*', NEW_SHEET_DRAFT]) clearDraftContext(key);
  state.channels = [
    { id: 'conductor', name: 'Conductor', kind: 'system' },
    { id: 'shop', name: 'Shop', kind: 'internal' },
    { id: 'pink', name: 'Pink Gellac', kind: 'internal' },
  ] as Channel[];
  state.crew = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method && init.method !== 'GET') {
        posts.push({ url, body: JSON.parse(init.body as string) });
        return Response.json({ id: 'created', channel_id: 'shop' });
      }
      if (url.startsWith('/api/thread-references')) {
        searches.push(url);
        const q = new URL(url, 'http://x').searchParams;
        const rows = q.get('scope') === 'all' ? [cart, nails] : [cart];
        return Response.json(rows.filter((r) => `${r.title} ${r.channel_name}`.toLowerCase().includes((q.get('q') ?? '').toLowerCase())));
      }
      if (url.startsWith('/api/harnesses')) return Response.json(harnesses);
      // The quick ask the sheet asked, answered.
      if (url.startsWith('/api/threads/created'))
        return Response.json({
          thread: { id: 'created', channel_id: 'shop', status: 'done', quick: 1, promoted_to: null },
          events: [
            { id: 1, kind: 'user', payload: JSON.stringify({ text: 'what is the cart total?' }) },
            { id: 2, kind: 'assistant_text', payload: JSON.stringify({ text: 'It is 42 euro.' }) },
          ],
        });
      if (url.startsWith('/api/channels/')) return Response.json({ available: false, reason: 'No repository.' });
      if (url.startsWith('/api/commands')) return Response.json({ status: 'ready', commands: [] });
      return Response.json({ error: 'not here' }, { status: 404 });
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

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 200))));
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
};
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const byText = (text: string) => [...host.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.includes(text));
const rows = () => [...host.querySelectorAll<HTMLElement>('[role="listitem"]')];
const type = async (el: HTMLElement, value: string) => {
  if (!(el instanceof HTMLInputElement)) return typeIn(el, value);
  const proto = HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const CHIP = `Thread: Fix the cart total (Shop · 7d3e91a0)`;
const sent = () => {
  expect(posts).toHaveLength(1);
  expect(posts[0].url).toBe('/api/threads');
  return posts[0].body;
};

describe.each([false, true])('referencing a thread from the new-thread composer, phone=%s', (phone) => {
  const mount = async () => {
    await act(async () => root.render(phone ? createElement(NewSheet, { channel: 'shop' }) : createElement(NewThreadComposer, { channelId: 'shop' })));
    // The sheet opens on Ask; this starts a thread.
    if (phone) await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Task') ?? null);
  };
  const draft = phone ? NEW_SHEET_DRAFT : 'new:shop';
  const start = () => click(phone ? button('Send') : byText('Start'));

  it('searches the channel the thread will start in, attaches a pick as a chip, and sends it with the first message', async () => {
    await mount();
    await click(button('Reference a thread'));
    await settle();
    // No thread exists yet, so the search runs from the channel and leaves no thread out.
    expect(searches.at(-1)).toBe('/api/thread-references?channel=shop&q=&scope=channel');
    await type(host.querySelector<HTMLInputElement>('input[type="search"]')!, 'cart');
    await settle();
    expect(searches.at(-1)).toBe('/api/thread-references?channel=shop&q=cart&scope=channel');
    await click(rows()[0]);
    // The picker closes and the chip sits in the composer, removable.
    expect(rows()).toHaveLength(0);
    expect(host.textContent).toContain(CHIP);
    expect(button(`Remove ${CHIP}`)).toBeTruthy();
    // Picking adds to the draft only: nothing went anywhere yet, least of all to the referenced thread.
    expect(posts).toHaveLength(0);

    await type(messageBox(host)!, 'Pick up where that thread left off');
    await start();
    const body = sent();
    expect(body).toMatchObject({ channel: 'shop', prompt: 'Pick up where that thread left off' });
    const [record] = body.context as MessageContext[];
    expect(body.context).toHaveLength(1);
    expect(record).toMatchObject({ kind: 'thread_reference', v: 1, label: CHIP, body: { thread: cart.id, title: 'Fix the cart total', channel: 'shop', channel_name: 'Shop', cross_channel: false } });
    // Sent: the chip leaves the composer's draft.
    expect(draftContext(draft)).toHaveLength(0);
  });

  it('removes a chip with its x, and then starts the thread without a reference', async () => {
    await mount();
    await click(button('Reference a thread'));
    await settle();
    await click(rows()[0]);
    await click(button(`Remove ${CHIP}`));
    expect(host.textContent).not.toContain(CHIP);
    await type(messageBox(host)!, 'No reference after all');
    await start();
    expect(sent()).not.toHaveProperty('context');
  });

  it('attaches a thread of another channel from All channels, marked as cross-channel', async () => {
    await mount();
    await click(button('Reference a thread'));
    await settle();
    expect(rows().some((r) => r.textContent!.includes('Nails page'))).toBe(false);
    await click(byText('All channels'));
    await settle();
    expect(searches.at(-1)).toBe('/api/thread-references?channel=shop&q=&scope=all');
    await click(rows().find((r) => r.textContent!.includes('Nails page')));
    await type(messageBox(host)!, 'Compare with the nails page');
    await start();
    expect((sent().context as MessageContext[])[0]).toMatchObject({ body: { thread: nails.id, channel: 'pink', cross_channel: true } });
  });
});

describe('the Home composer, whose channel can change after a pick', () => {
  it('sends each reference as cross-channel or not for the channel the thread starts in', async () => {
    await act(async () => root.render(createElement(NewThreadComposer, { templateChips: false })));
    // It opens on the Conductor: start it in Shop first.
    await click(host.querySelector('button[aria-label^="Channel:"]'));
    await click([...host.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Shop')));
    await click(button('Reference a thread'));
    await settle();
    expect(searches.at(-1)).toBe('/api/thread-references?channel=shop&q=&scope=channel');
    await click(rows()[0]);
    // Now start it in Pink Gellac instead: the chip, which names Shop, goes as a reference to another channel.
    await click(host.querySelector('button[aria-label^="Channel:"]'));
    await click([...host.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Pink Gellac')));
    await type(messageBox(host)!, 'Port the fix');
    await click(byText('Start'));
    const body = sent();
    expect(body.channel).toBe('pink');
    expect((body.context as MessageContext[])[0]).toMatchObject({ body: { thread: cart.id, channel: 'shop', cross_channel: true } });
  });

  it('referencesFor sets cross_channel for the channel given and leaves the rest of the record alone', () => {
    const at = new Date('2026-11-16T10:00:00.000Z');
    for (const c of [cart, nails]) expect(attachReference({ draft: 'new:*', channel: 'shop' }, c, at)).toBeNull();
    const picked = draftContext('new:*');
    expect(picked.map((r) => (r.body as { cross_channel: boolean }).cross_channel)).toEqual([false, true]);
    const inPink = referencesFor(picked, 'pink');
    expect(inPink.map((r) => (r.body as { cross_channel: boolean }).cross_channel)).toEqual([true, false]);
    expect(inPink.map(({ id, label, note }) => ({ id, label, note }))).toEqual(picked.map(({ id, label, note }) => ({ id, label, note })));
    expect(referencesFor(picked, 'shop')).toEqual(picked);
  });
});

describe('the phone New sheet', () => {
  it('asks by default: a quick ask with the reference, answered in the sheet with a follow-up box', async () => {
    vi.stubGlobal('EventSource', class { close() {} addEventListener() {} });
    await act(async () => root.render(createElement(NewSheet, { channel: 'shop' })));
    await click(button('Reference a thread'));
    await settle();
    await click(rows()[0]);
    await type(messageBox(host)!, 'what is the cart total?');
    await click(button('Send'));
    await settle();
    expect(sent()).toMatchObject({ channel: 'shop', prompt: 'what is the cart total?', quick: true, context: [expect.objectContaining({ kind: 'thread_reference' })] });
    expect(shell.open).not.toHaveBeenCalled();
    expect(host.textContent).toContain('It is 42 euro.');
    expect(host.querySelector('textarea[aria-label="Follow-up"]')).toBeTruthy();
    for (const label of ['Copy', 'Keep as thread', 'Make it a task']) expect(byText(label)).toBeTruthy();
  });

  it('starts with no chips and drops them when it closes', async () => {
    await act(async () => root.render(createElement(NewSheet, { channel: 'shop' })));
    await click(button('Reference a thread'));
    await settle();
    await click(rows()[0]);
    expect(draftContext(NEW_SHEET_DRAFT)).toHaveLength(1);
    await act(async () => root.render(createElement('div')));
    expect(draftContext(NEW_SHEET_DRAFT)).toHaveLength(0);
  });
});
