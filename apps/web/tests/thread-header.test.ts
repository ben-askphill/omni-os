import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Thread } from '../src/api.ts';
import { FOLD, HeaderActions, UNFOLD } from '../src/components/thread/HeaderActions.tsx';

// The thread header's buttons (components/thread/HeaderActions.tsx). With the side panel open the header gets narrow,
// and every button that always shows takes width from the title. A new header button folds into the More menu
// below the breakpoint, or is added to ALWAYS here on purpose.

const ALWAYS = ['Reference another thread', 'Thread actions', 'Interrupt', 'Artifacts, changes, browser, terminal, actions, details'];

const thread = (over: Partial<Thread> = {}) => ({ id: 't1', title: 'A thread', status: 'running', archived: 0, pinned_at: null, done_at: null, ...over }) as Thread;

const render = (t: Thread) =>
  renderToStaticMarkup(
    createElement(HeaderActions, {
      thread: t,
      meter: null,
      reconnecting: false,
      handoffReady: true,
      onPin: () => {},
      onDone: () => {},
      onRestore: () => {},
      restoring: false,
      grok: { busy: false, run: () => {} },
      interrupt: { busy: false, run: () => {} },
      panelOpen: true,
      onPanel: () => {},
      artifactCount: 0,
    }),
  );

/** Each button's accessible name (its aria-label, or its text) and its class. */
const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attrs, body]) => ({
    name: /aria-label="([^"]*)"/.exec(attrs)?.[1] ?? body.replace(/<[^>]+>/g, '').trim(),
    cls: /class="([^"]*)"/.exec(attrs)?.[1] ?? '',
  }));

describe('the thread header keeps the title wide when it is narrow', () => {
  it('folds every button but the thread reference, More, Interrupt and the panel toggle', () => {
    for (const t of [thread(), thread({ pinned_at: '2026-10-24T08:00:00Z' }), thread({ status: 'done', done_at: '2026-10-24T08:00:00Z' })]) {
      const shown = buttons(render(t)).filter((b) => !b.cls.split(' ').includes(FOLD));
      expect(shown.map((b) => b.name).filter((n) => !ALWAYS.includes(n))).toEqual([]);
    }
  });

  it('folds pin, done, hand off and Send to Grok Bot, which the More menu offers', () => {
    const all = buttons(render(thread({ status: 'done' })));
    for (const name of ['Pin thread', 'Mark as done', 'Hand off to another Mac', 'Send to Grok Bot']) expect(all.find((b) => b.name === name)?.cls.split(' ')).toContain(FOLD);
    expect(all.find((b) => b.name === 'Thread actions')?.cls.split(' ')).toContain(UNFOLD);
  });
});
