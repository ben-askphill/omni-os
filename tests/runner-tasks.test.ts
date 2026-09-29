import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Background agents run on after the turn that started them. The process must outlive the keepalive while they
// do, and every one shows in activeTasks until it ends.
const h = await startRunner({ OMNI_KEEPALIVE_SECONDS: '1' });
const r = h.runner;
const T = { timeout: 20_000 };

describe('runner: background tasks', () => {
  it('lists a running background task, keeps its process past the keepalive, then lets it close', T, async () => {
    const t = await h.start('BG:2500 fan out');
    await h.untilResults(t.id, 1);
    const [task] = r.activeTasks().filter((x) => x.thread_id === t.id);
    expect(task).toMatchObject({ thread_id: t.id, channel_id: t.channel_id, background: true, description: 'Background task 2500ms', task_type: 'local_agent' });
    expect(h.thread(t.id).status).toBe('done');

    // Past the 1s keepalive, the process is still up for the task.
    await new Promise((ok) => setTimeout(ok, 1600));
    expect(r.isLive(t.id)).toBe(true);
    expect(r.activeTasks().find((x) => x.task_id === task.task_id)?.tool_uses).toBeGreaterThan(0);

    await h.until('task ended', () => !r.activeTasks().some((x) => x.thread_id === t.id), 5000);
    await h.untilResults(t.id, 2);
    const events = h.byKind(t.id, 'task').map((e) => e.p.event);
    expect(events[0]).toBe('started');
    expect(events.at(-1)).toBe('ended');
    expect(h.byKind(t.id, 'task').at(-1)!.p).toMatchObject({ task_id: task.task_id, status: 'completed' });

    // With nothing left running, the normal keepalive applies again.
    await h.until('keepalive expiry', () => !r.isLive(t.id), 5000);
    expect(h.byKind(t.id, 'error')).toEqual([]);
  });

  it('ends the tasks of a process that goes away', T, async () => {
    const t = await h.start('BG:8000 long');
    await h.untilResults(t.id, 1);
    expect(r.activeTasks().some((x) => x.thread_id === t.id)).toBe(true);
    await r.shutdownAll();
    expect(r.activeTasks()).toEqual([]);
    expect(h.byKind(t.id, 'task').at(-1)!.p).toMatchObject({ event: 'ended', status: 'stopped' });
  });
});
