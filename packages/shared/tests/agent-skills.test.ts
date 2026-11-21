import { describe, expect, it } from 'vitest';
import { loadsSkills, skillMeta, skillRows, skillsHarnessNote, toggleSkill, type SkillEntry } from '../agent-skills.ts';

const skill = (name: string, over: Partial<SkillEntry> = {}): SkillEntry => ({ name, description: `${name} does things`, source: 'personal', harnesses: ['claude-code', 'codex'], ...over });
const catalog = { skills: [skill('tdd'), skill('pr-writer', { description: 'Write the PR body' }), skill('superpowers:brainstorming', { source: 'plugin', plugin: 'superpowers', harnesses: ['claude-code'] }), skill('imagegen', { source: 'builtin', harnesses: ['codex'] })] };

describe('the Skills list', () => {
  it('puts the ticked skills first, in the order ticked, then the rest by name', () => {
    expect(skillRows(catalog, ['tdd', 'imagegen']).map((r) => [r.name, r.picked])).toEqual([
      ['tdd', true],
      ['imagegen', true],
      ['pr-writer', false],
      ['superpowers:brainstorming', false],
    ]);
  });

  it('searches names, plugins and descriptions, every word, and always keeps a ticked skill the machine lacks', () => {
    expect(skillRows(catalog, [], 'PR body').map((r) => r.name)).toEqual(['pr-writer']);
    expect(skillRows(catalog, [], 'superpowers').map((r) => r.name)).toEqual(['superpowers:brainstorming']);
    expect(skillRows(catalog, ['gone', 'tdd'], 'writer').map((r) => [r.name, !!r.entry])).toEqual([
      ['gone', false],
      ['pr-writer', true],
    ]);
    expect(skillRows(null, ['gone']).map((r) => r.name)).toEqual(['gone']);
    // A name that matches comes before a description that does.
    const more = { skills: [...catalog.skills, skill('browser-tools', { description: 'Drive a browser' }), skill('bro', { description: 'Restate it' }), skill('pstack:bro'), skill('notes', { description: 'Write brochures' })] };
    expect(skillRows(more, [], 'bro').map((r) => r.name)).toEqual(['bro', 'browser-tools', 'pstack:bro', 'notes']);
  });

  it('ticks a skill onto the end and unticks it in place', () => {
    expect(toggleSkill(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleSkill(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('says where a skill comes from, and which harnesses have it when not all of them do', () => {
    const listed = ['claude-code', 'codex'] as const;
    expect(skillMeta(catalog.skills[0], listed)).toBe('Personal');
    expect(skillMeta(catalog.skills[2], listed)).toBe('Plugin superpowers · Claude Code only');
    expect(skillMeta(catalog.skills[3], listed)).toBe('Built-in · Codex only');
    // With one harness on the machine, there is nothing to compare.
    expect(skillMeta(catalog.skills[3], ['codex'])).toBe('Built-in');
  });

  it('notes an agent whose harness runs off this machine', () => {
    expect([loadsSkills('claude-code'), loadsSkills('codex'), loadsSkills('cursor'), loadsSkills('hermes'), loadsSkills('custom:nomos'), loadsSkills(undefined)]).toEqual([true, true, true, false, false, false]);
    expect(skillsHarnessNote('codex', () => 'Codex')).toBeNull();
    expect(skillsHarnessNote(undefined, () => undefined)).toBeNull();
    expect(skillsHarnessNote('hermes', () => 'Hermes')).toBe('Skills load on Claude Code, Codex and Cursor Agent. Hermes runs off this machine, so its threads do not get them.');
  });
});
