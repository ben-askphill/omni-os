import { describe, expect, it } from 'vitest';
import { agentStatus, splitGroup } from '../web/src/transcript/delegation.ts';
import type { ToolCall } from '../web/src/transcript/fold.ts';

const call = (id: string, name: string, result?: { text: string; is_error?: boolean }): ToolCall => ({
  id,
  name,
  input: {},
  parent: null,
  result: result && { tool_use_id: id, text: result.text, is_error: !!result.is_error, truncated: false },
  at: '2026-10-04T09:00:00Z',
  children: [],
  orphan: false,
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
