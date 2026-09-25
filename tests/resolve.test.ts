import { describe, it, expect } from 'vitest';
import { resolveRun, validateDefaults } from '../server/harness/resolve.ts';
import { claudeHarness, codexHarness, cursorHarness, type Catalog } from '../server/harness/catalog.ts';

const cat: Catalog = {
  harnesses: [
    claudeHarness(4),
    codexHarness(
      {
        available: true,
        defaultModel: 'gpt-5.6-sol',
        defaultEffort: 'high',
        models: [
          { id: 'gpt-5.6-sol', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
          { id: 'gpt-5.6-terra', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
        ],
      },
      4,
    ),
    cursorHarness({ available: true, models: [{ id: 'auto', label: 'Auto', efforts: [], defaultEffort: '', default: true }] }, 4),
  ],
};

const ok = (r: ReturnType<typeof resolveRun>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe('run resolver precedence', () => {
  it("uses the thread's own choice first", () => {
    expect(ok(resolveRun({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }, { harness: 'claude-code', model: 'opus' }, cat))).toEqual({
      ok: true,
      harness: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'high',
    });
  });

  it('falls back to the role default', () => {
    expect(ok(resolveRun({}, { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }, cat))).toMatchObject({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
  });

  it('falls back to Claude Code with no model when nothing is set', () => {
    expect(ok(resolveRun({}, undefined, cat))).toEqual({ ok: true, harness: 'claude-code', model: '', effort: '' });
  });

  it('keeps a role that only sets a model on Claude Code, applying its effort', () => {
    expect(ok(resolveRun({}, { model: 'opus', effort: 'xhigh' }, cat))).toMatchObject({ harness: 'claude-code', model: 'opus', effort: 'xhigh' });
  });

  it("ignores the role's model and effort on another harness", () => {
    expect(ok(resolveRun({ harness: 'claude-code' }, { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }, cat))).toEqual({
      ok: true,
      harness: 'claude-code',
      model: '',
      effort: '',
    });
  });

  it("ignores the role's effort when the model is overridden", () => {
    expect(ok(resolveRun({ model: 'sonnet' }, { model: 'opus', effort: 'high' }, cat))).toMatchObject({ model: 'sonnet', effort: '' });
  });

  it('treats an automation (thread choice) as beating the role', () => {
    expect(ok(resolveRun({ harness: 'codex', model: 'gpt-5.6-terra' }, { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }, cat))).toMatchObject({
      model: 'gpt-5.6-terra',
    });
  });

  it('accepts Claude aliases', () => {
    expect(ok(resolveRun({ model: 'haiku' }, undefined, cat)).model).toBe('haiku');
  });

  it('rejects an unknown harness, model or effort', () => {
    expect(resolveRun({ harness: 'grok' }, undefined, cat).ok).toBe(false);
    const badModel = resolveRun({ harness: 'codex', model: 'gpt-9' }, undefined, cat);
    expect(badModel.ok).toBe(false);
    if (!badModel.ok) expect(badModel.error).toContain('gpt-5.6-sol');
    expect(resolveRun({ harness: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' }, undefined, cat).ok).toBe(false);
  });

  it('passes values through when the catalog for the harness has no models', () => {
    const bare: Catalog = { harnesses: [{ ...codexHarness({ available: true, models: [] }, 4), available: true }] };
    expect(ok(resolveRun({ harness: 'codex', model: 'whatever', effort: 'odd' }, undefined, bare))).toMatchObject({ model: 'whatever', effort: 'odd' });
  });
});

describe('validateDefaults', () => {
  it('flags an unknown harness', () => {
    expect(validateDefaults({ harness: 'grok' }, cat)).toContain('unknown harness');
  });
  it('flags an unknown model', () => {
    expect(validateDefaults({ harness: 'codex', model: 'gpt-9' }, cat)).toContain('gpt-5.6-sol');
  });
  it('passes valid defaults', () => {
    expect(validateDefaults({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }, cat)).toBeUndefined();
    expect(validateDefaults({ model: 'opus' }, cat)).toBeUndefined();
  });
});
