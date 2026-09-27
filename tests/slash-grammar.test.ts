import { describe, expect, it } from 'vitest';
import { parseSlash, resolveSlash, slashRecord, visibleCommands, type SlashCommand } from '../shared/slash.ts';

// The slash grammar is shared by the server (what a message runs) and the web app (menu, pills),
// so both agree on what counts as a command.

const cmd = (name: string, extra: Partial<SlashCommand> = {}): SlashCommand => ({
  name,
  description: `${name} description`,
  source: 'personal',
  mentionable: true,
  ...extra,
});

const COMMANDS: SlashCommand[] = [
  cmd('tdd', { argumentHint: '<issue>' }),
  cmd('document-skills:pdf', { aliases: ['pdf'], source: 'plugin', plugin: 'document-skills' }),
  cmd('Deploy', { source: 'project' }),
  cmd('deploy', { source: 'personal' }),
  cmd('compact', { source: 'builtin', mentionable: false }),
  cmd('v1.2', { source: 'project' }),
];

describe('parseSlash: the leading command', () => {
  it.each([
    ['/tdd fix it', { name: 'tdd', start: 0, end: 4, args: 'fix it' }],
    ['/tdd', { name: 'tdd', start: 0, end: 4, args: '' }],
    ['/tdd\nfix the login bug', { name: 'tdd', start: 0, end: 4, args: 'fix the login bug' }],
    ['   /tdd   fix it  ', { name: 'tdd', start: 3, end: 7, args: 'fix it  ' }],
    ['/document-skills:pdf read this', { name: 'document-skills:pdf', start: 0, end: 20, args: 'read this' }],
    ['/v1.2 notes', { name: 'v1.2', start: 0, end: 5, args: 'notes' }],
    ['/2fa', { name: '2fa', start: 0, end: 4, args: '' }],
  ])('%j is a command', (text, lead) => {
    expect(parseSlash(text).lead).toEqual(lead);
  });

  it.each([
    ['', 'empty'],
    ['fix it', 'no slash'],
    ['fix it with /tdd', 'a slash after the start is not the leading command'],
    ['/Users/ben/notes.md what is this', 'a path'],
    ['/api/threads returns a 500', 'a route'],
    ['https://example.com/tdd', 'a URL'],
    ['//tdd', 'a double slash'],
    ['/ tdd', 'a space after the slash'],
    ['/-tdd', 'a name must start with a letter or digit'],
    ['/tdd, then fix it', 'punctuation glued to the name'],
    ['/tdd? maybe', 'a question mark glued to the name'],
    ['/', 'a bare slash'],
  ])('%j is not a command (%s)', (text) => {
    expect(parseSlash(text).lead).toBeNull();
  });
});

describe('resolveSlash', () => {
  it('matches a harness command by name', () => {
    const r = resolveSlash('/tdd fix it', COMMANDS);
    expect(r).toMatchObject({ kind: 'harness', command: { name: 'tdd' }, token: { name: 'tdd', args: 'fix it' } });
  });

  it('matches a plugin command by its short alias', () => {
    expect(resolveSlash('/pdf summarise', COMMANDS)).toMatchObject({ kind: 'harness', command: { name: 'document-skills:pdf' } });
  });

  it('prefers an exact match, then falls back to any case', () => {
    expect(resolveSlash('/Deploy', COMMANDS)).toMatchObject({ command: { name: 'Deploy', source: 'project' } });
    expect(resolveSlash('/deploy', COMMANDS)).toMatchObject({ command: { name: 'deploy', source: 'personal' } });
    expect(resolveSlash('/TDD', COMMANDS)).toMatchObject({ kind: 'harness', command: { name: 'tdd' } });
    expect(resolveSlash('/PDF', COMMANDS)).toMatchObject({ kind: 'harness', command: { name: 'document-skills:pdf' } });
  });

  it('classifies Omni commands, whatever the harness lists', () => {
    for (const name of ['clear', 'new', 'rename', 'model', 'effort', 'fast']) {
      expect(resolveSlash(`/${name}`, COMMANDS)).toMatchObject({ kind: 'omni', name });
    }
  });

  it('classifies terminal-only commands', () => {
    for (const name of ['login', 'logout', 'config', 'mcp', 'resume', 'exit']) {
      expect(resolveSlash(`/${name}`, COMMANDS)).toMatchObject({ kind: 'terminal', name });
    }
  });

  it('reports an unknown command', () => {
    expect(resolveSlash('/nope do it', COMMANDS)).toMatchObject({ kind: 'unknown', name: 'nope' });
    expect(resolveSlash('/tdd. fix it', COMMANDS)).toMatchObject({ kind: 'unknown', name: 'tdd.' });
  });

  it('returns null without a leading command', () => {
    expect(resolveSlash('/Users/ben/notes.md', COMMANDS)).toBeNull();
    expect(resolveSlash('use /tdd', COMMANDS)).toBeNull();
  });
});

describe('slashRecord: what the user event stores', () => {
  it('stores a resolved harness command with its span', () => {
    expect(slashRecord('  /pdf summarise', COMMANDS)).toEqual({
      command: { name: 'document-skills:pdf', source: 'plugin', description: 'document-skills:pdf description', start: 2, end: 6 },
    });
    expect(slashRecord('/tdd 31', COMMANDS)).toEqual({
      command: { name: 'tdd', source: 'personal', description: 'tdd description', argumentHint: '<issue>', start: 0, end: 4 },
    });
  });

  it('stores nothing for plain text, Omni, terminal-only or unknown commands', () => {
    for (const text of ['hello', '/clear', '/login', '/nope', '/Users/ben/a.md']) {
      expect(slashRecord(text, COMMANDS)).toBeUndefined();
    }
  });
});

describe('visibleCommands: what the menu offers', () => {
  it('leaves out terminal-only commands and the built-ins Omni commands replace', () => {
    const builtin = (name: string, aliases?: string[]) => cmd(name, { source: 'builtin', mentionable: false, ...(aliases && { aliases }) });
    const list = [
      cmd('tdd'),
      builtin('clear', ['reset', 'new']),
      builtin('rename', ['name']),
      builtin('model'),
      builtin('effort'),
      builtin('fast'),
      builtin('config', ['settings']),
      builtin('heapdump'),
      builtin('compact'),
      builtin('usage', ['cost', 'stats']),
    ];
    expect(visibleCommands(list).map((c) => c.name)).toEqual(['tdd', 'compact', 'usage']);
  });
});
