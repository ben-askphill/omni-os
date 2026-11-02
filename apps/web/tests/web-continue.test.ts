import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ContinueLink } from '@omni/shared/continue.ts';
import { NO_LINKS } from '@omni/shared/continue-flow.ts';
import { ContinueCrumbs, MoContinueLinks } from '../src/components/ContinueLinks.tsx';
import { BlockNote } from '../src/components/ContinueSheet.tsx';
import { threadView } from '@omni/shared/thread-view.ts';
import { buildItems, type TranscriptEvent } from '@omni/shared/transcript-fold.ts';

// What the Web UI draws of continuing a thread on another harness: the Close terminal button on a block, the links both
// threads show, and the carryover event the transcript leaves out. The logic is packages/shared/continue-flow.ts.

describe('a blocked source', () => {
  it('offers Close terminal only when an open shell is what blocks the source', () => {
    const terminal = { code: 'terminal' as const, message: 'Its Terminal tab has a shell open.' };
    const note = (block: typeof terminal | { code: 'running'; message: string }) =>
      renderToStaticMarkup(createElement(BlockNote, { block, onRecheck: () => {}, onCloseTerminal: () => {}, closing: false }));
    expect(note(terminal)).toContain('Close terminal');
    expect(note({ code: 'running', message: 'A turn is running in it.' })).not.toContain('Close terminal');
  });
});

describe('the links between the two threads', () => {
  const link = (id: string, created_at: string, over: Partial<ContinueLink> = {}): ContinueLink => ({
    id,
    title: id,
    harness: 'codex',
    model: null,
    status: 'done',
    created_at,
    carried: null,
    ...over,
  });
  const carried = { entries: 34, condensed: 12, omitted: 20, chars: 12_300, budget: 24_000, files: 3 };

  it('shows the desktop header where the thread came from, with what it carried, and the newest that carries it on', () => {
    const html = renderToStaticMarkup(
      createElement(ContinueCrumbs, {
        links: { from: link('src', '2026-10-23T09:00:00Z', { title: 'Fix the flaky test', harness: 'claude-code', carried }), into: [link('a', '2026-10-24T10:00:00Z'), link('b', '2026-10-24T12:00:00Z', { title: 'Add the test' })] },
      }),
    );
    expect(html).toContain('Continued from Fix the flaky test · Claude Code');
    expect(html).toContain('title="Carried 34 entries (12 shortened), 20 older left out, 3 changed files."');
    expect(html).toContain('Continued in Add the test · Codex +1');
    expect(html).toContain('href="#/t/src"');
    expect(renderToStaticMarkup(createElement(ContinueCrumbs, { links: NO_LINKS }))).toBe('');
  });

  it('lists both directions above a phone thread, each a button that opens that thread', () => {
    const opened: string[] = [];
    const links = { from: link('src', '2026-10-23T09:00:00Z', { title: 'Fix the flaky test', harness: 'claude-code', carried }), into: [link('b', '2026-10-24T12:00:00Z', { title: 'Add the test' })] };
    const html = renderToStaticMarkup(createElement(MoContinueLinks, { links, onOpen: (id: string) => opened.push(id) }));
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('Continued from</span> Fix the flaky test');
    expect(html).toContain('Claude Code · Carried 34 entries');
    expect(html).toContain('Continued in</span> Add the test');
    expect(html).not.toContain('href=');
    expect(renderToStaticMarkup(createElement(MoContinueLinks, { links: NO_LINKS, onOpen: () => {} }))).toBe('');
  });
});

describe("a continued thread's carryover event", () => {
  // The server writes a `carryover` event in the continued thread (it fills ContinueLink.carried); no client draws it.
  const ev = (id: number, kind: string, payload: unknown): TranscriptEvent => ({ id, kind, payload: JSON.stringify(payload), created_at: `2026-10-24T10:0${id}:00.000Z` });
  const events = [
    ev(1, 'carryover', { entries: 34, condensed: 12, omitted: 20, chars: 12_300, budget: 24_000, files: 3 }),
    ev(2, 'user', { text: 'Carry on' }),
    ev(3, 'assistant_text', { text: 'On it.' }),
    ev(4, 'result', { ok: true, subtype: 'success', duration_ms: 1000, turns: 1 }),
  ];

  it('folds to nothing in the desktop transcript', () => {
    expect(buildItems(events).items.map((it) => it.type)).toEqual(['user', 'text', 'result']);
  });

  it('leaves the phone thread one turn, opened by Ben\'s message', () => {
    const v = threadView({ events, thread: { status: 'done', cwd: '/w', harness: 'codex' }, artifacts: [], children: [] });
    expect(v.turns).toHaveLength(1);
    expect(v.turns[0]!.prompts.map((p) => p.text)).toEqual(['Carry on']);
  });
});
