import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Onboarding through /api/setup, the legacy migration that keeps a pre-config install as it was, and the
// personal overrides (data/crew, data/automations, automation toggles) that keep a fork's repo files untouched.

const home = mkdtempSync(join(tmpdir(), 'omni-home-'));
const r = await startRunner({ HOME: home, OMNI_TZ: '' });
delete process.env.OMNI_TZ;
const { app } = await import('../app.ts');
const { configPath, userConfig, resolved } = await import('../user-config.ts');
const { legacyConfig, migrateLegacyConfig } = await import('../config-migrate.ts');
const { listCrew } = await import('../crew.ts');
const { loadAutomations, setEnabled } = await import('../automations.ts');
const { paths } = await import('../config.ts');

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;

describe('onboarding', () => {
  it('a fresh data dir has no config and asks for onboarding', async () => {
    expect(existsSync(configPath())).toBe(false);
    const s = await json(await send('GET', '/api/setup'));
    expect(s.onboarded).toBe(false);
    expect(s.config.user.name).toBe('');
    expect(s.fallbacks.workspaceRoot).toBe('~/Omni');
    // No threads yet, so the legacy migration leaves it to onboarding.
    expect(migrateLegacyConfig()).toBe(false);
  });

  it('saving a step is not finishing onboarding, and bad values are refused', async () => {
    const s = await json(await send('PUT', '/api/setup', { user: { name: 'Ada', timezone: 'Europe/London' }, workspace: { githubOwner: 'ada' } }));
    expect(s.onboarded).toBe(false);
    expect(s.config.user.name).toBe('Ada');
    expect(s.resolved.timezone).toBe('Europe/London');
    expect((await send('PUT', '/api/setup', { user: { timezone: 'Nowhere/Land' } })).status).toBe(400);
    expect((await send('PUT', '/api/setup', { workspace: { githubOwner: 'not an owner' } })).status).toBe(400);
    expect((await send('PUT', '/api/setup', { integrations: { hermesUrl: 'ftp://x' } })).status).toBe(400);
    expect((await send('PUT', '/api/setup', { workspace: { root: '~/x\nrm -rf ~' } })).status).toBe(400);
    // A form post from another page cannot change it.
    const form = await app.request('/api/setup', { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '{"integrations":{"hermesUrl":"http://evil"}}' });
    expect(form.status).toBe(415);
    // Automation overrides go through their own endpoint.
    await send('PUT', '/api/setup', { automations: { 'weekly-review': { enabled: true } } });
    expect(userConfig().automations['weekly-review']).toBeUndefined();
  });

  it('complete marks it done, makes the workspace and leaves one welcome thread in #conductor', async () => {
    const ws = join(home, 'Work');
    const done = await json(await send('POST', '/api/setup/complete', { workspace: { root: ws } }));
    expect(done.onboarded).toBe(true);
    expect(done.config.workspace.root).toBe(ws);
    expect(done.threadId).toBeTruthy();
    const t = r.db.threads.get(done.threadId)!;
    expect(t.channel_id).toBe('conductor');
    const evs = r.events(done.threadId);
    expect(evs.map((e) => e.kind)).toEqual(['assistant_text']);
    expect(evs[0].p.text).toContain('Welcome to Omni, Ada');
    expect((await json(await send('GET', '/api/status'))).profile.onboarded).toBe(true);
    // Running setup again from Settings: no second welcome.
    expect((await json(await send('POST', '/api/setup/complete', {}))).threadId).toBeNull();
  });
});

describe('personal overrides', () => {
  it('a charter in data/crew replaces the shared one and placeholders are filled', () => {
    mkdirSync(paths.personalCrew, { recursive: true });
    writeFileSync(join(paths.personalCrew, 'inbox.md'), '---\nname: My inbox\n---\nWork for {{user}} in {{workspace}}.');
    const inbox = listCrew().find((c) => c.id === 'inbox')!;
    expect(inbox.name).toBe('My inbox');
    expect(inbox.charter).toBe(`Work for Ada in ${resolved.workspaceRoot().replace(home, '~')}.`);
    rmSync(join(paths.personalCrew, 'inbox.md'));
    expect(listCrew().find((c) => c.id === 'inbox')!.charter).not.toMatch(/\{\{|phillbert/);
  });

  it('toggling a shared automation writes the user config, never the YAML', () => {
    const before = loadAutomations().find((a) => a.id === 'weekly-review')!;
    const yaml = readFileSync(before.file, 'utf8');
    setEnabled('weekly-review', !before.enabled);
    expect(loadAutomations().find((a) => a.id === 'weekly-review')!.enabled).toBe(!before.enabled);
    expect(userConfig().automations['weekly-review']).toEqual({ enabled: !before.enabled });
    expect(readFileSync(before.file, 'utf8')).toBe(yaml);
    setEnabled('weekly-review', before.enabled);
  });

  it('an automation in data/automations wins over the shared one with the same id', () => {
    mkdirSync(paths.personalAutomations, { recursive: true });
    writeFileSync(join(paths.personalAutomations, 'weekly-review.yaml'), 'name: Mine\ncron: "0 9 * * 1"\nchannel: inbox\nprompt: hi {{user}}\n');
    const a = loadAutomations().find((x) => x.id === 'weekly-review')!;
    expect(a.name).toBe('Mine');
    expect(a.prompt).toBe('hi Ada');
    // No timezone in the YAML: the user's.
    expect(a.timezone).toBe('Europe/London');
    rmSync(join(paths.personalAutomations, 'weekly-review.yaml'));
  });

  it('the shared automations and charters name nobody', () => {
    for (const a of loadAutomations()) expect(a.prompt).not.toMatch(/central-brain|phillbert|\bBen\b|\{\{/);
    for (const c of listCrew()) expect(c.charter).not.toMatch(/phillbert|firstmate|\bBen\b|\{\{/);
  });
});

describe('legacy migration', () => {
  it("an install from before the config keeps the old defaults: workspace ~/phillbert, Amsterdam, its name", async () => {
    rmSync(configPath());
    mkdirSync(join(home, 'phillbert'), { recursive: true });
    mkdirSync(join(home, 'central-brain'), { recursive: true });
    r.db.kv.set('profile', { name: 'Ben' });
    const brain = process.env.OMNI_BRAIN_DIR;
    delete process.env.OMNI_BRAIN_DIR;
    try {
      const c = legacyConfig();
      expect(c.user.name).toBe('Ben');
      expect(c.user.timezone).toBe('Europe/Amsterdam');
      expect(c.workspace.root).toBe('~/phillbert');
      expect(c.integrations.centralBrainDir).toBe('~/central-brain');
      expect(c.onboardedAt).toBeTruthy();
      // The data dir has threads (the welcome one), so boot writes it and skips onboarding.
      expect(migrateLegacyConfig()).toBe(true);
      expect(resolved.workspaceRoot()).toBe(join(home, 'phillbert'));
      expect(resolved.timezone()).toBe('Europe/Amsterdam');
      expect((await json(await send('GET', '/api/setup'))).onboarded).toBe(true);
      // Only once.
      expect(migrateLegacyConfig()).toBe(false);
    } finally {
      process.env.OMNI_BRAIN_DIR = brain;
    }
  });
});
