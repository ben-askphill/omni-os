import { describe, expect, it } from 'vitest';
import type { SlashCommand } from '../shared/slash.ts';
import { menuSections, pickCommand, slashQuery } from '../web/src/slash-menu.ts';

// The composer's `/` menu: which command is being typed at the caret, what the menu lists for
// it, and what picking a row does to the text.

const cmd = (name: string, source: SlashCommand['source'], description: string, extra: Partial<SlashCommand> = {}): SlashCommand => ({
  name,
  source,
  description,
  mentionable: source !== 'builtin',
  ...extra,
});

const LIST: SlashCommand[] = [
  cmd('compact', 'builtin', 'Clear conversation history but keep a summary in context'),
  cmd('tdd', 'personal', 'Test-driven development with a red-green-refactor loop.'),
  cmd('document-skills:pdf', 'plugin', 'Read, create and edit PDF files', { aliases: ['pdf'], plugin: 'document-skills' }),
  cmd('deploy-preview', 'project', 'Push this branch to a preview theme'),
  cmd('bro', 'personal', 'Restate the last message in plain human language'),
  cmd('vercel:deploy', 'plugin', 'Deploy to Vercel', { plugin: 'vercel' }),
  cmd('export-pdf', 'project', 'Save the page'),
  cmd('context', 'builtin', 'Show context usage'),
];

const names = (sections: ReturnType<typeof menuSections>) => sections.flatMap((s) => s.commands.map((c) => c.name));

describe('slashQuery: the command being typed at the caret', () => {
  it.each([
    ['/', 1, { query: '', start: 0, end: 1 }],
    ['/td', 3, { query: 'td', start: 0, end: 3 }],
    ['  /td', 5, { query: 'td', start: 2, end: 5 }],
    // The caret inside a name: the query is what is before it, and picking replaces the whole name.
    ['/tdd fix', 2, { query: 't', start: 0, end: 4 }],
    ['/document-skills:p', 18, { query: 'document-skills:p', start: 0, end: 18 }],
  ])('%j with the caret at %i', (text, caret, want) => {
    expect(slashQuery(text, caret)).toEqual(want);
  });

  it.each([
    ['', 0],
    ['hello /td', 9],
    ['/tdd ', 5],
    ['/tdd fix', 8],
    ['/Users/ben', 10],
    ['/Users/ben', 3],
    ['https://x.com', 13],
    ['/td,', 4],
    ['/td,', 3],
  ])('nothing for %j with the caret at %i', (text, caret) => {
    expect(slashQuery(text, caret)).toBeNull();
  });
});

describe('menuSections', () => {
  it('groups the list with no search text: project, personal, plugins, built-ins', () => {
    expect(menuSections(LIST, '').map((s) => [s.label, s.commands.map((c) => c.name)])).toEqual([
      ['Project', ['deploy-preview', 'export-pdf']],
      ['Personal', ['bro', 'tdd']],
      ['Plugins', ['document-skills:pdf', 'vercel:deploy']],
      ['Built-in', ['compact', 'context']],
    ]);
  });

  it('searches every group in one ranked list, name and alias matches above description matches', () => {
    expect(menuSections(LIST, 'pdf')).toHaveLength(1);
    expect(menuSections(LIST, 'pdf')[0].label).toBeNull();
    expect(names(menuSections(LIST, 'pdf'))).toEqual(['document-skills:pdf', 'export-pdf']);
    expect(names(menuSections(LIST, 'context'))).toEqual(['context', 'compact']);
    expect(names(menuSections(LIST, 'refactor'))).toEqual(['tdd']);
  });

  it('ranks a name that starts with the search above a word inside a name', () => {
    expect(names(menuSections(LIST, 'depl'))).toEqual(['deploy-preview', 'vercel:deploy']);
    expect(names(menuSections(LIST, 'prev'))).toEqual(['deploy-preview']);
  });

  it('ignores case and lists nothing when nothing matches', () => {
    expect(names(menuSections(LIST, 'PDF'))).toEqual(['document-skills:pdf', 'export-pdf']);
    expect(menuSections(LIST, 'zzz')).toEqual([]);
  });
});

describe('pickCommand', () => {
  it('inserts /name and a space, with the caret after it', () => {
    expect(pickCommand('/td', slashQuery('/td', 3)!, 'tdd')).toEqual({ text: '/tdd ', caret: 5 });
  });

  it('keeps what follows the name without doubling the space', () => {
    expect(pickCommand('/t fix it', slashQuery('/t fix it', 2)!, 'tdd')).toEqual({ text: '/tdd fix it', caret: 5 });
  });

  it('keeps leading whitespace', () => {
    expect(pickCommand('  /p', slashQuery('  /p', 4)!, 'document-skills:pdf')).toEqual({ text: '  /document-skills:pdf ', caret: 23 });
  });
});
