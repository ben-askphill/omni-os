import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import type { RemoteChange } from '../sync/transport.ts';

// Auto-pause on the machine that owns the automations, for runs another machine made. Sync can deliver a run's failed
// thread before its run record, so the streak is checked again when each record arrives (automation-pause.ts).

const shipped = mkdtempSync(join(tmpdir(), 'omni-automation-pause-sync-'));
writeFileSync(join(shipped, 'flaky.yaml'), 'name: Flaky\nenabled: true\ncron: "0 2 * * *"\nchannel: scratch\nprompt: test\n');
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: shipped });
const { FAILURE_LIMIT, failuresInARow, watchAutomationFailures } = await import('../automation-pause.ts');
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

/** A failed manual run on the other machine: its thread, then its run record, as one sync batch sends them. */
function failedRun(i: number): RemoteChange[] {
  const id = `other-run-thread-${i}`;
  const ts = `2026-11-15T10:00:0${i}.000Z`;
  return [
    change('thread', id, ts, {
      id, channel_id: 'scratch', title: 'Failed run', status: 'failed', role: null, model: null, harness: 'claude-code', effort: '', session_id: id, has_run: 1,
      cwd: '~/omni-pause-sync', branch: null, parent_id: null, task_id: null, source: 'automation', automation: 'flaky', last_text: null, archived: 0,
      run_machine: null, created_at: ts, updated_at: ts,
    }),
    change('automation_run', `other-run-${i}`, ts, { uid: `other-run-${i}`, automation: 'flaky', thread_id: id, trigger: 'manual', created_at: ts, skip_reason: null }),
  ];
}

describe('auto-pause for runs synced from another machine', () => {
  it(`turns the automation off once the ${FAILURE_LIMIT}th failed run's record arrives after its thread`, () => {
    const stats = applyBatch([0, 1, 2].flatMap(failedRun), { machineId: OWNER });
    expect(stats).toMatchObject({ applied: 6, deferred: 0 });
    expect(loadAutomations().find((a) => a.id === 'flaky')?.enabled).toBe(false);
    // The pause row starts the count again.
    expect(failuresInARow('flaky')).toBe(0);
    expect(r.db.db.prepare(`SELECT trigger FROM automation_runs WHERE automation = 'flaky' ORDER BY id DESC LIMIT 1`).get()).toEqual({ trigger: 'pause' });
  });
});
