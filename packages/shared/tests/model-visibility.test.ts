import { describe, expect, it } from 'vitest';
import {
  hiddenModelIds,
  latestModelIds,
  modelFamily,
  modelOverride,
  parseModelVisibility,
  pickerModels,
  setNewModels,
  toggleModel,
} from '../model-visibility.ts';

const list = (...ids: string[]) => ids.map((id, i) => ({ id, ...(i === 0 && { default: true }) }));

// The model ids each harness listed on omarchy on 2026-11-18 (list_harnesses), trimmed.
const CLAUDE = list('claude-sonnet-5-5', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-fable-5-2', 'claude-fable-5-1', 'claude-haiku-4-5', 'claude-haiku-5-5', 'claude-opus-5');
const CODEX = list('gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna');
const CURSOR = list('auto', 'gpt-5.2', 'gpt-5.5', 'gpt-5.4', 'gpt-5.1', 'claude-4.6-opus', 'claude-opus-4-7', 'claude-opus-5-5', 'glm-5.2', 'glm-5p3', 'gemini-3-flash', 'gemini-3.8-flash', 'composer-2.5');

describe('modelFamily', () => {
  it('splits an id into its family and version', () => {
    expect(modelFamily('claude-opus-5-5')).toEqual({ family: 'claude-opus', version: [5, 5] });
    expect(modelFamily('claude-opus-5')).toEqual({ family: 'claude-opus', version: [5] });
    expect(modelFamily('gpt-6.1-sol')).toEqual({ family: 'gpt-sol', version: [6, 1] });
    expect(modelFamily('claude-4.6-opus')).toEqual({ family: 'claude-opus', version: [4, 6] });
    expect(modelFamily('kimi-k2.7-code')).toEqual({ family: 'kimi-k-code', version: [2, 7] });
    expect(modelFamily('glm-5p3')).toEqual({ family: 'glm', version: [5, 3] });
  });

  it('ignores a release date and a context suffix', () => {
    expect(modelFamily('claude-haiku-4-5-20251001')).toEqual({ family: 'claude-haiku', version: [4, 5] });
    expect(modelFamily('claude-opus-5-5[1m]')).toEqual({ family: 'claude-opus', version: [5, 5] });
  });

  it('gives an id without a number no version', () => {
    expect(modelFamily('auto')).toEqual({ family: 'auto', version: [] });
  });
});

describe('latestModelIds', () => {
  it('keeps the newest of each Claude family and the default', () => {
    expect([...latestModelIds(CLAUDE)].sort()).toEqual(['claude-fable-5-2', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
  });

  it('keeps one Codex model per tier', () => {
    expect([...latestModelIds(CODEX)].sort()).toEqual(['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-astra', 'gpt-6.2-sol']);
  });

  it('trims Cursor across its two Claude naming styles and keeps ids without a version', () => {
    expect([...latestModelIds(CURSOR)].sort()).toEqual(['auto', 'claude-opus-5-5', 'composer-2.5', 'gemini-3.8-flash', 'glm-5p3', 'gpt-5.5']);
  });

  it('keeps the harness default even when a newer one is listed', () => {
    const models = [{ id: 'claude-opus-5' , default: true }, { id: 'claude-opus-5-5' }];
    expect([...latestModelIds(models)].sort()).toEqual(['claude-opus-5', 'claude-opus-5-5']);
  });
});

describe('hiddenModelIds', () => {
  it('hides older versions under the default rule, and nothing under `all`', () => {
    expect([...hiddenModelIds(CLAUDE)].sort()).toEqual(['claude-fable-5-1', 'claude-haiku-4-5', 'claude-opus-5', 'claude-sonnet-5']);
    expect(hiddenModelIds(CLAUDE, { newModels: 'all' }).size).toBe(0);
  });

  it('lets a toggle override the rule either way', () => {
    const hidden = hiddenModelIds(CLAUDE, { show: ['claude-fable-5-1'], hide: ['claude-haiku-5-5'] });
    expect(hidden.has('claude-fable-5-1')).toBe(false);
    expect(hidden.has('claude-haiku-5-5')).toBe(true);
  });

  it('shows a newly released model and drops the one it replaces, unless that one was switched on', () => {
    const next = [...CLAUDE, { id: 'claude-opus-5-6' }];
    expect(hiddenModelIds(next).has('claude-opus-5-6')).toBe(false);
    expect(hiddenModelIds(next).has('claude-opus-5-5')).toBe(true);
    expect(hiddenModelIds(next, { show: ['claude-opus-5-5'] }).has('claude-opus-5-5')).toBe(false);
  });

  it('never hides every model', () => {
    const ids = CODEX.map((m) => m.id);
    expect([...hiddenModelIds(CODEX, { hide: ids })]).not.toContain('gpt-6.2-sol');
    expect(hiddenModelIds(CODEX, { hide: ids }).size).toBe(ids.length - 1);
  });
});

describe('toggleModel and setNewModels', () => {
  it('stores only what differs from the rule', () => {
    const on = toggleModel(undefined, CLAUDE, 'claude-sonnet-5', true);
    expect(on).toEqual({ show: ['claude-sonnet-5'] });
    expect(modelOverride('claude-sonnet-5', on)).toBe('shown');
    // Back to what the rule gives: no override left.
    expect(toggleModel(on, CLAUDE, 'claude-sonnet-5', false)).toEqual({});
    expect(toggleModel(undefined, CLAUDE, 'claude-opus-5-5', false)).toEqual({ hide: ['claude-opus-5-5'] });
  });

  it('drops overrides the new rule makes redundant', () => {
    const prefs = { show: ['claude-sonnet-5'], hide: ['claude-opus-5-5'] };
    expect(setNewModels(prefs, CLAUDE, 'all')).toEqual({ newModels: 'all', hide: ['claude-opus-5-5'] });
    expect(setNewModels({ newModels: 'all' as const }, CLAUDE, 'latest')).toEqual({});
  });
});

describe('pickerModels', () => {
  it('leaves hidden models out but keeps the one already picked', () => {
    const models = [{ id: 'a' }, { id: 'b', hidden: true }, { id: 'c', hidden: true }];
    expect(pickerModels(models).map((m) => m.id)).toEqual(['a']);
    expect(pickerModels(models, 'c').map((m) => m.id)).toEqual(['a', 'c']);
  });
});

describe('parseModelVisibility', () => {
  it('keeps well-formed prefs and drops the rest', () => {
    expect(parseModelVisibility({ codex: { show: ['x', 3], newModels: 'all' }, cursor: { newModels: 'bogus' }, bad: 'no' })).toEqual({
      codex: { show: ['x'], newModels: 'all' },
    });
    expect(parseModelVisibility(null)).toEqual({});
  });
});
