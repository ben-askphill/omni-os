import { describe, expect, it, vi } from 'vitest';

import { IDLE, switchReducer, switchThreadRun } from '../../src/thread/switch-state';
import { catalog, thread } from './fixtures';

const harnesses = catalog();

describe('switch state', () => {
  it('goes idle, switching, then back to idle', () => {
    const switching = switchReducer(IDLE, { type: 'start' });
    expect(switching).toEqual({ status: 'switching' });
    expect(switchReducer(switching, { type: 'done' })).toEqual(IDLE);
  });

  it('keeps the error until the sheet dismisses it', () => {
    const failed = switchReducer({ status: 'switching' }, { type: 'fail', error: 'Another machine runs this thread' });
    expect(failed).toEqual({ status: 'failed', error: 'Another machine runs this thread' });
    expect(switchReducer(failed, { type: 'dismiss' })).toEqual(IDLE);
  });

  it('does not dismiss a switch in flight', () => {
    expect(switchReducer({ status: 'switching' }, { type: 'dismiss' })).toEqual({ status: 'switching' });
  });

  it('takes a new switch after a failure', () => {
    expect(switchReducer({ status: 'failed', error: 'x' }, { type: 'start' })).toEqual({ status: 'switching' });
  });
});

describe('switching a thread run', () => {
  it('switches an idle thread and returns the thread now on the new run', async () => {
    const next = thread({ model: 'opus', effort: '' });
    const switchRun = vi.fn(async () => next);
    const out = await switchThreadRun({ switchRun }, 't1', thread(), harnesses, { harness: 'claude', model: 'opus' });
    expect(switchRun).toHaveBeenCalledWith('t1', { harness: 'claude', model: 'opus', effort: '' });
    expect(out).toEqual({ kind: 'switched', thread: next });
  });

  it('switches a running thread: the server queues it and the thread carries the queued run', async () => {
    const queued = thread({ status: 'running', queued_harness: 'codex', queued_model: 'gpt', queued_effort: '' });
    const switchRun = vi.fn(async () => queued);
    const out = await switchThreadRun({ switchRun }, 't1', thread({ status: 'running' }), harnesses, { harness: 'codex', model: 'gpt' });
    expect(switchRun).toHaveBeenCalledWith('t1', { harness: 'codex', model: 'gpt', effort: '' });
    expect(out).toEqual({ kind: 'switched', thread: queued });
  });

  it('sends nothing for the run already shown', async () => {
    const switchRun = vi.fn();
    const out = await switchThreadRun({ switchRun }, 't1', thread({ model: 'sonnet' }), harnesses, { harness: 'claude', model: 'sonnet' });
    expect(out).toEqual({ kind: 'unchanged' });
    expect(switchRun).not.toHaveBeenCalled();
  });

  it("fails with the server's words", async () => {
    const switchRun = vi.fn(async () => Promise.reject(new Error('This thread runs on another machine')));
    expect(await switchThreadRun({ switchRun }, 't1', thread(), harnesses, { effort: 'high' })).toEqual({
      kind: 'failed',
      error: 'This thread runs on another machine',
    });
  });
});
