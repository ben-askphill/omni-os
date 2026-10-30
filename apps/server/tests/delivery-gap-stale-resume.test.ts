import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { waitFor } from './support.ts';

// Known delivery gap (docs/internals/delivery.md, gap 3): before a process resumes a thread, sync/files.ts beforeResume
// brings the other machine's newer session file. When that download fails or times out it says so, and
// runner/spawn.ts spawnLive ignores the outcome: the harness resumes the stale session here, without the turns the
// other machine ran. Expected to fail until #400 blocks that resume, or requires a checkpoint for it. When #400 lands,
// this test passes, `it.fails` fails, and #400 turns it into a plain `it`.

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

describe('a resume whose session download failed (#400)', () => {
  it.fails('does not resume the stale session that is on this machine', { timeout: 20_000 }, async () => {
    const t = await r.start('first', { title: 'Stale resume' });
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    await waitFor(() => !r.runner.isLive(t.id), 'the first process to exit');
    // Let the upload after the first turn land before mac-b's newer session replaces it.
    await new Promise((res) => setTimeout(res, 100));
    mkdirSync(dirname(sessionFile(thread)), { recursive: true });
    writeFileSync(sessionFile(thread), '{"turn":1,"from":"mac-a"}\n');
    newerSessionOnMacB(t.id, thread.session_id, '{"turn":1,"from":"mac-a"}\n{"turn":2,"from":"mac-b"}\n');

    const down = vi.spyOn(relay, 'getObject').mockRejectedValue(new Error('relay down'));
    let resumed: unknown[];
    try {
      await r.runner.postMessage(t.id, 'second').catch(() => {});
      // Settled: a second process started, or the thread stopped without one.
      await waitFor(
        () => r.spawns(t.id).length >= 2 || (!r.runner.isLive(t.id) && !['running', 'queued'].includes(r.thread(t.id).status)),
        'a second process, or the thread to settle without one',
      );
      resumed = r.spawns(t.id).filter((s) => s.args.includes('--resume'));
    } finally {
      down.mockRestore();
    }

    // The session here lacks mac-b's turn, so resuming it would answer as if that turn never happened. A resume once
    // the download succeeds is fine; none while it fails.
    expect(resumed).toEqual([]);
  });
});
