import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';

let H: Awaited<ReturnType<typeof startRunner>>;

beforeAll(async () => {
  H = await startRunner();
});

const T = { timeout: 20_000 };

describe('delegate_team', () => {
  it('runs the members, then the lead once with every reply, then reports once to the conductor', T, async () => {
    const conductor = await H.start('be the conductor');
    await H.untilResults(conductor.id, 1);
    const { lead, members } = await H.runner.createTeam({
      channel: 'scratch',
      title: 'Mic research',
      prompt: 'Research the mic',
      parent_id: conductor.id,
      task_id: 'T-9',
      tasks: [
        { title: 'Price', prompt: 'find the price' },
        { title: 'Reviews', prompt: 'THINK:600 find reviews' },
      ],
    });
    expect(lead.status).toBe('running');
    expect(members.map((m) => [m.parent_id, m.source, m.task_id])).toEqual([
      [lead.id, 'team', 'T-9.1'],
      [lead.id, 'team', 'T-9.2'],
    ]);

    // The quick member's report shows in the lead, which keeps waiting for the other one.
    await H.until('first report on the lead', () => H.byKind(lead.id, 'crew_report').length === 1);
    expect(H.spawns(lead.id)).toHaveLength(0);
    expect(H.thread(lead.id).status).toBe('running');

    await H.untilResults(lead.id, 1);
    expect(H.spawns(lead.id)).toHaveLength(1);
    expect(H.flow(lead.id)).toEqual(['user', 'crew_report', 'crew_report', 'user', 'assistant_text', 'result']);
    expect(H.byKind(lead.id, 'user')[1].p).toMatchObject({ text: 'All 2 reports are in.', source: 'team' });
    const [reply] = H.texts(lead.id, 'assistant_text');
    expect(reply).toContain('Research the mic');
    expect(reply).toContain('ack: find the price');
    expect(reply).toContain('ack: THINK:600 find reviews');

    // One report reaches the conductor: the lead's, not one per member.
    await H.untilResults(conductor.id, 2);
    expect(H.byKind(conductor.id, 'crew_report').map((e) => e.p.thread_id)).toEqual([lead.id]);

    // Channel lists show the lead, not its members.
    const listed = H.db.threads.byChannel('scratch').map((t) => t.id);
    expect(listed).toContain(lead.id);
    expect(listed).not.toContain(members[0].id);
  });

  it('stopping a waiting lead stops its members and never runs the lead', T, async () => {
    const { lead, members } = await H.runner.createTeam({
      channel: 'scratch',
      prompt: 'Team that gets stopped',
      title: 'Stopped team',
      tasks: [{ prompt: 'HANG forever' }],
    });
    await H.until('member running', () => H.spawns(members[0].id).length === 1);
    H.runner.interruptThread(lead.id);
    expect(H.thread(lead.id).status).toBe('stopped');
    await H.until('member stopped', () => !['running', 'queued'].includes(H.thread(members[0].id).status));
    await H.until('stopped report shown', () => H.byKind(lead.id, 'crew_report').length === 1);
    expect(H.spawns(lead.id)).toHaveLength(0);
  });
});
