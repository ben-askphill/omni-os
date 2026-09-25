import { describe, it, expect } from 'vitest';
import { parseCrewFile } from '../server/crew.ts';
import { parseAutomation } from '../server/automations.ts';

describe('crew role frontmatter', () => {
  it('reads harness, model and effort', () => {
    const r = parseCrewFile('builder', '---\nname: Builder\nharness: codex\nmodel: gpt-5.6-sol\neffort: high\n---\nDo the build.');
    expect(r.harness).toBe('codex');
    expect(r.model).toBe('gpt-5.6-sol');
    expect(r.effort).toBe('high');
    expect(r.charter).toBe('Do the build.');
  });

  it('a role that only sets a model leaves harness unset (defaults to Claude Code)', () => {
    const r = parseCrewFile('r', '---\nname: R\nmodel: opus\n---\ncharter');
    expect(r.harness).toBeUndefined();
    expect(r.model).toBe('opus');
  });
});

describe('automation yaml', () => {
  it('reads harness, model and effort', () => {
    const a = parseAutomation('job', 'name: Job\ncron: "0 8 * * *"\nharness: cursor\nmodel: auto\neffort: high\nprompt: do it');
    expect(a.harness).toBe('cursor');
    expect(a.model).toBe('auto');
    expect(a.effort).toBe('high');
  });
});
