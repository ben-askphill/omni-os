import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { EventRow } from '../src/api.ts';
import { Transcript } from '../src/components/Transcript.tsx';

const { agent, channel } = vi.hoisted(() => ({
  agent: { id: 'conductor', name: 'Conductor', avatar: null },
  channel: { id: 'conductor', name: 'Conductor', icon: 'icon:play', avatar_bg: '#1e1e1e' },
}));

vi.mock('../src/store.tsx', async (original) => ({
  ...(await original<object>()),
  useApp: () => ({ tasks: [], feedLive: true, crew: [agent], channel: (id: string) => id === channel.id ? channel : undefined }),
  useCrewRoles: () => [agent],
}));

it('uses the Conductor agent avatar over the first and later replies in #conductor', () => {
  const events: EventRow[] = ['First', 'Follow-up'].flatMap((text, turn) => [
    { kind: 'user', payload: { text, source: 'ben' } },
    { kind: 'assistant_text', payload: { text: `Reply to ${text}` } },
    { kind: 'result', payload: { ok: true, subtype: 'success', turns: 1 } },
  ].map(({ kind, payload }, index) => ({
    id: turn * 3 + index + 1, thread_id: 't1', kind, payload: JSON.stringify(payload), agent: null, created_at: '2026-11-21T19:34:00.000Z',
  })));
  const html = renderToStaticMarkup(createElement(Transcript, { threadId: 't1', channelId: 'conductor', lead: 'conductor', events, running: false }));
  const headers = html.match(/<div data-author="conductor"[^>]*>.*?<\/div>/g) ?? [];
  expect(headers).toHaveLength(2);
  for (const header of headers) {
    expect(header).toContain('data-shape="circle"');
    expect(header).not.toContain('background-color:#1e1e1e');
  }
});
