import { describe, expect, it } from 'vitest';
import { commandMenu, newThreadBody, sameRun } from '../composer-slash.ts';
import type { CommandList, SlashCommand } from '../slash.ts';

// The parts of the composers' `/` handling every client shares: the menu for a composer that reads its own caret (the
// iOS app's), and the settings `/clear` carries into the next thread.

const cmd = (name: string, source: SlashCommand['source'], extra: Partial<SlashCommand> = {}): SlashCommand => ({
  name,
  source,
  description: `${name} description`,
  mentionable: source !== 'builtin',
  ...extra,
});

const list = (over: Partial<CommandList> = {}): CommandList => ({
  status: 'ready',
  fetchedAt: 1,
  commands: [cmd('tdd', 'personal'), cmd('compact', 'builtin'), cmd('deploy-preview', 'project'), cmd('clear', 'builtin', { aliases: ['reset'] })],
  ...over,
});

const names = (m: ReturnType<typeof commandMenu>) => m?.sections.map((s) => [s.label, s.commands.map((c) => c.name)]);

describe('commandMenu: the `/` menu at the caret', () => {
  it('is null with no command being typed', () => {
    expect(commandMenu('fix the cart', 12, list(), 'reply')).toBeNull();
    expect(commandMenu('/tdd now', 8, list(), 'reply')).toBeNull();
    expect(commandMenu('see a/b', 7, list(), 'reply')).toBeNull();
  });

  it("lists a thread's commands by source, then Omni's, recent ones first", () => {
    const m = commandMenu('/', 1, list({ recent: ['deploy-preview'] }), 'reply');
    expect(m?.at).toEqual({ query: '', start: 0, end: 1 });
    expect(names(m)).toEqual([
      ['Recent', ['deploy-preview']],
      ['Personal', ['tdd']],
      ['Built-in', ['compact']],
      ['Omni', ['clear', 'effort', 'fast', 'model', 'new', 'rename']],
    ]);
  });

  it('ranks what is typed in one list, and offers Omni commands only in a thread', () => {
    expect(names(commandMenu('/ren', 4, list(), 'reply'))).toEqual([[null, ['rename']]]);
    expect(names(commandMenu('/ren', 4, list(), 'new-thread'))).toEqual([]);
    expect(names(commandMenu('/dep', 4, list(), 'new-thread'))).toEqual([[null, ['deploy-preview']]]);
  });

  it('lists Omni commands while the harness list is still loading', () => {
    // `/fast` by its description: "Pick a faster model".
    expect(names(commandMenu('/mod', 4, null, 'reply'))).toEqual([[null, ['model', 'fast']]]);
  });

  it('after the start of a message, lists only what can be named there, by name', () => {
    const m = commandMenu('run /t', 6, list(), 'reply');
    expect(m?.at).toEqual({ query: 't', start: 4, end: 6, mention: true });
    expect(names(m)).toEqual([[null, ['tdd']]]);
    // A built-in or an Omni command only works at the start.
    expect(names(commandMenu('run /comp', 9, list(), 'reply'))).toEqual([]);
    expect(names(commandMenu('run /ren', 8, list(), 'reply'))).toEqual([]);
  });

  it('reads the name the caret is in, to its end', () => {
    expect(commandMenu('/tdd write it', 2, list(), 'reply')?.at).toEqual({ query: 't', start: 0, end: 4 });
  });
});

describe('the next thread `/clear` starts', () => {
  const thread = { channel_id: 'acme', role: 'builder', harness: 'codex', model: 'gpt-5.6-sol', effort: 'high', auto_reason: null };

  it('keeps the harness, model and effort', () => {
    expect(sameRun(thread)).toEqual({ choice: { harness: 'codex', model: 'gpt-5.6-sol' }, effort: 'high' });
    expect(newThreadBody(thread, 'again')).toEqual({ channel: 'acme', prompt: 'again', role: 'builder', harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
  });

  it('starts on Auto when Auto picked this one', () => {
    const auto = { ...thread, auto_reason: 'Short question' };
    expect(sameRun(auto)).toEqual({ choice: { harness: 'auto', model: 'auto' }, effort: '' });
    expect(newThreadBody(auto, 'again')).toEqual({ channel: 'acme', prompt: 'again', role: 'builder', model: 'auto' });
  });
});
