import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { MemoryTransport, type Change } from '../sync/transport.ts';
import { rawPublicKey } from '../sync/signing.ts';
import { keyOf, signAs } from './sync-sign.ts';

// The Automations editor: every change is written to a YAML file (automation-files.ts). A shipped automation becomes
// the user's own copy in data/automations/, its comments kept, and Reset drops the copy. `machine:` picks the synced
// machine that runs one automation, and the files written here reach the other machine through sync, so both agree.

const shared = mkdtempSync(join(tmpdir(), 'omni-automations-editor-'));
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: shared });
const shippedYaml = '# Shipped with Omni.\nname: Nightly\nenabled: false\ncron: "0 2 * * *"\nchannel: scratch\n# Keep it short.\nprompt: |\n  tidy up {{user}}\n';
writeFileSync(join(shared, 'nightly.yaml'), shippedYaml);
const { paths } = await import('../config.ts');
const automations = await import('../automations.ts');
const sync = await import('../sync/worker.ts');
const { app } = await import('../app.ts');
const { channels } = await import('../db.ts');
const { updateUserConfig, userConfig } = await import('../user-config.ts');
for (const id of ['work', 'side']) channels.create({ id, name: id, kind: 'internal', use_worktree: 0, base_dir: shared });
const relay = new MemoryTransport();

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};
const find = (id: string) => automations.loadAutomations().find((a) => a.id === id);
const own = (id: string) => join(paths.personalAutomations, `${id}.yaml`);
const fields = (over: Record<string, unknown> = {}) => ({ name: 'Digest', enabled: true, cron: '*/30 * * * *', channel: 'scratch', prompt: 'Sum up the day.', ...over });

describe('editing', () => {
  it('reads the file as written: the prompt keeps its placeholders', async () => {
    const { status, body } = await call('GET', '/automations/nightly/definition');
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: 'nightly', shipped: true, personal: false, yaml: shippedYaml });
    expect(body.fields).toMatchObject({ name: 'Nightly', enabled: false, cron: '0 2 * * *', channel: 'scratch', prompt: 'tidy up {{user}}', machine: '' });
  });

  it('saving a shipped one writes your copy with its comments and leaves the shipped file alone', async () => {
    const { body: def } = await call('GET', '/automations/nightly/definition');
    const { status, body } = await call('PUT', '/automations/nightly', { fields: { ...def.fields, machine_id: undefined, name: 'Nightly tidy', cron: '0 3 * * *', role: 'builder' } });
    expect(status).toBe(200);
    expect(body.personal).toBe(true);
    const text = readFileSync(own('nightly'), 'utf8');
    expect(text).toContain('# Shipped with Omni.');
    expect(text).toContain('# Keep it short.');
    expect(text).toContain('cron: "0 3 * * *"');
    // A key new to the file goes before the prompt, not after it.
    expect(text.indexOf('role: builder')).toBeLessThan(text.indexOf('prompt:'));
    expect(text).toContain('prompt: |\n  tidy up {{user}}\n');
    expect(readFileSync(join(shared, 'nightly.yaml'), 'utf8')).toBe(shippedYaml);
    expect(find('nightly')).toMatchObject({ name: 'Nightly tidy', cron: '0 3 * * *', role: 'builder', file: own('nightly') });
  });

  it('the toggle writes enabled into the file', async () => {
    expect((await call('POST', '/automations/nightly/enabled', { enabled: true })).status).toBe(200);
    expect(readFileSync(own('nightly'), 'utf8')).toContain('enabled: true');
    expect(find('nightly')!.enabled).toBe(true);
  });

  it('Reset drops your copy and the shipped file loads again', async () => {
    const { status, body } = await call('POST', '/automations/nightly/reset');
    expect(status).toBe(200);
    expect(body).toMatchObject({ personal: false, shipped: true });
    expect(existsSync(own('nightly'))).toBe(false);
    expect(find('nightly')!.name).toBe('Nightly');
    expect((await call('POST', '/automations/nightly/reset')).status).toBe(409);
  });

  it('refuses what Omni would load as invalid, and writes nothing', async () => {
    expect((await call('PUT', '/automations/nightly', { fields: fields({ cron: 'every day' }) })).body.error).toMatch(/invalid schedule/);
    expect((await call('PUT', '/automations/nightly', { fields: fields({ on: 'pr_opened' }) })).body.error).toMatch(/not both/);
    expect((await call('PUT', '/automations/nightly', { fields: fields({ channel: 'nowhere' }) })).body.error).toMatch(/No channel nowhere/);
    expect((await call('PUT', '/automations/nightly', { fields: fields({ cron: '', on: { event: 'github_webhook' } }) })).body.error).toMatch(/needs repo/);
    expect((await call('PUT', '/automations/nightly', { yaml: 'name: [' })).status).toBe(400);
    expect((await call('PUT', '/automations/ghost', { fields: fields() })).status).toBe(404);
    expect(existsSync(own('nightly'))).toBe(false);
  });

  it('a machine needs sync', async () => {
    const { status, body } = await call('PUT', '/automations/nightly', { fields: fields({ machine: 'here' }) });
    expect(status).toBe(409);
    expect(body.error).toMatch(/Set up sync/);
  });

  it('the toggle folds an old channel override into the file and drops the override', async () => {
    updateUserConfig({ automations: { nightly: { enabled: false, channel: 'work' } } });
    expect((await call('POST', '/automations/nightly/enabled', { enabled: true })).status).toBe(200);
    const text = readFileSync(own('nightly'), 'utf8');
    expect(text).toContain('channel: work');
    expect(text).not.toContain('channel: scratch');
    expect(userConfig().automations.nightly).toBeUndefined();
    expect(find('nightly')).toMatchObject({ enabled: true, channel: 'work' });
    await call('POST', '/automations/nightly/reset');
  });

  it('raw YAML that leaves the channel as it was keeps an old channel override; one that changes it wins', async () => {
    updateUserConfig({ automations: { nightly: { channel: 'work' } } });
    expect((await call('PUT', '/automations/nightly', { yaml: shippedYaml.replace('Nightly', 'Nightly raw') })).status).toBe(200);
    expect(find('nightly')).toMatchObject({ name: 'Nightly raw', channel: 'work' });
    expect(userConfig().automations.nightly).toBeUndefined();
    await call('POST', '/automations/nightly/reset');
    updateUserConfig({ automations: { nightly: { channel: 'work' } } });
    expect((await call('PUT', '/automations/nightly', { yaml: shippedYaml.replace('channel: scratch', 'channel: side') })).status).toBe(200);
    expect(find('nightly')!.channel).toBe('side');
    await call('POST', '/automations/nightly/reset');
  });

  it('a machine the file already names saves unchanged without sync', async () => {
    writeFileSync(own('nightly'), shippedYaml.replace('channel: scratch', 'channel: scratch\nmachine: studio'));
    const { body: def } = await call('GET', '/automations/nightly/definition');
    expect(def.fields).toMatchObject({ machine: 'studio', machine_id: null });
    const { status } = await call('PUT', '/automations/nightly', { fields: { ...def.fields, machine_id: undefined, prompt: 'tidy less' } });
    expect(status).toBe(200);
    const text = readFileSync(own('nightly'), 'utf8');
    expect(text).toContain('machine: studio');
    expect(text).toContain('tidy less');
    expect((await call('PUT', '/automations/nightly', { fields: { ...def.fields, machine_id: undefined, machine: 'elsewhere' } })).status).toBe(409);
    await call('POST', '/automations/nightly/reset');
  });
});

describe('creating', () => {
  it('makes data/automations/<id>.yaml from the name, quoting the cron', async () => {
    const { status, body } = await call('POST', '/automations', { fields: fields() });
    expect(status).toBe(201);
    expect(body.id).toBe('digest');
    const text = readFileSync(own('digest'), 'utf8');
    expect(text).toContain('cron: "*/30 * * * *"');
    expect(find('digest')).toMatchObject({ name: 'Digest', enabled: true, cron: '*/30 * * * *', prompt: 'Sum up the day.' });
    expect((await call('POST', '/automations', { fields: fields() })).status).toBe(409);
    expect((await call('POST', '/automations', { id: '../x', fields: fields() })).status).toBe(400);
  });

  it('writes an event trigger without its defaults, and drops the schedule-only keys', async () => {
    const { status } = await call('PUT', '/automations/digest', {
      fields: fields({ cron: '', timezone: 'Europe/Amsterdam', catchup: true, on: { event: 'github_webhook', repo: 'acme/shop', events: ['workflow_run', 'pull_request_review'], concurrency: 1 } }),
    });
    expect(status).toBe(200);
    const text = readFileSync(own('digest'), 'utf8');
    expect(text).toContain('on: { event: github_webhook, repo: acme/shop, concurrency: 1 }');
    expect(text).not.toMatch(/cron:|timezone:|catchup:/);
    expect(find('digest')!.on).toMatchObject({ event: 'github_webhook', repo: 'acme/shop', concurrency: 1 });
  });

  it('saves raw YAML as given', async () => {
    const yaml = '# hand written\nname: Digest\nenabled: false\non: pr_opened\nchannel: scratch\nprompt: look\n';
    expect((await call('PUT', '/automations/digest', { yaml })).status).toBe(200);
    expect(readFileSync(own('digest'), 'utf8')).toBe(yaml);
  });
});

describe('choosing a machine, with sync on', () => {
  let worker: ReturnType<typeof sync.createSyncWorker>;
  const device = (id: string, name: string) => r.db.kv.set(`devices.${id}`, { id, name, tailscale: null, at: new Date().toISOString() });

  it('writes the machine by name, and only that machine fires it', async () => {
    worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
    await sync.setActiveWorker(worker);
    expect((await worker.syncNow()).error).toBeUndefined();
    device('mac-a', 'omarchy');
    device('mac-b', "Ben's MacBook Pro");
    // This machine owns automations; the file sends this one to the other machine.
    expect(r.db.kv.get('automations.owner')).toBe('mac-a');
    const { status, body } = await call('PUT', '/automations/digest', { fields: fields({ machine: 'mac-b' }) });
    expect(status).toBe(200);
    expect(body.fields).toMatchObject({ machine: "Ben's MacBook Pro", machine_id: 'mac-b' });
    expect(readFileSync(own('digest'), 'utf8')).toContain("machine: Ben's MacBook Pro");
    expect(await automations.fireScheduled(find('digest')!)).toBeNull();
    const listed = (await call('GET', '/automations')).body.find((a: any) => a.id === 'digest');
    expect(listed.runs_on).toEqual({ owner: 'mac-b', isThisMac: false });
    // `here` writes this machine's name, and it fires again.
    await call('PUT', '/automations/digest', { fields: fields({ machine: 'here' }) });
    expect(readFileSync(own('digest'), 'utf8')).toContain('machine: omarchy');
    expect(await automations.fireScheduled(find('digest')!)).not.toBeNull();
  });

  it('a machine no one has runs nowhere, and the editor refuses it', async () => {
    expect((await call('PUT', '/automations/digest', { fields: fields({ machine: 'toaster' }) })).status).toBe(400);
    writeFileSync(own('digest'), readFileSync(own('digest'), 'utf8').replace('machine: omarchy', 'machine: toaster'));
    expect(await automations.fireScheduled(find('digest')!)).toBeNull();
  });

  it('the file goes to the relay, and one the other machine signed is written here', async () => {
    await call('PUT', '/automations/digest', { fields: fields({ name: 'Digest v2', machine: 'mac-b' }) });
    expect((await worker.syncNow()).error).toBeUndefined();
    const sent = relay.changes.filter((c) => c.entity === 'automation_file' && c.entity_id === 'digest').at(-1)!;
    expect((sent.data as any).yaml).toContain('name: Digest v2');

    let n = 0;
    const at = () => new Date(Date.now() + 1_000 + n++).toISOString();
    const file = (id: string, data: unknown, op: Change['op'] = 'upsert'): Change => ({ machine_id: 'mac-b', entity: 'automation_file', entity_id: id, op, data, ts: at() });
    // mac-b announces itself with its signing key, as a paired machine does; this one pins and trusts that first key.
    const record = signAs({ machine_id: 'mac-b', entity: 'kv', entity_id: 'devices.mac-b', op: 'upsert', ts: at(), data: { value: { id: 'mac-b', name: "Ben's MacBook Pro", tailscale: null, signKey: rawPublicKey(keyOf('mac-b')), at: at() } } });
    const yaml = 'name: From B\nenabled: true\ncron: "0 9 * * *"\nchannel: scratch\nmachine: mac-a\nprompt: hello\n';
    // Unsigned: an automation is a prompt that runs, so a file nobody signed is held, never written.
    await relay.push([record, file('unsigned', { yaml })]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(existsSync(own('unsigned'))).toBe(false);

    await relay.push([signAs(file('from-b', { yaml })), signAs(file('../evil', { yaml }))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(readFileSync(own('from-b'), 'utf8')).toBe(yaml);
    // An id that is a path is dropped.
    expect(existsSync(join(paths.personalAutomations, '..', 'evil.yaml'))).toBe(false);
    expect(find('from-b')).toMatchObject({ name: 'From B', machine: 'mac-a' });

    await relay.push([signAs(file('from-b', null, 'delete'))]);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(find('from-b')).toBeUndefined();
  });

  it('Delete sends the removal too', async () => {
    expect((await call('DELETE', '/automations/digest')).status).toBe(200);
    expect((await worker.syncNow()).error).toBeUndefined();
    expect(relay.changes.filter((c) => c.entity === 'automation_file' && c.entity_id === 'digest').at(-1)!.op).toBe('delete');
  });
});
