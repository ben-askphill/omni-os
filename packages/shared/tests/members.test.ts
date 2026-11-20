import { describe, expect, it } from 'vitest';
import { avatarMark, busiest, groupGlyph, groupMark, markLine, recipients, replyTo, routingHint, type MemberState } from '../members.ts';
import { threadGlyph, threadMark } from '../status.ts';
import { agentMention, mentionedAgents } from '../message-context-agent.ts';

const member = (state: MemberState, lead = false) => ({ lead, state });
const lead = { agent: 'builder', name: 'Builder' };
const designer = { agent: 'designer', name: 'Designer' };
const reviewer = { agent: 'reviewer', name: 'Reviewer' };

describe('the busiest-state rule', () => {
  it('orders Needs you, Failed, Working, Done with Stopped, Idle', () => {
    expect(busiest(['idle', 'done', 'working'])).toBe('working');
    expect(busiest(['working', 'failed'])).toBe('failed');
    expect(busiest(['failed', 'needs', 'working'])).toBe('needs');
    expect(busiest(['stopped', 'idle'])).toBe('stopped');
    expect(busiest([])).toBe('idle');
  });

  it('marks a thread with the busiest of its lead and members', () => {
    // The lead is done; a member works: Working.
    expect(threadMark({ status: 'done', members: [member('done', true), member('working')] })).toBe('working');
    // A member waits on Ben: Needs you, over a working lead.
    expect(threadMark({ status: 'running', members: [member('working', true), member('needs')] })).toBe('question');
    // A failed member over a working lead: Failed ranks above Working.
    expect(threadMark({ status: 'running', members: [member('working', true), member('failed')] })).toBe('failed');
    // A lead at its usage limit stays Limited over a member that only finished.
    expect(threadMark({ status: 'failed', limit_state: 'limited', members: [member('failed', true), member('done')] })).toBe('limited');
    // No members: as before.
    expect(threadMark({ status: 'done' })).toBe('done');
    expect(threadGlyph({ status: 'done', members: [member('done', true), member('working')] })).toBe('running');
    expect(groupGlyph('idle', [member('stopped')])).toBe('settled');
    expect(groupMark('review', [member('done')])).toBe('review');
  });
});

describe('who gets a message', () => {
  it('goes to the lead with no mention, else to the named agents only', () => {
    expect(recipients(lead, [])).toEqual([lead]);
    expect(recipients(lead, [designer, designer, reviewer])).toEqual([designer, reviewer]);
  });

  it('names the lead in the placeholder and, once an @ is typed, who gets it and who joins', () => {
    expect(replyTo('Builder')).toBe('Reply to Builder');
    expect(routingHint('hello', lead, [], ['builder'])).toBeNull();
    expect(routingHint('@', lead, [], ['builder'])).toMatch(/^Goes to Builder\./);
    expect(routingHint('@Designer look', lead, [designer], ['builder', 'designer'])).toBe('Goes to Designer only.');
    expect(routingHint('@Designer @Reviewer look', lead, [designer, reviewer], ['builder', 'designer'])).toBe(
      'Goes to Designer and Reviewer only. Reviewer joins this thread and stays until you remove it.',
    );
  });
});

describe('agent mention records', () => {
  it('parses and lists the agents a message names, each once, in order', () => {
    expect(agentMention.parse({ agent: 'designer', name: 'Designer' }, 1)).toEqual({ ok: true, value: { agent: 'designer', name: 'Designer' } });
    expect(agentMention.parse({ agent: '', name: 'x' }, 1).ok).toBe(false);
    const rec = (agent: string) => ({ id: agent, kind: 'agent_mention', v: 1, label: `@${agent}`, body: { agent, name: agent } });
    expect(mentionedAgents([rec('b'), { id: 'm', kind: 'machine_mention', body: {} }, rec('a'), rec('b')]).map((a) => a.agent)).toEqual(['b', 'a']);
    expect(mentionedAgents('nope')).toEqual([]);
  });
});

describe('the avatar mark', () => {
  const m = (agent: string, state: MemberState, lead = false) => ({ agent, name: agent[0].toUpperCase() + agent.slice(1), lead, state });

  it('draws the asker first in the Needs you ring, then the working agents, two at most', () => {
    expect(avatarMark([m('builder', 'working', true), m('designer', 'needs')])).toEqual({
      faces: [{ agent: 'designer', name: 'Designer', ring: 'needs' }, { agent: 'builder', name: 'Builder', ring: 'working' }],
      more: 0,
      failed: false,
    });
    // Three at work: one face and a count.
    expect(avatarMark([m('builder', 'working', true), m('designer', 'working'), m('critic', 'needs')])).toEqual({
      faces: [{ agent: 'critic', name: 'Critic', ring: 'needs' }],
      more: 2,
      failed: false,
    });
  });

  it('shows the working avatar and a red dot when one agent failed while another works', () => {
    expect(avatarMark([m('builder', 'failed', true), m('designer', 'working')])).toEqual({
      faces: [{ agent: 'designer', name: 'Designer', ring: 'working' }],
      more: 0,
      failed: true,
    });
  });

  it('draws nothing once no agent works or waits on Ben, so the busiest-state mark shows', () => {
    expect(avatarMark([m('builder', 'done', true), m('designer', 'failed')])).toBeNull();
    expect(avatarMark(undefined)).toBeNull();
  });

  it('says it on the phone row’s second line', () => {
    expect(markLine([m('builder', 'needs', true), m('designer', 'working')])).toBe('Builder asks you · Designer working');
    expect(markLine([m('builder', 'working', true), m('designer', 'working'), m('critic', 'failed')])).toBe('Builder and Designer working · Critic failed');
    expect(markLine([m('builder', 'done', true), m('designer', 'done')])).toBeNull();
  });
});
