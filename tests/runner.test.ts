import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-harness.ts';
import { sleep } from './support.ts';

// Integration: the real runner, a temp data dir and the fake claude CLI (tests/fixtures/fake-claude.mjs).
// Keepalive expiry and slot limits live in their own files because config is read once per module graph.

// A stale key in the server's shell env, like one exported from ~/.zshrc. It must never reach the CLI.
const h = await startRunner({ FAKE_CLAUDE_CRASH_ON: 'CRASH_NOW', ANTHROPIC_API_KEY: 'sk-ant-stale', ANTHROPIC_AUTH_TOKEN: 'stale' });
const r = h.runner;
const T = { timeout: 20_000 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('runner: live sessions', () => {
  it('runs the first message of a new thread in a warm stream-json process', T, async () => {
    const t = await h.start('hello there');
    await h.untilResults(t.id, 1);

    expect(h.thread(t.id)).toMatchObject({ status: 'done', has_run: 1, last_text: 'ack: hello there' });
    expect(h.flow(t.id)).toEqual(['user', 'assistant_text', 'result']);
    expect(h.byKind(t.id, 'user')[0].p).toEqual({ text: 'hello there', source: 'manual' });
    expect(h.byKind(t.id, 'init')).toHaveLength(1);
    const [result] = h.byKind(t.id, 'result');
    expect(result.p).toMatchObject({ ok: true, subtype: 'success', turns: 1 });
    expect(result.p.text).toBeUndefined();
    expect(result.p.stopped).toBeUndefined();

    expect(r.isLive(t.id)).toBe(true);
    expect(r.pendingFor(t.id)).toEqual([]);
    expect(r.runningCount()).toBe(0);

    const spawns = h.spawns(t.id);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatchObject({ session_id: t.session_id, resume: false, unknown: [] });
    expect(spawns[0].args).toEqual(
      expect.arrayContaining(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages', '--session-id']),
    );
    await h.until('generated title', () => h.thread(t.id).title === 'Fake title');
  });

  it('never hands API key auth to the CLI, so every run uses the subscription login', T, async () => {
    const t = await h.start('who pays');
    await h.untilResults(t.id, 1);
    await h.until('title spawn logged', () => h.invocations().some((i) => i.mode === 'text'));
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-stale');
    expect(h.invocations().length).toBeGreaterThan(0);
    for (const i of h.invocations()) expect(i.api_auth).toEqual([]);
  });

  it('delivers steers sent during a tool after its tool_result, in the same turn', T, async () => {
    const t = await h.start('TOOL:1500 build it');
    await h.untilTool(t.id);
    expect(h.thread(t.id).status).toBe('running');

    r.sendMessage(t.id, 'steer: add PINEAPPLE');
    r.sendMessage(t.id, 'steer: and MANGO', { mode: 'steer' });
    const pending = r.pendingFor(t.id);
    expect(pending).toMatchObject([
      { kind: 'user', text: 'steer: add PINEAPPLE', source: 'ben', mode: 'steer', state: 'sent' },
      { kind: 'user', text: 'steer: and MANGO', source: 'ben', mode: 'steer', state: 'sent' },
    ]);
    expect(pending[0].uuid).toMatch(UUID);
    expect(pending[0].uuid).not.toBe(pending[1].uuid);

    await h.untilResults(t.id, 1);
    expect(h.flow(t.id)).toEqual(['user', 'tool_use', 'tool_result', 'user', 'user', 'assistant_text', 'result']);
    expect(h.byKind(t.id, 'user').map((e) => e.p)).toEqual([
      { text: 'TOOL:1500 build it', source: 'manual' },
      { text: 'steer: add PINEAPPLE', source: 'ben', mode: 'steer' },
      { text: 'steer: and MANGO', source: 'ben', mode: 'steer' },
    ]);
    expect(h.texts(t.id, 'assistant_text')).toEqual(['ack: TOOL:1500 build it | steer: add PINEAPPLE | steer: and MANGO']);
    expect(h.byKind(t.id, 'result')).toHaveLength(1);
    expect(h.byKind(t.id, 'result')[0].p).toMatchObject({ ok: true, turns: 2 });
    expect(h.thread(t.id).status).toBe('done');
    expect(r.pendingFor(t.id)).toEqual([]);
  });

  it('runs a steer sent while the agent only writes text as the next turn, without ending the run in between', T, async () => {
    const t = await h.start('THINK:1000 write a paragraph');
    await h.until('first message replayed', () => h.byKind(t.id, 'user').length === 1);
    r.sendMessage(t.id, 'steer: end with PINEAPPLE');
    expect(r.pendingFor(t.id)).toMatchObject([{ kind: 'user', text: 'steer: end with PINEAPPLE', mode: 'steer', state: 'sent' }]);

    await h.untilResults(t.id, 2);
    expect(h.flow(t.id)).toEqual(['user', 'assistant_text', 'result', 'user', 'assistant_text', 'result']);
    expect(h.byKind(t.id, 'user')[1].p).toEqual({ text: 'steer: end with PINEAPPLE', source: 'ben', mode: 'steer' });
    expect(h.texts(t.id, 'assistant_text')).toEqual(['ack: THINK:1000 write a paragraph', 'ack: steer: end with PINEAPPLE']);
    // The first result did not end the run: the CLI picked the steer up by itself.
    expect(h.statuses(t.id).filter((s) => s === 'done')).toEqual(['done']);
    expect(h.statuses(t.id).at(-1)).toBe('done');
    // One init per process in the transcript, although the CLI emits one per turn.
    expect(h.byKind(t.id, 'init')).toHaveLength(1);
    expect(h.spawns(t.id)).toHaveLength(1);
    expect(h.thread(t.id).last_text).toBe('ack: steer: end with PINEAPPLE');
  });

  it('holds a queued message until the turn ends, then runs it as its own turn', T, async () => {
    const t = await h.start('TOOL:1200 work');
    await h.untilTool(t.id);
    r.sendMessage(t.id, 'queued follow-up', { mode: 'queue' });
    expect(r.pendingFor(t.id)).toMatchObject([{ kind: 'user', text: 'queued follow-up', source: 'ben', mode: 'queue', state: 'held' }]);

    await h.untilResults(t.id, 2);
    expect(h.flow(t.id)).toEqual(['user', 'tool_use', 'tool_result', 'assistant_text', 'result', 'user', 'assistant_text', 'result']);
    // Not sent mid-turn, so no mode label in the transcript.
    expect(h.byKind(t.id, 'user')[1].p).toEqual({ text: 'queued follow-up', source: 'ben' });
    expect(h.texts(t.id, 'assistant_text')).toEqual(['ack: TOOL:1200 work', 'ack: queued follow-up']);
    expect(h.statuses(t.id).filter((s) => s === 'done')).toEqual(['done']);
    expect(h.spawns(t.id)).toHaveLength(1);
    expect(r.pendingFor(t.id)).toEqual([]);
  });

  it('interrupts a turn but keeps the process, and the next message continues in it', T, async () => {
    const t = await h.start('TOOL:6000 long job');
    await h.untilTool(t.id);
    const t0 = Date.now();
    r.interruptThread(t.id);
    await h.untilStatus(t.id, 'stopped');
    expect(Date.now() - t0).toBeLessThan(3000);

    expect(h.flow(t.id)).toEqual(['user', 'tool_use', 'tool_result', 'result']);
    const [rejected] = h.byKind(t.id, 'tool_result');
    expect(rejected.p.is_error).toBe(true);
    expect(rejected.p.text).toContain("doesn't want to proceed");
    expect(h.byKind(t.id, 'result')[0].p).toMatchObject({ ok: false, subtype: 'error_during_execution', stopped: true });
    // The "[Request interrupted by user for tool use]" marker is plumbing, not a message.
    expect(h.events(t.id).some((e) => JSON.stringify(e.p).includes('[Request interrupted'))).toBe(false);
    expect(r.isLive(t.id)).toBe(true);
    expect(r.runningCount()).toBe(0);

    r.sendMessage(t.id, 'what were you doing?');
    await h.untilResults(t.id, 2);
    expect(h.thread(t.id).status).toBe('done');
    expect(h.byKind(t.id, 'user')[1].p).toEqual({ text: 'what were you doing?', source: 'ben' });
    expect(h.texts(t.id, 'assistant_text')).toEqual(['ack: what were you doing?']);
    expect(h.byKind(t.id, 'result')[1].p.stopped).toBeUndefined();
    expect(h.spawns(t.id)).toHaveLength(1);
    // The interrupt fallback timer (OMNI_INTERRUPT_GRACE_MS=1000) must not kill the process later.
    await sleep(1300);
    expect(r.isLive(t.id)).toBe(true);
    expect(h.thread(t.id).status).toBe('done');
  });

  it('interrupt and send runs the new message right after the interrupt', T, async () => {
    const t = await h.start('TOOL:6000 long job');
    await h.untilTool(t.id);
    const t0 = Date.now();
    r.sendMessage(t.id, 'new direction', { mode: 'interrupt' });
    expect(r.pendingFor(t.id)).toMatchObject([{ kind: 'user', text: 'new direction', mode: 'interrupt', state: 'sent' }]);

    await h.untilResults(t.id, 2);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(h.flow(t.id)).toEqual(['user', 'tool_use', 'tool_result', 'result', 'user', 'assistant_text', 'result']);
    const [stopped, next] = h.byKind(t.id, 'result');
    expect(stopped.p).toMatchObject({ ok: false, stopped: true });
    expect(next.p).toMatchObject({ ok: true });
    expect(next.p.stopped).toBeUndefined();
    expect(h.byKind(t.id, 'user')[1].p).toEqual({ text: 'new direction', source: 'ben', mode: 'interrupt' });
    expect(h.texts(t.id, 'assistant_text')).toEqual(['ack: new direction']);
    expect(h.thread(t.id).status).toBe('done');
    expect(h.statuses(t.id)).not.toContain('stopped');
    expect(h.spawns(t.id)).toHaveLength(1);
  });

  it('hard stops a CLI that ignores the interrupt once the grace period is over', T, async () => {
    const t = await h.start('TOOL:8000 IGNORE_INTERRUPT');
    await h.untilTool(t.id);
    const t0 = Date.now();
    r.interruptThread(t.id);
    await sleep(300);
    expect(h.thread(t.id).status).toBe('running');

    await h.untilStatus(t.id, 'stopped', 7000);
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(900);
    expect(took).toBeLessThan(6000);
    await h.until('process gone', () => !r.isLive(t.id));
    expect(h.byKind(t.id, 'error')).toEqual([]);
    expect(r.runningCount()).toBe(0);
  });

  it('stops a process that is still starting up at once, instead of waiting out the grace period', T, async () => {
    process.env.FAKE_CLAUDE_STARTUP_MS = '5000';
    let id: string;
    try {
      const t = await h.start('never gets going');
      id = t.id;
      // Booted and connecting its (fake) MCP servers.
      await h.until('process started', () => h.spawns(t.id).length === 1);
      expect(r.isLive(t.id)).toBe(true);
      const t0 = Date.now();
      r.interruptThread(t.id);
      await h.untilStatus(t.id, 'stopped');
      // OMNI_INTERRUPT_GRACE_MS is 1000, so this was not the fallback timer.
      expect(Date.now() - t0).toBeLessThan(900);
    } finally {
      delete process.env.FAKE_CLAUDE_STARTUP_MS;
    }
    await h.until('process gone', () => !r.isLive(id));
    expect(h.byKind(id, 'user').map((e) => e.p)).toEqual([{ text: 'never gets going', source: 'manual', dropped: true }]);
    expect(h.byKind(id, 'error')).toEqual([]);
    expect(h.byKind(id, 'result')).toEqual([]);
    expect(r.pendingFor(id)).toEqual([]);
    expect(r.runningCount()).toBe(0);

    r.sendMessage(id, 'now go');
    await h.untilResults(id, 1);
    expect(h.thread(id).status).toBe('done');
    expect(h.texts(id, 'assistant_text')).toEqual(['ack: now go']);
    expect(h.spawns(id)).toHaveLength(2);
  });

  it('fails a thread whose CLI crashes mid-turn and records undelivered messages as dropped', T, async () => {
    const t = await h.start('TOOL:1200 before the crash');
    await h.untilTool(t.id);
    r.sendMessage(t.id, 'CRASH_NOW please');
    r.sendMessage(t.id, 'second steer');
    r.sendMessage(t.id, 'held for later', { mode: 'queue' });

    await h.untilStatus(t.id, 'failed');
    await h.until('process gone', () => !r.isLive(t.id));
    expect(h.flow(t.id).slice(0, 3)).toEqual(['user', 'tool_use', 'tool_result']);
    const errors = h.byKind(t.id, 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].p.text).toContain('crashed on purpose');
    const dropped = h.byKind(t.id, 'user').filter((e) => e.p.dropped);
    expect(dropped.map((e) => e.p)).toMatchObject([
      { text: 'CRASH_NOW please', dropped: true },
      { text: 'second steer', dropped: true },
      { text: 'held for later', dropped: true },
    ]);
    expect(r.pendingFor(t.id)).toEqual([]);
    expect(r.runningCount()).toBe(0);

    // The thread recovers with a fresh process.
    r.sendMessage(t.id, 'after the crash');
    await h.untilResults(t.id, 1);
    expect(h.thread(t.id).status).toBe('done');
    expect(h.texts(t.id, 'assistant_text')).toEqual(['ack: after the crash']);
    expect(h.spawns(t.id)).toHaveLength(2);
  });

  it('reports a finished crew thread to its busy parent as a steer', T, async () => {
    const parent = await h.start('TOOL:2500 parent work');
    await h.untilTool(parent.id);
    const child = await h.start('child task', { parent_id: parent.id });
    expect(child.task_id).toMatch(/^T-/);
    await h.untilResults(child.id, 1);

    const pending = await h.until('crew report pending on the parent', () =>
      r.pendingFor(parent.id).find((p) => p.kind === 'crew_report'),
    );
    expect(pending).toMatchObject({ kind: 'crew_report', mode: 'steer', state: 'sent', task_id: child.task_id });

    await h.untilResults(parent.id, 1);
    expect(h.flow(parent.id)).toEqual(['user', 'tool_use', 'tool_result', 'crew_report', 'assistant_text', 'result']);
    expect(h.byKind(parent.id, 'crew_report')[0].p).toMatchObject({
      task_id: child.task_id, thread_id: child.id, status: 'done', text: 'ack: child task',
    });
    const [reply] = h.texts(parent.id, 'assistant_text');
    expect(reply).toContain('[crew report]');
    expect(reply).toContain(child.task_id!);
    expect(h.thread(parent.id).status).toBe('done');
    expect(r.pendingFor(parent.id)).toEqual([]);
  });

  it('an interrupt the CLI answers between two of its turns stops nothing, and the next turn runs to the end', T, async () => {
    process.env.FAKE_CLAUDE_TURN_GAP_MS = '500';
    try {
      const t = await h.start('THINK:600 first');
      await h.until('first turn replayed', () => h.byKind(t.id, 'user').length === 1);
      // No tool boundary, so this steer runs as the CLI's next turn, after a gap.
      r.sendMessage(t.id, 'TOOL:1500 second');
      await h.until('first result', () => h.byKind(t.id, 'result').length === 1);
      expect(h.thread(t.id).status).toBe('running');
      r.interruptThread(t.id);

      // The grace timer (OMNI_INTERRUPT_GRACE_MS=1000) must not kill the steer's turn.
      await h.untilResults(t.id, 2);
      expect(h.thread(t.id).status).toBe('done');
      const [first, second] = h.byKind(t.id, 'result');
      expect(first.p.stopped).toBeUndefined();
      expect(second.p).toMatchObject({ ok: true });
      expect(second.p.stopped).toBeUndefined();
      expect(h.texts(t.id, 'assistant_text')).toEqual(['ack: THINK:600 first', 'ack: TOOL:1500 second']);
      expect(h.statuses(t.id)).not.toContain('stopped');
      expect(r.isLive(t.id)).toBe(true);
      expect(h.spawns(t.id)).toHaveLength(1);
    } finally {
      delete process.env.FAKE_CLAUDE_TURN_GAP_MS;
    }
  });

  it('after a hard stop, new and held messages wait for a fresh process instead of going to the dying one', T, async () => {
    process.env.FAKE_CLAUDE_SIGINT_EXIT_MS = '1500';
    let id: string;
    try {
      const t = await h.start('TOOL:8000 IGNORE_INTERRUPT');
      id = t.id;
      await h.untilTool(t.id);
      const [{ pid }] = h.spawns(t.id);
      r.interruptThread(t.id);
      await sleep(300);
      r.sendMessage(t.id, 'queued later', { mode: 'queue' });
      // The grace timer SIGINTs the CLI at 1000ms; it takes 1500ms more to exit.
      await sleep(1000);
      expect(h.fakeAlive(pid)).toBe(true);
      expect(r.isLive(t.id)).toBe(false);
      r.sendMessage(t.id, 'after the hard stop');
    } finally {
      delete process.env.FAKE_CLAUDE_SIGINT_EXIT_MS;
    }
    await h.untilResults(id, 1);
    expect(h.thread(id).status).toBe('done');
    expect(h.byKind(id, 'user').filter((e) => e.p.dropped)).toEqual([]);
    const said = h.texts(id, 'assistant_text').join('\n');
    expect(said).toContain('queued later');
    expect(said).toContain('after the hard stop');
    expect(h.spawns(id)).toHaveLength(2);
    expect(h.byKind(id, 'error')).toEqual([]);
  });

  it('interrupt and send while the process is still starting drops the first prompt and starts fresh', T, async () => {
    process.env.FAKE_CLAUDE_STARTUP_MS = '1500';
    let id: string;
    try {
      const t = await h.start('TOOL:2000 wrong prompt');
      id = t.id;
      await h.until('process started', () => h.spawns(t.id).length === 1);
      r.sendMessage(t.id, 'right prompt', { mode: 'interrupt' });
      expect(r.isLive(t.id)).toBe(false);
    } finally {
      delete process.env.FAKE_CLAUDE_STARTUP_MS;
    }
    await h.untilResults(id, 1);
    expect(h.thread(id).status).toBe('done');
    expect(h.byKind(id, 'user').map((e) => e.p)).toEqual([
      { text: 'TOOL:2000 wrong prompt', source: 'manual', dropped: true },
      { text: 'right prompt', source: 'ben' },
    ]);
    expect(h.byKind(id, 'tool_use')).toEqual([]);
    expect(h.texts(id, 'assistant_text')).toEqual(['ack: right prompt']);
    expect(h.spawns(id)).toHaveLength(2);
  });

  it('ends the turn of a local slash command, which calls no model', T, async () => {
    const t = await h.start('hello');
    await h.untilResults(t.id, 1);
    r.sendMessage(t.id, '/cost');
    await h.untilResults(t.id, 2);
    expect(h.thread(t.id)).toMatchObject({ status: 'done', last_text: 'Output of /cost' });
    expect(h.flow(t.id)).toEqual(['user', 'assistant_text', 'result', 'user', 'assistant_text', 'result']);
    expect(h.texts(t.id, 'assistant_text')).toEqual(['ack: hello', 'Output of /cost']);
    expect(h.byKind(t.id, 'result')[1].p).toMatchObject({ ok: true, turns: 0 });
    expect(r.runningCount()).toBe(0);
    expect(h.spawns(t.id)).toHaveLength(1);

    r.sendMessage(t.id, 'and now?');
    await h.untilResults(t.id, 3);
    expect(h.texts(t.id, 'assistant_text').at(-1)).toBe('ack: and now?');
  });

  it('tracks the turn the CLI runs by itself when a background task finishes, and reports it to the parent', T, async () => {
    const parent = await h.start('parent');
    await h.untilResults(parent.id, 1);
    const child = await h.start('BG:700 child with a watcher', { parent_id: parent.id });
    await h.untilResults(child.id, 1);
    expect(h.thread(child.id).last_text).toBe('ack: BG:700 child with a watcher');

    await h.until('background turn done', () => h.byKind(child.id, 'result').length === 2 && h.thread(child.id).status === 'done');
    expect(h.statuses(child.id).slice(-3)).toEqual(['done', 'running', 'done']);
    expect(h.thread(child.id).last_text).toBe('ack: BGDONE');
    expect(h.byKind(child.id, 'result')[1].p).toMatchObject({ ok: true });

    const reports = await h.until('two crew reports', () => {
      const all = h.byKind(parent.id, 'crew_report');
      return all.length === 2 && all;
    });
    expect(reports.map((e) => e.p.text)).toEqual(['ack: BG:700 child with a watcher', 'ack: BGDONE']);
    await h.untilResults(parent.id, 3);
    expect(h.thread(parent.id).status).toBe('done');
    expect(r.runningCount()).toBe(0);
  });

  it('shutdownAll closes every live process and waits for them to exit', T, async () => {
    const streams = h.invocations().filter((i) => i.mode === 'stream');
    const live = streams.filter((i) => r.isLive(i.thread_id));
    expect(live.length).toBeGreaterThan(2);
    const before = live.map((i) => [h.thread(i.thread_id).status, h.byKind(i.thread_id, 'error').length]);
    await r.shutdownAll();
    for (const i of streams) {
      expect(r.isLive(i.thread_id)).toBe(false);
      expect(h.fakeAlive(i.pid)).toBe(false);
    }
    // Closing idle sessions is not a failure.
    expect(live.map((i) => [h.thread(i.thread_id).status, h.byKind(i.thread_id, 'error').length])).toEqual(before);
  });
});
