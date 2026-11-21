import type { CrewRole, Thread } from '@omni/client-core';
import crewJson from '@omni/test-fixtures/wire/crew.json';
import membersJson from '@omni/test-fixtures/wire/thread-members.json';
import { agentMentionBody } from '@omni/shared/message-context-agent.ts';
import { describe, expect, it } from 'vitest';

import { agentMenu, composerRouting, memberRows, pickAgent, threadAgents } from '../../src/thread/agents';

// The server's recorded answers (apps/server/tests/wire-fixtures.test.ts), read as the phone reads them.
const crew = crewJson as unknown as CrewRole[];
const group = membersJson as unknown as Thread;
const solo = { ...group, members: undefined } as Thread;
const mention = (id: string, name: string) => ({ kind: 'agent_mention', v: 1, id: `m-${id}`, body: agentMentionBody({ id, name }) });

describe('threadAgents', () => {
  it('names the lead, the members seated now and every other agent a mention would seat, never the Conductor', () => {
    const a = threadAgents(group, crew);
    expect(a.lead).toEqual({ id: 'builder', name: 'Builder' });
    expect(a.members.map((m) => m.id)).toEqual(['builder', 'reviewer']);
    expect(a.others.map((m) => m.id)).not.toContain('conductor');
    expect(a.others.map((m) => m.id)).not.toContain('reviewer');
    expect(a.others.map((m) => m.id)).toContain('fixture-agent');
  });

  it('reads a thread with no members as its lead alone', () => {
    expect(threadAgents(solo, crew).members).toEqual([{ id: 'builder', name: 'Builder' }]);
  });
});

describe('memberRows', () => {
  it('lists the lead first with no Remove, and each member with its state and run', () => {
    const working = { ...group, members: group.members!.map((m) => (m.lead ? m : { ...m, state: 'working' as const })) };
    expect(memberRows(working)).toEqual([
      { agent: 'builder', name: 'Builder', lead: true, state: 'Idle', glyph: 'done', member: 'done', removable: false, run: null },
      { agent: 'reviewer', name: 'Reviewer', lead: false, state: 'Working', glyph: 'running', member: 'working', removable: true, run: 'Claude Code · claude-haiku-4-5' },
    ]);
  });
});

describe('composerRouting', () => {
  it("names the lead in the placeholder while no @ is typed, and who gets the message once one is", () => {
    const a = threadAgents(group, crew);
    expect(composerRouting(group, a, '', [])).toMatchObject({ placeholder: 'Reply to Builder', hint: null, toOthers: false });
    expect(composerRouting(group, a, '@Designer look', [mention('designer', 'Designer')])).toMatchObject({
      hint: 'Goes to Designer only. Designer joins this thread and stays until you remove it.',
      toOthers: true,
    });
    expect(composerRouting(group, a, '@Builder look', [mention('builder', 'Builder')]).toOthers).toBe(false);
  });

  it('says a remote lead talks only, and takes no message in a read-only thread', () => {
    const remote = { ...solo, role: 'fixture-agent', harness: 'custom:fixture-agent' } as Thread;
    expect(composerRouting(remote, threadAgents(remote, crew), '', []).placeholder).toBe('Message Fixture agent. A local agent changes files: @ one to seat it');
    const gone = { ...group, read_only: 'Its lead agent was deleted. Start a new thread to carry on.' } as Thread;
    expect(composerRouting(gone, threadAgents(gone, crew), '', [])).toMatchObject({ placeholder: gone.read_only, readOnly: true });
  });

  it('keeps the steer and queue wording while a turn runs, and with no lead', () => {
    const running = { ...group, status: 'running' } as Thread;
    expect(composerRouting(running, threadAgents(running, crew), '', []).placeholder).toBeNull();
    const none = { ...solo, role: null } as Thread;
    expect(composerRouting(none, threadAgents(none, crew), '', []).placeholder).toBeNull();
  });
});

describe('the @ agent menu', () => {
  const a = threadAgents(group, crew);

  it('lists the members first, then the agents a mention would seat, while an @ starts the word at the caret', () => {
    const menu = agentMenu('please @', 8, a);
    expect(menu?.rows.slice(0, 2).map((r) => [r.insert, r.detail])).toEqual([
      ['builder', 'In this thread'],
      ['reviewer', 'In this thread'],
    ]);
    expect(menu?.rows.find((r) => r.insert === 'fixture-agent')?.detail).toBe('Joins this thread');
    expect(agentMenu('please @fix', 11, a)?.rows.map((r) => r.insert)).toEqual(['fixture-agent']);
    expect(agentMenu('mail me@home', 12, a)).toBeNull();
    expect(agentMenu('no at here', 10, a)).toBeNull();
  });

  it('puts the name in the text and an agent_mention record on the message, once per agent', () => {
    const menu = agentMenu('ask @fix', 8, a)!;
    const picked = pickAgent('ask @fix', menu.at, menu.rows[0], [], () => 'r1');
    expect(picked.text).toBe('ask @Fixture agent ');
    expect(picked.record).toEqual({ id: 'r1', kind: 'agent_mention', v: 1, label: '@Fixture agent', note: '', body: { agent: 'fixture-agent', name: 'Fixture agent' } });
    expect(pickAgent('again @fix', { query: 'fix', start: 6, end: 10 }, menu.rows[0], [picked.record!], () => 'r2').record).toBeNull();
  });
});
