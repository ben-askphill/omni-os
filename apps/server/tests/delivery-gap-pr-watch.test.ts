import { beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Known delivery gap (docs/internals/delivery.md, gap 2): a PR watch wakes a thread on this machine while another
// machine holds it between turns. turnBlocked (sync/guard.ts) refuses a turn only while the other machine runs the
// thread, or a handoff is under way, not while it holds an idle one, so pr-watch/worker.ts deliver starts the turn here.
// Expected to fail until #399 makes the holder the one owner a wake is checked against. When #399 lands, this test
// passes, `it.fails` fails, and #399 turns it into a plain `it`.

let H: Awaited<ReturnType<typeof startRunner>>;
let W: typeof import('../pr-watch/worker.ts');
let S: typeof import('../pr-watch/store.ts');

const REPO = 'acme/app';
const NOW = Date.parse('2026-10-24T10:00:00Z');

beforeAll(async () => {
  H = await startRunner();
  W = await import('../pr-watch/worker.ts');
  S = await import('../pr-watch/store.ts');
  const { MemoryTransport } = await import('../sync/transport.ts');
  const sync = await import('../sync/worker.ts');
  // Sync on, as mac-a: the machine that started the watch and polls it.
  await sync.setActiveWorker(sync.createSyncWorker({ transport: new MemoryTransport(), machineId: 'mac-a' }));
  H.db.channels.update('scratch', { github_repo: REPO });
});

describe('PR watch on a thread another machine holds (#399)', () => {
  it.fails('does not start a turn here for a thread that mac-b holds between turns', { timeout: 20_000 }, async () => {
    const t = await H.start('build the feature');
    await H.untilResults(t.id, 1);
    S.prWatches.start(t.id, REPO, 1, H.db.outbox.machineId(), W.BASE_S, new Date(NOW).toISOString());
    // The thread then moved to mac-b, which ran a turn there and now holds it, idle. Only mac-b writes this record;
    // here it stands in for mac-b's synced write.
    H.db.kv.set(`handoff.holder.${t.id}`, 'mac-b');
    expect(H.db.threads.holder(t.id)).toBe('mac-b');

    const woken: string[] = [];
    const deps: import('../pr-watch/worker.ts').PRWatchDeps = {
      observe: async (repo, number) => ({
        repo,
        number,
        viewer: 'ben-askphill',
        feedback: [],
        state: 'OPEN',
        headSha: 'a'.repeat(40),
        checks: [{ id: 'CI / build', name: 'CI / build', state: 'FAILURE', url: null }],
      }),
      checkLog: async () => 'log of CI / build',
      now: () => NOW,
      wake: (r) => {
        woken.push(r.id);
        H.runner.wake(r);
      },
    };
    await W.pollOnce(deps);

    // The wake is mac-b's to run, or held for Resume: never a turn here, which would fork the session mac-b holds.
    expect(woken).toEqual([]);
    expect(H.spawns(t.id)).toHaveLength(1);
  });
});
