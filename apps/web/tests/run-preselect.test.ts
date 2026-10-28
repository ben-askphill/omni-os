import { describe, it, expect } from 'vitest';
import { draftRun, draftRunRequest, newThreadBody, runPreselect, sameSettings } from '../src/new-thread-preset.ts';
import type { Channel, CrewRole, Thread } from '../src/api.ts';

// What the web new-thread composer preselects: the role's run defaults, else the channel's, else Auto.

const harnesses = [
  { id: 'claude-code' as const, models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet', efforts: [], defaultEffort: '', default: true }, { id: 'claude-opus-5-5', label: 'Opus', efforts: [], defaultEffort: '' }] },
  { id: 'codex' as const, models: [{ id: 'gpt-5.6-sol', label: 'Sol', efforts: [], defaultEffort: '', default: true }] },
];

describe('new-thread draft defaults', () => {
  const conductor = { id: 'conductor', model: 'auto' } as CrewRole;
  const channel = (over: Partial<Channel> = {}) => ({ id: 'conductor', default_model: 'auto', ...over }) as Channel;

  it('uses the saved Conductor default even when the role or catalog arrives later', () => {
    expect(draftRun(null, undefined, channel(), []).choice.model).toBe('auto');
    expect(draftRun(null, conductor, channel(), harnesses).choice.model).toBe('auto');
    expect(draftRun(null, conductor, channel({ default_model: 'claude-sonnet-5-5' }), harnesses).choice.model).toBe('claude-sonnet-5-5');
    // With no saved run the charter now asks for Auto too.
    expect(draftRun(null, conductor, channel({ default_model: null }), harnesses).choice.model).toBe('auto');
  });

  it('follows settings changes until the current draft has an explicit model, effort or preset', () => {
    const before = channel({ default_model: 'claude-opus-5-5' });
    expect(draftRun(null, conductor, before, harnesses).choice.model).toBe('claude-opus-5-5');
    expect(draftRun(null, conductor, channel(), harnesses)).toEqual({ choice: { harness: 'auto', model: 'auto' }, effort: '' });
    const picked = { choice: { harness: 'codex', model: 'gpt-5.6-sol' }, effort: 'high' };
    expect(draftRun(picked, conductor, before, harnesses)).toEqual(picked);
    expect(draftRun(picked, conductor, channel(), harnesses)).toEqual(picked);
    // A new draft does not inherit that pick.
    expect(draftRun(null, conductor, channel(), harnesses).choice.model).toBe('auto');
    const preset = { choice: { harness: 'codex', model: '' }, effort: 'low' };
    expect(draftRun(preset, conductor, channel(), harnesses)).toEqual({ ...preset, choice: { harness: 'codex', model: 'gpt-5.6-sol' } });
  });

  it('preserves other channel defaults and explicit crew roles', () => {
    const acme = channel({ id: 'acme', default_harness: 'codex', default_model: 'gpt-5.6-sol', default_effort: 'high' });
    const builder = { ...conductor, id: 'builder', model: 'claude-opus-5-5' };
    expect(draftRun(null, undefined, acme, harnesses)).toEqual({ choice: { harness: 'codex', model: 'gpt-5.6-sol' }, effort: 'high' });
    expect(draftRun(null, conductor, acme, harnesses).choice.model).toBe('auto');
    expect(draftRun(null, builder, channel(), harnesses).choice.model).toBe('claude-opus-5-5');
  });

  it('leaves inherited runs to the server and only serializes deliberate choices', () => {
    const retired = channel({ default_model: 'claude-retired-1' });
    expect(draftRun(null, conductor, retired, harnesses).choice.model).toBe('claude-retired-1');
    expect(draftRunRequest(null)).toEqual({});
    const explicit = { choice: { harness: 'claude-code', model: 'claude-opus-5-5' }, effort: 'high' };
    expect(draftRunRequest(explicit)).toEqual({ harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high' });
    expect(draftRunRequest({ choice: { harness: 'auto', model: 'auto' }, effort: '' })).toEqual({ model: 'auto' });
  });
});

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
