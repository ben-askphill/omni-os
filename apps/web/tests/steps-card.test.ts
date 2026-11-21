import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { turnSteps } from '@omni/shared/steps.ts';
import { buildItems, type TranscriptEvent } from '@omni/shared/transcript-fold.ts';
import type { Thread } from '../src/api.ts';

// The step view a turn shows in place of its tool rows: on desktop (StepsCard) open while the turn runs and one line
// with Show steps once it ends, on the phone (MoSteps) the same with the calls behind "N actions". No tool names.

vi.mock('../src/store.tsx', async (original) => ({ ...(await original<object>()), useApp: () => ({ tasks: [], feedLive: true, needsYou: [], channel: () => undefined }), useNeedOf: () => null }));

const { StepsCard } = await import('../src/components/thread/StepsCard.tsx');
const { MoSteps } = await import('../src/mobile/ThreadCards.tsx');

let id = 0;
const ev = (kind: string, payload: unknown): TranscriptEvent => ({ id: ++id, kind, payload: JSON.stringify(payload), created_at: '2026-11-18T10:00:00.000Z' });
const call = (tid: string, name: string, input: unknown, text = 'ok') => [ev('tool_use', { id: tid, name, input }), ev('tool_result', { tool_use_id: tid, text, is_error: false })];
const list = ['Find candidate apps', 'Read the reviews', 'Compare prices'];
const running = [
  ev('user', { text: 'Which review app?' }),
  ...call('s1', 'mcp__omni-steps__set_steps', { steps: list, current: 0 }),
  ...call('w', 'WebSearch', { query: 'review apps' }),
  ...call('d', 'mcp__omni__delegate', { role: 'researcher' }, JSON.stringify({ thread_id: 'kid' })),
  ...call('s2', 'mcp__omni-steps__set_steps', { steps: list, current: 1 }),
  ev('tool_use', { id: 'f', name: 'WebFetch', input: { url: 'https://apps.shopify.com/judgeme' } }),
];
const finished = [...running, ev('tool_result', { tool_use_id: 'f', text: 'ok', is_error: false }), ...call('s3', 'mcp__omni-steps__set_steps', { steps: list, current: 3 }), ev('assistant_text', { text: 'Judge.me.' }), ev('result', { ok: true, turns: 4 })];
const view = (events: TranscriptEvent[], live: boolean) => turnSteps(buildItems(events).items, { live })!;
const kid = { id: 'kid', title: 'Compare app prices', role: 'researcher', status: 'running' } as Thread;
const desktop = (events: TranscriptEvent[], live: boolean) => renderToStaticMarkup(createElement(StepsCard, { v: view(events, live), cwd: '/w', byId: new Map([['kid', kid]]) }));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('StepsCard on desktop', () => {
  it('shows a running turn open: where it is, each step, what it does now and the thread a step handed work to', () => {
    const html = desktop(running, true);
    const t = text(html);
    expect(t).toContain('Step 2 of 3');
    expect(t).toContain('Find candidate apps');
    expect(t).toContain('Now: Reading a page on apps.shopify.com');
    expect(t).toContain('Researcher: Compare app prices');
    expect(t).toContain('2 actions');
    expect(html).toContain('data-state="active"');
    // The calls are one click away, not drawn.
    expect(t).not.toMatch(/WebFetch|WebSearch|set_steps|mcp__/);
  });

  it('folds a finished turn to one line with Show steps', () => {
    const t = text(desktop(finished, false));
    expect(t).toContain('3 steps · 3 actions');
    expect(t).toContain('Show steps');
    expect(t).not.toContain('Compare prices');
  });
});

describe('MoSteps on the phone', () => {
  it('lists the steps of a running turn with the calls behind N actions', () => {
    const t = text(renderToStaticMarkup(createElement(MoSteps, { v: view(running, true), failed: 0, onActions: () => {} })));
    expect(t).toContain('Step 2 of 3');
    expect(t).toContain('1/3');
    expect(t).toContain('Read the reviews');
    // Every call the turn made, the list's own not counted.
    expect(t).toContain('3 actions');
    expect(t).not.toMatch(/WebFetch|mcp__/);
  });

  it('folds a finished turn behind Show steps', () => {
    const t = text(renderToStaticMarkup(createElement(MoSteps, { v: view(finished, false), failed: 0, onActions: () => {} })));
    expect(t).toContain('3 steps');
    expect(t).toContain('Show steps');
    expect(t).not.toContain('Read the reviews');
  });
});

describe('the rail on both', () => {
  // Each row's pieces of the rail (above its mark, below it), dark where the list has got to.
  const rails = (html: string) =>
    html
      .split('<li')
      .slice(1)
      .map((li) => [...li.matchAll(/class="(absolute left-1\/2 w-\[2px\][^"]*)"/g)].map((m) => (m[1].includes('bg-fg-4') ? 'dark' : 'light')));
  const both = (v: ReturnType<typeof view>) => [
    rails(renderToStaticMarkup(createElement(StepsCard, { v, cwd: '/w', byId: new Map() }))),
    rails(renderToStaticMarkup(createElement(MoSteps, { v, failed: 0, onActions: () => {} }))),
  ];
  const at = (current: number) => [ev('user', { text: 'Which review app?' }), ...call(`c${current}`, 'mcp__omni-steps__set_steps', { steps: list, current })];

  it('stays light below the first step while it is on it', () => {
    for (const r of both(view(at(0), true))) expect(r).toEqual([['light'], ['light', 'light'], ['light']]);
  });

  it('runs dark into a middle step it is on, and light past it', () => {
    for (const r of both(view(at(1), true))) expect(r).toEqual([['dark'], ['dark', 'light'], ['light']]);
  });

  it('runs dark the whole way once every step is done', () => {
    for (const r of both(view(at(3), true))) expect(r).toEqual([['dark'], ['dark', 'dark'], ['dark']]);
  });

  it('stays light past the step it is on when the turn went back to a phase above done ones', () => {
    const back = [
      ev('user', { text: 'How is it going?' }),
      ...call('a', 'ToolSearch', { query: 'select:list_threads' }),
      ...call('b', 'mcp__omni__list_threads', {}),
      ...call('r', 'Read', { file_path: '/r/notes.md' }),
      ev('tool_use', { id: 'g', name: 'ToolSearch', input: { query: 'select:get_thread' } }),
    ];
    const v = view(back, true);
    expect(v.steps.map((s) => s.state)).toEqual(['active', 'done', 'done', 'pending']);
    for (const r of both(v)) expect(r).toEqual([['light'], ['light', 'light'], ['light', 'light'], ['light']]);
  });
});

