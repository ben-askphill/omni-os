import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCodexSkills } from '../server/harness/codex/commands.ts';

// Trimmed from a real codex-cli 0.157 `skills/list` answer captured on 2026-09-27, plus three
// made-up skills in the same shape: a disabled one, an admin one and a name with a space.
const RAW = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'codex-skills.json'), 'utf8'));
const SKILLS = RAW.result.data[0].skills;
const list = normalizeCodexSkills(SKILLS);
const one = (name: string) => {
  const hits = list.filter((c) => c.name === name);
  expect(hits).toHaveLength(1);
  return hits[0];
};

describe('normalizeCodexSkills', () => {
  it('tags repo skills as project skills and keeps the file Codex loads them from', () => {
    expect(one('ship-check')).toEqual({
      name: 'ship-check',
      description: 'Run the pre-ship checklist for this repo.',
      source: 'project',
      mentionable: true,
      path: '/Users/ben/code/shop/.agents/skills/ship-check/SKILL.md',
    });
  });

  it('tags user skills as personal', () => {
    expect(one('bro')).toMatchObject({ source: 'personal', mentionable: true, path: '/Users/ben/.agents/skills/bro/SKILL.md' });
  });

  it('tags plugin skills and names the plugin', () => {
    expect(one('chrome-devtools-mcp:a11y-debugging')).toMatchObject({ source: 'plugin', plugin: 'chrome-devtools-mcp', mentionable: true });
    expect(one('vercel:vercel-cli')).toMatchObject({ source: 'plugin', plugin: 'vercel' });
  });

  it('tags system and admin skills as built-ins, which can still be Mentions', () => {
    expect(one('imagegen')).toMatchObject({ source: 'builtin', mentionable: true });
    expect(one('company-policy')).toMatchObject({ source: 'builtin', mentionable: true });
  });

  it('prefers the short description when a skill has one', () => {
    expect(one('imagegen').description).toBe('Generate or edit images for websites, games, and more');
    expect(one('openai-docs').description).toBe('OpenAI and Codex docs for models, skills, tasks, and setup');
    expect(one('tdd').description).toMatch(/^Test-driven development with red-green-refactor loop\./);
  });

  it('keeps the first skill of a name, since Codex lists repo, then personal, then system skills', () => {
    expect(one('productive-time').path).toBe('/Users/ben/.agents/skills/productive-time/SKILL.md');
    expect(one('skill-creator')).toMatchObject({ source: 'personal' });
    expect(one('vercel:vercel-cli').path).toMatch(/\/vercel-cli\/SKILL\.md$/);
  });

  it('leaves out disabled skills and names that cannot be typed as a command', () => {
    expect(list.find((c) => c.name === 'legacy-deploy')).toBeUndefined();
    expect(list.some((c) => c.name.includes(' '))).toBe(false);
    expect(list).toHaveLength(SKILLS.length - 5); // three repeats, one disabled, one name with a space
  });

  it('reads nothing from an answer it does not understand', () => {
    expect(normalizeCodexSkills(undefined)).toEqual([]);
    expect(normalizeCodexSkills([{ name: 'no-path', description: 'x', scope: 'user', enabled: true }])).toEqual([]);
  });
});
