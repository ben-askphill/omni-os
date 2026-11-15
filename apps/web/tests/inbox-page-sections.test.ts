import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const thread = (id: string, title: string) => ({ id, title, channel_id: 'acme', status: 'idle', created_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:00:00Z' });
// Needs you lists one unread result; the Finished shelf also holds a thread Ben already read (no Needs you item).
const unread = { thread: { ...thread('t1', 'Unread result'), last_text: 'All green' }, result: { uid: 'r1', status: 'done', event_uid: null, at: '2026-11-15T10:00:00Z' }, blockers: [], at: '2026-11-15T10:00:00Z' };
const state = vi.hoisted(() => ({ needsYou: null as unknown, finished: [] as unknown[] }));

vi.mock('../src/store.tsx', () => ({
  useApp: () => ({ needsYou: state.needsYou, channels: [], setDone: async () => {} }),
  useNow: () => Date.now(),
}));
vi.mock('../src/app/useInbox.ts', () => ({
  useInbox: () => ({ needs: [], finished: state.finished, working: { count: 0 }, loaded: true }),
}));

import { InboxPage } from '../src/pages/Inbox.tsx';

describe('the Inbox page', () => {
  it('heads its second section Finished and lists every thread the subtitle counts as finished, read or not', () => {
    state.needsYou = { items: [unread], unread: 1, blocked: 0 };
    state.finished = [unread.thread, thread('t2', 'Read already')];
    const html = renderToStaticMarkup(createElement(InboxPage));
    expect(html).toContain('2 finished');
    expect(html).not.toContain('Unread<');
    const section = html.slice(html.indexOf('aria-label="Finished"'));
    expect(section).toMatch(/Finished<span[^>]*>2<\/span>/);
    expect(section).toContain('Unread result');
    expect(section).toContain('Read already');
  });
});
