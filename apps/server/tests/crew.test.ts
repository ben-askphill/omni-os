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

  it('reads tokens: as the accounts a role reaches through a secret, and leaves a bad map out', () => {
    expect(parseCrewFile('t', '---\ntokens:\n  notion: OMNI_NOTION_TOKEN\n  Slack: SLACK_BOT_TOKEN\n---\nbody').tokens).toEqual({ notion: 'OMNI_NOTION_TOKEN', slack: 'SLACK_BOT_TOKEN' });
    expect(parseCrewFile('u', '---\nname: U\n---\nbody')).not.toHaveProperty('tokens');
    for (const bad of ['tokens: [notion]', 'tokens: OMNI_NOTION_TOKEN', 'tokens:\n  jira: JIRA_TOKEN', 'tokens:\n  notion: notion-token'])
      expect(parseCrewFile('v', `---\n${bad}\n---\nbody`), bad).not.toHaveProperty('tokens');
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

  it('has every shipped role that does its own work reach Notion through its token, and the routers none', async () => {
    // A role that does work gets the Notion section when the token is set (runner/prompts.ts), so it never waits on
    // the claude.ai Notion connector. The Conductor and usage-scan only route, with no shell to use a token from.
    const { listCrew } = await import('../crew.ts');
    for (const r of listCrew().filter((x) => x.kind !== 'own')) expect(r.tokens, r.id).toEqual(r.delegateOnly ? undefined : { notion: 'OMNI_NOTION_TOKEN' });
  });

  it("has the Conductor answer quick asks itself, keep the brief and folder pick for real work, and opt in to report wakes", async () => {
    const { listCrew } = await import('../crew.ts');
    const charter = listCrew().find((r) => r.id === 'conductor')!.charter;
    expect(charter).toContain('Answer quick asks yourself, in this thread.');
    expect(charter).not.toContain('a single lookup still goes to a crewmate');
    expect(charter).not.toContain('No folder fits; want me to create');
    expect(charter).toContain('When none fits, leave it out and do not ask about it.');
    expect(charter).toContain('Your first action is `seat_agents`');
    expect(charter).toContain('A quick answer you give yourself needs none of this.');
    expect(charter).toContain('pass `follow_up: true` on `delegate`');
  });
});
