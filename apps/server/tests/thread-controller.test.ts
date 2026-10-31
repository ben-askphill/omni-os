// The thread controller (runner/controller.ts) with its deps replaced: the transitions move its state as the diagram
// in docs/internals/execution-state.md says, with no database, bus or real timer behind it.
import { describe, expect, it, vi } from 'vitest';
import type { ControllerDeps } from '../runner/ports.ts';
import type { HarnessSession } from '../harness/adapter.ts';
import { ThreadController } from '../runner/controller.ts';
import type { Msg } from '../runner/state.ts';

const msg = (uuid: string): Msg => ({ uuid, text: uuid, mode: 'steer', event: { kind: 'user', payload: { text: uuid } } });

/** Deps that record what they were asked and run timers by hand. */
function fakeDeps(generation = 3) {
  const timers: { ms: number; fn: () => void; unref?: boolean; cancelled: boolean }[] = [];
  const events: { threadId: string; kind: string; payload: unknown }[] = [];
  const deps: ControllerDeps = {
    reporting: {
      event: (threadId, kind, payload) => {
        events.push({ threadId, kind, payload });
        return { id: events.length };
      },
      thread: vi.fn(),
    },
    scheduling: {
      after: (ms, fn, opts) => {
        const t = { ms, fn, unref: opts?.unref, cancelled: false };
        timers.push(t);
        return t;
      },
      cancel: (t) => {
        if (t) (t as { cancelled: boolean }).cancelled = true;
      },
    },
    persistence: { claimTurn: vi.fn(() => generation) },
  };
  return { deps, timers, events, live: () => timers.filter((t) => !t.cancelled) };
}

function fakeSession(): HarnessSession & { ended: string[] } {
  const s = { alive: true, ended: [] as string[] } as HarnessSession & { ended: string[] };
  s.end = (how) => {
    s.ended.push(how);
  };
  s.send = () => true;
  s.interrupt = () => true;
  return s;
}

const thread = { id: 't1', channel_id: 'c1', session_id: 't1', harness: 'claude-code' };

describe('ThreadController', () => {
  it('starts in a turn with the first message inflight, and claims the turn on request', () => {
    const { deps } = fakeDeps(7);
    const c = new ThreadController(thread, msg('a'), deps);
    expect(c.turn).toBe(true);
    expect(c.inflight.map((m) => m.uuid)).toEqual(['a']);
    expect(c.generation).toBeUndefined();
    c.claimTurn();
    expect(deps.persistence.claimTurn).toHaveBeenCalledWith('t1');
    expect(c.generation).toBe(7);
  });

  it('a turn opens and closes: the idle timer is dropped, the interrupt cleared, the run start returned', () => {
    const { deps, timers, live } = fakeDeps();
    const c = new ThreadController(thread, msg('a'), deps);
    c.closeTurn();
    c.armIdle(600_000, () => {});
    expect(live()).toHaveLength(1);
    c.beginTurn();
    expect(c.turn).toBe(true);
    expect(live()).toHaveLength(0);
    c.turnOpenedAt(42);
    c.armInterrupt('int1', 1000, () => {});
    expect(c.closeTurn()).toBe(41);
    expect(c.turn).toBe(false);
    expect(c.interrupt).toBeNull();
    expect(c.turnFrom).toBe(0);
    expect(timers.every((t) => t.cancelled)).toBe(true);
  });

  it('what the stream said: init once per process, limit kept until the result, replay answers a zero-turn result', () => {
    const { deps } = fakeDeps();
    const c = new ThreadController(thread, msg('a'), deps);
    expect(c.sawInit()).toBe(true);
    expect(c.sawInit()).toBe(false);
    expect(c.cliTurn).toBe(true);
    c.sawLimit(100);
    c.sawLimit(undefined);
    expect(c.limit).toEqual({ resets_at: 100 });
    expect(c.takeInflight('zzz')).toBeUndefined();
    expect(c.takeInflight('a')?.uuid).toBe('a');
    expect(c.inflight).toEqual([]);
    expect(c.sawResult()).toEqual({ limit: { resets_at: 100 }, answered: true });
    expect(c.sawResult()).toEqual({ limit: null, answered: false });
    expect(c.cliTurn).toBe(false);
    expect(c.resultSeen).toBe(true);
  });

  it('held messages: next, all, some, replaced; messages kept or dropped', () => {
    const { deps } = fakeDeps();
    const c = new ThreadController(thread, msg('a'), deps);
    c.hold(msg('b'));
    c.hold(msg('c'));
    c.hold(msg('d'));
    expect(c.nextHeld()?.uuid).toBe('b');
    expect(c.takeHeldWhere((m) => m.uuid === 'd').map((m) => m.uuid)).toEqual(['d']);
    expect(c.held.map((m) => m.uuid)).toEqual(['c']);
    c.replaceHeld([msg('e'), msg('f')]);
    expect(c.takeHeld().map((m) => m.uuid)).toEqual(['e', 'f']);
    expect(c.held).toEqual([]);
    c.enqueue(msg('g'));
    c.hold(msg('h'));
    c.removeMessages((m) => m.uuid !== 'g');
    expect(c.inflight.map((m) => m.uuid)).toEqual(['a']);
    expect(c.held.map((m) => m.uuid)).toEqual(['h']);
  });

  it('unread messages are kept only while a release to another Mac is under way', () => {
    const { deps } = fakeDeps();
    const c = new ThreadController(thread, msg('a'), deps);
    expect(c.keepUnread([msg('x')])).toBe(false);
    const kept: Msg[] = [];
    c.releasing(kept);
    expect(c.keepUnread([msg('x'), msg('y')])).toBe(true);
    expect(kept.map((m) => m.uuid)).toEqual(['x', 'y']);
  });

  it('ending the session: stop sends SIGINT and a kill fallback, close ends stdin with an unref terminate, shutdown drops its fallbacks on exit', async () => {
    const { deps, timers, live } = fakeDeps();
    const stop = new ThreadController(thread, msg('a'), deps);
    const s1 = fakeSession();
    stop.attach(s1);
    stop.beginClosing();
    expect(stop.closing).toBe(true);
    stop.endSession('stop');
    expect(stop.hardStop).toBe(true);
    expect(s1.ended).toEqual(['stop']);
    expect(timers.at(-1)).toMatchObject({ ms: 5000 });
    timers.at(-1)!.fn();
    expect(s1.ended).toEqual(['stop', 'kill']);

    const close = new ThreadController(thread, msg('a'), deps);
    const s2 = fakeSession();
    close.attach(s2);
    close.endSession('close');
    expect(s2.ended).toEqual(['close']);
    expect(timers.at(-1)).toMatchObject({ ms: 10_000, unref: true });

    const down = new ThreadController(thread, msg('a'), deps);
    const s3 = fakeSession();
    down.attach(s3);
    down.endSession('shutdown');
    expect(down.shutdown).toBe(true);
    expect(s3.ended).toEqual(['close']);
    expect(live().map((t) => t.ms)).toContain(3000);
    down.tornDown();
    await down.exited;
    await Promise.resolve();
    expect(live().map((t) => t.ms)).not.toContain(3000);
    expect(down.turn).toBe(false);
    expect(down.inflight).toEqual([]);
  });

  it('an interrupt runs its late action only while the same interrupt is still open in a turn', () => {
    const { deps, timers } = fakeDeps();
    const c = new ThreadController(thread, msg('a'), deps);
    const late = vi.fn();
    c.armInterrupt('i1', 1000, late);
    expect(c.interrupt).toEqual({ id: 'i1', acked: false });
    c.ackInterrupt();
    expect(c.interrupt?.acked).toBe(true);
    c.clearInterrupt();
    timers[0].fn();
    expect(late).not.toHaveBeenCalled();
    c.armInterrupt('i2', 1000, late);
    timers[1].fn();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('tasks and mods: progress is persisted on a cadence, and the process going reports each task ended', () => {
    const { deps, events } = fakeDeps();
    const c = new ThreadController(thread, msg('a'), deps);
    const task = { thread_id: 't1', channel_id: 'c1', task_id: 'k1', description: 'Task', subagent: true, background: false, started_at: 'now' };
    c.taskStarted(task);
    expect(c.taskProgress('k1', { tokens: 5 })).toBe(true);
    expect(c.tasks.get('k1')?.tokens).toBe(5);
    expect(c.taskProgress('nope', {})).toBe(false);
    expect(c.taskSaveDue('k1', 20_000)).toBe(false);
    expect(c.taskSaveDue('k1', 20_000, true)).toBe(true);
    expect(c.taskSaveDue('k1', 0)).toBe(true);
    expect(c.setMod('p', 'working')).toBe(true);
    expect(c.setMod('p', 'working')).toBe(false);
    expect(c.setMod('q', null)).toBe(false);
    expect(c.setMod('p', null)).toBe(true);
    expect(c.clearMods()).toBe(false);
    expect(c.endTasks()).toBe(true);
    expect(events).toEqual([{ threadId: 't1', kind: 'task', payload: { task_id: 'k1', tool_use_id: undefined, event: 'ended', status: 'stopped' } }]);
    expect(c.tasks.size).toBe(0);
    expect(c.taskEnded('k1')).toBe(false);
  });

  it('handover and snapshot bookkeeping', () => {
    const { deps } = fakeDeps();
    const c = new ThreadController(thread, msg('a'), deps);
    c.handoverWaits(true);
    expect(c.handoverDue).toBe(true);
    const done = { to: { harness: 'codex', model: '', effort: '', harnessName: 'Codex', modelLabel: 'default' }, session: 'fresh' as const, entries: 1, omitted: 0, chars: 10 };
    c.carryHandover('a', done);
    expect(c.handoverRead()).toBe(done);
    expect(c.handoverRead()).toBeUndefined();
    c.snapStarted('s1');
    const gate = Promise.resolve();
    c.gateOn(gate);
    c.gateMessage(msg('b'));
    c.gateOff(Promise.resolve());
    expect(c.gate).toBe(gate);
    c.gateOff(gate);
    expect(c.gate).toBeNull();
    expect(c.takeGated().map((m) => m.uuid)).toEqual(['b']);
    expect(c.snapEnded()).toBe('s1');
    expect(c.snapEnded()).toBeNull();
  });
});
