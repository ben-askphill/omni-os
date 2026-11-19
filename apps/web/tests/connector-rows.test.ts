// @vitest-environment happy-dom
import { connectorGroups, connectorOf, connectorsUsed } from '@omni/shared/connectors.ts';
import { progressPanel } from '@omni/shared/progress-panel.ts';
import { buildItems, type ToolCall, type TranscriptEvent } from '@omni/shared/transcript-fold.ts';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Thread } from '../src/api.ts';
import { ConnectorMark } from '../src/components/ConnectorMark.tsx';
import { ProgressCard } from '../src/components/thread/ProgressCard.tsx';
import { ThreadQuickCard } from '../src/components/thread/ThreadQuickCard.tsx';
import { ConnectorRow, ToolRow } from '../src/components/thread/ToolRows.tsx';

// Connector and MCP calls wear their app's brand: the tile, the name and the words for what the call does.

vi.mock('../src/store.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/store.tsx')>()),
  useFeed: () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let id = 0;
const ev = (kind: string, payload: unknown): TranscriptEvent => ({ id: ++id, kind, payload: JSON.stringify(payload), created_at: '2026-11-19T10:00:00.000Z' });
const use = (tid: string, name: string, input: unknown = {}) => ev('tool_use', { id: tid, name, input, parent: null });
const out = (tid: string, text = 'ok', is_error = false) => ev('tool_result', { tool_use_id: tid, text, is_error, truncated: false });
const callsOf = (events: TranscriptEvent[]): ToolCall[] => buildItems(events).items.flatMap((it) => (it.type === 'tools' ? it.calls : []));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const mount = (el: ReturnType<typeof createElement>) => act(() => root.render(el));

describe('ConnectorMark', () => {
  it('draws a brand logo, an initial, the Omni ring or a plug, named for screen readers', () => {
    const html = (name: string) => renderToStaticMarkup(createElement(ConnectorMark, { connector: connectorOf(name)! }));
    const notion = html('mcp__claude_ai_Notion__notion-search');
    expect(notion).toContain('aria-label="Notion"');
    expect(notion).toContain('<svg');
    const granola = html('mcp__claude_ai_Granola__search_meetings');
    expect(granola).toContain('aria-label="Granola"');
    expect(granola).toContain('>G</span>');
    const acme = html('mcp__acme_crm__lookup');
    expect(acme).toContain('aria-label="Acme crm"');
    expect(acme).toContain('data-connector="mcp:acme_crm"');
    const omni = renderToStaticMarkup(createElement(ConnectorMark, { connector: { id: 'omni', name: 'Omni', mark: { type: 'omni' }, kind: 'omni' } }));
    expect(omni).toContain('class="mark');
  });
});

describe('a tool row', () => {
  it('names a connector call by its app and its action, with the app tile', () => {
    const [c] = callsOf([use('g1', 'mcp__claude_ai_Granola__search_meetings', { query: 'kickoff' }), out('g1')]);
    mount(createElement(ToolRow, { c, running: false }));
    const row = host.querySelector('button')!;
    expect(row.querySelector('[data-connector="granola"]')).not.toBeNull();
    expect(row.textContent).toContain('Granola');
    expect(row.textContent).toContain('Search meetings · kickoff');
    expect(row.textContent).not.toContain('claude_ai_Granola');
  });

  it('keeps a built-in tool as it was: its icon, its name and its monospace summary', () => {
    const [c] = callsOf([use('b1', 'Bash', { command: 'git status' }), out('b1')]);
    mount(createElement(ToolRow, { c, running: false }));
    expect(host.querySelector('[data-connector]')).toBeNull();
    expect(host.textContent).toContain('Bash');
    expect(host.querySelector('.font-mono')?.textContent).toBe('git status');
  });

  it('shows the Omni ring on an Omni call', () => {
    const [c] = callsOf([use('o1', 'mcp__omni__list_threads'), out('o1')]);
    mount(createElement(ToolRow, { c, running: false }));
    expect(host.querySelector('[data-connector="omni"]')).not.toBeNull();
    expect(host.textContent).toContain('Omni');
    expect(host.textContent).toContain('List threads');
  });
});

describe('the inline connector row', () => {
  it('says Working on it while a call runs, then Used Granola, and opens to the call', () => {
    const head = [ev('user', { text: 'summarise' }), use('g1', 'mcp__claude_ai_Granola__search_meetings', { query: 'kickoff' })];
    const [g] = connectorGroups(callsOf(head));
    mount(createElement(ConnectorRow, { g, running: true }));
    const button = host.querySelector('button')!;
    expect(button.textContent).toContain('Working on it');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    const [done] = connectorGroups(callsOf([...head, out('g1', '3 meetings found')]));
    mount(createElement(ConnectorRow, { g: done, running: false }));
    expect(host.querySelector('button')!.textContent).toContain('Used Granola');
    expect(host.querySelector('button')!.textContent).toContain('Search meetings');
    act(() => host.querySelector('button')!.click());
    expect(host.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('kickoff');
    expect(host.textContent).toContain('3 meetings found');
  });

  it('folds several calls into one row that opens to a row each, and marks a failure', () => {
    const events = [use('n1', 'mcp__claude_ai_Notion__notion-search'), out('n1'), use('n2', 'mcp__claude_ai_Notion__notion-fetch'), out('n2', 'Not found', true)];
    const [g] = connectorGroups(callsOf(events));
    mount(createElement(ConnectorRow, { g, running: false }));
    expect(host.textContent).toContain('Used Notion');
    expect(host.textContent).toContain('2 calls');
    expect(host.textContent).toContain('1 failed');
    act(() => host.querySelector('button')!.click());
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Search'), expect.stringContaining('Fetch')]));
  });
});

describe('the step a connector call runs in', () => {
  it('reads "Now: Using Granola" with the Granola tile on the Progress card', () => {
    const events = [
      ev('user', { text: 'summarise' }),
      use('s1', 'mcp__omni-steps__set_steps', { steps: ['Read the meeting notes', 'Write the summary'], current: 0 }),
      out('s1'),
      use('g1', 'mcp__claude_ai_Granola__search_meetings'),
    ];
    mount(createElement(ProgressCard, { threadId: 't1', panel: progressPanel(buildItems(events).items, { live: true }) }));
    const active = host.querySelector('li[data-state="active"]')!;
    expect(active.textContent).toContain('Read the meeting notes');
    expect(active.textContent).toContain('Now');
    expect(active.textContent).toContain('Using Granola');
    expect(active.querySelector('[data-connector="granola"]')).not.toBeNull();
  });
});

describe('the Connectors list in the quick card', () => {
  const thread = { id: 't1', channel_id: 'notes', title: 'Brief', status: 'done', harness: 'claude-code', session_id: 's1', cwd: '/x', branch: null, source: 'manual', created_at: '2026-11-19T09:00:00.000Z', updated_at: '2026-11-19T09:00:00.000Z' } as unknown as Thread;
  const base = { thread, init: null, warm: true, slotBusy: false, prs: undefined, step: null, artifactCount: 0, machineName: 'Laptop', cwd: '/x', onOpen: () => {}, onOpenPR: () => {}, onOpenThread: () => {} };

  it('lists each connector the thread used once, with its tile and Connector beside it', () => {
    const connectors = connectorsUsed(callsOf([use('g1', 'mcp__claude_ai_Granola__get_meetings'), out('g1'), use('m1', 'mcp__claude_ai_Gmail__search_threads'), out('m1'), use('g2', 'mcp__claude_ai_Granola__search_meetings'), out('g2'), use('o1', 'mcp__omni__list_threads'), out('o1')]));
    const html = renderToStaticMarkup(createElement(ThreadQuickCard, { ...base, connectors }));
    expect(html).toContain('aria-label="Connectors"');
    expect(html.match(/data-connector="granola"/g)).toHaveLength(1);
    expect(html).toContain('data-connector="gmail"');
    expect(html).not.toContain('data-connector="omni"');
    expect(html).toContain('>Connector<');
  });

  it('leaves the section out while the thread used none', () => {
    expect(renderToStaticMarkup(createElement(ThreadQuickCard, base))).not.toContain('aria-label="Connectors"');
  });
});
