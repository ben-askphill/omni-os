import { describe, it, expect } from 'vitest';
import { newThreadBody, runPreselect, sameSettings } from '../src/new-thread-preset.ts';
import type { Thread } from '../src/api.ts';

// What the web new-thread composer preselects: the role's run defaults, else the channel's, else Auto.

const harnesses = [
  { id: 'claude-code' as const, models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet', efforts: [], defaultEffort: '', default: true }, { id: 'claude-opus-5-5', label: 'Opus', efforts: [], defaultEffort: '' }] },
  { id: 'codex' as const, models: [{ id: 'gpt-5.6-sol', label: 'Sol', efforts: [], defaultEffort: '', default: true }] },
];

describe('runPreselect', () => {
  it('uses Auto when nothing is set', () => {
    expect(runPreselect(undefined, undefined, harnesses)).toEqual({ choice: { harness: 'auto', model: 'auto' }, effort: '' });
    expect(runPreselect({}, { harness: null, model: null, effort: null }, harnesses)).toEqual({ choice: { harness: 'auto', model: 'auto' }, effort: '' });
  });

  it('uses Auto when the channel asks for it', () => {
    expect(runPreselect(undefined, { harness: null, model: 'auto', effort: null }, harnesses)).toEqual({ choice: { harness: 'auto', model: 'auto' }, effort: '' });
  });

  it("lets a role's model win over a channel on Auto, and a role on Auto win over a channel's model", () => {
    expect(runPreselect({ harness: 'codex' }, { model: 'auto' }, harnesses).choice).toEqual({ harness: 'codex', model: 'gpt-5.6-sol' });
    expect(runPreselect({ model: 'auto' }, { harness: 'codex', model: 'gpt-5.6-sol' }, harnesses).choice).toEqual({ harness: 'auto', model: 'auto' });
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

  it("keeps Cursor's own auto model as Cursor, not Omni's Auto", () => {
    const withCursor = [...harnesses, { id: 'cursor' as const, models: [{ id: 'auto', label: 'Auto', efforts: [], defaultEffort: '' }] }];
    expect(runPreselect(undefined, { harness: 'cursor', model: 'auto' }, withCursor).choice).toEqual({ harness: 'cursor', model: 'auto' });
  });
});

const thread = (over: Partial<Thread>) =>
  ({ channel_id: 'acme', role: null, harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high', auto_reason: null, ...over }) as Thread;

describe('starting a new thread from a thread', () => {
  it('keeps the harness, model and effort of a thread that was picked by hand', () => {
    expect(sameSettings(thread({}))).toMatchObject({ choice: { harness: 'claude-code', model: 'claude-opus-5-5' }, effort: 'high' });
    expect(newThreadBody(thread({}), 'next')).toEqual({ channel: 'acme', prompt: 'next', role: undefined, harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high' });
  });

  it('starts on Auto when Auto picked the thread, not on what Auto picked', () => {
    const picked = thread({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'medium', auto_reason: 'Hard code task: Sol, medium effort' });
    expect(sameSettings(picked)).toMatchObject({ choice: { harness: 'auto', model: 'auto' }, effort: '' });
    expect(newThreadBody(picked, 'next')).toEqual({ channel: 'acme', prompt: 'next', role: undefined, model: 'auto' });
  });
});
