import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Channel, HistoryEvent, Thread } from '../src/api.ts';

vi.mock('../src/store.tsx', async (load) => ({ ...(await load<object>()), useApp: () => ({ channels: [] }) }));

import { DetailsTab } from '../src/components/thread/panel/DetailsTab.tsx';
import { useTurnState } from '../src/pages/threadTurn.ts';

// A thread a remote agent leads (ADR 0020) has its worktree on this machine, and local agents seated in it run their
// own sessions there. Details still says the lead runs on its own server, and reads the lead's run, not a member's.

const repo = { id: 'webapp', name: 'Web app', repo_path: '/repo' } as Channel;
const led = { id: 't1', channel_id: 'webapp', title: 'Empty state', status: 'done', harness: 'custom:nomos', model: 'default', session_id: 'omni-eve-s1', cwd: '/data/worktrees/t1', branch: 'omni/t1', source: 'manual', archived: 0, pinned_at: null, done_at: null, role: 'nomos', created_at: '2026-11-20T09:00:00.000Z', updated_at: '2026-11-20T09:00:00.000Z' } as Thread;

const details = (init: { model: string; cwd: string; mcp: { name: string; status: string }[] } | null) =>
  renderToStaticMarkup(
    createElement(DetailsTab, { thread: led, roleName: 'Nomos', channel: repo, parent: null, children: [], init: init as never, lastResult: null, warm: undefined, links: { from: null, into: [] }, agents: [], onJump: () => {} }),
  );

const row = (id: number, kind: string, agent: string | null, payload: unknown) => ({ id, thread_id: 't1', kind, agent, payload: JSON.stringify(payload), created_at: '2026-11-20T09:00:00.000Z' }) as HistoryEvent;

function turnState(events: HistoryEvent[], lead: string | null) {
  let out: ReturnType<typeof useTurnState> | null = null;
  const Probe = () => {
    out = useTurnState(events, lead);
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  return out!;
}

describe('a thread a remote agent leads', () => {
  it('offers no terminal resume, says its agent runs on its own server, and shows the worktree its members change', () => {
    const html = details({ model: 'default', cwd: '/data/worktrees/t1', mcp: [] });
    expect(html).not.toContain('Resume in terminal');
    expect(html).not.toContain('--resume');
    expect(html).toContain('Remote session');
    expect(html).toContain('Nomos runs on its own server and talks only');
    expect(html).toContain('/data/worktrees/t1');
  });

  it("reads the lead's init and last result, not a seated member's newer ones", () => {
    const events = [
      row(1, 'init', 'nomos', { model: 'default', cwd: '', mcp: [] }),
      row(2, 'result', 'nomos', { ok: true, model: 'deepseek/deepseek-v4-pro' }),
      row(3, 'init', 'builder', { model: 'claude-haiku-4-5', cwd: '/data/worktrees/t1', mcp: [{ name: 'omni', status: 'connected' }] }),
      row(4, 'result', 'builder', { ok: true, model: 'claude-haiku-4-5' }),
    ];
    const s = turnState(events, 'nomos');
    expect(s.init).toMatchObject({ model: 'default' });
    expect(s.lastResult).toMatchObject({ model: 'deepseek/deepseek-v4-pro' });
    // Rows from before Omni recorded who wrote them read as the lead's.
    expect(turnState([row(1, 'init', null, { model: 'opus', cwd: '/w', mcp: [] })], 'builder').init).toMatchObject({ model: 'opus' });
  });
});
