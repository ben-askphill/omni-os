// Antigravity's models and what limits where it runs (spec #977, ticket #979), through the runner and the API against
// the scripted fake `agy acp` (packages/test-fixtures/fake-agy.mjs): the list agy gives, its default and effort levels,
// the non-Gemini models hidden until switched on, a failed refresh, a restart, what the check leaves behind in agy's
// home, and the runs Omni refuses because it cannot limit agy's own tools yet.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hiddenModelIds } from '@omni/shared/model-visibility.ts';
import { startRunner } from './runner-boot.ts';
import { FAKE_AGY } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: typeof import('../app.ts').app;
let tmp: string;
let sessions: string;
const saved = new Map<string, string | undefined>();

function set(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) {
    if (!saved.has(k)) saved.set(k, process.env[k]);
    process.env[k] = v;
  }
}
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
});

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'omni-agy-models-'));
  const home = join(tmp, 'home');
  mkdirSync(home);
  sessions = join(tmp, 'sessions');
  H = await startRunner({ HOME: home, OMNI_SECRET_STORE: 'file', OMNI_ANTIGRAVITY_BIN: FAKE_AGY, OMNI_ANTIGRAVITY_CHECK_MS: '4000', FAKE_AGY_SESSIONS: sessions });
  ({ app } = await import('../app.ts'));
}, 30_000);

/** Settings' Check for new models: every harness is asked now. */
async function checkNow() {
  const res = await app.request('/api/harnesses/refresh', { method: 'POST' });
  expect(res.status).toBe(200);
  return ((await res.json()) as any[]).find((h) => h.id === 'antigravity');
}

describe('the list agy gives', () => {
  it('is the account\'s models, Gemini 4 Neon first as the default, with each model\'s own effort levels', async () => {
    const h = await checkNow();
    expect(h.models.map((m: any) => m.id)).toEqual(['gemini-4-neon', 'gemini-4-carbon', 'claude-opus-5-5', 'gpt-oss-120b']);
    expect(h.models[0]).toMatchObject({ default: true, efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' });
    expect(h.models[1]).toMatchObject({ efforts: [] });
  });

  it('leaves what the check opened out of agy\'s home', async () => {
    const conversations = join(tmp, 'home', '.gemini', 'antigravity-cli', 'conversations');
    // A conversation of the person's own, which the check must leave alone.
    mkdirSync(conversations, { recursive: true });
    writeFileSync(join(conversations, 'theirs.db'), '');
    mkdirSync(join(tmp, 'home', '.gemini', 'antigravity-cli', 'brain', 'theirs'), { recursive: true });
    await checkNow();
    expect(readdirSync(conversations)).toEqual(['theirs.db']);
    expect(readdirSync(join(tmp, 'home', '.gemini', 'antigravity-cli', 'brain'))).toEqual(['theirs']);
  });

  it('bills the other models to the Google AI plan and hides them until they are switched on', async () => {
    const h = await checkNow();
    const other = h.models.filter((m: any) => !/^gemini/i.test(m.id));
    expect(other.map((m: any) => m.id)).toEqual(['claude-opus-5-5', 'gpt-oss-120b']);
    for (const m of other) expect(m.note).toBe('Bills your Google AI plan, not your Claude or ChatGPT plan.');
    // The picker's default rule hides them, and a "show" switches one on. The Gemini models stay.
    expect([...hiddenModelIds(h.models)].sort()).toEqual(['claude-opus-5-5', 'gpt-oss-120b']);
    expect([...hiddenModelIds(h.models, { show: ['claude-opus-5-5'] })]).toEqual(['gpt-oss-120b']);
    expect(hiddenModelIds(h.models, { newModels: 'all' }).has('claude-opus-5-5')).toBe(true);
  });

  it('labels two models with one name by their id', async () => {
    set({ FAKE_AGY_MODELS: JSON.stringify([{ id: 'gemini-4-neon', name: 'Gemini', levels: [] }, { id: 'gemini-4-neon-fast', name: 'Gemini', levels: [] }]) });
    const h = await checkNow();
    expect(h.models.map((m: any) => m.label)).toEqual(['Gemini (gemini-4-neon)', 'Gemini (gemini-4-neon-fast)']);
  });
});

describe('a refresh that fails, and a restart', () => {
  it('keeps the last list when agy will not give one', async () => {
    const before = (await checkNow()).models.map((m: any) => m.id);
    set({ FAKE_AGY_MODELS_FAIL: '1' });
    const h = await checkNow();
    expect(h.models.map((m: any) => m.id)).toEqual(before);
  });

  it('lists the last list again after a restart, from disk', async () => {
    await checkNow();
    const models = await import('../harness/antigravity/models.ts');
    models.forgetModels();
    expect(models.lastModels().map((m) => m.id)).toEqual(['gemini-4-neon', 'gemini-4-carbon', 'claude-opus-5-5', 'gpt-oss-120b']);
    expect(existsSync(join(H.paths.data, 'antigravity-models.json'))).toBe(true);
  });
});

describe('what Omni cannot hold agy to yet', () => {
  it('refuses a channel below Full access', async () => {
    const { harnessRefusal } = await import('../access.ts');
    const at = (level: 'read' | 'ask' | 'full') => ({ level, connectors: {} }) as any;
    expect(harnessRefusal('antigravity', at('ask'))).toMatch(/cannot hold Antigravity to this channel's access level/);
    expect(harnessRefusal('antigravity', at('full'))).toBeNull();
  });

  it('refuses a quick ask', async () => {
    await checkNow();
    await expect(H.start('what is in here?', { harness: 'antigravity', model: 'gemini-4-neon', quick: true } as any)).rejects.toThrow(/read only, which needs its file-edit tools taken away/);
  });

  it('refuses an agent that runs without file edits, and a delegate-only one', async () => {
    await checkNow();
    const { saveCrew } = await import('../crew-store.ts');
    const ctx = { catalog: (await import('../harness/catalog-service.ts')).getCatalog(), channelExists: () => true };
    saveCrew('trim', { fields: { name: 'Trim', harness: 'antigravity', model: 'gemini-4-neon', tools: 'no-edits', avatar: { bg: '#f5e6ba' } } }, ctx, { create: true });
    await expect(H.start('hello', { harness: 'antigravity', model: 'gemini-4-neon', role: 'trim' } as any)).rejects.toThrow(/without file edits/);
  });
});

describe('list_harnesses for agents', () => {
  it('carries each model\'s note, so a brief sees the billing', async () => {
    const h = await checkNow();
    expect(h.models.find((m: any) => m.id === 'claude-opus-5-5').note).toContain('Google AI plan');
  });
});
