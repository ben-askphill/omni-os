import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import type { RemoteChange } from '../sync/transport.ts';

// Auto-pause on the machine that owns the automations, for runs another machine made. The streak is checked once a
// whole sync batch has applied: a batch can bring a run's failed thread before its record, and old failures before
// the pause that already answered them. History older than the automation's last change here never pauses it again.

const shipped = mkdtempSync(join(tmpdir(), 'omni-automation-pause-sync-'));
for (const id of ['flaky', 'answered', 'revived'])
  writeFileSync(join(shipped, `${id}.yaml`), `name: ${id}\nenabled: true\ncron: "0 2 * * *"\nchannel: scratch\nprompt: test\n`);
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: shipped });
const { FAILURE_LIMIT, PAUSE_TRIGGER, failuresInARow, watchAutomationFailures } = await import('../automation-pause.ts');
const { setAutomationEnabled } = await import('../automation-files.ts');
const { loadAutomations } = await import('../automations.ts');
const { applyBatch } = await import('../sync/apply.ts');
await import('../sync/handlers/thread.ts');
await import('../sync/handlers/automation-run.ts');

const OWNER = 'mac-owner';
const OTHER = 'mac-other';
r.db.outbox.arm(OWNER);
r.db.kv.set('automations.owner', OWNER);
watchAutomationFailures();

let seq = 0;
const change = (entity: 'thread' | 'automation_run', entity_id: string, ts: string, data: Record<string, unknown>): RemoteChange =>
  ({ seq: ++seq, machine_id: OTHER, entity, entity_id, op: 'upsert', ts, data }) as RemoteChange;

/** A failed manual run on the other machine, started at `ts`: its thread and its run record. */
function failedRun(automation: string, i: number, ts: string): { thread: RemoteChange; record: RemoteChange } {
  const id = `${automation}-thread-${i}`;
  return {
    thread: change('thread', id, ts, {
      id, channel_id: 'scratch', title: 'Failed run', status: 'failed', role: null, model: null, harness: 'claude-code', effort: '', session_id: id, has_run: 1,
      cwd: '~/omni-pause-sync', branch: null, parent_id: null, task_id: null, source: 'automation', automation, last_text: null, archived: 0,
      run_machine: null, created_at: ts, updated_at: ts,
    }),
    record: change('automation_run', `${automation}-run-${i}`, ts, { uid: `${automation}-run-${i}`, automation, thread_id: id, trigger: 'manual', created_at: ts, skip_reason: null }),
  };
}
/** The pause the other machine already made for those runs, when it ran the automations. */
const oldPause = (automation: string, ts: string) =>
  change('automation_run', `${automation}-old-pause`, ts, { uid: `${automation}-old-pause`, automation, thread_id: null, trigger: PAUSE_TRIGGER, created_at: ts, skip_reason: 'Turned off on the other machine' });

const enabled = (id: string) => loadAutomations().find((a) => a.id === id)?.enabled;
const pauses = (id: string) => r.db.db.prepare(`SELECT uid FROM automation_runs WHERE automation = ? AND trigger = ? ORDER BY id`).all(id, PAUSE_TRIGGER) as { uid: string }[];
const yesterday = (s: number) => new Date(Date.now() - 86_400_000 + s * 1000).toISOString();
const soon = (s: number) => new Date(Date.now() + 60_000 + s * 1000).toISOString();

describe('auto-pause for runs synced from another machine', () => {
  it(`turns the automation off once a batch brings ${FAILURE_LIMIT} failed runs, each thread before its record`, () => {
    const runs = [0, 1, 2].map((i) => failedRun('flaky', i, yesterday(i)));
    expect(applyBatch(runs.flatMap((x) => [x.thread, x.record]), { machineId: OWNER })).toMatchObject({ applied: 6, deferred: 0 });
    expect(enabled('flaky')).toBe(false);
    // The pause row starts the count again.
    expect(failuresInARow('flaky')).toBe(0);
    expect(pauses('flaky')).toHaveLength(1);
  });

  it('leaves it on when the same batch also brings the pause that already answered those failures', () => {
    // Three failures complete before the batch reaches the pause the other machine made for them.
    const runs = [0, 1, 2].map((i) => failedRun('answered', i, yesterday(i)));
    const batch = [...runs.flatMap((x) => [x.thread, x.record]), oldPause('answered', yesterday(3))];
    expect(applyBatch(batch, { machineId: OWNER })).toMatchObject({ applied: 7, deferred: 0 });
    expect(failuresInARow('answered')).toBe(0);
    expect(enabled('answered')).toBe(true);
    expect(pauses('answered')).toEqual([{ uid: 'answered-old-pause' }]);
  });

  it('never turns off an automation turned on after those runs, even when their pause comes in a later batch', () => {
    // Ben turned it back on here after the other machine paused it; the old history arrives afterwards.
    setAutomationEnabled('revived', true);
    const old = [0, 1, 2].map((i) => failedRun('revived', i, yesterday(i)));
    applyBatch(old.flatMap((x) => [x.thread, x.record]), { machineId: OWNER });
    expect(failuresInARow('revived')).toBe(FAILURE_LIMIT);
    expect(enabled('revived')).toBe(true);
    applyBatch([oldPause('revived', yesterday(3))], { machineId: OWNER });
    expect(enabled('revived')).toBe(true);
    expect(pauses('revived')).toEqual([{ uid: 'revived-old-pause' }]);

    // Runs that fail after it was turned on still count.
    const fresh = [3, 4, 5].map((i) => failedRun('revived', i, soon(i)));
    applyBatch(fresh.flatMap((x) => [x.thread, x.record]), { machineId: OWNER });
    expect(enabled('revived')).toBe(false);
    expect(pauses('revived')).toHaveLength(2);
  });
});
