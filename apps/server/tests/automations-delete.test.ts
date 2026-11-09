import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// DELETE /api/automations/:id against a real server. The user's own YAML in data/automations/ is removed; one shipped
// in automations/ stays on disk and is hidden on this machine through data/omni.config.json, so a restart or an update
// never brings it back. Either way it leaves the list and its schedule. An unknown id and anything shaped like a path
// change nothing.

const shared = mkdtempSync(join(tmpdir(), 'omni-automations-shared-'));
const r = await startRunner({ OMNI_AUTOMATIONS_DIR: shared });
const { paths } = await import('../config.ts');
const automations = await import('../automations.ts');
const { app } = await import('../app.ts');
mkdirSync(paths.personalAutomations, { recursive: true });

const yaml = (name: string) => `name: ${name}\nenabled: true\ncron: "0 2 * * *"\nchannel: scratch\nprompt: tidy up\n`;
writeFileSync(join(shared, 'nightly.yaml'), yaml('Nightly'));
writeFileSync(join(shared, 'weekly.yaml'), yaml('Weekly'));
writeFileSync(join(shared, 'digest.yaml'), yaml('Digest (shipped)'));
writeFileSync(join(paths.personalAutomations, 'digest.yaml'), yaml('Digest (mine)'));
writeFileSync(join(paths.personalAutomations, 'mine.yml'), yaml('Mine'));
// A YAML file beside the data dir, which a traversal would reach.
const outside = join(paths.data, '..', 'outside.yaml');
writeFileSync(outside, yaml('Outside'));

const ids = () => automations.loadAutomations().map((a) => a.id).sort();
const del = (id: string, headers?: Record<string, string>) => app.request(`/api/automations/${id}`, { method: 'DELETE', headers });
const overrides = () => JSON.parse(readFileSync(join(paths.data, 'omni.config.json'), 'utf8')).automations;
/** How many cron jobs the last reschedule left, from its log line. */
function scheduledAfter(action: () => Promise<unknown>) {
  const log = vi.spyOn(console, 'log');
  return action().then(() => {
    const line = log.mock.calls.map((c) => String(c[0])).findLast((l) => /\[automations\] \d+ scheduled/.test(l));
    log.mockRestore();
    return Number(line?.match(/(\d+) scheduled/)?.[1]);
  });
}

describe('DELETE /api/automations/:id', () => {
  it('removes your own automation: the file, its override and its schedule', async () => {
    automations.setEnabled('mine', true);
    expect(ids()).toEqual(['digest', 'mine', 'nightly', 'weekly']);
    let res!: Response;
    const left = await scheduledAfter(async () => (res = await del('mine')));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: 'file' });
    expect(existsSync(join(paths.personalAutomations, 'mine.yml'))).toBe(false);
    expect(ids()).toEqual(['digest', 'nightly', 'weekly']);
    expect(overrides().mine).toBeUndefined();
    expect(left).toBe(3);
  });

  it('hides a shipped automation on this machine and leaves its YAML alone', async () => {
    const res = await del('nightly');
    expect(await res.json()).toEqual({ ok: true, removed: 'hidden' });
    expect(readFileSync(join(shared, 'nightly.yaml'), 'utf8')).toBe(yaml('Nightly'));
    expect(overrides().nightly).toEqual({ deleted: true });
    expect(ids()).toEqual(['digest', 'weekly']);
    // Gone for the other routes too: it can no longer be run or turned on.
    expect((await app.request('/api/automations/nightly/run', { method: 'POST' })).status).toBe(404);
    expect(((await (await app.request('/api/automations')).json()) as { id: string }[]).map((a) => a.id)).not.toContain('nightly');
  });

  it('stays hidden after the scheduler reloads, as on a restart', async () => {
    expect(await scheduledAfter(async () => automations.schedule())).toBe(2);
    expect(ids()).toEqual(['digest', 'weekly']);
  });

  it('removes your copy of a shipped automation without bringing the shipped one back', async () => {
    const res = await del('digest');
    expect(await res.json()).toEqual({ ok: true, removed: 'file' });
    expect(existsSync(join(paths.personalAutomations, 'digest.yaml'))).toBe(false);
    expect(existsSync(join(shared, 'digest.yaml'))).toBe(true);
    expect(ids()).toEqual(['weekly']);
  });

  it('answers 404 for an id it does not list, and for one already deleted', async () => {
    for (const id of ['nope', 'nightly', 'mine']) {
      const res = await del(id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not found' });
    }
    expect(ids()).toEqual(['weekly']);
  });

  it('refuses an id shaped like a path and touches no file', async () => {
    for (const id of ['..%2F..%2Foutside', '..%2Foutside', '%2E%2E%2Foutside', '.hidden', '..%5Coutside', 'a%2Fb', 'x%00y']) {
      const res = await del(id);
      expect(res.status, id).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid automation id' });
    }
    // A literal or encoded `..` segment never reaches this route: URL parsing resolves it first.
    for (const id of ['../outside', '%2E%2E']) expect((await del(id)).status, id).toBe(404);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(join(shared, 'weekly.yaml'))).toBe(true);
    expect(ids()).toEqual(['weekly']);
  });

  it('needs the install token like every other route', async () => {
    const res = await del('weekly', { authorization: '' });
    expect(res.status).toBe(401);
    expect(ids()).toEqual(['weekly']);
  });

  it('removes a webhook automation’s signing secret with it', async () => {
    writeFileSync(join(paths.personalAutomations, 'hook.yaml'), 'name: Hook\nenabled: true\non: { event: github_webhook, repo: acme/shop }\nchannel: scratch\nprompt: Fix it.\n');
    // The stub Keychain stores nothing, so only the name is recorded; that is what the list shows.
    writeFileSync(join(r.tmp, 'bin', 'security'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    expect((await app.request('/api/automations/hook/webhook-secret', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 's3cret' }) })).status).toBe(200);
    const names = async () => ((await (await app.request('/api/secrets')).json()) as { name: string }[]).map((s) => s.name);
    expect(await names()).toContain('OMNI_WEBHOOK_HOOK');
    expect((await del('hook')).status).toBe(200);
    expect(await names()).not.toContain('OMNI_WEBHOOK_HOOK');
  });
});
