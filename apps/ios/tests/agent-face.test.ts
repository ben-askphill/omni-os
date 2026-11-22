import type { CrewRole } from '@omni/client-core';
import crewJson from '@omni/test-fixtures/wire/crew.json';
import { agentFace as sharedFace } from '@omni/shared/agent-avatar.ts';
import { describe, expect, it } from 'vitest';

import { agentColor, agentFace, agentName } from '../src/components/agent-face';

// The server's recorded GET /api/crew (apps/server/tests/wire-fixtures.test.ts), as the phone reads it.
const crew = crewJson as unknown as CrewRole[];
const own = (over: Partial<CrewRole>): CrewRole => ({ ...crew.find((r) => r.id === 'fixture-agent')!, ...over });

describe('agentFace', () => {
  it('draws an uploaded image, read from its own path on the server', () => {
    const agents = [own({ id: 'designer', name: 'Designer', avatar: { image: '/api/crew/designer/avatar?v=0123456789ab', icon: '🎨' } })];
    expect(agentFace('designer', agents, 24)).toEqual({ kind: 'image', agent: 'designer', v: '0123456789ab', ring: null });
  });

  it('never sends the token to an image path that is not that agent’s own avatar', () => {
    for (const image of ['https://evil.example/a.png', '/api/crew/builder/avatar?v=0123456789ab', '/api/threads/x/uploads/a.png', '/api/crew/designer/avatar?v=../x']) {
      expect(agentFace('designer', [own({ id: 'designer', name: 'Designer', avatar: { image } })], 24).kind).toBe('character');
    }
  });

  it('draws the icon or emoji on its color, else the crew character the shared agent face draws', () => {
    expect(agentFace('designer', [own({ id: 'designer', name: 'Designer', avatar: { icon: '🎨', bg: '#283c62' } })], 24)).toMatchObject({ kind: 'icon', icon: '🎨', bg: '#283c62' });
    expect(agentFace('builder', crew, 24)).toEqual(sharedFace({ id: 'builder' }, { size: 24 }));
    expect(agentFace('builder', crew, 24)).toMatchObject({ kind: 'character', shape: 'squircle', eyes: 'idle' });
  });

  it("draws the shape and color an agent's file names, and the small drawing at 16px", () => {
    expect(agentFace('writer', crew, 24)).toMatchObject({ kind: 'character', shape: 'droplet', body: '#52cdfe' });
    expect(agentFace('writer', crew, 16)).toMatchObject({ kind: 'character', grid: 18, glyphs: 'small' });
  });

  it("gives a mention pill the agent's color, else its shape's paired color, as its character's body", () => {
    expect(agentColor('writer', crew)).toBe('#52cdfe');
    for (const id of ['builder', 'fixture-agent', 'gone']) expect(agentColor(id, crew)).toBe((agentFace(id, crew, 24) as { body: string }).body);
  });

  it("shows what the avatar shows in a character's eyes, and rings only a photo or an icon", () => {
    expect(agentFace('builder', crew, 32, { shows: { member: 'needs' } })).toMatchObject({ kind: 'character', eyes: 'needs', glyphs: 'large' });
    expect(agentFace('builder', crew, 18, { shows: { mark: 'queued' } })).toMatchObject({ kind: 'character', eyes: 'waiting' });
    const photo = [own({ id: 'designer', name: 'Designer', avatar: { image: '/api/crew/designer/avatar?v=0123456789ab' } })];
    expect(agentFace('designer', photo, 32, { shows: { member: 'working' } })).toMatchObject({ kind: 'image', ring: 'working' });
    expect(agentFace('designer', photo, 32)).toMatchObject({ kind: 'image', ring: null });
    const icon = [own({ id: 'designer', name: 'Designer', avatar: { icon: '🎨' } })];
    expect(agentFace('designer', icon, 22, { shows: { member: 'failed' } })).toMatchObject({ kind: 'icon', ring: 'needs' });
    expect(agentFace('designer', icon, 22, { shows: { member: 'done' } })).toMatchObject({ kind: 'icon', ring: null });
  });

  it('names an agent this machine does not list by its built-in name, else its id, and draws its default character', () => {
    expect(agentName('fixture-agent', crew)).toBe('Fixture agent');
    expect(agentName('builder', [])).toBe('Builder');
    expect(agentName('gone', [])).toBe('gone');
    expect(agentFace('gone', [], 24)).toEqual(sharedFace({ id: 'gone' }, { size: 24 }));
  });
});
