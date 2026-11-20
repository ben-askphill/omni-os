import { describe, expect, it } from 'vitest';
import { agentDisc, agentInitials } from '../agent-avatar.ts';
import { AVATAR_SWATCHES } from '../avatar-color.ts';

describe('agentDisc', () => {
  it('takes its color from the agent id, so a rename keeps it, and shows its letters only from 18px', () => {
    const big = agentDisc('researcher', 'RS', 24);
    expect(AVATAR_SWATCHES).toContain(big.bg);
    expect(agentDisc('researcher', 'XY', 30).bg).toBe(big.bg);
    expect(big.letters).toBe('RS');
    expect(agentDisc('researcher', 'RS', 18).letters).toBe('RS');
    expect(agentDisc('researcher', 'RS', 17).letters).toBeNull();
    expect(agentDisc('researcher', 'RS', 14).bg).toBe(big.bg);
  });

  it('spreads agents over the swatches, ink that reads on each', () => {
    const ids = ['builder', 'reviewer', 'researcher', 'writer', 'inbox', 'store-ops', 'designer', 'hermes'];
    expect(new Set(ids.map((id) => agentDisc(id, 'AB', 24).bg)).size).toBeGreaterThan(3);
    for (const id of ids) expect(['#202020', '#ffffff']).toContain(agentDisc(id, 'AB', 24).ink);
  });
});

describe('agentInitials', () => {
  it('gives two agents whose monograms match two letters each, from where their names part', () => {
    const m = agentInitials([
      { id: 'reviewer', name: 'Reviewer' },
      { id: 'researcher', name: 'Researcher' },
      { id: 'builder', name: 'Builder' },
    ]);
    expect([m.get('researcher'), m.get('reviewer'), m.get('builder')]).toEqual(['RS', 'RV', 'BU']);
  });

  it('stays unique when the parted letters are another agent\'s, whatever order the agents come in', () => {
    const set = [
      { id: 'scout', name: 'Release Scout' },
      { id: 'reviewer', name: 'Reviewer' },
      { id: 'researcher', name: 'Researcher' },
      { id: 'twin', name: 'Researcher' },
    ];
    const m = agentInitials(set);
    expect(new Set(m.values()).size).toBe(4);
    expect([...m.values()].every((v) => v.length === 2)).toBe(true);
    expect([...agentInitials([...set].reverse())].sort()).toEqual([...m].sort());
  });
});
