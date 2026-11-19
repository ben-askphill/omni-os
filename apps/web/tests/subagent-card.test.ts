import { describe, expect, it } from 'vitest';
import { agentStatus, answersFor, mergeTasks, shownAnswers, splitGroup } from '../src/transcript/delegation.ts';
import type { Item, ReportP, TaskView, ToolCall } from '@omni/shared/transcript-fold.ts';
import type { BackgroundTask } from '../src/api.ts';

const call = (id: string, name: string, result?: { text: string; is_error?: boolean }): ToolCall => ({
  id,
  name,
  input: {},
  parent: null,
  result: result && { tool_use_id: id, text: result.text, is_error: !!result.is_error, truncated: false, event: 2 },
  at: '2026-10-04T09:00:00Z',
  children: [],
  orphan: false,
  event: 1,
});

describe('sub-agent delegation cards', () => {
  it('takes sub-agents and finished delegations out of the tool group', () => {
    const calls = [
      call('r', 'Read', { text: 'x' }),
      call('a1', 'Agent'),
      call('a2', 'Task', { text: 'done' }),
      call('d', 'mcp__omni__delegate', { text: '{"thread_id":"t"}' }),
      call('bad', 'mcp__omni__delegate', { text: 'nope', is_error: true }),
    ];
    const { agents, rest, agentsFirst } = splitGroup(calls);
    expect(agents.map((c) => c.id)).toEqual(['a1', 'a2']);
    expect(rest.map((c) => c.id)).toEqual(['r', 'bad']);
    expect(agentsFirst).toBe(false);
    expect(splitGroup([call('a', 'Agent'), call('b', 'Bash')]).agentsFirst).toBe(true);
    expect(splitGroup([call('b', 'Bash')]).agentsFirst).toBe(false);
  });

  it('reads the state from the task when there is one, else from the result', () => {
    const started = '2026-10-04T09:00:00Z';
    // A background agent answers at launch; its task decides.
    const bg = call('a', 'Agent', { text: 'launched' });
    expect(agentStatus(bg, { running: true, background: true, started }, false, false)).toBe('running');
    expect(agentStatus(bg, { running: false, background: true, status: 'failed', started }, false, false)).toBe('failed');
    expect(agentStatus(bg, { running: false, background: true, status: 'killed', started }, false, false)).toBe('stopped');

    expect(agentStatus(call('a', 'Agent'), undefined, true, false)).toBe('running');
    expect(agentStatus(call('a', 'Agent'), undefined, false, false)).toBe('stopped');
    expect(agentStatus(call('a', 'Agent', { text: 'ok' }), undefined, false, false)).toBe('done');
    expect(agentStatus(call('a', 'Agent', { text: 'boom', is_error: true }), undefined, false, false)).toBe('failed');
    expect(agentStatus(call('a', 'Agent', { text: '[Request interrupted by user]', is_error: true }), undefined, false, true)).toBe('stopped');
  });
});

describe('sub-agent state from the live task list', () => {
  const running: TaskView = { running: true, background: true, tool_uses: 41, started: '2026-11-14T17:58:46Z' };
  const stored = () => new Map([['toolu_a', running]]);
  const liveTask = (thread_id: string): BackgroundTask => ({
    thread_id,
    channel_id: 'c',
    task_id: 'task-a',
    tool_use_id: 'toolu_a',
    description: 'Implement',
    subagent: true,
    background: true,
    tool_uses: 54,
    started_at: '2026-11-14T17:58:47Z',
  });

  it('ends a stored running task this server no longer runs', () => {
    const t = mergeTasks(stored(), [], 't1', { feedLive: true, here: true }).get('toolu_a')!;
    expect(t.running).toBe(false);
    expect(agentStatus({ id: 'toolu_a', name: 'Agent', input: {}, parent: null, at: '', children: [], orphan: false, event: 1 }, t, false, false)).toBe('stopped');
  });

  it('keeps a task the live list still runs, with its newest count', () => {
    const t = mergeTasks(stored(), [liveTask('t1')], 't1', { feedLive: true, here: true }).get('toolu_a')!;
    expect(t).toMatchObject({ running: true, tool_uses: 54, started: '2026-11-14T17:58:46Z' });
  });

  it('trusts the stored rows while another Mac holds the thread', () => {
    // This server runs nothing for a thread the other Mac holds: an empty live list says nothing about its agents.
    const t = mergeTasks(stored(), [], 't1', { feedLive: true, here: false }).get('toolu_a')!;
    expect(t.running).toBe(true);
  });

  it('leaves stored rows alone until the feed is live', () => {
    expect(mergeTasks(stored(), [], 't1', { feedLive: false, here: true }).get('toolu_a')!.running).toBe(true);
  });
});

describe('answers on delegation cards', () => {
  const report = (thread_id: string, text: string, shown = true): Item => ({ type: 'report', key: text.length, at: '2026-10-04T09:05:00Z', p: { thread_id, text, ...(shown && { shown }) } as ReportP });
  const calls = [call('d1', 'mcp__omni__delegate', { text: '{"thread_id":"a"}' }), call('d2', 'mcp__omni__delegate', { text: '{"thread_id":"b"}' })];
  const tools: Item = { type: 'tools', key: 1, calls, total: 2 } as Item;

  it("puts a report shown in place on its thread's card, the latest when it reported twice", () => {
    const answers = shownAnswers([tools, report('a', 'first'), report('a', 'second one'), report('b', 'relayed', false), report('gone', 'no card here')]);
    expect([...answers.keys()]).toEqual(['a']);
    expect(answers.get('a')?.text).toBe('second one');
    expect(answersFor(calls, answers)).toEqual({ a: expect.objectContaining({ text: 'second one' }) });
    expect(answersFor([call('r', 'Read', { text: 'x' })], answers)).toBeUndefined();
  });
});
