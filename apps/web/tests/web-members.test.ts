// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { buildItems, memberLine } from '@omni/shared/transcript-fold.ts';
import type { ThreadMember } from '@omni/shared/members.ts';
import type { Thread } from '../src/api.ts';

// Group threads in the Web UI (ADR 0019): both reply composers name the lead, say who a message with an `@` goes to and
// send an agent mention with it, a read-only thread says why and sends nothing, the header's member list removes and
// adds agents, and the transcript shows joined and left lines and keeps old Ask cards' answers on them.

const ROLES = [
  { id: 'lead', name: 'Builder', harness: 'claude-code', delegatable: true, delegateOnly: false, hidden: false },
  { id: 'designer', name: 'Designer', harness: 'claude-code', delegatable: true, delegateOnly: false, hidden: false },
  { id: 'critic', name: 'Critic', harness: 'codex', delegatable: true, delegateOnly: false, hidden: false },
  { id: 'conductor', name: 'Conductor', harness: 'claude-code', delegatable: false, delegateOnly: true, hidden: false },
];
vi.mock('../src/store.tsx', () => ({ useApp: () => ({ channels: [], crew: [], status: null }), useFeed: () => {}, useCrewRoles: () => ROLES }));

import { ReplyComposer } from '../src/components/Composer.tsx';
import { MoComposer } from '../src/mobile/MoComposer.tsx';
import { MemberList } from '../src/components/thread/Members.tsx';
import { addDraftContext, clearDraftContext } from '../src/message-context/draft.ts';
import { shownAnswers } from '../src/transcript/delegation.ts';
import { messageBox, typeIn } from './message-box.ts';

const member = (agent: string, name: string, lead: boolean, state: ThreadMember['state'] = 'done'): ThreadMember =>
  ({ agent, name, lead, state, status: 'done', harness: 'claude-code', model: null, effort: '', seated_at: '2026-11-20T10:00:00.000Z' }) as ThreadMember;
const base = { id: 't1', channel_id: 'c1', title: 'A thread', status: 'done', harness: 'claude-code', model: 'claude-sonnet-5-5', effort: 'high', role: 'lead' } as unknown as Thread;
const group = { ...base, members: [member('lead', 'Builder', true), member('designer', 'Designer', false, 'working')] } as Thread;
const harnesses = [{ id: 'claude-code', name: 'Claude Code', available: true, capabilities: { steer: true }, models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['high'], defaultEffort: 'high', default: true }] }];

let root: Root;
let host: HTMLDivElement;
let calls: { method: string; url: string; body: unknown }[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      if (method !== 'GET') calls.push({ method, url, body });
      if (url === `/api/threads/${base.id}/messages`) return Response.json(group);
      if (url.startsWith(`/api/threads/${base.id}/members`)) return Response.json(group);
      if (url.startsWith('/api/mentions')) return Response.json([]);
      if (url.startsWith('/api/harnesses')) return Response.json(harnesses);
      if (url.startsWith('/api/accounts')) return Response.json({ machines: [] });
      if (url.startsWith('/api/commands')) return Response.json({ status: 'ready', commands: [] });
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
  clearDraftContext(base.id);
  vi.unstubAllGlobals();
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));
const mount = async (phone: boolean, thread: Thread) => {
  await act(async () =>
    root.render(phone ? createElement(MoComposer, { thread, chips: [], placeholder: 'Follow up', onSent: () => {}, onSwitched: () => {}, onFork: () => {} }) : createElement(ReplyComposer, { thread })),
  );
  await settle();
};
const box = () => messageBox(host)!;
const type = async (value: string) => {
  await typeIn(box(), value);
  await settle();
};
const hint = () => host.querySelector('[data-routing-hint]')?.textContent ?? null;
const sendButton = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => /^Send\b/.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))!;
const button = (name: string | RegExp) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof name === 'string' ? b.textContent?.trim() === name : name.test(b.textContent ?? '')))!;

describe.each([false, true])('the reply box in a group thread, phone=%s', (phone) => {
  it('names the lead, and once an @ is typed says who the message goes to', async () => {
    await mount(phone, group);
    expect(box().getAttribute('aria-placeholder') ?? box().getAttribute('aria-label')).toMatch(/^Reply to Builder\b/);
    expect(hint()).toBeNull();
    await type('ask @');
    expect(hint()).toBe('Goes to Builder. Pick an agent from the @ menu to send it to them instead.');
  });

  it('sends a message with an agent mention to that agent alone, as a new turn', async () => {
    await mount(phone, group);
    // As a pick from the `@` menu leaves it: the text, then the record (happy-dom can't drive the menu).
    await type('@Critic what do you think?');
    await act(async () => void addDraftContext(base.id, { id: 'm1', kind: 'agent_mention', v: 1, label: '@Critic', body: { agent: 'critic', name: 'Critic' } } as never));
    await settle();
    expect(hint()).toBe('Goes to Critic only. Critic joins this thread and stays until you remove it.');
    await act(async () => sendButton().click());
    await settle();
    const sent = calls.find((c) => c.url.endsWith('/messages'))!;
    const form = sent.body instanceof FormData ? Object.fromEntries(sent.body.entries()) : (sent.body as Record<string, unknown>);
    const payload = typeof form.data === 'string' ? JSON.parse(form.data) : form;
    expect(payload.prompt).toBe('@Critic what do you think?');
    expect(payload.context).toEqual([expect.objectContaining({ kind: 'agent_mention', body: { agent: 'critic', name: 'Critic' } })]);
  });

  it('says why a read-only thread takes no messages, and sends nothing', async () => {
    await mount(phone, { ...group, read_only: 'Builder was deleted, so this thread is read-only.' } as Thread);
    expect(box().getAttribute('aria-placeholder') ?? box().getAttribute('aria-label')).toMatch(/^Builder was deleted, so this thread is read-only\./);
    await type('hello');
    expect(sendButton()?.disabled ?? true).toBe(true);
  });
});

describe('the member list', () => {
  it('marks the lead, removes a member after a confirm, and adds an agent', async () => {
    await act(async () => root.render(createElement(MemberList, { thread: group })));
    await settle();
    const rows = [...host.querySelectorAll('[data-member]')].map((r) => [r.getAttribute('data-member'), r.textContent?.includes('Lead'), r.textContent?.includes('Working')]);
    expect(rows).toEqual([
      ['lead', true, false],
      ['designer', false, true],
    ]);
    expect(host.querySelector('[aria-label="Remove Builder"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remove Designer"]')!.click());
    expect(host.textContent).toContain('Its session closes once its turn finishes.');
    await act(async () => button('Remove Designer').click());
    await settle();
    expect(calls).toContainEqual({ method: 'DELETE', url: '/api/threads/t1/members/designer', body: undefined });

    await act(async () => button('Add an agent').click());
    // Any agent but the Conductor, and none already seated.
    const choices = [...host.querySelectorAll('[aria-label="Agents to add"] [role="listitem"]')].map((b) => b.textContent?.trim());
    expect(choices).toEqual([expect.stringMatching(/Critic$/)]);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Agents to add"] [role="listitem"]')!.click());
    await settle();
    expect(calls).toContainEqual({ method: 'POST', url: '/api/threads/t1/members', body: { agent: 'critic' } });
  });
});

describe('the transcript', () => {
  const ev = (id: number, kind: string, payload: unknown) => ({ id, thread_id: 't1', kind, payload: JSON.stringify(payload), created_at: '2026-11-19T10:00:00.000Z' });

  it('shows an agent joining and leaving as quiet lines, and drops the rows routed to each session', () => {
    const { items } = buildItems([
      ev(1, 'user', { text: 'hi' }),
      ev(2, 'member', { event: 'joined', agent: 'designer', name: 'Designer' }),
      ev(3, 'routed', { text: 'hi' }),
      ev(4, 'member', { event: 'left', agent: 'designer', name: 'Designer' }),
    ]);
    expect(items.map((it) => it.type)).toEqual(['user', 'member', 'member']);
    expect(items.flatMap((it) => (it.type === 'member' ? [memberLine(it.p)] : []))).toEqual(['Designer joined', 'Designer left']);
  });

  it('puts a Just show it answer on an old Ask card, and leaves a woken answer as its own report', () => {
    const ask = { thread_id: 'child', role: 'researcher', name: 'Researcher', harness: 'claude-code', harness_name: 'Claude Code', remote: false, question: 'Check it', excerpt: null, wake: false, title: 'Ask: Check it', channel: 'c1' };
    const { items } = buildItems([ev(1, 'user', { text: 'hi' }), ev(2, 'ask', ask), ev(3, 'crew_report', { thread_id: 'child', text: 'Checked.', shown: true, quiet: true, ask: true })]);
    expect(items.map((it) => it.type)).toEqual(['user', 'ask', 'report']);
    expect(shownAnswers(items).get('child')).toMatchObject({ text: 'Checked.' });
    const woken = buildItems([ev(1, 'user', { text: 'hi' }), ev(2, 'ask', { ...ask, wake: true }), ev(3, 'crew_report', { thread_id: 'child', text: 'Checked.', ask: true })]).items;
    expect(shownAnswers(woken).size).toBe(0);
  });
});
