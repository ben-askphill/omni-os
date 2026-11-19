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
      tools: 'full',
      delegateOnly: false,
      delegatable: true,
      review: false,
      memory: 'read-write',
      memoryWrites: 'review',
      charter: 'You write and ship code.\n\n- Keep changes scoped.',
      kind: 'own',
      hidden: false,
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
      tools: 'full',
      delegateOnly: false,
      delegatable: true,
      review: false,
      memory: 'read-write',
      memoryWrites: 'review',
      charter: 'Just do quick asks.',
      kind: 'own',
      hidden: false,
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

  it('reads review the same way: a review role only when it says so exactly', () => {
    expect(parseCrewFile('r', '---\nreview: true\n---\nbody').review).toBe(true);
    expect(parseCrewFile('s', '---\nreview: "yes"\n---\nbody').review).toBe(false);
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
    // The Conductor routes work and never does it; the crew it routes to do the work. A usage scan's lead has no
    // working tools either: it reads its first message and saves what Ben picks through the omni tools.
    expect(crew.find((r) => r.id === 'conductor')!.delegateOnly).toBe(true);
    expect(crew.filter((r) => r.delegateOnly).map((r) => r.id)).toEqual(['conductor', 'usage-scan']);
    expect(crew.find((r) => r.id === 'usage-scan')).toMatchObject({ mcp: ['omni'], channel: 'inbox', harness: 'claude-code' });
    for (const r of crew) expect(r.charter.length).toBeGreaterThan(0);
  });

  it("has the Conductor answer quick asks itself, keep the brief and folder pick for real work, and opt in to report wakes", async () => {
    const { listCrew } = await import('../crew.ts');
    const charter = listCrew().find((r) => r.id === 'conductor')!.charter;
    expect(charter).toContain('Answer quick asks yourself, in this thread.');
    expect(charter).not.toContain('a single lookup still goes to a crewmate');
    expect(charter).not.toContain('No folder fits; want me to create');
    expect(charter).toContain('When none fits, delegate without one and do not ask about it.');
    expect(charter).toContain('A quick answer you give yourself needs none of this.');
    expect(charter).toContain('pass `follow_up: true` on `delegate`');
  });
});
