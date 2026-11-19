import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BackgroundTask } from '../src/api.ts';
import { AgentsSection } from '../src/components/thread/panel/AgentsSection.tsx';
import { DetailsTab } from '../src/components/thread/panel/DetailsTab.tsx';
import type { Thread } from '../src/api.ts';
import { runningSubagents, subagentKind, subagentProgress, subagentTip } from '../src/subagents.ts';

// The Details tab's agents card (components/thread/panel/AgentsSection.tsx) and the phone's
// thread options sheet list the agents a thread spawned itself, from the feed's live task list.

const task = (over: Partial<BackgroundTask> = {}): BackgroundTask => ({
  thread_id: 't1',
  channel_id: 'omni',
  task_id: 'a1',
  tool_use_id: 'toolu_1',
  description: 'Map the repo',
  subagent: true,
  event_id: 42,
  background: false,
  started_at: '2026-10-28T09:00:00.000Z',
  ...over,
});

describe('running subagents', () => {
  it("lists only this thread's agents, oldest first", () => {
    const tasks = [
      task({ task_id: 'late', started_at: '2026-10-28T09:05:00.000Z' }),
      task({ task_id: 'shell', subagent: false, task_type: 'local_bash' }),
      task({ task_id: 'other', thread_id: 't2' }),
      // A delegated member thread's agent nests under its lead in the sidebar, but it runs in its own thread.
      task({ task_id: 'member', thread_id: 'm1', lead_id: 't1' }),
      task({ task_id: 'early', started_at: '2026-10-28T08:55:00.000Z' }),
    ];
    expect(runningSubagents(tasks, 't1').map((t) => t.task_id)).toEqual(['early', 'late']);
  });

  it('names the kind from the sub-agent type, else the task type', () => {
    expect(subagentKind(task({ subagent_type: 'Explore', task_type: 'local_agent' }))).toBe('Explore');
    expect(subagentKind(task({ task_type: 'local_workflow' }))).toBe('workflow');
    expect(subagentKind(task({ task_type: 'local_agent' }))).toBeUndefined();
  });

  it('says how far it got and where a click goes', () => {
    expect(subagentTip(task({ background: true, tool_uses: 3, last_tool: 'Grep' }))).toBe(
      'Map the repo · in the background · 3 tool calls · last Grep\nJump to where it started',
    );
    expect(subagentTip(task({ event_id: undefined }))).toBe('Map the repo');
  });

  it('shows how far it got on the row itself, and the whole line as its tooltip', () => {
    expect(subagentProgress(task({ background: true, tool_uses: 3, last_tool: 'Grep' }))).toBe('in the background · 3 tool calls · last Grep');
    expect(subagentProgress(task())).toBe('');
    const html = renderToStaticMarkup(
      createElement(AgentsSection, { parent: null, links: { from: null, into: [] }, children: [], agents: [task({ tool_uses: 3, last_tool: 'Grep' })], onJump: () => {} }),
    );
    const row = html.slice(html.lastIndexOf('<button', html.indexOf('Map the repo')), html.indexOf('</button>', html.indexOf('Map the repo')));
    expect(row).toContain('3 tool calls · last Grep</span>');
    expect(row).not.toMatch(/<button[^>]* title=/);
    expect(html).toMatch(/aria-describedby="(tip-[^"]+)"[\s\S]*id="\1" role="tooltip"/);
  });

  it('renders nothing for a thread with no agents around it', () => {
    expect(renderToStaticMarkup(createElement(AgentsSection, { parent: null, links: { from: null, into: [] }, children: [], agents: [], onJump: () => {} }))).toBe('');
  });

  it('renders a row per agent with its kind and a jump button', () => {
    const html = renderToStaticMarkup(
      createElement(AgentsSection, {
        parent: null,
        links: { from: null, into: [] },
        children: [],
        agents: [
          task({ subagent_type: 'Explore' }),
          task({
            task_id: 'a2',
            description: 'Write tests',
            event_id: undefined,
          }),
        ],
        onJump: () => {},
      }),
    );
    expect(html).toContain('Running');
    expect(html).toContain('Map the repo');
    expect(html).toContain('Explore');
    expect(html.match(/<button/g)).toHaveLength(2);
    // Without a start row there is nowhere to jump.
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });

  it('sits above the session rows in the Details tab, with the other agents', () => {
    const thread = { id: 't1', channel_id: 'omni', harness: 'claude-code', session_id: 's1', cwd: '/w', source: 'manual', created_at: '2026-10-28T09:00:00.000Z', updated_at: '2026-10-28T09:00:00.000Z' } as Thread;
    const html = renderToStaticMarkup(
      createElement(DetailsTab, { thread, channel: undefined, parent: null, children: [], init: null, lastResult: null, warm: undefined, links: { from: null, into: [] }, agents: [task()], onJump: () => {} }),
    );
    const agents = html.indexOf('aria-label="Agents"');
    expect(agents).toBeGreaterThan(-1);
    expect(html.indexOf('Map the repo')).toBeGreaterThan(agents);
    expect(html.indexOf('Harness')).toBeGreaterThan(html.indexOf('Map the repo'));
  });
});
