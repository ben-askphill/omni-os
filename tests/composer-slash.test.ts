import { describe, expect, it } from 'vitest';
import type { SlashCommand } from '../shared/slash.ts';
import type { CommandList, Thread } from '../web/src/api.ts';
import { menuCommands, newThreadHint, replySlash } from '../shared/composer-slash.ts';
import { newThreadBody, otherModel, sameSettings } from '../web/src/new-thread-preset.ts';
import { menuSections } from '../shared/slash-menu.ts';

// What the reply composer does with a `/`: the Omni commands it adds to every thread's menu, what
// Send does with each one, and the quiet hints for commands that stay plain text.

const cmd = (name: string, source: SlashCommand['source'], extra: Partial<SlashCommand> = {}): SlashCommand => ({
  name,
  source,
  description: `${name} description`,
  mentionable: source !== 'builtin',
  ...extra,
});

const LIST: SlashCommand[] = [cmd('tdd', 'personal'), cmd('compact', 'builtin'), cmd('document-skills:pdf', 'plugin', { aliases: ['pdf'] })];

/** Claude Code's list, with the built-ins Omni runs in their place under their own names. */
const CLAUDE: SlashCommand[] = [...LIST, cmd('clear', 'builtin', { aliases: ['reset', 'new'] }), cmd('rename', 'builtin', { aliases: ['name'] }), cmd('model', 'builtin')];

const names = (sections: ReturnType<typeof menuSections>) => sections.map((s) => [s.label, s.commands.map((c) => c.name)]);

describe('menuCommands: the rows a composer offers', () => {
  it("puts Omni's commands last in a thread, on every harness, whatever the harness lists", () => {
    expect(names(menuSections(menuCommands(LIST, 'reply'), ''))).toEqual([
      ['Personal', ['tdd']],
      ['Plugins', ['document-skills:pdf']],
      ['Built-in', ['compact']],
      ['Omni', ['clear', 'effort', 'fast', 'model', 'new', 'rename']],
    ]);
  });

  it('offers them while the harness list is still loading or unavailable', () => {
    expect(names(menuSections(menuCommands(undefined, 'reply'), 'ren'))).toEqual([[null, ['rename']]]);
  });

  it('offers only the harness list in the new-thread composer', () => {
    expect(names(menuSections(menuCommands(LIST, 'new-thread'), ''))).toEqual([
      ['Personal', ['tdd']],
      ['Plugins', ['document-skills:pdf']],
      ['Built-in', ['compact']],
    ]);
  });

  it("leaves out the harness's built-ins that Omni runs in their place, in both composers", () => {
    expect(names(menuSections(menuCommands(CLAUDE, 'reply'), ''))).toEqual(names(menuSections(menuCommands(LIST, 'reply'), '')));
    expect(names(menuSections(menuCommands(CLAUDE, 'new-thread'), ''))).toEqual(names(menuSections(menuCommands(LIST, 'new-thread'), '')));
    expect(names(menuSections(menuCommands(CLAUDE, 'new-thread'), 'model'))).toEqual([]);
  });
});

const READY: CommandList = { status: 'ready', commands: LIST, fetchedAt: 1 };
const SEND = { action: { kind: 'send' }, armed: true, label: null, hint: null };

describe('replySlash: what Send does', () => {
  it('sends plain text and harness commands as typed', () => {
    expect(replySlash('fix the login bug', READY, 'claude-code')).toEqual(SEND);
    expect(replySlash('/tdd 31', READY, 'claude-code')).toEqual(SEND);
    expect(replySlash(' \n', READY, 'claude-code')).toMatchObject({ action: { kind: 'send' }, armed: false });
  });

  it('starts a new thread for /clear and /new, with the text after the command as its first prompt', () => {
    expect(replySlash('/clear\nstart over on the login bug  ', READY, 'codex')).toEqual({
      action: { kind: 'new-thread', prompt: 'start over on the login bug' },
      armed: true,
      label: 'New thread',
      hint: 'Starts a new thread with this prompt and the same settings. This one stays as it is.',
    });
    expect(replySlash('/NEW', null, 'cursor')).toEqual({
      action: { kind: 'new-thread', prompt: '' },
      armed: true,
      label: 'New thread',
      hint: 'Opens a new thread with the same settings.',
    });
  });

  it('renames the thread with /rename, and asks for a title when there is none', () => {
    expect(replySlash('/rename  Fix the\nlogin bug ', READY, 'claude-code')).toEqual({
      action: { kind: 'rename', title: 'Fix the login bug' },
      armed: true,
      label: 'Rename',
      hint: null,
    });
    expect(replySlash('/rename ', READY, 'claude-code')).toEqual({
      action: { kind: 'rename', title: '' },
      armed: false,
      label: 'Rename',
      hint: 'Type the new title after /rename.',
    });
  });

  it('says how long a title can be, and holds a longer one back', () => {
    expect(replySlash(`/rename ${'a'.repeat(200)}`, READY, 'claude-code')).toMatchObject({ armed: true, hint: null });
    // The server trims the title, so the space after it doesn't count.
    expect(replySlash(`/rename ${'a'.repeat(200)} \n`, READY, 'claude-code')).toMatchObject({
      action: { kind: 'rename', title: 'a'.repeat(200) },
      armed: true,
      hint: null,
    });
    expect(replySlash(`/rename ${'a'.repeat(150)}\n${'b'.repeat(51)}`, READY, 'claude-code')).toEqual({
      action: { kind: 'rename', title: `${'a'.repeat(150)} ${'b'.repeat(51)}` },
      armed: false,
      label: 'Rename',
      hint: 'A title can be up to 200 characters. This one is 202.',
    });
  });

  it("runs the harness's other names for /clear and /rename as Omni's", () => {
    const claude: CommandList = { status: 'ready', commands: CLAUDE, fetchedAt: 3 };
    expect(replySlash('/reset', claude, 'claude-code')).toMatchObject({ action: { kind: 'new-thread', prompt: '' }, armed: true, label: 'New thread' });
    expect(replySlash('/Name Launch prep', claude, 'claude-code')).toMatchObject({ action: { kind: 'rename', title: 'Launch prep' }, armed: true, label: 'Rename' });
    expect(replySlash('/model', claude, 'claude-code')).toMatchObject({ action: { kind: 'fixed' }, armed: false });
  });

  it('says the model, effort and fast mode are fixed per thread, and sends nothing', () => {
    for (const text of ['/model', '/effort high', '/Fast']) {
      expect(replySlash(text, READY, 'claude-code')).toEqual({
        action: { kind: 'fixed' },
        armed: false,
        label: null,
        hint: 'The model, effort and fast mode are fixed per thread.',
      });
    }
  });
});

describe('replySlash: hints for commands that stay text', () => {
  const sendWith = (hint: string) => ({ ...SEND, hint });

  it('says a command the thread does not have sends as text, once its list is in', () => {
    expect(replySlash('/nope do it', READY, 'claude-code')).toEqual(sendWith('No /nope command in this thread, so it sends as text.'));
    expect(replySlash('/nope do it', { status: 'loading', commands: [], fetchedAt: null }, 'claude-code')).toEqual(SEND);
    expect(replySlash('/nope do it', null, 'claude-code')).toEqual(SEND);
  });

  it("says a terminal-only command only works in the harness's own terminal", () => {
    expect(replySlash('/login', READY, 'claude-code')).toEqual(sendWith('/login only works in a Claude Code terminal, so it sends as text.'));
    expect(replySlash('/config', null, 'cursor')).toEqual(sendWith('/config only works in a Cursor Agent terminal, so it sends as text.'));
  });

  it('says a built-in or Omni command after the start of a message stays text', () => {
    expect(replySlash('fix it, then /clear', READY, 'codex')).toEqual(sendWith('/clear only works at the start of a message, so here it stays text.'));
    expect(replySlash('/tdd 31 then /compact', READY, 'claude-code')).toEqual(sendWith('/compact only works at the start of a message, so here it stays text.'));
  });

  it('says Claude Code loads a Mention only if the model decides to, each named as typed', () => {
    expect(replySlash('use /tdd here', READY, 'claude-code')).toEqual(sendWith('Claude Code loads /tdd only if the model decides to.'));
    expect(replySlash('use /tdd and /pdf then /TDD again', READY, 'claude-code')).toEqual(sendWith('Claude Code loads /tdd and /pdf only if the model decides to.'));
    expect(replySlash('/tdd 31 with /pdf', READY, 'claude-code')).toEqual(sendWith('Claude Code loads /pdf only if the model decides to.'));
    const more = { ...READY, commands: [...LIST, cmd('bro', 'personal')] };
    expect(replySlash('use /tdd /pdf and /bro', more, 'claude-code')).toEqual(sendWith('Claude Code loads /tdd, /pdf and /bro only if the model decides to.'));
  });

  it('says nothing about a Mention on Codex or Cursor Agent, which load every one', () => {
    expect(replySlash('use /tdd and /pdf here', READY, 'codex')).toEqual(SEND);
    expect(replySlash('use /tdd and /pdf here', READY, 'cursor')).toEqual(SEND);
  });

  it('says Codex leaves out the text after /compact, since its compaction takes no instructions', () => {
    expect(replySlash('/compact keep the API notes', READY, 'codex')).toEqual(sendWith('Codex compacts without instructions, so it leaves out the text after /compact.'));
    expect(replySlash('/compact', READY, 'codex')).toEqual(SEND);
    // Claude Code's /compact takes them.
    expect(replySlash('/compact keep the API notes', READY, 'claude-code')).toEqual(SEND);
  });

  it('leaves paths and URLs alone', () => {
    for (const text of ['/Users/ben/notes.md read this', 'see https://example.com/clear', 'look in /tmp/x']) {
      expect(replySlash(text, READY, 'claude-code')).toEqual(SEND);
    }
  });
});

describe('newThreadHint: the new-thread composer, where Start sends every message as typed', () => {
  const CODEX: CommandList = { status: 'ready', commands: [cmd('review', 'builtin'), cmd('imagegen', 'builtin')], fetchedAt: 2 };

  it("says an Omni command is for a thread's reply box, since this composer offers none", () => {
    expect(newThreadHint('/clear', READY, 'claude-code')).toBe("/clear works in a thread's reply box, so here it sends as text.");
    expect(newThreadHint('/rename Launch prep', null, 'codex')).toBe("/rename works in a thread's reply box, so here it sends as text.");
    // After the start it is plain text, like any other word.
    expect(newThreadHint('fix it, then /clear', READY, 'claude-code')).toBeNull();
    // So is the harness's own name for one, named as typed.
    const claude: CommandList = { status: 'ready', commands: CLAUDE, fetchedAt: 3 };
    expect(newThreadHint('/reset start over', claude, 'claude-code')).toBe("/reset works in a thread's reply box, so here it sends as text.");
    expect(newThreadHint('fix it, then /reset', claude, 'claude-code')).toBeNull();
  });

  it('says the picked harness has no such command in this channel, once its list is in', () => {
    expect(newThreadHint('/nope do it', READY, 'claude-code')).toBe('No /nope command for Claude Code in this channel, so it sends as text.');
    expect(newThreadHint('/nope do it', null, 'claude-code')).toBeNull();
  });

  it('checks what is typed against the list of the harness in the picker', () => {
    expect(newThreadHint('/tdd fix the parser', READY, 'claude-code')).toBeNull();
    expect(newThreadHint('/tdd fix the parser', CODEX, 'codex')).toBe('No /tdd command for Codex in this channel, so it sends as text.');
    expect(newThreadHint('fix the parser with /tdd', READY, 'claude-code')).toBe('Claude Code loads /tdd only if the model decides to.');
    expect(newThreadHint('fix the parser with /tdd', CODEX, 'codex')).toBeNull();
  });

  it('says the rest as a reply would', () => {
    expect(newThreadHint('fix the login bug', READY, 'claude-code')).toBeNull();
    expect(newThreadHint('/login', READY, 'claude-code')).toBe('/login only works in a Claude Code terminal, so it sends as text.');
    expect(newThreadHint('/tdd 31 then /compact', READY, 'claude-code')).toBe('/compact only works at the start of a message, so here it stays text.');
  });
});

describe('a new thread from this one', () => {
  const thread = { id: 't1', channel_id: 'acme', role: 'builder', harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' } as Thread;

  it('starts with the text after /clear, in the same channel with the same harness, model, effort and role', () => {
    expect(newThreadBody(thread, 'start over')).toEqual({ channel: 'acme', prompt: 'start over', role: 'builder', harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
  });

  it('leaves out what the thread left to the defaults', () => {
    expect(newThreadBody({ ...thread, role: null, model: null, effort: '' }, 'start over')).toEqual({ channel: 'acme', prompt: 'start over', harness: 'codex' });
  });

  it('opens the composer with the same settings for /clear on its own', () => {
    expect(sameSettings(thread)).toEqual({ channel: 'acme', role: 'builder', choice: { harness: 'codex', model: 'gpt-5.6-sol' }, effort: 'high' });
    expect(sameSettings({ ...thread, role: null, model: null, effort: '' })).toEqual({ channel: 'acme', role: '', choice: { harness: 'codex', model: '' }, effort: '' });
  });

  it('keeps only the channel and role for another model, with the model picker open', () => {
    expect(otherModel(thread)).toEqual({ channel: 'acme', role: 'builder', pickModel: true });
  });
});
