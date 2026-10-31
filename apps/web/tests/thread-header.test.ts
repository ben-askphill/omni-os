import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Thread } from '../src/api.ts';
import { HeaderActions } from '../src/components/thread/HeaderActions.tsx';

// The thread header's buttons (components/thread/HeaderActions.tsx): Done (Restore on an archived thread), the thread
// menu and the panel toggle. Everything else the thread can do is in the thread menu, so a new header button is a
// choice made here on purpose.

const thread = (over: Partial<Thread> = {}) => ({ id: 't1', title: 'A thread', status: 'running', archived: 0, pinned_at: null, done_at: null, ...over }) as Thread;

const render = (t: Thread) =>
  renderToStaticMarkup(
    createElement(HeaderActions, {
      thread: t,
      meter: null,
      reconnecting: false,
      onDone: () => {},
      onRestore: () => {},
      restoring: false,
      panelOpen: true,
      onPanel: () => {},
      artifactCount: 0,
    }),
  );

/** Each button's accessible name: its aria-label, or its text. */
const buttons = (html: string) => [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attrs, body]) => /aria-label="([^"]*)"/.exec(attrs)?.[1] ?? body.replace(/<[^>]+>/g, '').trim());

const MENU = 'Thread actions';
const PANEL = 'Artifacts, changes, browser, terminal, actions, details';

describe('the thread header', () => {
  it('shows the thread menu and the panel toggle, at any width, on any thread', () => {
    for (const t of [thread(), thread({ status: 'done' }), thread({ status: 'done', done_at: '2026-10-24T08:00:00Z' }), thread({ archived: 1 })]) {
      expect(buttons(render(t))).toEqual(expect.arrayContaining([MENU, PANEL]));
    }
  });

  it('adds only Done, or Restore on an archived thread', () => {
    expect(buttons(render(thread()))).toEqual([MENU, PANEL]);
    expect(buttons(render(thread({ status: 'done' })))).toEqual(['Mark as done', MENU, PANEL]);
    expect(buttons(render(thread({ status: 'done', done_at: '2026-10-24T08:00:00Z' })))).toEqual(['Mark as not done', MENU, PANEL]);
    expect(buttons(render(thread({ archived: 1 })))).toEqual(['Restore', MENU, PANEL]);
  });

  it('leaves pin, reference, hand off and Send to Grok Bot to the thread menu', () => {
    const names = buttons(render(thread({ status: 'done', pinned_at: '2026-10-24T08:00:00Z' })));
    for (const gone of ['Pin thread', 'Unpin thread', 'Reference another thread', 'Hand off to another Mac', 'Send to Grok Bot']) expect(names).not.toContain(gone);
  });
});
