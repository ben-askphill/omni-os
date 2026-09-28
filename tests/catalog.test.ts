import { describe, it, expect } from 'vitest';
import {
  claudeModels,
  claudeHarness,
  codexHarness,
  resolveModel,
  validateRun,
  emptyCatalog,
  hermesHarness,
  HERMES_FIX,
  type Catalog,
  type CodexProbe,
} from '../server/harness/catalog.ts';

const codexProbe: CodexProbe = {
  available: true,
  planType: 'plus',
  defaultModel: 'gpt-5.6-sol',
  defaultEffort: 'high',
  models: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', efforts: ['low', 'medium'], defaultEffort: 'low', isDefault: true },
  ],
};

const cat: Catalog = { harnesses: [claudeHarness(4), codexHarness(codexProbe, 4)] };

describe('claude catalog', () => {
  it('lists the fixed models with efforts and marks the default', () => {
    const models = claudeModels('claude-opus-5-5');
    expect(models.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-haiku-4-5']);
    expect(models.every((m) => m.efforts.includes('xhigh'))).toBe(true);
    expect(models.find((m) => m.default)?.id).toBe('claude-opus-5-5');
  });

  it('marks the default via alias', () => {
    expect(claudeModels('sonnet').find((m) => m.default)?.id).toBe('claude-sonnet-5');
  });

  it('resolves aliases', () => {
    expect(resolveModel(cat, 'claude-code', 'opus')?.id).toBe('claude-opus-5-5');
    expect(resolveModel(cat, 'claude-code', 'claude-haiku-4-5')?.id).toBe('claude-haiku-4-5');
    expect(resolveModel(cat, 'claude-code', 'nope')).toBeNull();
  });
});

describe('codex catalog', () => {
  it('uses Ben config default model and effort', () => {
    const h = codexHarness(codexProbe, 4);
    expect(h.available).toBe(true);
    const def = h.models.find((m) => m.default);
    expect(def?.id).toBe('gpt-5.6-sol');
    expect(def?.defaultEffort).toBe('high'); // config effort wins over the model's own default
  });

  it('applies the config effort to every model that supports it, as Codex does', () => {
    const h = codexHarness(codexProbe, 4);
    expect(h.models.find((m) => m.id === 'gpt-5.6-terra')?.defaultEffort).toBe('high');
    expect(h.models.find((m) => m.id === 'gpt-6-astra')?.defaultEffort).toBe('low'); // has no "high"
  });

  it("falls back to Codex's own default model when config.toml names none", () => {
    const h = codexHarness({ ...codexProbe, defaultModel: undefined, defaultEffort: undefined }, 4);
    expect(h.models.filter((m) => m.default).map((m) => m.id)).toEqual(['gpt-6-astra']);
    expect(h.models.find((m) => m.id === 'gpt-5.6-terra')?.defaultEffort).toBe('medium');
  });

  it('shows disabled with the fix command when unavailable', () => {
    const h = codexHarness({ available: false, models: [] }, 4);
    expect(h.available).toBe(false);
    expect(h.fix).toBe('codex login');
    expect(h.models).toEqual([]);
  });
});

describe('validateRun', () => {
  it('accepts a valid model and effort', () => {
    expect(validateRun(cat, 'codex', 'gpt-5.6-sol', 'high')).toEqual({ ok: true, harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
  });

  it('accepts an empty effort (model default)', () => {
    const r = validateRun(cat, 'claude-code', 'opus', '');
    expect(r).toEqual({ ok: true, harness: 'claude-code', model: 'claude-opus-5-5', effort: '' });
  });

  it('rejects an unknown model with the valid list', () => {
    const r = validateRun(cat, 'codex', 'gpt-9', '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('gpt-5.6-sol');
  });

  it('rejects an unsupported effort', () => {
    const r = validateRun(cat, 'codex', 'gpt-5.6-terra', 'xhigh');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('does not support effort');
  });

  it('rejects an unavailable harness', () => {
    const c: Catalog = { harnesses: [codexHarness({ available: false, models: [] }, 4)] };
    const r = validateRun(c, 'codex', 'gpt-5.6-sol', '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('codex login');
  });

  it('passes values through when the catalog could not be probed', () => {
    const c = emptyCatalog({ 'claude-code': 4, codex: 4, cursor: 4, hermes: 4 });
    // codex has no models in an empty catalog but is marked unavailable, so it errors;
    // simulate a probed-but-empty catalog by making it "available" with no models.
    const probed: Catalog = { harnesses: [{ ...codexHarness({ available: true, models: [] }, 4), available: true }] };
    const r = validateRun(probed, 'codex', 'whatever-id', 'weird');
    expect(r).toEqual({ ok: true, harness: 'codex', model: 'whatever-id', effort: 'weird' });
    expect(c.harnesses.find((h) => h.id === 'claude-code')?.models.length).toBeGreaterThan(0);
    const hermes = c.harnesses.find((h) => h.id === 'hermes');
    expect(hermes?.available).toBe(false);
    expect(hermes?.fix).toBe(HERMES_FIX);
    expect(hermes?.models).toEqual([]);
  });
});

describe('hermes catalog', () => {
  it('offers one model and no effort levels when the probe succeeds', () => {
    const h = hermesHarness({ available: true }, 4);
    expect(h.available).toBe(true);
    expect(h.models).toHaveLength(1);
    expect(h.models[0]).toMatchObject({ id: 'hermes', label: 'Hermes default', efforts: [], defaultEffort: '', default: true });
    expect(h.models[0].note).toContain('Anthropic API');
    expect(h.capabilities).toMatchObject({ warmProcess: false, steer: true, inlineImages: false, usage: 'none' });
  });

  it('is unavailable until the key is set and this Mac is on Tailscale', () => {
    const h = hermesHarness({ available: false }, 4);
    expect(h.available).toBe(false);
    expect(h.fix).toBe(
      'Set HERMES_API_KEY in Secrets and connect this Mac to Tailscale (OMNI_HERMES_URL, default http://100.110.128.38:8642)',
    );
    expect(h.fix).toBe(HERMES_FIX);
    expect(h.models).toEqual([]);
  });
});
