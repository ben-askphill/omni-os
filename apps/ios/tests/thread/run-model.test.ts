import { describe, expect, it } from 'vitest';

import { nextTurnLabel, runChipLabel, runForPick, runSheetModel } from '../../src/thread/run-model';
import { catalog, thread } from './fixtures';

const harnesses = catalog();

describe('model sheet rows', () => {
  it('lists every harness the catalog reports, with no code for any of them', () => {
    const model = runSheetModel(thread(), harnesses);
    expect(model.harnesses.map((h) => [h.id, h.name, h.available])).toEqual([
      ['claude', 'Claude Code', true],
      ['codex', 'Codex', true],
      ['hermes', 'Hermes', false],
    ]);
    expect(model.harnesses[2]).toMatchObject({ fix: 'hermes login', models: [] });
  });

  it('checks the model the thread runs on', () => {
    const model = runSheetModel(thread({ harness: 'claude', model: 'opus' }), harnesses);
    expect(model.harnesses.flatMap((h) => h.models.filter((m) => m.selected).map((m) => `${h.id}/${m.id}`))).toEqual(['claude/opus']);
  });

  it("checks the harness's default model when the thread stores none", () => {
    const model = runSheetModel(thread({ harness: 'codex', model: '' }), harnesses);
    expect(model.harnesses.flatMap((h) => h.models.filter((m) => m.selected).map((m) => `${h.id}/${m.id}`))).toEqual(['codex/gpt']);
  });

  it("shows the model's effort levels with a default row, and checks the thread's", () => {
    const model = runSheetModel(thread({ model: 'sonnet', effort: 'high' }), harnesses);
    expect(model.effortTitle).toBe('Effort for Sonnet 5.5');
    expect(model.efforts).toEqual([
      { value: '', label: 'Default (low)', selected: false },
      { value: 'low', label: 'low', selected: false },
      { value: 'high', label: 'high', selected: true },
    ]);
  });

  it('checks the default effort row when no effort is set', () => {
    expect(runSheetModel(thread({ effort: '' }), harnesses).efforts.find((e) => e.selected)?.value).toBe('');
  });

  it('shows no effort rows for a model without levels', () => {
    const model = runSheetModel(thread({ harness: 'codex', model: 'gpt' }), harnesses);
    expect(model.effortTitle).toBeNull();
    expect(model.efforts).toEqual([]);
  });

  it('moves the checks to the queued run while a turn runs', () => {
    const running = thread({ status: 'running', queued_harness: 'codex', queued_model: 'gpt', queued_effort: '' });
    const model = runSheetModel(running, harnesses);
    expect(model.harnesses.flatMap((h) => h.models.filter((m) => m.selected).map((m) => `${h.id}/${m.id}`))).toEqual(['codex/gpt']);
  });
});

describe('model sheet picks', () => {
  it('switches to another model at its default effort', () => {
    expect(runForPick(thread({ effort: 'high' }), harnesses, { harness: 'claude', model: 'opus' })).toEqual({ harness: 'claude', model: 'opus', effort: '' });
  });

  it('switches harness with that harness model', () => {
    expect(runForPick(thread(), harnesses, { harness: 'codex', model: 'gpt' })).toEqual({ harness: 'codex', model: 'gpt', effort: '' });
  });

  it('keeps the model when only the effort changes', () => {
    expect(runForPick(thread({ model: 'sonnet' }), harnesses, { effort: 'high' })).toEqual({ harness: 'claude', model: 'sonnet', effort: 'high' });
  });

  it('sends nothing for the run the thread already has', () => {
    expect(runForPick(thread({ model: 'sonnet', effort: 'low' }), harnesses, { harness: 'claude', model: 'sonnet' })).toBeNull();
    expect(runForPick(thread({ effort: 'high' }), harnesses, { effort: 'high' })).toBeNull();
  });

  it('picks from the queued run, not the one still running', () => {
    const running = thread({ status: 'running', queued_harness: 'codex', queued_model: 'gpt', queued_effort: '' });
    expect(runForPick(running, harnesses, { harness: 'codex', model: 'gpt' })).toBeNull();
    expect(runForPick(running, harnesses, { harness: 'claude', model: 'sonnet' })).toEqual({ harness: 'claude', model: 'sonnet', effort: '' });
  });
});

describe('chips', () => {
  it('names the model and its effort', () => {
    expect(runChipLabel(thread({ model: 'sonnet', effort: 'high' }), harnesses)).toBe('Sonnet 5.5 · high');
    expect(runChipLabel(thread({ model: 'sonnet', effort: '' }), harnesses)).toBe('Sonnet 5.5 · low');
    expect(runChipLabel(thread({ harness: 'codex', model: 'gpt' }), harnesses)).toBe('GPT');
  });

  it('keeps the chip on the running model while a switch waits', () => {
    const running = thread({ status: 'running', model: 'sonnet', effort: 'high', queued_harness: 'codex', queued_model: 'gpt', queued_effort: '' });
    expect(runChipLabel(running, harnesses)).toBe('Sonnet 5.5 · high');
  });

  it('shows nothing until the catalog loads', () => {
    expect(runChipLabel(thread(), null)).toBeNull();
  });

  it('names the next turn model only while a switch waits', () => {
    expect(nextTurnLabel(thread(), harnesses)).toBeNull();
    expect(nextTurnLabel(thread({ status: 'running', queued_harness: 'codex', queued_model: 'gpt', queued_effort: '' }), harnesses)).toBe('GPT');
  });
});
