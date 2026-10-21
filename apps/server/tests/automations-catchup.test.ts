import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Cron } from 'croner';
import { startRunner } from './runner-boot.ts';

// A `catchup: true` automation runs the slot it missed (Mac asleep, Omni stopped) once Omni is back, at most once
// per slot, and only on the Mac that owns scheduled runs.

const dir = mkdtempSync(join(tmpdir(), 'omni-catchup-'));
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: dir });
const yaml = (catchup: boolean) => `name: Nightly\nenabled: true\ncatchup: ${catchup}\ncron: "0 2 * * *"\ntimezone: Europe/Amsterdam\nchannel: scratch\nprompt: tidy up\n`;
writeFileSync(join(dir, 'nightly.yaml'), yaml(true));
writeFileSync(join(dir, 'plain.yaml'), yaml(false));
const automations = await import('../automations.ts');

const get = (id: string) => automations.loadAutomations().find((a) => a.id === id)!;
const runs = (id: string) => r.db.db.prepare(`SELECT trigger FROM automation_runs WHERE automation = ? ORDER BY id`).all(id).map((x: any) => x.trigger);
const lastSlot = new Cron('0 2 * * *', { timezone: 'Europe/Amsterdam', paused: true }).previousRuns(1, new Date())[0];

describe('catching up a missed slot', () => {
  it('parses catchup, off unless literally true', () => {
    expect(get('nightly').catchup).toBe(true);
    expect(get('plain').catchup).toBe(false);
    expect(automations.parseAutomation('x', 'cron: "0 2 * * *"\nprompt: p\ncatchup: "yes"').catchup).toBe(false);
  });

  it('leaves a slot that just passed to the cron job', async () => {
    expect(await automations.catchUp(get('nightly'), new Date(lastSlot.getTime() + 60_000))).toBeNull();
    expect(runs('nightly')).toEqual([]);
  });

  it('does nothing for an automation without catchup', async () => {
    expect(await automations.catchUp(get('plain'))).toBeNull();
    expect(runs('plain')).toEqual([]);
  });

  it('runs the missed slot once', async () => {
    expect(await automations.catchUp(get('nightly'))).not.toBeNull();
    expect(runs('nightly')).toEqual(['catchup']);
    expect(await automations.catchUp(get('nightly'))).toBeNull();
    expect(runs('nightly')).toEqual(['catchup']);
  });

  it('counts a manual run after the slot as done', async () => {
    await automations.runAutomation(get('plain'), 'manual');
    const plain = { ...get('plain'), catchup: true };
    expect(await automations.catchUp(plain)).toBeNull();
    expect(runs('plain')).toEqual(['manual']);
  });

  it('skips on a Mac that does not own scheduled runs', async () => {
    r.db.db.prepare(`DELETE FROM automation_runs WHERE automation = 'nightly'`).run();
    const sync = await import('../sync/worker.ts');
    const { MemoryTransport } = await import('../sync/transport.ts');
    await sync.setActiveWorker(sync.createSyncWorker({ transport: new MemoryTransport(), machineId: 'mac-a' }));
    r.db.kv.set('automations.owner', 'mac-b');
    expect(await automations.catchUp(get('nightly'))).toBeNull();
    expect(runs('nightly')).toEqual([]);
    r.db.kv.set('automations.owner', 'mac-a');
    expect(await automations.catchUp(get('nightly'))).not.toBeNull();
    await sync.setActiveWorker(null);
  });
});
