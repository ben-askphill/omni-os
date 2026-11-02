import { describe, expect, it } from 'vitest';
import { anyRunning, liveRun, withRun, type ActionRun, type ChannelAction, type ThreadActions } from '../channel-actions.ts';

const action = (over: Partial<ChannelAction> = {}): ChannelAction => ({
  id: 'a1',
  channel_id: 'acme',
  name: 'Theme preview',
  command: 'shopify theme dev --port $OMNI_PORT',
  secrets: [],
  port: 0,
  setup: null,
  position: 0,
  created_at: '2026-01-05T09:00:00.000Z',
  updated_at: '2026-01-05T09:00:00.000Z',
  ...over,
});

const run = (over: Partial<ActionRun> = {}): ActionRun => ({
  id: 'r1',
  thread_id: 't1',
  action_id: 'a1',
  name: 'Theme preview',
  command: 'shopify theme dev --port $OMNI_PORT',
  cwd: '/tmp/acme',
  port: null,
  state: 'succeeded',
  exit_code: 0,
  error: null,
  output: 'ok\n',
  output_bytes: 3,
  started_at: '2026-01-05T09:00:00.000Z',
  ended_at: '2026-01-05T09:00:12.000Z',
  ...over,
});

const thread = (runs: ActionRun[], over: Partial<ThreadActions> = {}): ThreadActions => ({ actions: [action()], runs, blocked: null, setup_run: null, ...over });

describe('a thread\'s runs', () => {
  it('poll only while a run is running', () => {
    expect(anyRunning(undefined)).toBe(false);
    expect(anyRunning(thread([run()]))).toBe(false);
    expect(anyRunning(thread([run({ state: 'running', ended_at: null })]))).toBe(true);
  });

  it('find the run of an action still going, newest first', () => {
    const data = thread([run({ id: 'r3', state: 'running', ended_at: null }), run({ id: 'r2', state: 'running', ended_at: null }), run()]);
    expect(liveRun(data, action())?.id).toBe('r3');
    expect(liveRun(thread([run()]), action())).toBeUndefined();
    expect(liveRun(data, action({ id: 'other' }))).toBeUndefined();
  });
});

describe('answers to Run, Stop and Retry', () => {
  it('puts a new run on top and replaces a known one in place', () => {
    const data = thread([run({ id: 'r1' }), run({ id: 'r0' })]);
    expect(withRun(data, run({ id: 'r2', state: 'running' })).runs.map((r) => r.id)).toEqual(['r2', 'r1', 'r0']);
    const stopped = withRun(data, run({ id: 'r0', state: 'stopped' }));
    expect(stopped.runs.map((r) => [r.id, r.state])).toEqual([
      ['r1', 'succeeded'],
      ['r0', 'stopped'],
    ]);
  });

  it('updates the setup run when the answer is about it', () => {
    const data = thread([run({ id: 's1', state: 'running', ended_at: null })], { setup_run: run({ id: 's1', state: 'running', ended_at: null }) });
    expect(withRun(data, run({ id: 's1', state: 'stopped' })).setup_run?.state).toBe('stopped');
    expect(withRun(data, run({ id: 'r9' })).setup_run?.id).toBe('s1');
  });
});

