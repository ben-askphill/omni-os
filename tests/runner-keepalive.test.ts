import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-harness.ts';

// Idle processes close after OMNI_KEEPALIVE_SECONDS; the next message resumes the session in a new one.
const h = await startRunner({ OMNI_KEEPALIVE_SECONDS: '1' });
const r = h.runner;
const T = { timeout: 20_000 };

async function runThenExpire(prompt: string) {
  const t = await h.start(prompt);
  await h.untilResults(t.id, 1);
  expect(r.isLive(t.id)).toBe(true);
  await h.until('keepalive expiry', () => !r.isLive(t.id), 5000);
  const [first] = h.spawns(t.id);
  await h.until('first process exited', () => !h.fakeAlive(first.pid));
  // Closing an idle process changes nothing visible.
  expect(h.thread(t.id).status).toBe('done');
  expect(h.byKind(t.id, 'error')).toEqual([]);
  return t;
}

describe('runner: keepalive', () => {
  it('closes an idle process after the keepalive and resumes the session in a new one', T, async () => {
    const t = await runThenExpire('hello');
    r.sendMessage(t.id, 'again');
    await h.untilResults(t.id, 2);

    const spawns = h.spawns(t.id);
    expect(spawns).toHaveLength(2);
    expect(spawns[0]).toMatchObject({ session_id: t.session_id, resume: false });
    expect(spawns[0].args).toContain('--session-id');
    expect(spawns[1]).toMatchObject({ session_id: t.session_id, resume: true });
    expect(spawns[1].args).toContain('--resume');
    expect(spawns[1].args).not.toContain('--session-id');
    expect(h.byKind(t.id, 'init')).toHaveLength(2);
    expect(h.flow(t.id)).toEqual(['user', 'assistant_text', 'result', 'user', 'assistant_text', 'result']);
    expect(h.byKind(t.id, 'user')[1].p).toEqual({ text: 'again', source: 'ben' });
    expect(h.texts(t.id, 'assistant_text')).toEqual(['ack: hello', 'ack: again']);
    expect(h.thread(t.id).status).toBe('done');
    expect(r.isLive(t.id)).toBe(true);
  });

  it('ignores a zero-turn result flushed on resume: not stored, not a turn end', T, async () => {
    process.env.FAKE_CLAUDE_RESUME_FLUSH = '1';
    try {
      const t = await runThenExpire('first');
      r.sendMessage(t.id, 'second');
      await h.untilResults(t.id, 2);
      expect(h.spawns(t.id)[1]).toMatchObject({ resume: true });
      expect(h.byKind(t.id, 'result').map((e) => e.p.turns)).toEqual([1, 1]);
      expect(h.flow(t.id)).toEqual(['user', 'assistant_text', 'result', 'user', 'assistant_text', 'result']);
      expect(h.texts(t.id, 'assistant_text')).toEqual(['ack: first', 'ack: second']);
      expect(h.statuses(t.id).filter((s) => s === 'done')).toEqual(['done', 'done']);
      expect(h.thread(t.id).status).toBe('done');
    } finally {
      delete process.env.FAKE_CLAUDE_RESUME_FLUSH;
    }
  });
});
