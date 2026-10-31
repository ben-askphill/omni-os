import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { waitFor } from './support.ts';

// Delivery contract 3 (docs/internals/delivery.md): before a process resumes a thread, sync/files.ts beforeResume
// brings the other machine's newer session file. When that download fails or times out, runner/spawn.ts does not
// resume the stale session here (#400): the message waits for Resume, the thread says why, and Ben can try again or
// start with fresh context, a new session that reads the thread from Omni's transcript.

const r = await startRunner({ OMNI_KEEPALIVE_SECONDS: '0' });
const { MemoryTransport } = await import('../sync/transport.ts');
const sync = await import('../sync/worker.ts');
const files = await import('../sync/files.ts');

const relay = new MemoryTransport();
const home = join(r.tmp, 'home');
mkdirSync(home);
files.configureFileSync({ home, env: {}, turnDelayMs: 20, openEveryMs: 0 });
await sync.setActiveWorker(sync.createSyncWorker({ transport: relay, machineId: 'mac-a' }));

const sha = (b: string) => createHash('sha256').update(b).digest('hex');
const sessionFile = (t: { cwd: string; session_id: string }) => join(home, '.claude', 'projects', files.claudeProjectDir(t.cwd), `${t.session_id}.jsonl`);

/** The session file mac-b left in the relay after it ran more turns of the thread. */
function newerSessionOnMacB(id: string, sid: string, body: string) {
  const entry = { sha: sha(body), size: body.length, mtime: Date.now() };
  relay.objects.set(`sessions/claude-code/${sid}.jsonl`, Buffer.from(body));
  relay.objects.set(
    `manifests/${id}.json`,
    Buffer.from(JSON.stringify({ v: 1, files: {}, sessions: { [`claude-code:${sid}`]: { harness: 'claude-code', id: sid, files: { [`${sid}.jsonl`]: entry } } } })),
  );
}

/** A thread that ran one turn here, whose newer session mac-b left in the relay. */
async function staleHere(title: string) {
  const t = await r.start('first', { title });
  await r.untilResults(t.id, 1);
  const thread = r.thread(t.id);
  await waitFor(() => !r.runner.isLive(t.id), 'the first process to exit');
  // Let the upload after the first turn land before mac-b's newer session replaces it.
  await new Promise((res) => setTimeout(res, 100));
  mkdirSync(dirname(sessionFile(thread)), { recursive: true });
  writeFileSync(sessionFile(thread), '{"turn":1,"from":"mac-a"}\n');
  newerSessionOnMacB(t.id, thread.session_id, '{"turn":1,"from":"mac-a"}\n{"turn":2,"from":"mac-b"}\n');
  return { t, thread };
}

/** Send `text` while the relay refuses every download, and wait for the thread to settle. The resumed spawns. */
async function sendWhileRelayDown(id: string, text: string) {
  const before = r.spawns(id).length;
  const down = vi.spyOn(relay, 'getObject').mockRejectedValue(new Error('relay down'));
  let resumed: unknown[];
  try {
    await r.runner.postMessage(id, text, { requestId: `req-${text}` }).catch(() => {});
    // Settled: another process started, or the thread stopped without one.
    await waitFor(
      () => r.spawns(id).length > before || (!r.runner.isLive(id) && !['running', 'queued'].includes(r.thread(id).status)),
      'another process, or the thread to settle without one',
    );
    resumed = r.spawns(id).slice(before).filter((s) => s.args.includes('--resume'));
  } finally {
    down.mockRestore();
  }
  return resumed;
}

describe('a resume whose session download failed (#400)', () => {
  it('does not resume the stale session that is on this machine', { timeout: 20_000 }, async () => {
    const { t } = await staleHere('Stale resume');
    const resumed = await sendWhileRelayDown(t.id, 'second');

    // The session here lacks mac-b's turn, so resuming it would answer as if that turn never happened. A resume once
    // the download succeeds is fine; none while it fails.
    expect(resumed).toEqual([]);
    // Ben sees why, and his message waits for Resume.
    expect(r.thread(t.id).resume_blocked).toMatch(/download failed/);
    expect(r.texts(t.id, 'error').at(-1)).toMatch(/start with fresh context/);
    expect(r.runner.pendingFor(t.id).map((m) => [m.text, m.delivery])).toEqual([['second', 'recovered']]);
  });

  it('resumes the session once the download works again', { timeout: 20_000 }, async () => {
    const { t } = await staleHere('Stale then retried');
    await sendWhileRelayDown(t.id, 'second');
    await r.runner.retryResume(t.id);
    await r.untilResults(t.id, 2);
    const last = r.spawns(t.id).at(-1)!;
    expect(last.args).toContain('--resume');
    expect(r.thread(t.id).resume_blocked).toBeNull();
  });

  it('starts with fresh context: a new session that reads the thread', { timeout: 20_000 }, async () => {
    const { t, thread } = await staleHere('Stale then fresh');
    await sendWhileRelayDown(t.id, 'second');
    const down = vi.spyOn(relay, 'getObject').mockRejectedValue(new Error('relay down'));
    try {
      await r.runner.startFresh(t.id);
      await r.untilResults(t.id, 2);
    } finally {
      down.mockRestore();
    }
    const last = r.spawns(t.id).at(-1)!;
    expect(last.args).not.toContain('--resume');
    const now = r.thread(t.id);
    expect(now.session_id).not.toBe(thread.session_id);
    expect(now.resume_blocked).toBeNull();
    // The new session read the thread so far ahead of the waiting message.
    const read = r.claudeTexts(t.id).at(-1)!;
    expect(read).toMatch(/<omni-handover>[\s\S]*could not be resumed here[\s\S]*first/);
    expect(read).toMatch(/second$/);
  });
});
