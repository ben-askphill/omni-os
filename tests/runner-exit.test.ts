import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CURSOR } from './support.ts';

// A CLI can exit while a process it started still holds its stdout (ORPHAN in the fakes), so its pipes
// never close. Omni must see the exit anyway: the turn ends, the next message runs, the title lands and
// shutdownAll finishes. It stops waiting on the pipes, it does not kill what holds them: that process
// is the CLI's, not Omni's.

const h = await startRunner({ FAKE_CLAUDE_CRASH_ON: 'CRASH_NOW', OMNI_CURSOR_BIN: FAKE_CURSOR });
await (await import('../server/harness/catalog-service.ts')).loadCatalog(['cursor']);
const r = h.runner;
const T = { timeout: 20_000 };
const cursor = { harness: 'cursor', model: 'gpt-5.6-sol', effort: 'high' };

/** The process ORPHAN left behind for this thread. */
const orphanOf = (id: string) =>
  h.until(`the orphan of ${id}`, () => h.invocations().find((i) => i.mode === 'orphan' && i.thread_id === id));
/** The same for a Cursor thread, whose cursor-agent runs once per turn. */
const cursorOrphanOf = (id: string) =>
  h.until(`the orphan of ${id}`, () => h.cursorRequests().find((q) => q.method === 'orphan' && q.thread_id === id));
/** The thread's cursor-agent turns, oldest first. */
const turns = (id: string) => h.cursorRequests().filter((q) => q.method === 'turn' && q.thread_id === id);

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

  it('lands the title when the title call exits before the process it started', T, async () => {
    process.env.FAKE_CLAUDE_TITLE_ORPHAN = '1';
    try {
      const known = h.invocations().length;
      const t = await h.start('name this one');
      const call = await h.until('the title call', () => h.invocations().slice(known).find((i) => i.mode === 'text'));
      const orphan = await h.until('its orphan', () => h.invocations().find((i) => i.mode === 'orphan' && i.parent === call.pid));

      await h.until('the generated title', () => h.thread(t.id).title === 'Fake title', 3000);
      expect(h.fakeAlive(orphan.pid)).toBe(true);
    } finally {
      delete process.env.FAKE_CLAUDE_TITLE_ORPHAN;
    }
  });
});

// Cursor runs a cursor-agent per turn, which the runner never sees: it watches a holder process. The
// adapter must see each cursor-agent exit itself, or the thread never moves on.
describe('cursor: a cursor-agent whose stdout outlives it', () => {
  it('ends the turn, and the next message runs', T, async () => {
    const t = await h.start('ORPHAN start a watcher', cursor);
    await h.untilResults(t.id, 1);
    const orphan = await cursorOrphanOf(t.id);

    r.sendMessage(t.id, 'after the watcher');
    await h.untilResults(t.id, 2, 3000);
    expect(h.fakeAlive(orphan.pid, 'fake-cursor.mjs')).toBe(true);
    expect(h.thread(t.id).status).toBe('done');
    expect(h.texts(t.id, 'assistant_text').at(-1)).toBe('ack: after the watcher');
    expect(turns(t.id)).toHaveLength(2);
    expect(turns(t.id)[1]).toMatchObject({ prompt: 'after the watcher', resume: h.thread(t.id).session_id });
  });

  it('fails a turn that crashed without a result, and the next message runs', T, async () => {
    const t = await h.start('ORPHAN CRASH', cursor);
    await h.untilStatus(t.id, 'failed', 3000);
    const orphan = await cursorOrphanOf(t.id);
    expect(h.fakeAlive(orphan.pid, 'fake-cursor.mjs')).toBe(true);
    expect(h.texts(t.id, 'status')).toContain('fake-cursor: crashing on purpose');
    expect(h.byKind(t.id, 'result').map((e) => e.p.ok)).toEqual([false]);

    r.sendMessage(t.id, 'after the crash');
    await h.untilResults(t.id, 2, 3000);
    expect(h.thread(t.id).status).toBe('done');
    expect(h.texts(t.id, 'assistant_text').at(-1)).toBe('ack: after the crash');
    expect(turns(t.id)[1]).toMatchObject({ prompt: 'after the crash', resume: h.thread(t.id).session_id });
  });

  it('runs the first message when create-chat exits before the process it started', T, async () => {
    process.env.FAKE_CURSOR_CREATE_CHAT_ORPHAN = '1';
    try {
      const t = await h.start('hello', cursor);
      const orphan = await cursorOrphanOf(t.id);

      await h.untilResults(t.id, 1, 3000);
      expect(h.fakeAlive(orphan.pid, 'fake-cursor.mjs')).toBe(true);
      expect(h.thread(t.id).status).toBe('done');
      // The turn resumed the chat create-chat made.
      expect(h.thread(t.id).session_id).toMatch(/^chat_/);
      expect(turns(t.id)).toMatchObject([{ resume: h.thread(t.id).session_id }]);
    } finally {
      delete process.env.FAKE_CURSOR_CREATE_CHAT_ORPHAN;
    }
  });
});
