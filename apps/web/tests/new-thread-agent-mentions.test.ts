// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Channel, CrewRole } from '../src/api.ts';
import type { MessageEditorProps } from '../src/components/composer/MessageEditor.tsx';
import { agentMention, agentMentionBody } from '@omni/shared/message-context-agent.ts';
import { newContext } from '@omni/shared/message-context.ts';

// The new-thread composer's `@` menu lists agents as a thread's does (ADR 0019): Overview's composer, where most threads
// start, hands its editor every agent but the lead and the Conductor, says who the message goes to once one is named,
// and sends the agent mention on the first message, which seats that agent and goes to it. The editor's own picker
// and chips are driven in Chromium (message-editor-browser.test.ts); here it is a stand-in that shows its props.

const state = vi.hoisted(() => ({ channels: [] as Channel[], crew: [] as CrewRole[] }));
vi.mock('../src/store.tsx', () => ({
  useApp: () => ({ ...state, status: null }),
  useHereName: () => undefined,
  useFeed: () => {},
}));
const editor = vi.hoisted(() => ({ props: null as MessageEditorProps | null }));
vi.mock('../src/components/composer/MessageEditor.tsx', () => ({
  newThreadScope: (channel: string, role?: string) => `channel=${channel}${role ? `&role=${role}` : ''}`,
  MessageEditor: (props: MessageEditorProps) => {
    editor.props = props;
    return null;
  },
}));

import { NewThreadComposer } from '../src/components/Composer.tsx';
import { addDraftContext, clearDraftContext } from '../src/message-context/draft.ts';
import { newThreadAgents } from '../src/thread-agents.ts';

const role = (id: string, name: string, extra: Partial<CrewRole> = {}) => ({ id, name, description: '', hidden: false, ...extra }) as CrewRole;

let root: Root;
let host: HTMLDivElement;
let posted: Record<string, unknown>[];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  posted = [];
  editor.props = null;
  clearDraftContext('new:*');
  state.channels = [
    { id: 'conductor', name: 'Conductor', kind: 'system' },
    { id: 'shop', name: 'Shop', kind: 'internal' },
  ] as Channel[];
  state.crew = [role('conductor', 'Conductor'), role('designer', 'Designer'), role('builder', 'Builder'), role('old', 'Old hand', { hidden: true })];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/threads') && init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)));
        return Response.json({ id: 't-new', channel_id: 'conductor' });
      }
      if (url.startsWith('/api/harnesses')) return Response.json([]);
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
  clearDraftContext('new:*');
  vi.unstubAllGlobals();
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 50))));
const overview = async () => {
  await act(async () => root.render(createElement(NewThreadComposer, { big: true, templateChips: false })));
  await settle();
};
/** What a pick of Designer from the `@` menu leaves: `@Designer` in the text and its record on the draft. */
const pickDesigner = async (rest: string) => {
  addDraftContext('new:*', newContext(agentMention, agentMentionBody({ id: 'designer', name: 'Designer' }), ''));
  await act(async () => editor.props!.onText(`@Designer ${rest}`));
  await settle();
};
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

describe("Overview's composer and agent mentions", () => {
  it('hands the @ menu every agent but the lead (the Conductor here) and hidden ones', async () => {
    await overview();
    expect(editor.props?.agents).toMatchObject({ members: [], others: [{ id: 'designer', name: 'Designer' }, { id: 'builder', name: 'Builder' }] });
    expect(editor.props?.mentions).toBe('channel=conductor&role=conductor');
  });

  it('says who gets the message once an agent is named, and sends the mention on the first message', async () => {
    await overview();
    await pickDesigner('polish the copy');
    expect(host.querySelector('[data-routing-hint]')?.textContent).toBe('Goes to Designer only. Designer joins this thread and stays until you remove it.');
    await act(async () => button('Start').click());
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ channel: 'conductor', role: 'conductor', prompt: '@Designer polish the copy' });
    expect(posted[0].context).toEqual([expect.objectContaining({ kind: 'agent_mention', body: { agent: 'designer', name: 'Designer' } })]);
  });

  it('leaves the mention out of a quick ask, which starts with no members', async () => {
    await overview();
    await pickDesigner('what is left to do?');
    await act(async () => button('Quick ask').click());
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ quick: true, prompt: '@Designer what is left to do?' });
    expect(posted[0].context).toBeUndefined();
  });
});

describe('newThreadAgents', () => {
  it('leaves out the agent the thread starts as, and names the lead for the hint', () => {
    const crew = [role('conductor', 'Conductor'), role('designer', 'Designer'), role('builder', 'Builder')];
    expect(newThreadAgents(crew, 'builder')).toEqual({ lead: { id: 'builder', name: 'Builder' }, members: [], others: [{ id: 'designer', name: 'Designer' }] });
    // No agent picked: the channel's default runs it.
    expect(newThreadAgents(crew, '')).toMatchObject({ lead: { id: '', name: 'the agent' }, others: [{ id: 'designer' }, { id: 'builder' }] });
  });
});
