import { describe, expect, it } from 'vitest';
import { applyHermesEvent, emptyHermesNorm, eventFromRun, previewText } from '../server/harness/hermes/normalize.ts';

const run = 'run_1';

/** The payloads observed live against the Hermes API server. */
const observed = [
  { event: 'tool.started', run_id: run, timestamp: 1, tool: 'terminal', preview: 'echo hi', seq: 0 },
  { event: 'tool.completed', run_id: run, timestamp: 2, tool: 'terminal', duration: 0.339, error: false, preview: '{"output": "hi", "exit_code": 0}', seq: 1 },
  { event: 'message.delta', run_id: run, timestamp: 3, delta: ' The command printed "hi".', seq: 3 },
  { event: 'reasoning.available', run_id: run, timestamp: 4, text: 'The shell said hi.', seq: 4 },
  {
    event: 'run.completed',
    run_id: run,
    timestamp: 5,
    output: 'The command printed "hi".',
    usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18, cache_read_tokens: 2, cache_write_tokens: 1 },
    runtime: { provider: 'anthropic', model: 'claude-opus-5-5', route_source: 'global' },
    seq: 5,
  },
];

const play = (events: unknown[]) => {
  let state = emptyHermesNorm();
  const records = [];
  let done = false;
  for (const evt of events) {
    const applied = applyHermesEvent(state, evt);
    state = applied.state;
    records.push(...applied.records);
    done = done || applied.done;
  }
  return { records, done, state };
};

describe('Hermes normalizer', () => {
  it('maps the observed run onto one Bash row, one assistant bubble and a result', () => {
    const { records, done } = play(observed);
    expect(done).toBe(true);
    expect(records.map((r) => r.kind)).toEqual(['tool_use', 'tool_result', 'assistant_text', 'result']);
    expect(records[0].payload).toMatchObject({ name: 'Bash', input: { command: 'echo hi' } });
    expect(records[1].payload).toMatchObject({ text: 'hi', is_error: false });
    expect(records[2].payload).toEqual({ text: 'The command printed "hi".' });
    expect(records[3].payload).toMatchObject({
      ok: true,
      subtype: 'success',
      turns: 1,
      model: 'claude-opus-5-5',
      input_tokens: 11,
      output_tokens: 7,
      cache_read_tokens: 2,
      cache_write_tokens: 1,
    });
  });

  it('does not mutate the previous state', () => {
    const prev = emptyHermesNorm();
    applyHermesEvent(prev, { event: 'message.delta', delta: 'a' });
    expect(prev.delta).toBe('');
  });

  it('drops reasoning and unknown events', () => {
    expect(applyHermesEvent(emptyHermesNorm(), { event: 'reasoning.available', text: 'hmm' }).records).toEqual([]);
    expect(applyHermesEvent(emptyHermesNorm(), { event: 'run.widget', text: 'nope' }).records).toEqual([]);
    expect(applyHermesEvent(emptyHermesNorm(), { event: 'message.started' }).records).toEqual([]);
  });

  it('surfaces an approval request as a status line', () => {
    const { records, done } = play([
      { event: 'approval.request', tool: 'terminal', preview: 'rm -rf /' },
      { event: 'approval.responded', decision: 'allow' },
    ]);
    expect(done).toBe(false);
    expect(records[0]).toMatchObject({ kind: 'status', payload: { text: 'Approval requested: terminal — rm -rf /' } });
    expect(records[1]).toMatchObject({ kind: 'status', payload: { text: 'Approval allow' } });
  });

  it('pairs a failed tool and a failed run', () => {
    const tool = play([
      { event: 'tool.started', tool: 'terminal', preview: 'false', seq: 0 },
      { event: 'tool.failed', tool: 'terminal', error: 'exit 1', seq: 1 },
    ]);
    expect(tool.records[1].payload).toMatchObject({ is_error: true, text: 'exit 1' });

    const failed = play([{ event: 'run.failed', error: 'boom' }]);
    expect(failed.done).toBe(true);
    expect(failed.records.map((r) => r.kind)).toEqual(['error', 'result']);
    expect(failed.records[1].payload).toMatchObject({ ok: false, subtype: 'error', turns: 1 });
  });

  it('ends a cancelled or interrupted run without treating it as success', () => {
    expect(play([{ event: 'run.cancelled' }]).records[0].payload).toMatchObject({ ok: false, subtype: 'cancelled', turns: 1 });
    expect(play([{ event: 'run.interrupted' }]).records[0].payload).toMatchObject({ ok: false, subtype: 'interrupted' });
  });

  it('renders a subagent as an Agent row', () => {
    const { records } = play([
      { event: 'subagent.start', name: 'builder', prompt: 'fix it', seq: 0 },
      { event: 'subagent.complete', status: 'ok', summary: 'fixed', seq: 1 },
    ]);
    expect(records[0].payload).toMatchObject({ name: 'Agent' });
    expect(records[1].payload).toMatchObject({ text: 'fixed', is_error: false });
  });

  it('still emits a tool row when the completion arrives without a start', () => {
    const { records } = play([{ event: 'tool.completed', tool: 'terminal', preview: 'echo hi', error: false, seq: 1 }]);
    expect(records.map((r) => r.kind)).toEqual(['tool_use', 'tool_result']);
  });

  it('flushes interim text once when it was already streamed', () => {
    const { records } = play([
      { event: 'message.delta', delta: 'hello' },
      { event: 'message.interim', text: 'hello', already_streamed: true },
    ]);
    expect(records).toEqual([{ kind: 'assistant_text', payload: { text: 'hello' } }]);
  });

  it('reads a tool result out of a JSON preview', () => {
    expect(previewText('{"output": "hi"}')).toBe('hi');
  });

  it('turns a finished GET body into the terminal event, and ignores a run that is still going', () => {
    expect(eventFromRun({ status: 'stopping' })).toBeNull();
    expect(eventFromRun({ status: 'running' })).toBeNull();
    expect(eventFromRun({ status: 'completed', output: 'done', usage: { input_tokens: 1 }, runtime: { model: 'm' } })).toMatchObject({
      event: 'run.completed',
      output: 'done',
    });
    expect(eventFromRun({ status: 'failed', error: 'nope' })).toEqual({ event: 'run.failed', error: 'nope' });
    expect(eventFromRun({ status: 'cancelled' })).toEqual({ event: 'run.cancelled' });
  });

  it('names a queued run', () => {
    expect(applyHermesEvent(emptyHermesNorm(), { event: 'run.queued' }).records[0]).toMatchObject({
      kind: 'status',
      payload: { text: 'Queued on Hermes' },
    });
  });
});
