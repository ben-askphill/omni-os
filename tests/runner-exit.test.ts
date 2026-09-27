import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-boot.ts';

// A CLI can exit while a process it started still holds its stdout (ORPHAN in the fake), so its pipes
// never close. The runner must see the exit anyway: the turn ends and shutdownAll finishes. It stops
// waiting on the pipes, it does not kill what holds them: that process is the CLI's, not Omni's.

const h = await startRunner({ FAKE_CLAUDE_CRASH_ON: 'CRASH_NOW' });
const r = h.runner;
const T = { timeout: 20_000 };

/** The process ORPHAN left behind for this thread. */
const orphanOf = (id: string) =>
  h.until(`the orphan of ${id}`, () => h.invocations().find((i) => i.mode === 'orphan' && i.thread_id === id));

describe('runner: a CLI whose stdout outlives it', () => {
  it('fails the turn when the CLI crashes, and the next message starts a fresh process', T, async () => {
    const t = await h.start('ORPHAN start a watcher');
    await h.untilResults(t.id, 1);
    const orphan = await orphanOf(t.id);

    r.sendMessage(t.id, 'CRASH_NOW please');
    await h.untilStatus(t.id, 'failed', 3000);
    await h.until('process gone', () => !r.isLive(t.id));
    expect(h.fakeAlive(orphan.pid)).toBe(true);
    const errors = h.byKind(t.id, 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].p.text).toContain('crashed on purpose');
    expect(h.byKind(t.id, 'user').filter((e) => e.p.dropped).map((e) => e.p.text)).toEqual(['CRASH_NOW please']);
    expect(r.runningCount()).toBe(0);

    r.sendMessage(t.id, 'after the crash');
    await h.untilResults(t.id, 2);
    expect(h.thread(t.id).status).toBe('done');
    expect(h.texts(t.id, 'assistant_text')).toEqual(['ack: ORPHAN start a watcher', 'ack: after the crash']);
    expect(h.spawns(t.id)).toHaveLength(2);
  });

  it('stops the turn when the CLI ignores the interrupt and gets hard stopped', T, async () => {
    const t = await h.start('ORPHAN TOOL:8000 IGNORE_INTERRUPT');
    await h.untilTool(t.id);
    const orphan = await orphanOf(t.id);

    r.interruptThread(t.id);
    // SIGINT once the 1s grace period is over.
    await h.untilStatus(t.id, 'stopped', 4000);
    await h.until('process gone', () => !r.isLive(t.id));
    expect(h.fakeAlive(orphan.pid)).toBe(true);
    expect(h.byKind(t.id, 'error')).toEqual([]);
    expect(r.runningCount()).toBe(0);

    r.sendMessage(t.id, 'after the stop');
    await h.untilResults(t.id, 1);
    expect(h.thread(t.id).status).toBe('done');
    expect(h.texts(t.id, 'assistant_text')).toEqual(['ack: after the stop']);
    expect(h.spawns(t.id)).toHaveLength(2);
  });

  it('shutdownAll finishes once the CLI has exited', T, async () => {
    const t = await h.start('ORPHAN keep this one open');
    await h.untilResults(t.id, 1);
    const orphan = await orphanOf(t.id);
    expect(r.isLive(t.id)).toBe(true);

    let finished = false;
    void r.shutdownAll().then(() => (finished = true));
    // The CLI exits as soon as its stdin ends.
    await h.until('shutdownAll to finish', () => finished, 2000);
    expect(r.isLive(t.id)).toBe(false);
    expect(h.fakeAlive(orphan.pid)).toBe(true);
    // Closing an idle session is not a failure.
    expect(h.thread(t.id).status).toBe('done');
    expect(h.byKind(t.id, 'error')).toEqual([]);
  });
});
