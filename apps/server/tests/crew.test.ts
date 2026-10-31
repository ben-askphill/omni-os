import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.ts', () => {
  throw new Error('db.ts must not be imported by crew tests');
});

import { parseCrewFile } from '../crew.ts';

describe('parseCrewFile', () => {
  it('reads frontmatter fields and the charter body', () => {
    const src = [
      '---',
      'name: Builder',
      'description: Writes code in a repo channel.',
      'model: opus',
      'channel: volero',
      'mcp: [omni]',
      '---',
      'You write and ship code.',
      '',
      '- Keep changes scoped.',
      '',
    ].join('\n');
    expect(parseCrewFile('builder', src)).toEqual({
      id: 'builder',
      name: 'Builder',
      description: 'Writes code in a repo channel.',
      model: 'opus',
      channel: 'volero',
      mcp: ['omni'],
      delegateOnly: false,
      charter: 'You write and ship code.\n\n- Keep changes scoped.',
    });
  });

  it('treats a file without frontmatter as a pure charter with defaults', () => {
    const role = parseCrewFile('inbox', '  Just do quick asks.\n');
    expect(role).toEqual({
      id: 'inbox',
      name: 'inbox',
      description: '',
      model: undefined,
      channel: undefined,
      mcp: [],
      delegateOnly: false,
      charter: 'Just do quick asks.',
    });
  });

  it('handles empty frontmatter and a non-array mcp value', () => {
    expect(parseCrewFile('a', '---\n\n---\nbody')).toMatchObject({ name: 'a', mcp: [], charter: 'body' });
    expect(parseCrewFile('b', '---\nmcp: omni\n---\nbody').mcp).toEqual([]);
  });

  it('reads delegate_only only when it is exactly true', () => {
    expect(parseCrewFile('e', '---\ndelegate_only: true\n---\nbody').delegateOnly).toBe(true);
    expect(parseCrewFile('f', '---\ndelegate_only: "yes"\n---\nbody').delegateOnly).toBe(false);
  });

  it('accepts frontmatter with no body', () => {
    expect(parseCrewFile('c', '---\nname: C\n---')).toMatchObject({ name: 'C', charter: '' });
  });

  it('does not treat a later --- rule as frontmatter', () => {
    const role = parseCrewFile('d', 'Intro\n---\nname: nope\n---\nrest');
    expect(role.name).toBe('d');
    expect(role.charter).toContain('name: nope');
  });

  it('parses the shipped crew files', async () => {
    const { listCrew } = await import('../crew.ts');
    const crew = listCrew();
    expect(crew.length).toBeGreaterThan(0);
    expect(crew[0].id).toBe('conductor');
    expect(crew.find((r) => r.id === 'conductor')!.mcp).toContain('omni');
    // The Conductor routes work and never does it; the crew it routes to do the work.
    expect(crew.find((r) => r.id === 'conductor')!.delegateOnly).toBe(true);
    expect(crew.filter((r) => r.delegateOnly).map((r) => r.id)).toEqual(['conductor']);
    for (const r of crew) expect(r.charter.length).toBeGreaterThan(0);
  });
});
