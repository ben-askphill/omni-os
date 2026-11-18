import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// The picker's models come from the harness, as in T3 Code: a model a new Claude Code release lists shows up with no Omni
// change, and Settings chooses which of them the pickers list without taking any away from a run.

const NEW_MODEL = { value: 'claude-opus-5-6', resolvedModel: 'claude-opus-5-6', displayName: 'Opus 5.6', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] };
const BASE = [
  { value: 'default', resolvedModel: 'claude-sonnet-5-5', displayName: 'Default (recommended)' },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] },
];

const r = await startRunner();
const models = join(r.tmp, 'claude-models.json');
writeFileSync(models, JSON.stringify(BASE));
process.env.FAKE_CLAUDE_MODELS = models;
const svc = await import('../harness/catalog-service.ts');
const { metaApi } = await import('../meta-api.ts');
await svc.loadCatalog();

type Row = { id: string; models: { id: string; label: string; hidden?: boolean; efforts: string[] }[] };
const harnesses = async (path = '/harnesses', init?: RequestInit): Promise<Row[]> => (await metaApi.request(path, init)).json();
const claude = async (path?: string, init?: RequestInit) => (await harnesses(path, init)).find((h) => h.id === 'claude-code')!;
const ids = (h: Row) => h.models.map((m) => m.id);
const shown = (h: Row) => h.models.filter((m) => !m.hidden).map((m) => m.id);
const put = (harness: string, body: unknown) =>
  metaApi.request(`/model-visibility/${harness}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('Claude Code model discovery', () => {
  it('lists what Claude Code reports besides the bundled models', async () => {
    const h = await claude();
    expect(ids(h)).toContain('claude-haiku-5-5');
    expect(h.models.find((m) => m.id === 'claude-haiku-5-5')).toMatchObject({ label: 'Haiku 5.5', efforts: ['low', 'medium', 'high'] });
  });

  it('keeps what Claude Code reported on disk, for the next start', () => {
    const cache = join(r.paths.data, 'claude-models.json');
    expect(existsSync(cache)).toBe(true);
    expect(JSON.parse(readFileSync(cache, 'utf8')).models.map((m: { value: string }) => m.value)).toEqual(['default', 'opus', 'haiku']);
  });

  it('picks up a model a new Claude Code release lists when Settings asks again', async () => {
    expect(ids(await claude())).not.toContain('claude-opus-5-6');
    writeFileSync(models, JSON.stringify([...BASE, NEW_MODEL]));
    const h = await claude('/harnesses/refresh', { method: 'POST' });
    expect(ids(h)).toContain('claude-opus-5-6');
    // A thread can start on it right away.
    const t = await r.start('hello', { harness: 'claude-code', model: 'claude-opus-5-6', effort: 'max' });
    expect(t.model).toBe('claude-opus-5-6');
  });

  it('asks again in the background when a picker opens on a catalog older than five minutes', async () => {
    writeFileSync(models, JSON.stringify([...BASE, NEW_MODEL, { ...NEW_MODEL, value: 'claude-sonnet-5-6', resolvedModel: 'claude-sonnet-5-6', displayName: 'Sonnet 5.6' }]));
    expect(ids(await claude())).not.toContain('claude-sonnet-5-6');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + svc.ON_DEMAND_MS + 1000);
      await claude();
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(async () => expect(ids(await claude())).toContain('claude-sonnet-5-6'), { timeout: 10_000 });
  });

  it('keeps the last list when Claude Code does not answer', async () => {
    process.env.FAKE_CLAUDE_INIT_FAIL = '1';
    try {
      expect(ids(await claude('/harnesses/refresh', { method: 'POST' }))).toContain('claude-opus-5-6');
    } finally {
      delete process.env.FAKE_CLAUDE_INIT_FAIL;
    }
  });
});

describe('models in the picker', () => {
  it('shows the newest of each family by default, and marks the rest hidden without dropping them', async () => {
    const h = await claude();
    expect(shown(h)).toEqual(expect.arrayContaining(['claude-sonnet-5-5', 'claude-opus-5-6', 'claude-haiku-5-5']));
    expect(shown(h)).not.toContain('claude-opus-5-5');
    expect(shown(h)).not.toContain('claude-haiku-4-5');
    expect(ids(h)).toContain('claude-opus-5-5');
  });

  it('hides a model switched off, and shows one switched on', async () => {
    const res = await put('claude-code', { hide: ['claude-haiku-5-5'], show: ['claude-opus-5-5'] });
    expect(await res.json()).toEqual({ 'claude-code': { show: ['claude-opus-5-5'], hide: ['claude-haiku-5-5'] } });
    const h = await claude();
    expect(shown(h)).not.toContain('claude-haiku-5-5');
    expect(shown(h)).toContain('claude-opus-5-5');
    expect((await (await metaApi.request('/model-visibility')).json())['claude-code'].hide).toEqual(['claude-haiku-5-5']);
  });

  it('still runs a hidden model a thread or role names', async () => {
    const t = await r.start('hello', { harness: 'claude-code', model: 'claude-haiku-5-5' });
    expect(t.model).toBe('claude-haiku-5-5');
    // Auto's light tier names a model the default rule hides.
    const a = await r.start('hello', { harness: 'claude-code', model: 'claude-haiku-4-5', effort: 'low' });
    expect(a.model).toBe('claude-haiku-4-5');
  });

  it('shows everything with the `all` rule, and Reset goes back to the default', async () => {
    await put('claude-code', { newModels: 'all' });
    expect((await claude()).models.some((m) => m.hidden)).toBe(false);
    await put('claude-code', {});
    expect(await (await metaApi.request('/model-visibility')).json()).toEqual({});
    expect((await claude()).models.some((m) => m.hidden)).toBe(true);
  });

  it('refuses an unknown harness or a body that is not prefs', async () => {
    expect((await put('nope', {})).status).toBe(400);
    expect((await put('codex', 'show everything')).status).toBe(400);
  });
});
