// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { openHistory, revealCursor, applyPage, spanIndex, type HistoryRow } from '@omni/shared/history.ts';
import { findHits, findPattern, matchList } from '@omni/shared/thread-find.ts';
import { buildItems, type TranscriptEvent } from '@omni/shared/transcript-fold.ts';
import { LONG_THREAD } from '@omni/test-fixtures/long-thread.ts';
import type { EventRow } from '../src/api.ts';
import { FindTargetCtx, callsHold } from '../src/transcript/find-target.ts';
import { FIND_ATTR, paintFind, rangesOf, textOf } from '../src/thread-find-dom.ts';
import { historyServer, longRows } from './history-sim.ts';

// Find in a thread: the server's matches cover rows the client does not hold and rows a fold hides; the transcript opens
// the fold the current match is in; the page paints the matches it draws, across nodes, and falls back when it draws
// fewer than the server counted.

vi.mock('../src/store.tsx', async (original) => ({ ...(await original<object>()), useApp: () => ({ tasks: [], feedLive: true, needsYou: [], channel: () => undefined }), useNeedOf: () => null }));
const { Transcript } = await import('../src/components/Transcript.tsx');

describe('matches outside what the client holds', () => {
  const all = longRows({ turns: 80, hugeResult: 20_000, hugeWrite: 20_000 });
  const server = historyServer(all);

  it('finds a message only the oldest page has, then its page loads and draws it', () => {
    const { events, head } = server.head();
    let h = openHistory(events, head);
    const needle = findHits(all, LONG_THREAD.oldNeedle.toUpperCase());
    expect(needle.total).toBe(1);
    const event = needle.hits[0].event;
    // Not held: the client opened on its newest page, thousands of rows later.
    expect(spanIndex(h.spans, event)).toBe(-1);
    expect(h.rows.some((r) => r.id === event)).toBe(false);
    // The find's reveal: the page holding it.
    h = applyPage(h, server.page(revealCursor(h, event)!));
    expect(spanIndex(h.spans, event)).toBeGreaterThanOrEqual(0);
    const item = buildItems(h.rows as TranscriptEvent[], h.spans).items.find((it) => it.key === event);
    expect(item?.type).toBe('user');
  });

  it('counts matches in tool output that only a steps card holds, every match of a row', () => {
    const hits = findHits(all, 'step 2 of turn 8');
    // TodoWrite inputs: the call in turn 8 names it once, and turns stop at 79.
    expect(hits.hits).toHaveLength(1);
    const tools = buildItems(all as TranscriptEvent[]).items.flatMap((it) => (it.type === 'tools' ? [it] : []));
    const holder = tools.find((it) => callsHold(it.calls, hits.hits[0].event));
    expect(holder).toBeDefined();
    const many = findHits(all, 'the agent');
    expect(many.hits.some((h) => h.count > 1)).toBe(true);
    expect(matchList(many.hits)).toHaveLength(many.total);
  });
});

let id = 0;
const ev = (kind: string, payload: unknown): EventRow => ({ id: ++id, thread_id: 't1', kind, payload: JSON.stringify(payload), created_at: '2026-11-19T10:00:00.000Z' }) as EventRow;

/** A finished turn whose call output says `needle`, folded into its steps card. */
function turn() {
  id = 0;
  const events = [
    ev('user', { text: 'Run the tests', source: 'ben' }),
    ev('tool_use', { id: 'c1', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }),
    ev('tool_result', { tool_use_id: 'c1', text: 'FAIL the hidden NEEDLE test', is_error: false, truncated: false }),
    ev('tool_use', { id: 'c2', name: 'Read', input: { file_path: '/repo/a.ts' } }),
    ev('tool_result', { tool_use_id: 'c2', text: 'export const a = 1;', is_error: false, truncated: false }),
    ev('assistant_text', { text: 'One test **fails**: the needle one.' }),
    ev('result', { ok: true, duration_ms: 1000 }),
  ];
  return { events, output: 3 };
}

const render = (events: EventRow[], target: number | null) =>
  renderToStaticMarkup(createElement(FindTargetCtx.Provider, { value: target }, createElement(Transcript, { threadId: 't1', events, running: false })));

describe('the fold a match is in', () => {
  it('keeps a finished turn folded with no match, and opens it down to the output when the match is inside', () => {
    const { events, output } = turn();
    const closed = render(events, null);
    expect(closed).toContain('Show steps');
    expect(closed).not.toContain('hidden NEEDLE');
    const open = render(events, output);
    expect(open).toContain('Hide steps');
    expect(open).toContain(`${FIND_ATTR}="${output}"`);
    expect(open).toContain('FAIL the hidden NEEDLE test');
    // Its call's input is tagged too, for a match in the command.
    expect(open).toContain(`${FIND_ATTR}="2"`);
  });

  it('shows a long message whole when the match is in its cut', () => {
    id = 0;
    const long = ev('user', { text: `${'filler '.repeat(300)} the tail needle`, source: 'ben' });
    expect(render([long], null)).not.toContain('tail needle');
    expect(render([long], long.id)).toContain('tail needle');
  });
});

describe('painting', () => {
  const page = (html: string) => {
    document.body.innerHTML = html;
    return document.body;
  };

  it('finds matches across nodes and skips control labels and nested events', () => {
    const root = page(`<div ${FIND_ATTR}="7">Use the <b>Need</b>le here <button data-find-skip>needle</button><span ${FIND_ATTR}="8">needle</span> NEEDLE</div>`);
    const el = root.firstElementChild!;
    expect(textOf(el).text).toBe('Use the Needle here  NEEDLE');
    const ranges = rangesOf(el, findPattern('needle')!);
    expect(ranges.map((r) => r.toString())).toEqual(['Needle', 'NEEDLE']);
  });

  it('picks the current match by its place in the event, and falls back to the last drawn one', () => {
    const root = page(`<div data-key="1"><div ${FIND_ATTR}="1">a needle, a needle</div></div><div data-key="2"><pre ${FIND_ATTR}="2">no match drawn</pre></div>`);
    const re = findPattern('needle')!;
    const events = new Set([1, 2]);
    expect(paintFind(root, re, events, { event: 1, n: 1 }).range?.startOffset).toBe(12);
    // The server counted three in event 1: the page draws two.
    expect(paintFind(root, re, events, { event: 1, n: 2 }).range?.startOffset).toBe(12);
    // None drawn: the element stands in.
    const painted = paintFind(root, re, events, { event: 2, n: 0 });
    expect(painted.range).toBeNull();
    expect(painted.element?.textContent).toBe('no match drawn');
    expect(painted.drawn).toBe(2);
    // An event the server did not list is not painted.
    expect(paintFind(root, re, new Set([2]), null).drawn).toBe(0);
  });
});

it('keeps HistoryRow and EventRow in step for findHits', () => {
  const rows: HistoryRow[] = [{ id: 1, kind: 'user', payload: '{"text":"x"}', created_at: '' }];
  expect(findHits(rows, 'x').total).toBe(1);
});
