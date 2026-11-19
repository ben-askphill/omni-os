// @vitest-environment happy-dom
import { progressPanel } from '@omni/shared/progress-panel.ts';
import { buildItems, type TranscriptEvent } from '@omni/shared/transcript-fold.ts';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProgressCard } from '../src/components/thread/ProgressCard.tsx';

// The Progress card under the thread's quick card: the agent's step list with a rail, closed by its X for that list.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let id = 0;
const ev = (kind: string, payload: unknown): TranscriptEvent => ({ id: ++id, kind, payload: JSON.stringify(payload), created_at: '2026-11-19T06:00:00.000Z' });
const setSteps = (tid: string, steps: string[], current: number) => [
  ev('tool_use', { id: tid, name: 'mcp__omni-steps__set_steps', input: { steps, current }, parent: null }),
  ev('tool_result', { tool_use_id: tid, text: 'ok', is_error: false, truncated: false }),
];
const LIST = ['Warm up the demo', 'Generate sample data', 'Crunch the numbers'];
const start = [ev('user', { text: 'Make a demo' }), ...setSteps('s1', LIST, 1)];
const panelOf = (events: TranscriptEvent[]) => progressPanel(buildItems(events).items, { live: true });

let root: Root;
let host: HTMLDivElement;
const render = (threadId: string, events: TranscriptEvent[] | null) =>
  act(() => root.render(createElement(ProgressCard, { threadId, panel: events ? panelOf(events) : null })));

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

describe('ProgressCard', () => {
  it('lists the steps in order, with the step it is on current and marked', () => {
    render('t1', start);
    const card = host.querySelector('section');
    expect(card?.getAttribute('aria-label')).toBe('Progress, 1 of 3 done');
    expect(card?.textContent).toContain('Progress');
    const items = [...host.querySelectorAll('li')];
    expect(items.map((li) => [li.textContent, li.dataset.state])).toEqual([
      ['Warm up the demo', 'done'],
      [expect.stringContaining('Generate sample data'), 'active'],
      ['Crunch the numbers', 'pending'],
    ]);
    expect(items[1].getAttribute('aria-current')).toBe('step');
    expect(items[1].querySelector('[role="img"]')).not.toBeNull();
    expect(items[0].querySelector('[role="img"]')).toBeNull();
  });

  it('darkens the rail from the first step into the mark of the step it is on', () => {
    render('t1', start);
    const lines = (li: Element) => [...li.querySelectorAll('span[aria-hidden]')].map((l) => (l.className.includes('bg-fg-4') ? 'dark' : 'light'));
    const [done, active, pending] = [...host.querySelectorAll('li')];
    expect(lines(done)).toEqual(['dark']);
    expect(lines(active)).toEqual(['dark', 'light']);
    expect(lines(pending)).toEqual(['light']);
  });

  it('ends a finished list on a done check, folded to its last step until Show earlier steps', () => {
    const finished = [...start, ...setSteps('s2', LIST, 3)];
    render('t1', finished);
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.textContent).toBe('Show 2 earlier steps');
    const items = () => [...host.querySelectorAll('li[data-state]')];
    expect(items().map((li) => li.textContent)).toEqual(['Crunch the numbers']);
    expect(items()[0].querySelector('[data-mark="done"]')).not.toBeNull();
    act(() => toggle.click());
    expect(toggle.textContent).toBe('Hide earlier steps');
    expect(items().map((li) => li.textContent)).toEqual(LIST);
    expect(items().map((li) => li.querySelector('[role="img"]')?.getAttribute('data-mark') ?? null)).toEqual([null, null, 'done']);
    render('t1', [...finished, ...setSteps('s3', [...LIST, 'Write it up'], 4)]);
    expect(host.querySelector('button[aria-expanded]')?.textContent).toBe('Show 3 earlier steps');
  });

  it('renders nothing when the thread has no list', () => {
    render('t1', null);
    expect(host.innerHTML).toBe('');
  });

  it('closes on its X, stays closed as the list moves on and after a reload, and comes back for a new list', () => {
    render('t1', start);
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Close progress"]')!.click());
    expect(host.innerHTML).toBe('');
    const moved = [...start, ...setSteps('s2', LIST, 2)];
    render('t1', moved);
    expect(host.innerHTML).toBe('');
    act(() => root.unmount());
    root = createRoot(host);
    render('t1', moved);
    expect(host.innerHTML).toBe('');
    render('t1', [...moved, ...setSteps('s3', [...LIST, 'Write it up'], 3)]);
    expect(host.querySelectorAll('li')).toHaveLength(4);
  });

  it('keeps a close to its own thread', () => {
    render('t1', start);
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Close progress"]')!.click());
    render('t2', start);
    expect(host.querySelectorAll('li')).toHaveLength(3);
    render('t1', start);
    expect(host.innerHTML).toBe('');
  });
});
