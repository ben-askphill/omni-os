import { describe, it, expect } from 'vitest';
import { runPreselect } from '../web/src/new-thread-preset.ts';

// What the web new-thread composer preselects: the role's run defaults, else the channel's, else Claude Code's default.

const harnesses = [
  { id: 'claude-code' as const, models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet', efforts: [], defaultEffort: '', default: true }, { id: 'claude-opus-5-5', label: 'Opus', efforts: [], defaultEffort: '' }] },
  { id: 'codex' as const, models: [{ id: 'gpt-5.6-sol', label: 'Sol', efforts: [], defaultEffort: '', default: true }] },
];

describe('runPreselect', () => {
  it("uses Claude Code's default model when nothing is set", () => {
    expect(runPreselect(undefined, undefined, harnesses)).toEqual({ choice: { harness: 'claude-code', model: 'claude-sonnet-5-5' }, effort: '' });
  });

  it("uses the channel's model and effort", () => {
    expect(runPreselect({}, { harness: 'claude-code', model: 'claude-opus-5-5', effort: 'max' }, harnesses)).toEqual({
      choice: { harness: 'claude-code', model: 'claude-opus-5-5' },
      effort: 'max',
    });
  });

  it("takes the channel's harness default model when it names only a harness", () => {
    expect(runPreselect(undefined, { harness: 'codex' }, harnesses).choice).toEqual({ harness: 'codex', model: 'gpt-5.6-sol' });
  });

  it('lets a role that sets anything win over the channel', () => {
    expect(runPreselect({ effort: 'low' }, { harness: 'codex', model: 'gpt-5.6-sol' }, harnesses)).toEqual({
      choice: { harness: 'claude-code', model: 'claude-sonnet-5-5' },
      effort: 'low',
    });
  });

  it('falls back to Claude Code for a harness it cannot show', () => {
    expect(runPreselect(undefined, { harness: 'cursor', model: 'auto' }, harnesses).choice).toEqual({ harness: 'claude-code', model: 'claude-sonnet-5-5' });
  });
});
