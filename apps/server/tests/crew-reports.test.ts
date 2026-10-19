import { beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Crew reports as durable requests (apps/server/runner/queue.ts): saved for the parent before it is woken, keyed by the
// child and its completion, so a second report of the same completion adds nothing, and a parent Ben stopped keeps
// the report for Resume instead of starting again. tests/crew-reports-restart.test.ts covers real restarts.

let H: Awaited<ReturnType<typeof startRunner>>;

beforeAll(async () => {
  H = await startRunner();
});

const T = { timeout: 20_000 };

const rows = (threadId: string) => H.db.messageRequests.forThread(threadId);
const reports = (threadId: string) => rows(threadId).filter((r) => r.kind === 'crew_report');

describe('crew reports', () => {
  it('saves one report per completion, delivered once, and a repeat of that completion reports nothing', T, async () => {
    const parent = await H.start('be the conductor');
    await H.untilResults(parent.id, 1);
    const child = await H.start('child task', { parent_id: parent.id });
    await H.untilResults(child.id, 1);
    await H.untilResults(parent.id, 2);

    const [saved] = reports(parent.id);
    expect(reports(parent.id)).toHaveLength(1);
    expect(saved.request_id).toBe(`crew-report:${child.id}:${H.db.events.lastId(child.id)}`);
    expect(saved).toMatchObject({ state: 'delivered', source: 'crew', mode: 'steer' });
    expect(saved.payload).toMatchObject({ thread_id: child.id, task_id: child.task_id, status: 'done', text: 'ack: child task' });
    expect(saved.event_id).toBe(H.byKind(parent.id, 'crew_report')[0].id);

    // The same completion reported again, as a retry would: no new row, no new transcript report, no new turn.
    H.runner.reportToParent(child.id, 'done', 'ack: child task');
    H.runner.reportToParent(child.id, 'done', 'ack: child task');
    expect(reports(parent.id)).toHaveLength(1);
    expect(H.runner.pendingFor(parent.id)).toEqual([]);
    expect(H.byKind(parent.id, 'crew_report')).toHaveLength(1);
    expect(H.byKind(parent.id, 'result')).toHaveLength(2);
  });

  it('keeps a report for a parent Ben stopped, held for Resume, and Resume delivers it once', T, async () => {
    const parent = await H.start('TOOL:30000 conductor at work');
    await H.untilTool(parent.id);
    const child = await H.start('TOOL:400 child task', { parent_id: parent.id });
    H.runner.interruptThread(parent.id);
    await H.untilStatus(parent.id, 'stopped');
    const results = H.byKind(parent.id, 'result').length;
    const spawns = H.spawns(parent.id).length;
    await H.untilResults(child.id, 1);

    // Not woken: the report waits on Ben, shown as a held crew report from the child.
    const held = await H.until('report held on the parent', () => H.runner.pendingFor(parent.id).find((p) => p.kind === 'crew_report'));
    expect(held).toMatchObject({ kind: 'crew_report', state: 'held', delivery: 'recovered', thread_id: child.id, task_id: child.task_id, text: 'ack: TOOL:400 child task' });
    expect(H.thread(parent.id).status).toBe('stopped');
    expect(H.byKind(parent.id, 'crew_report')).toHaveLength(0);

    // A crew report is Omni's: it can't be edited, and reordering Ben's messages leaves it out.
    expect(() => H.runner.editRequest(parent.id, held.uuid, { prompt: 'changed' })).toThrow(/not edited/);
    H.runner.reorderRequests(parent.id, []);

    await Promise.all([H.runner.resumeRequests(parent.id), H.runner.resumeRequests(parent.id).catch(() => null)]);
    await H.until('parent ran the report', () => H.byKind(parent.id, 'result').length > results && H.thread(parent.id).status === 'done');
    expect(H.byKind(parent.id, 'crew_report').map((e) => e.p.thread_id)).toEqual([child.id]);
    expect(H.byKind(parent.id, 'result')).toHaveLength(results + 1);
    expect(H.spawns(parent.id).length).toBeLessThanOrEqual(spawns + 1);
    expect(reports(parent.id)[0]).toMatchObject({ state: 'delivered' });
    // Nothing left to resume.
    await expect(H.runner.resumeRequests(parent.id, [held.uuid])).rejects.toMatchObject({ status: 409 });
  });

  it('discarding a held report keeps it in the transcript as a dropped report', T, async () => {
    const parent = await H.start('parent');
    await H.untilResults(parent.id, 1);
    H.runner.interruptThread(parent.id);
    H.db.threads.update(parent.id, { status: 'stopped' });
    const child = await H.start('child to discard', { parent_id: parent.id });
    await H.untilResults(child.id, 1);
    const held = await H.until('held report', () => H.runner.pendingFor(parent.id).find((p) => p.kind === 'crew_report'));
    H.runner.discardRequests(parent.id, [held.uuid]);
    expect(H.runner.pendingFor(parent.id)).toEqual([]);
    expect(H.byKind(parent.id, 'crew_report').map((e) => e.p)).toMatchObject([{ thread_id: child.id, dropped: true }]);
    expect(reports(parent.id)[0].state).toBe('discarded');
  });

  it('a team lead still waits for every member, and its go is saved once', T, async () => {
    const conductor = await H.start('conductor');
    await H.untilResults(conductor.id, 1);
    const { lead, members } = await H.runner.createTeam({
      channel: 'scratch',
      prompt: 'Compare two mics',
      title: 'Mics',
      parent_id: conductor.id,
      tasks: [{ prompt: 'mic one' }, { prompt: 'TOOL:500 mic two' }],
    });
    await H.until('first member report', () => H.byKind(lead.id, 'crew_report').length === 1);
    expect(H.spawns(lead.id)).toHaveLength(0);
    await H.untilResults(lead.id, 1);

    // Each member's report is one delivered row, its transcript row the one the lead shows.
    const memberRows = reports(lead.id);
    expect(memberRows.map((r) => r.payload?.thread_id).sort()).toEqual(members.map((m) => m.id).sort());
    expect(memberRows.every((r) => r.state === 'delivered')).toBe(true);
    expect(memberRows.map((r) => r.event_id).sort()).toEqual(H.byKind(lead.id, 'crew_report').map((e) => e.id).sort());
    const go = rows(lead.id).find((r) => r.request_id === `team-settle:${lead.id}`);
    expect(go).toMatchObject({ kind: 'user', source: 'team', state: 'delivered', payload: { text: 'All 2 reports are in.', source: 'team' } });

    // Settling again (a late call) starts nothing new.
    H.runner.settleTeam(lead.id);
    for (const m of members) H.runner.reportToParent(m.id, 'done', 'again');
    expect(H.byKind(lead.id, 'crew_report')).toHaveLength(2);
    expect(H.spawns(lead.id)).toHaveLength(1);
    await H.untilResults(conductor.id, 2);
    expect(H.byKind(conductor.id, 'crew_report').map((e) => e.p.thread_id)).toEqual([lead.id]);
  });
});
