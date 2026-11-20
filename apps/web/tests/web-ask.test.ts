// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { buildItems } from '@omni/shared/transcript-fold.ts';
import type { Thread } from '../src/api.ts';

// Ask from a thread in both reply composers (desktop and phone): a message that starts with `@<role>` shows the Ask
// chip and goes to the role through POST /threads/:id/ask, never to this thread's agent; the `@` menu lists the roles
// only at the start of a message; the chip's choices go with it; a channel that keeps excerpts from remote agents
// says so in place of the toggle. And a sent Ask's "Just show it" answer belongs on its card.

const ROLES = [
  { id: 'hermes-box', name: 'Hermes on box', harness: 'custom:hermes-box', delegatable: true, delegateOnly: false, hidden: false },
  { id: 'researcher', name: 'Researcher', harness: 'claude-code', delegatable: true, delegateOnly: false, hidden: false },
  { id: 'conductor', name: 'Conductor', harness: 'claude-code', delegatable: false, delegateOnly: true, hidden: false },
];
vi.mock('../src/store.tsx', () => ({ useApp: () => ({ channels: [], crew: [], status: null }), useFeed: () => {}, useCrewRoles: () => ROLES }));

import { ReplyComposer } from '../src/components/Composer.tsx';
import { MoComposer } from '../src/mobile/MoComposer.tsx';
import { shownAnswers } from '../src/transcript/delegation.ts';
import { messageBox, typeIn } from './message-box.ts';

const thread = { id: 't1', channel_id: 'c1', title: 'A thread', status: 'done', harness: 'claude-code', model: 'claude-sonnet-5-5', effort: 'high', role: null } as unknown as Thread;
const harnesses = [{ id: 'claude-code', name: 'Claude Code', available: true, capabilities: { steer: true }, models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['high'], defaultEffort: 'high', default: true }] }];

let root: Root;
let host: HTMLDivElement;
let asks: Record<string, unknown>[];
let messages: unknown[];
let excerpt: Record<string, unknown>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  asks = [];
  messages = [];
  excerpt = { allowed: true, entries: 3, total: 9, chars: 1200, text: '<thread-excerpt>…</thread-excerpt>' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/threads/${thread.id}/ask` && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        asks.push(body);
        return Response.json({ thread_id: 'child', ask: {} }, { status: 201 });
      }
      if (url.startsWith(`/api/threads/${thread.id}/ask-preview?role=`)) return Response.json({ role: {}, excerpt });
      if (url === `/api/threads/${thread.id}/messages`) {
        messages.push(init?.body);
        return Response.json(thread);
      }
      if (url.startsWith('/api/mentions')) return Response.json([]);
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

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));
const mount = async (phone: boolean) => {
  await act(async () =>
    root.render(phone ? createElement(MoComposer, { thread, chips: [], placeholder: 'Follow up', onSent: () => {}, onSwitched: () => {}, onFork: () => {} }) : createElement(ReplyComposer, { thread })),
  );
};
const textarea = () => messageBox(host)!;
const type = async (value: string) => {
  await typeIn(textarea(), value);
  await settle();
};
const askButton = () => [...host.querySelectorAll('button')].find((b) => /^Ask\b/.test(b.getAttribute('aria-label') ?? ''))!;
/** Each `@` menu row: its name, and whether it is marked Remote. */
const options = () => [...document.querySelectorAll('[role="option"]')].map((o) => [o.querySelector('.font-medium')?.textContent, o.textContent?.endsWith('Remote')]);

describe.each([false, true])('an Ask from the reply box, phone=%s', (phone) => {
  it('turns a message that starts with a role into an Ask: the chip says so, and it goes to the role, not this thread', async () => {
    await mount(phone);
    await type('@hermes-box what do the logs say?');
    const chip = host.querySelector('[data-ask-chip]')!;
    expect(chip.textContent).toContain('Ask Hermes on box (remote)');
    expect(chip.textContent).toContain('Remote');
    expect(chip.querySelector('[data-excerpt-size]')?.textContent).toBe('Thread excerpt: last 3 of 9 messages, 1.2k characters');
    await act(async () => askButton().click());
    expect(asks).toEqual([{ role: 'hermes-box', question: 'what do the logs say?', excerpt: true, wake: true, request_id: expect.any(String) }]);
    expect(messages).toEqual([]);
    expect(textarea().textContent).toBe('');
  });

  it('sends Just show it and no excerpt when Ben picks them', async () => {
    await mount(phone);
    await type('@researcher check the README');
    const chip = host.querySelector('[data-ask-chip]')!;
    await act(async () => chip.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    await act(async () => [...chip.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === 'Just show it')!.click());
    expect(chip.textContent).not.toContain('(remote)');
    await act(async () => askButton().click());
    expect(asks).toEqual([{ role: 'researcher', question: 'check the README', excerpt: false, wake: false, request_id: expect.any(String) }]);
  });

  it('says the channel sends no excerpts to remote agents, in place of the toggle', async () => {
    excerpt = { allowed: false, reason: '#client sends no thread excerpts to remote agents (Channel settings).', entries: 0, total: 0, chars: 0, text: '' };
    await mount(phone);
    await type('@hermes-box anything?');
    const chip = host.querySelector('[data-ask-chip]')!;
    expect(chip.querySelector('[data-excerpt-off]')?.textContent).toBe('#client sends no thread excerpts to remote agents (Channel settings).');
    expect(chip.querySelector('[role="switch"]')).toBeNull();
  });

  it('lists the roles Ben can ask in the @ menu at the start of a message only, remote ones first', async () => {
    await mount(phone);
    await type('@');
    expect(options()).toEqual([
      ['Hermes on box', true],
      ['Researcher', false],
    ]);
    await type('see @re');
    expect(options()).toEqual([]);
    expect(host.querySelector('[data-ask-chip]')).toBeNull();
  });
});

describe('a sent Ask in the transcript', () => {
  it('puts a Just show it answer on the Ask card, and leaves a woken answer as its own report', () => {
    const ev = (id: number, kind: string, payload: unknown) => ({ id, thread_id: 't1', kind, payload: JSON.stringify(payload), created_at: '2026-11-19T10:00:00.000Z' });
    const ask = { thread_id: 'child', role: 'researcher', name: 'Researcher', harness: 'claude-code', harness_name: 'Claude Code', remote: false, question: 'Check it', excerpt: null, wake: false, title: 'Ask: Check it', channel: 'c1' };
    const { items } = buildItems([ev(1, 'user', { text: 'hi' }), ev(2, 'ask', ask), ev(3, 'crew_report', { thread_id: 'child', text: 'Checked.', shown: true, quiet: true, ask: true })]);
    expect(items.map((it) => it.type)).toEqual(['user', 'ask', 'report']);
    expect(shownAnswers(items).get('child')).toMatchObject({ text: 'Checked.' });
    const woken = buildItems([ev(1, 'user', { text: 'hi' }), ev(2, 'ask', { ...ask, wake: true }), ev(3, 'crew_report', { thread_id: 'child', text: 'Checked.', ask: true })]).items;
    expect(shownAnswers(woken).size).toBe(0);
  });
});
