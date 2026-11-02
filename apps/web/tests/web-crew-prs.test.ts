// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CrewPR, Thread } from '../src/api.ts';
import { DetailsTab } from '../src/components/thread/panel/DetailsTab.tsx';
import { PRsTab } from '../src/components/thread/panel/PRsTab.tsx';
import { useThreadPR } from '../src/components/thread/ThreadPR.tsx';
import { CrewPRList } from '../src/mobile/CrewPRs.tsx';
import { crewLine } from '@omni/shared/thread-glance.ts';

// The PRs a thread's delegated threads opened (GET /threads/:id/pr `crew`), on the thread that delegated them: the PRs
// tab on the desktop (components/thread/panel/PRsTab.tsx) and the phone's list (mobile/CrewPRs.tsx).

const crewPR = (over: Partial<CrewPR> = {}): CrewPR => ({
  number: 12,
  title: 'Add the crew PR list',
  state: 'OPEN',
  isDraft: false,
  url: 'https://github.com/o/r/pull/12',
  repo: 'o/r',
  thread_id: 't-web',
  thread_title: 'Web UI crew list',
  channel_id: 'omni',
  task_id: 'web-ui',
  ...over,
});
const merged = crewPR({ number: 9, title: 'Show PRs in Thread options', state: 'MERGED', url: 'https://github.com/o/r/pull/9', thread_id: 't-mac', thread_title: 'Mac crew list', task_id: null });

const thread = (over: Partial<Thread> = {}) =>
  ({ id: 'cond', channel_id: 'conductor', title: 'Conductor', status: 'done', harness: 'claude-code', session_id: 's1', cwd: '/w', source: 'manual', created_at: '2026-10-28T09:00:00.000Z', updated_at: '2026-10-28T09:00:00.000Z', ...over }) as Thread;

let root: Root;
let host: HTMLDivElement;
let asked: string[];
let answer: unknown;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  asked = [];
  answer = { pr: null, prs: [], crew: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(url);
      return Response.json(answer);
    }),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** The PRs tab fed by the real hook, as Thread.tsx does. */
function Tab({ t }: { t: Thread }) {
  const data = useThreadPR(t, false);
  const watch = { watch: null, watching: false, busy: false, error: null, start: async () => {}, stop: async () => {} };
  return createElement(PRsTab, { thread: t, data, watch, next: null, busy: false, onAsk: () => {} });
}
const mount = async (t: Thread) => {
  await act(async () => root.render(createElement(Tab, { t })));
  await act(async () => new Promise((r) => setTimeout(r, 10)));
};
const links = () => [...host.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent]);

describe('the PRs tab of a thread with no branch', () => {
  it('lists the PRs of its delegated threads, each with where it came from and a way to the thread', async () => {
    answer = { pr: null, prs: [], crew: [crewPR(), merged] };
    await mount(thread());
    expect(asked).toEqual(['/api/threads/cond/pr']);
    expect(host.textContent).toContain('From delegated threads');
    expect(host.textContent).toContain('1 open, 1 merged');
    const [first, second] = [...host.querySelectorAll('section a[href^="#/c/"]')];
    expect(first.getAttribute('href')).toBe('#/c/omni/prs/12');
    expect(first.textContent).toBe('#12Add the crew PR listweb-ui · Web UI crew listopen');
    expect(second.textContent).toBe('#9Show PRs in Thread optionsMac crew listmerged');
    expect(links().filter(([h]) => h?.startsWith('#/t/'))).toEqual([
      ['#/t/t-web', ''],
      ['#/t/t-mac', ''],
    ]);
    expect(host.querySelector('[aria-label="Open thread: Web UI crew list"]')).not.toBeNull();
  });

  it('offers no branch actions for it', async () => {
    answer = { pr: null, prs: [], crew: [crewPR()] };
    await mount(thread());
    expect(host.textContent).not.toContain('Open PR');
    expect(host.textContent).not.toContain('No PR yet');
    expect(host.textContent).not.toContain('No branch');
  });

  it('still says there is no branch when its crew opened nothing', async () => {
    await mount(thread());
    expect(asked).toEqual(['/api/threads/cond/pr']);
    expect(host.textContent).toContain('No branch');
    expect(host.textContent).not.toContain('From delegated threads');
    expect(host.textContent).not.toContain('Open PR');
  });

  it('reads an older server that sends no crew as no crew', async () => {
    answer = { pr: null, prs: [] };
    await mount(thread());
    expect(host.textContent).toContain('No branch');
  });
});

describe('the PRs tab of a thread on a branch', () => {
  it('keeps its own PR section and Open PR, with the crew list below', async () => {
    answer = { pr: null, prs: [], crew: [crewPR()] };
    await mount(thread({ branch: 'omni/lead' }));
    const text = host.textContent!;
    expect(text).toContain('No PR yet');
    expect(text).toContain('Open PR');
    expect(text.indexOf('No PR yet')).toBeLessThan(text.indexOf('From delegated threads'));
  });

  it('has no crew section without crew', async () => {
    await mount(thread({ branch: 'omni/lead' }));
    expect(host.textContent).toContain('Open PR');
    expect(host.textContent).not.toContain('From delegated threads');
  });
});

describe('the Details tab of a thread with no branch', () => {
  it('has no branch card even with crew PRs', () => {
    const el = createElement(DetailsTab, {
      thread: thread(),
      channel: undefined,
      parent: null,
      children: [],
      lastResult: null,
      warm: undefined,
      links: { from: null, into: [] },
      agents: [],
      onJump: () => {},
      init: null,
      prs: { pr: null, prs: [], crew: [crewPR()] },
    });
    act(() => root.render(el));
    expect(host.textContent).not.toContain('Branch at a glance');
    expect(host.textContent).not.toContain('No PR yet');
  });
});

describe('the phone list', () => {
  it('shows each PR with its title, origin and state, and opens the delegated thread', async () => {
    const opened: string[] = [];
    await act(async () => root.render(createElement(CrewPRList, { crew: [crewPR(), merged], onOpen: (id) => opened.push(id) })));
    const rows = [...host.querySelectorAll('button')];
    expect(rows.map((r) => r.textContent)).toEqual(['Add the crew PR list#12 · web-ui · Web UI crew listopen', 'Show PRs in Thread options#9 · Mac crew listmerged']);
    expect(host.textContent).toContain('From delegated threads');
    await act(async () => rows[1].click());
    expect(opened).toEqual(['t-mac']);
  });
});

describe('the crew summary', () => {
  it('counts open and merged, and is live while any is open', () => {
    expect(crewLine([crewPR(), merged])).toEqual({ text: '1 open, 1 merged', tone: 'live' });
    expect(crewLine([merged])).toEqual({ text: '1 merged', tone: 'done' });
    expect(crewLine([crewPR(), crewPR({ isDraft: true })])).toEqual({ text: '2 open', tone: 'live' });
  });
});
