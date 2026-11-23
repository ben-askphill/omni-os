import { describe, expect, it } from 'vitest';
import { newContext } from '../message-context.ts';
import { agentMention, agentMentionBody } from '../message-context-agent.ts';
import type { Collision } from '../collisions.ts';
import { isBrief, lanePlan, lockedReply, outcomeLine, promptCaption, promptRecipients, replyShows, thinkingLabel, turnLive } from '../turn-plan.ts';
import type { TurnStatus } from '../thread-view.ts';

const ids = (() => {
  let n = 0;
  return { id: () => `c${++n}` };
})();
const names: Record<string, string> = { builder: 'Builder', designer: 'Designer', reviewer: 'Reviewer' };
const nameOf = (a: string) => names[a] ?? a;

describe('promptCaption', () => {
  const caption = (p: Parameters<typeof promptCaption>[0], o: Partial<Parameters<typeof promptCaption>[1]> = {}) => promptCaption(p, { index: 0, brief: false, lead: null, ...o });

  it('says a message never reached the agent first, with why when it knows', () => {
    expect(caption({ dropped: true, undelivered: 'the run ended' }, { lead: 'Builder', brief: true })).toEqual({ text: 'Not delivered · the run ended', kind: 'dropped' });
    expect(caption({ dropped: true }).text).toBe('Not sent');
  });

  it("names a team lead's message, then PR watch and team, then a delegated brief", () => {
    expect(caption({ source: 'lead' }, { lead: 'Builder' })).toEqual({ text: 'Builder', kind: 'lead' });
    expect(caption({ source: 'pr-watch' }, { brief: true })).toEqual({ text: 'PR watch', kind: 'pr-watch' });
    expect(caption({ source: 'team' }).kind).toBe('team');
    expect(caption({}, { brief: true, taskId: 'T-12' })).toEqual({ text: 'Delegated by the Conductor · T-12', kind: 'brief' });
    expect(caption({}, { brief: true }).text).toBe('Delegated by the Conductor');
  });

  it('marks a message sent while the turn ran, and says nothing of the first', () => {
    expect(caption({}, { index: 1 })).toEqual({ text: 'Sent while it ran', kind: 'late' });
    expect(caption({})).toEqual({ text: null, kind: null });
  });
});

describe('isBrief', () => {
  it("is the delegated thread's first message, once its start is loaded", () => {
    expect(isBrief({ parent_id: 'p' }, { first: true, index: 0, atStart: true })).toBe(true);
    expect(isBrief({ parent_id: null }, { first: true, index: 0, atStart: true })).toBe(false);
    expect(isBrief({ parent_id: 'p' }, { first: true, index: 1, atStart: true })).toBe(false);
    expect(isBrief({ parent_id: 'p' }, { first: false, index: 0, atStart: true })).toBe(false);
    expect(isBrief({ parent_id: 'p' }, { first: true, index: 0, atStart: false })).toBe(false);
  });
});

describe('promptRecipients', () => {
  const designer = newContext(agentMention, agentMentionBody({ id: 'designer', name: 'Designer' }), '', ids);
  const other = { id: 'x', kind: 'thread_reference', v: 1, label: 'T-1', note: '', body: {} };

  it('names the agents a message went to and keeps the rest as chips', () => {
    expect(promptRecipients({ text: 'Rework the drawer', context: [designer, other] }, 'builder', nameOf)).toEqual({ lead: null, to: [{ agent: 'designer', name: 'Designer' }], chips: [other] });
  });

  it("adds a team lead's members once, after the agents its context names", () => {
    const r = promptRecipients({ text: 'Split the work', context: [designer], source: 'lead', to: ['designer', 'reviewer'] }, 'builder', nameOf);
    expect(r.lead?.from).toBe('Builder');
    expect(r.to).toEqual([{ agent: 'designer', name: 'Designer' }, { agent: 'reviewer', name: 'Reviewer' }]);
  });
});

describe('outcomeLine', () => {
  it('says how the turn ended, how long it took, its steps and a harness', () => {
    expect(outcomeLine({ status: 'done', took: '2m 3s', steps: 4, harness: 'Codex' })).toBe('Done in 2m 3s · 4 steps · Codex');
    expect(outcomeLine({ status: 'failed', took: '5s', steps: 1, harness: null })).toBe('Failed after 5s · 1 step');
    expect(outcomeLine({ status: 'stopped', took: '', steps: 0, harness: null })).toBe('Stopped');
    expect(outcomeLine({ status: 'running', took: '', steps: 0, harness: null })).toBe('Ended');
  });

  it("puts the thread's limit line first in place of the time", () => {
    expect(outcomeLine({ status: 'failed', took: '5s', steps: 2, harness: null, limit: 'Usage limit until 14:00' })).toBe('Usage limit until 14:00 · 2 steps');
  });
});

describe('a live turn', () => {
  it('is running or queued', () => {
    expect((['running', 'queued', 'done', 'failed', 'stopped'] as TurnStatus[]).map((status) => turnLive({ status }))).toEqual([true, true, false, false, false]);
  });

  it("thinks in the lead's status words, or Starting, and another agent's turn just thinks", () => {
    expect(thinkingLabel({ author: 'builder' }, 'builder', 'Reading the cart', 'starting')).toBe('Reading the cart');
    expect(thinkingLabel({ author: null }, 'builder', null, 'starting')).toBe('Starting');
    expect(thinkingLabel({ author: null }, 'builder', null)).toBe('Thinking');
    expect(thinkingLabel({ author: 'designer' }, 'builder', 'Reading the cart', 'starting')).toBe('Thinking');
  });

  it('shows live eyes on the head of a reply being written, its seat state in a group thread', () => {
    expect(replyShows({ status: 'running', author: 'builder' }, undefined, 'working')).toEqual({ mark: 'working' });
    expect(replyShows({ status: 'done', author: 'builder' }, undefined, 'working')).toBeUndefined();
    expect(replyShows({ status: 'queued', author: 'designer' }, [{ agent: 'designer', state: 'needs' }], 'working')).toEqual({ member: 'needs' });
  });

  it('puts the lock line under a remote agent reply the channel keeps its files from', () => {
    const agents = [{ id: 'remote', server: { url: 'https://x' } }, { id: 'builder' }];
    expect(lockedReply({ prose: 'ok', author: 'remote' }, agents, null)).toBe(true);
    expect(lockedReply({ prose: 'ok', author: 'remote' }, agents, { remote_work: 1 })).toBe(false);
    expect(lockedReply({ prose: null, author: 'remote' }, agents, null)).toBe(false);
    expect(lockedReply({ prose: 'ok', author: 'builder' }, agents, null)).toBe(false);
  });
});

describe('lanePlan', () => {
  const flag = (path: string, cleared: Collision['cleared'] = null) => ({ id: 1, key: path, path, label: path, agents: ['builder', 'designer'], at: '', cleared }) as Collision;
  const lanes = {
    turns: [{ author: 'builder', status: 'done' as TurnStatus }, { author: 'designer', status: 'running' as TurnStatus }],
    flags: [flag('src/cart.ts'), flag('src/old.ts', 'commit')],
    files: { builder: ['src/cart.ts', 'src/a.ts'], designer: ['src/old.ts'] },
    latest: { designer: 'Editing the drawer', builder: null },
  };

  it('gives a tab per agent, flagged when it edited a file a flag still up names', () => {
    const plan = lanePlan(lanes, null)!;
    expect(plan.tabs).toEqual([{ agent: 'builder', status: 'done', hit: true }, { agent: 'designer', status: 'running', hit: false }]);
    expect(plan.open.map((f) => f.path)).toEqual(['src/cart.ts']);
  });

  it('shows the picked lane, the first when none or an unknown one is picked', () => {
    expect(lanePlan(lanes, 'designer')).toMatchObject({ agent: 'designer', working: true, live: true, latest: 'Editing the drawer' });
    expect(lanePlan(lanes, 'nobody')).toMatchObject({ agent: 'builder', working: false, live: true, latest: null });
    expect(lanePlan({ ...lanes, turns: [] }, null)).toBeNull();
  });

  it("lists the picked lane's files with their labels and flags", () => {
    expect(lanePlan(lanes, 'builder')!.files).toEqual([
      { path: 'src/cart.ts', label: 'src/cart.ts', flagged: true },
      { path: 'src/a.ts', label: 'src/a.ts', flagged: false },
    ]);
  });

  it('is history once every lane ended', () => {
    expect(lanePlan({ ...lanes, turns: lanes.turns.map((t) => ({ ...t, status: 'done' as TurnStatus })) }, null)!.live).toBe(false);
  });
});
