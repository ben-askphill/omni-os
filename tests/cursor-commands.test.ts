import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCursorCommands } from '../server/harness/cursor/commands.ts';

// Trimmed from a real cursor-agent 2026.09.26 `available_commands_update` captured on 2026-09-27
// in a repo with a .cursor command, a .claude command and a .cursor skill, plus three made-up
// entries in the same shape: a team command, a skill of no known scope and a name with a space.
const RAW = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'cursor-commands.json'), 'utf8'));
const COMMANDS = RAW.params.update.availableCommands;
const list = normalizeCursorCommands(COMMANDS);
const one = (name: string) => {
  const hits = list.filter((c) => c.name === name);
  expect(hits).toHaveLength(1);
  return hits[0];
};

describe('normalizeCursorCommands', () => {
  it('tags project commands and skills as project, from .cursor and .claude alike', () => {
    expect(one('omni-probe-skill')).toEqual({ name: 'omni-probe-skill', description: 'Omni probe skill', source: 'project', mentionable: true });
    expect(one('omni-probe-cmd')).toMatchObject({ source: 'project', mentionable: true });
    expect(one('omni-claude-cmd')).toMatchObject({ source: 'project', mentionable: true });
  });

  it('tags user commands and skills as personal', () => {
    expect(one('bro')).toEqual({
      name: 'bro',
      description: 'Restate the last message in plain human language, with no jargon.',
      source: 'personal',
      mentionable: true,
    });
    expect(one('ke-dev')).toMatchObject({ source: 'personal', mentionable: true });
  });

  it('strips only the scope tag at the end of a description', () => {
    expect(one('ke-dev').description).toBe('List products from the Shopify admin (production) store using the mcp__shopify-admin__products-list tool.');
  });

  it('tags built-in and team entries as built-ins, and only skills and commands someone wrote can be Mentions', () => {
    expect(one('goal')).toMatchObject({ source: 'builtin', mentionable: true });
    expect(one('lint-fix')).toMatchObject({ source: 'builtin', mentionable: true });
    expect(one('release-notes')).toMatchObject({ source: 'builtin', mentionable: true });
    expect(one('simplify')).toMatchObject({ source: 'builtin', mentionable: false });
    expect(one('multi-model-review')).toMatchObject({ source: 'builtin', mentionable: false });
  });

  it('keeps descriptions to one line, and drops the frontmatter fence Cursor shows for a command file', () => {
    expect(one('preview-volero').description).toMatch(/^Push the current branch to an unpublished Shopify preview theme .*"\/preview-volero"\.$/);
    expect(one('omni-probe-cmd').description).toBe('');
    for (const c of list) expect(c.description).not.toMatch(/\n|\((user|project|global|team|builtin skill|user skill|project skill|skill)\)$/);
  });

  it('leaves out terminal-only commands, repeats and names that cannot be typed', () => {
    for (const name of ['copy-request-id', 'rename-chat', 'statusline']) expect(list.find((c) => c.name === name)).toBeUndefined();
    expect(one('n8n')).toMatchObject({ description: 'n8n', source: 'personal' });
    expect(list.some((c) => c.name.includes(' '))).toBe(false);
    expect(list).toHaveLength(COMMANDS.length - 5); // three terminal-only, one repeat, one name with a space
  });

  it('reads nothing from an answer it does not understand', () => {
    expect(normalizeCursorCommands(undefined)).toEqual([]);
    expect(normalizeCursorCommands([{ description: 'no name' }, null, 'tdd'])).toEqual([]);
  });
});
