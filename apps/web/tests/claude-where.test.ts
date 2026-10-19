import { describe, it, expect } from 'vitest';
import { claudeWhere, pickerHarnesses, switchWhere } from '../src/claude-where.ts';

// Claude Code shows as one group in the model picker, with a Local/Cloud toggle for where it runs.

const harnesses = [
  { id: 'claude-code', models: [{ id: 'claude-sonnet-5-5', default: true }, { id: 'claude-opus-5-5' }] },
  { id: 'codex', models: [{ id: 'gpt-5.6-sol', default: true }] },
  { id: 'claude-cloud', models: [{ id: 'default', default: true }, { id: 'claude-sonnet-5-5' }, { id: 'claude-opus-5-5' }] },
];

describe('claudeWhere', () => {
  it('reads local, cloud, or nothing for another harness', () => {
    expect(claudeWhere('claude-code')).toBe('local');
    expect(claudeWhere('claude-cloud')).toBe('cloud');
    expect(claudeWhere('codex')).toBeNull();
  });
});

describe('pickerHarnesses', () => {
  it('shows one Claude Code group, local unless the choice is cloud', () => {
    expect(pickerHarnesses(harnesses, 'claude-code').map((h) => h.id)).toEqual(['claude-code', 'codex']);
    expect(pickerHarnesses(harnesses, 'codex').map((h) => h.id)).toEqual(['claude-code', 'codex']);
    expect(pickerHarnesses(harnesses, 'claude-cloud').map((h) => h.id)).toEqual(['claude-cloud', 'codex']);
  });

  it('keeps Claude Code when there is no cloud harness', () => {
    expect(pickerHarnesses(harnesses.slice(0, 2), 'claude-cloud').map((h) => h.id)).toEqual(['claude-code', 'codex']);
  });
});

describe('switchWhere', () => {
  it('keeps the model when the other side has it', () => {
    expect(switchWhere(harnesses, { harness: 'claude-code', model: 'claude-opus-5-5' }, 'cloud')).toEqual({ harness: 'claude-cloud', model: 'claude-opus-5-5' });
    expect(switchWhere(harnesses, { harness: 'claude-cloud', model: 'claude-opus-5-5' }, 'local')).toEqual({ harness: 'claude-code', model: 'claude-opus-5-5' });
  });

  it("falls back to the other side's default", () => {
    expect(switchWhere(harnesses, { harness: 'claude-cloud', model: 'default' }, 'local')).toEqual({ harness: 'claude-code', model: 'claude-sonnet-5-5' });
  });

  it('leaves an unpicked model unpicked', () => {
    expect(switchWhere(harnesses, { harness: 'claude-code', model: '' }, 'cloud')).toEqual({ harness: 'claude-cloud', model: '' });
  });
});
