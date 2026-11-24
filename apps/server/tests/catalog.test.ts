import { describe, it, expect } from 'vitest';
import {
  claudeModels,
  claudeHarness,
  claudeProbeOf,
  CLAUDE_LOGIN,
  CLAUDE_NOT_FOUND,
  parseClaudeReported,
  codexHarness,
  resolveModel,
  validateRun,
  emptyCatalog,
  hermesHarness,
  HERMES_FIX,
  type Catalog,
  type CodexProbe,
} from '../harness/catalog.ts';

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
    const models = claudeModels();
    expect(models.map((m) => m.id)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-haiku-4-5']);
    expect(models.every((m) => m.efforts.includes('xhigh'))).toBe(true);
    expect(models.find((m) => m.default)?.id).toBe('claude-sonnet-5-5');
  });

  it('marks the default via alias', () => {
    expect(claudeModels('sonnet').find((m) => m.default)?.id).toBe('claude-sonnet-5-5');
    expect(claudeModels('opus').find((m) => m.default)?.id).toBe('claude-opus-5-5');
  });

  it('resolves aliases', () => {
    expect(resolveModel(cat, 'claude-code', 'fable')?.id).toBe('claude-fable-5-2');
    expect(resolveModel(cat, 'claude-code', 'opus')?.id).toBe('claude-opus-5-5');
    expect(resolveModel(cat, 'claude-code', 'claude-haiku-4-5')?.id).toBe('claude-haiku-4-5');
    expect(resolveModel(cat, 'claude-code', 'nope')).toBeNull();
  });
});

describe('claude catalog from what Claude Code reports', () => {
  // The `models` of claude 2.1.316's initialize answer, trimmed: its default pointer, an alias, a dated id and two
  // models the bundled list lacks.
  const reported = parseClaudeReported([
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', supportsThinkingOff: true },
    { value: 'claude-opus-5', resolvedModel: 'claude-opus-5[1m]', displayName: 'Opus 5', supportsEffort: true, supportedEffortLevels: ['low', 'medium'] },
    { nope: true },
  ]);

  it('adds the models the bundled list lacks, after it, with their own efforts', () => {
    const models = claudeModels('sonnet', reported);
    expect(models.map((m) => m.id)).toEqual([
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-sonnet-5',
      'claude-fable-5-2',
      'claude-fable-5-1',
      'claude-haiku-4-5',
      'claude-haiku-5-5',
      'claude-opus-5',
    ]);
    expect(models.find((m) => m.id === 'claude-haiku-5-5')).toEqual({
      id: 'claude-haiku-5-5',
      label: 'Haiku 5.5',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultEffort: 'high',
    });
    expect(models.find((m) => m.id === 'claude-opus-5')).toMatchObject({ efforts: ['low', 'medium'], defaultEffort: 'low' });
  });

  it('keeps the bundled entry for an id it already has, so Auto and the aliases still resolve', () => {
    const models = claudeModels('sonnet', reported);
    expect(models.filter((m) => m.id === 'claude-haiku-4-5')).toHaveLength(1);
    expect(models.find((m) => m.id === 'claude-haiku-4-5')?.efforts).toContain('low');
    expect(models.find((m) => m.default)?.id).toBe('claude-sonnet-5-5');
  });

  it('keeps bundled and reported display names and derives missing names from Claude IDs', () => {
    const models = claudeModels('sonnet', [
      { value: 'claude-opus-5-5', displayName: 'Alternate Opus name' },
      { value: 'claude-haiku-5-5-20261120[1m]', displayName: 'claude-haiku-5-5-20261120[1m]' },
      { value: 'claude-fable-5-3' },
      { value: 'claude-opus-5', displayName: ' Opus 5 Preview ' },
    ]);
    expect(Object.fromEntries(models.map((m) => [m.id, m.label]))).toMatchObject({
      'claude-opus-5-5': 'Opus 5.5',
      'claude-sonnet-5-5': 'Sonnet 5.5',
      'claude-haiku-5-5': 'Haiku 5.5',
      'claude-fable-5-1': 'Fable 5.1',
      'claude-fable-5-2': 'Fable 5.2',
      'claude-fable-5-3': 'Fable 5.3',
      'claude-opus-5': 'Opus 5 Preview',
    });
  });

  it('validates a run on a reported model', () => {
    const c: Catalog = { harnesses: [claudeHarness(4, 'sonnet', reported)] };
    expect(validateRun(c, 'claude-code', 'claude-haiku-5-5', 'max')).toEqual({ ok: true, harness: 'claude-code', model: 'claude-haiku-5-5', effort: 'max' });
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
    const c = emptyCatalog({ 'claude-code': 4, codex: 4, cursor: 4, hermes: 4, 'cursor-cloud': 4, antigravity: 4 });
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
      'Set the Hermes URL in Settings (or OMNI_HERMES_URL) to its Tailscale address, set HERMES_API_KEY in Secrets, and connect this machine to Tailscale',
    );
    expect(h.fix).toBe(HERMES_FIX);
    expect(h.models).toEqual([]);
  });
});

describe('Claude Code availability probe', () => {
  it('reads a signed-in, a signed-out and a missing claude from `claude auth status --json`', () => {
    expect(claudeProbeOf({ stdout: '{"loggedIn":true,"email":"a@b.c"}', missing: false })).toEqual({ available: true });
    expect(claudeProbeOf({ stdout: '{"loggedIn":false,"authMethod":"none"}', missing: false })).toEqual({ available: false, fix: CLAUDE_LOGIN });
    // The same rule as Settings > Accounts: an answer that does not say loggedIn: true is signed out.
    expect(claudeProbeOf({ stdout: '{"authMethod":"none"}', missing: false })).toEqual({ available: false, fix: CLAUDE_LOGIN });
    expect(claudeProbeOf({ stdout: null, missing: true })).toEqual({ available: false, missing: true, fix: CLAUDE_NOT_FOUND });
  });

  it('keeps an answer it cannot read available, so an old CLI is never shown as down', () => {
    expect(claudeProbeOf({ stdout: null, missing: false })).toEqual({ available: true });
    expect(claudeProbeOf({ stdout: 'error: unknown command auth', missing: false })).toEqual({ available: true });
  });

  it('is no longer Ready when signed out: unavailable, with the sign-in command and no models', () => {
    const h = claudeHarness(4, undefined, [], { available: false, fix: CLAUDE_LOGIN });
    expect(h).toMatchObject({ id: 'claude-code', available: false, fix: 'claude auth login', models: [] });
    expect(h.missing).toBeUndefined();
    expect(claudeHarness(4, undefined, [], { available: false, missing: true, fix: CLAUDE_NOT_FOUND }).missing).toBe(true);
    expect(claudeHarness(4).available).toBe(true);
  });
});
