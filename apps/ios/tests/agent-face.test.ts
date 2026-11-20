import type { CrewRole } from '@omni/client-core';
import crewJson from '@omni/test-fixtures/wire/crew.json';
import { describe, expect, it } from 'vitest';

import { agentFace, agentName } from '../src/components/agent-face';

// The server's recorded GET /api/crew (apps/server/tests/wire-fixtures.test.ts), as the phone reads it.
const crew = crewJson as unknown as CrewRole[];
const own = (over: Partial<CrewRole>): CrewRole => ({ ...crew.find((r) => r.id === 'fixture-agent')!, ...over });

describe('agentFace', () => {
  it('draws an uploaded image, read from its own path on the server', () => {
    const agents = [own({ id: 'designer', name: 'Designer', avatar: { image: '/api/crew/designer/avatar?v=0123456789ab', icon: '🎨' } })];
    expect(agentFace('designer', agents, 24)).toEqual({ kind: 'image', agent: 'designer', v: '0123456789ab' });
  });

  it('never sends the token to an image path that is not that agent’s own avatar', () => {
    for (const image of ['https://evil.example/a.png', '/api/crew/builder/avatar?v=0123456789ab', '/api/threads/x/uploads/a.png', '/api/crew/designer/avatar?v=../x']) {
      expect(agentFace('designer', [own({ id: 'designer', name: 'Designer', avatar: { image } })], 24).kind).not.toBe('image');
    }
  });

  it("draws the icon or emoji on its color, then a built-in's mark, then two letters unique across the agents", () => {
    expect(agentFace('designer', [own({ id: 'designer', name: 'Designer', avatar: { icon: '🎨', bg: '#283c62' } })], 24)).toEqual({ kind: 'icon', icon: '🎨', bg: '#283c62' });
    expect(agentFace('builder', crew, 24)).toEqual({ kind: 'mark', role: 'builder' });
    const pair = [own({ id: 'researcher-2', name: 'Researcher' }), own({ id: 'reviewer-2', name: 'Reviewer' })];
    expect([agentFace('researcher-2', pair, 24), agentFace('reviewer-2', pair, 24)].map((f) => f.kind === 'disc' && f.letters)).toEqual(['RS', 'RV']);
  });

  it('shows a disc its color only below 18px', () => {
    const face = agentFace('fixture-agent', crew, 14);
    expect(face).toMatchObject({ kind: 'disc', letters: null });
    expect(face.kind === 'disc' && face.bg).toMatch(/^#/);
  });

  it('names an agent this machine does not list by its built-in name, else its id', () => {
    expect(agentName('fixture-agent', crew)).toBe('Fixture agent');
    expect(agentName('builder', [])).toBe('Builder');
    expect(agentName('gone', [])).toBe('gone');
    expect(agentFace('gone', [], 24)).toMatchObject({ kind: 'disc', letters: 'GO' });
  });
});
