import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeClaudeCommands } from '../server/harness/claude/commands.ts';

// Trimmed from real `initialize` responses captured on 2026-09-27: a strict-MCP probe in a folder
// with a project command and a project skill, plus one MCP prompt from a probe without strict MCP.
const RAW = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'claude-commands.json'), 'utf8'));
const list = normalizeClaudeCommands(RAW);
const byName = (name: string) => list.find((c) => c.name === name);

describe('normalizeClaudeCommands', () => {
  it('tags personal commands and strips the scope tag', () => {
    expect(byName('bro')).toEqual({
      name: 'bro',
      description: 'Restate the last message in plain human language, with no jargon.',
      source: 'personal',
      mentionable: true,
    });
    expect(byName('ask-phill-marketing-blog-writer')).toMatchObject({
      source: 'personal',
      aliases: ['anthropic-skills:ask-phill-marketing-blog-writer'],
      mentionable: true,
    });
    expect(byName('ask-phill-marketing-blog-writer')!.description).not.toContain('(claude.ai sync)');
  });

  it('tags project commands and keeps the argument hint', () => {
    expect(byName('deploy-preview')).toEqual({
      name: 'deploy-preview',
      description: 'Push this branch to a preview theme',
      argumentHint: '<store>',
      source: 'project',
      mentionable: true,
    });
    expect(byName('ship-check')).toMatchObject({ source: 'project', description: 'Run the pre-ship checklist for this repo.' });
  });

  it('tags plugin commands, names the plugin and strips its prefix', () => {
    expect(byName('document-skills:pdf')).toMatchObject({ source: 'plugin', plugin: 'document-skills', aliases: ['pdf'], mentionable: true });
    expect(byName('document-skills:pdf')!.description).not.toMatch(/^\(/);
    expect(byName('slack:create-slack-app')).toMatchObject({ source: 'plugin', plugin: 'slack', argumentHint: '[bolt-js | bolt-python]' });
    expect(byName('vercel:deploy')!.description).toMatch(/^Deploy the current project to Vercel\./);
  });

  it('tags built-ins, which cannot be Mentions', () => {
    expect(byName('compact')).toMatchObject({ source: 'builtin', mentionable: false });
    expect(byName('code-review')).toMatchObject({ source: 'builtin', aliases: ['review'] });
  });

  it('keeps each description on one line', () => {
    expect(byName('claude-api')!.description).not.toContain('\n');
  });

  it('drops entries whose names cannot be typed as a command, such as MCP prompts', () => {
    expect(list.some((c) => c.name.includes(' '))).toBe(false);
    expect(list).toHaveLength(RAW.length - 2); // the MCP prompt and `__remote-workflow`
  });
});
