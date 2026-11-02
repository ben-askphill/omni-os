import type { ActionRun, ChannelAction, ThreadActions } from '@omni/shared/channel-actions.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createActionsLive, POLL_MS } from '../src/live/actions';

const action = (id: string): ChannelAction => ({ id, channel_id: 'c', name: id, command: `echo ${id}`, secrets: [], port: null, setup: null, position: 0, created_at: '', updated_at: '' });
const run = (id: string, state: ActionRun['state'], action_id: string | null = 'a'): ActionRun => ({
  id, thread_id: 't', action_id, name: id, command: '', cwd: '', port: null, state, exit_code: null, error: null, output: '', output_bytes: 0, started_at: '', ended_at: null,
});
const data = (runs: ActionRun[], over: Partial<ThreadActions> = {}): ThreadActions => ({ actions: [action('a')], runs, blocked: null, setup_run: null, ...over });

function setup(initial: ThreadActions) {
  let server = initial;
  const api = {
    threadActions: vi.fn(async (_id: string) => server),
    runAction: vi.fn(async (_t: string, id: string) => run(`run-${id}`, 'running', id)),
    stopActionRun: vi.fn(async (_t: string, id: string) => run(id, 'stopped')),
    retryActionRun: vi.fn(async (_t: string, id: string) => run(`again-${id}`, 'running')),
  };
  const live = createActionsLive({ api, withAuth: (f) => f(), threadId: 't' });
  return { api, live, serve: (next: ThreadActions) => (server = next) };
}

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createActionsLive', () => {
  it('loads once when nothing runs', async () => {
    const t = setup(data([run('r', 'succeeded')]));
    await settle(POLL_MS * 5);
    expect(t.api.threadActions).toHaveBeenCalledTimes(1);
    expect(t.live.view.get()).toMatchObject({ loading: false, error: null });
    expect(t.live.view.get().data?.runs.map((r) => r.id)).toEqual(['r']);
    t.live.close();
  });

  it('polls while a run runs and stops once it finished', async () => {
    const t = setup(data([run('r', 'running')]));
    await settle();
    await settle(POLL_MS);
    expect(t.api.threadActions).toHaveBeenCalledTimes(2);
    t.serve(data([run('r', 'succeeded')]));
    await settle(POLL_MS);
    expect(t.live.view.get().data?.runs[0]?.state).toBe('succeeded');
    const calls = t.api.threadActions.mock.calls.length;
    await settle(POLL_MS * 5);
    expect(t.api.threadActions).toHaveBeenCalledTimes(calls);
    t.live.close();
  });

  it('does not let a load that started before Run erase the run it started', async () => {
    const t = setup(data([]));
    await settle();
    let answer!: (d: ThreadActions) => void;
    t.api.threadActions.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const slow = t.live.reload();
    await t.live.run(action('a'));
    expect(t.live.view.get().data?.runs.map((r) => r.id)).toEqual(['run-a']);
    t.serve(data([run('run-a', 'running')]));
    answer(data([]));
    await slow;
    await settle();
    expect(t.live.view.get().data?.runs.map((r) => r.id)).toEqual(['run-a']);
    const calls = t.api.threadActions.mock.calls.length;
    await settle(POLL_MS);
    expect(t.api.threadActions.mock.calls.length).toBeGreaterThan(calls);
    t.live.close();
  });

  it('keeps the runs on screen when a poll fails, and tries again', async () => {
    const t = setup(data([run('r', 'running')]));
    await settle();
    t.api.threadActions.mockRejectedValueOnce(new Error('offline'));
    await settle(POLL_MS);
    expect(t.live.view.get().error).toBe('offline');
    expect(t.live.view.get().data?.runs).toHaveLength(1);
    await settle(POLL_MS);
    expect(t.live.view.get().error).toBeNull();
    t.live.close();
  });

  it('shows a started run at once and begins polling for it', async () => {
    const t = setup(data([]));
    await settle();
    const started = t.live.run(action('a'));
    expect(t.live.view.get().busy.has('a')).toBe(true);
    await started;
    expect(t.live.view.get().busy.size).toBe(0);
    expect(t.live.view.get().data?.runs.map((r) => [r.id, r.state])).toEqual([['run-a', 'running']]);
    const before = t.api.threadActions.mock.calls.length;
    await settle(POLL_MS);
    expect(t.api.threadActions.mock.calls.length).toBe(before + 1);
    t.live.close();
  });

  it('puts the server message on the action that was refused', async () => {
    const t = setup(data([], { blocked: 'preparing' }));
    await settle();
    t.api.runAction.mockRejectedValueOnce(new Error('The worktree is still being prepared'));
    expect(await t.live.run(action('a'))).toBeUndefined();
    expect(t.live.view.get().errors).toEqual({ a: 'The worktree is still being prepared' });
    await t.live.run(action('a'));
    expect(t.live.view.get().errors).toEqual({});
    t.live.close();
  });

  it('replaces a run with its stopped copy', async () => {
    const t = setup(data([run('r', 'running')]));
    await settle();
    await t.live.stop(run('r', 'running'));
    expect(t.live.view.get().data?.runs.map((r) => [r.id, r.state])).toEqual([['r', 'stopped']]);
    t.live.close();
  });

  it('makes the retry of a setup run the setup run', async () => {
    const failed = run('s', 'failed');
    const t = setup(data([failed], { setup_run: failed }));
    await settle();
    await t.live.retry(failed);
    expect(t.live.view.get().data?.setup_run?.id).toBe('again-s');
    expect(t.live.view.get().data?.runs[0]?.id).toBe('again-s');
    t.live.close();
  });

  it('stops polling while paused and loads again on resume', async () => {
    const t = setup(data([run('r', 'running')]));
    await settle();
    t.live.pause();
    const calls = t.api.threadActions.mock.calls.length;
    await settle(POLL_MS * 3);
    expect(t.api.threadActions).toHaveBeenCalledTimes(calls);
    t.live.resume();
    await settle();
    expect(t.api.threadActions.mock.calls.length).toBe(calls + 1);
    t.live.close();
  });

  it('asks for nothing after it is closed', async () => {
    const t = setup(data([run('r', 'running')]));
    await settle();
    t.live.close();
    const calls = t.api.threadActions.mock.calls.length;
    await settle(POLL_MS * 3);
    expect(t.api.threadActions).toHaveBeenCalledTimes(calls);
    expect(await t.live.run(action('a'))).toBeUndefined();
  });

  it('does nothing when the device is not paired', async () => {
    const live = createActionsLive({ api: null, withAuth: (f) => f(), threadId: 't' });
    await settle();
    expect(live.view.get().data).toBeNull();
    expect(await live.run(action('a'))).toBeUndefined();
  });
});
