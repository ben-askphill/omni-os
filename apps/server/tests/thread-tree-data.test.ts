import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// The data the thread tree reads (apps/web/src/components/ThreadTree.tsx): a failed delegated thread or team member
// waits on the job it sits under, as its question does (apps/server/db/repos/needs-you.ts), every waiting blocker names
// the threads under the job it came from, and the channel listing carries each team lead with its members and the
// model and branch of every thread it lists (apps/server/channels-api.ts).

const h = await startRunner({ FAKE_CLAUDE_CRASH_ON: 'CRASH_NOW' });
const { app } = await import('../app.ts');
const { db } = await import('../db.ts');
const { completions } = await import('../db/repos/needs-you.ts');
const { migrate } = await import('../db/migrate.ts');
const T = { timeout: 30_000 };

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const itemOf = async (id: string) => ((await call('GET', '/needs-you')).body.items as any[]).find((i) => i.thread.id === id);
const idle = async (prompt: string, extra: Record<string, unknown> = {}) => {
  const t = await h.start(prompt, extra);
  await h.untilResults(t.id, 1);
  return h.thread(t.id);
};
const failed = async (extra: Record<string, unknown>) => {
  const t = await h.start('CRASH_NOW', extra);
  await h.untilStatus(t.id, 'failed');
  return h.thread(t.id);
};

describe('a failed thread under a job', () => {
  it('waits on the job that delegated it, naming it, until Ben reads its result', T, async () => {
    const job = await idle('be the conductor');
    await call('POST', '/needs-you/read', { uid: (await itemOf(job.id)).result.uid });
    expect(await itemOf(job.id)).toBeUndefined();

    const child = await failed({ parent_id: job.id, title: 'Re-record the wire fixture' });
    const uid = completions.latest(child.id)!.uid;
    const item = await itemOf(job.id);
    expect(item.blockers).toEqual([{ kind: 'child_failed', detail: 'Re-record the wire fixture', count: 1, from: [child.id], results: [uid] }]);

    await call('POST', '/needs-you/read', { uid });
    expect(await itemOf(job.id)).toBeUndefined();
  });

  it('counts one failed thread once: it moves to the job, as its question does', T, async () => {
    const job = await idle('conduct a single failure');
    await call('POST', '/needs-you/read', { uid: (await itemOf(job.id)).result.uid });
    const child = await failed({ parent_id: job.id, title: 'Fail once' });
    const uid = completions.latest(child.id)!.uid;

    // One item holds the failure, the job's; the failed run is no unread result of its own. (The child's crew report
    // can still give the job a result of its own, which counts as the job's, not the failure's.)
    const { items } = (await call('GET', '/needs-you')).body as { items: any[] };
    expect(await itemOf(child.id)).toBeUndefined();
    expect(items.filter((i) => i.result?.uid === uid)).toEqual([]);
    const holding = items.filter((i) => i.blockers.some((b: any) => b.from?.includes(child.id)));
    expect(holding.map((i) => i.thread.id)).toEqual([job.id]);
  });

  it('keeps a failed thread on its own item when nothing above it is listed', T, async () => {
    const job = await idle('a job Ben archived');
    await call('PATCH', `/threads/${job.id}`, { archived: 1 });
    const child = await failed({ parent_id: job.id, title: 'Fail under a done job' });
    expect((await itemOf(child.id)).result.status).toBe('failed');
  });

  it('waits on the top of the chain for a team member, past its lead, until Ben opens the member', T, async () => {
    const job = await idle('be the conductor again');
    await call('POST', '/needs-you/read', { uid: (await itemOf(job.id)).result.uid });
    const lead = await idle('lead the team', { parent_id: job.id, title: 'Rebuild PDP gallery' });
    const member = await failed({ parent_id: lead.id, source: 'team', title: 'Zoom modal a11y pass' });
    const uid = completions.latest(member.id)!.uid;

    const item = await itemOf(job.id);
    expect(item.blockers).toContainEqual({ kind: 'child_failed', detail: 'Zoom modal a11y pass', count: 1, from: [member.id], results: [uid] });
    // Team members never list on their own.
    expect(await itemOf(member.id)).toBeUndefined();

    // Opening the member reads the result its job's blocker names, which clears it.
    await call('POST', '/needs-you/read', { uid });
    expect((await itemOf(job.id))?.blockers.find((b: any) => b.kind === 'child_failed')).toBeUndefined();
  });

  it('treats team members that failed before the upgrade as read, once', T, async () => {
    const job = await idle('a job from before');
    await call('POST', '/needs-you/read', { uid: (await itemOf(job.id)).result.uid });
    const lead = await idle('an old lead', { parent_id: job.id });
    const member = await failed({ parent_id: lead.id, source: 'team', title: 'Failed last week' });
    // As an older build left it: no read watermark on a member, and the migration not run yet.
    db.prepare('DELETE FROM result_reads WHERE thread_id = ?').run(member.id);
    db.prepare(`DELETE FROM kv WHERE key = 'sync.migrated.team_results_read'`).run();
    expect((await itemOf(job.id)).blockers[0]).toMatchObject({ kind: 'child_failed', from: [member.id] });

    migrate();
    expect((await itemOf(job.id))?.blockers ?? []).toEqual([]);

    // Once only: a member that fails after the upgrade counts.
    const later = await failed({ parent_id: lead.id, source: 'team', title: 'Failed today' });
    migrate();
    expect((await itemOf(job.id)).blockers[0]).toMatchObject({ kind: 'child_failed', from: [later.id] });
  });

  it('leaves the job alone once the failed thread is marked done', T, async () => {
    const job = await idle('one more conductor');
    await call('POST', '/needs-you/read', { uid: (await itemOf(job.id)).result.uid });
    const child = await failed({ parent_id: job.id, title: 'Give up' });
    expect((await itemOf(job.id)).blockers[0].kind).toBe('child_failed');
    expect((await call('PATCH', `/threads/${child.id}`, { done: true })).status).toBe(200);
    // The child's report can still leave the job an unread result of its own; the failure no longer holds it.
    expect((await itemOf(job.id))?.blockers ?? []).toEqual([]);
  });
});

describe('a question under a job', () => {
  it('names the thread that asked on the job\'s blocker', T, async () => {
    const job = await idle('conduct the questions');
    const child = await h.start('TOOL:8000 ask away', { parent_id: job.id });
    await h.untilTool(child.id);
    const ask = await call('POST', `/threads/${child.id}/questions`, {
      questions: [{ question: 'Which market first?', header: 'Market', options: [{ label: 'NL', description: '' }, { label: 'DE', description: '' }], multiSelect: false }],
    });
    expect(ask.status).toBe(200);
    const b = (await itemOf(job.id)).blockers.find((x: any) => x.kind === 'question');
    expect(b).toMatchObject({ detail: 'Which market first?', count: 1, from: [child.id] });
    await call('POST', `/threads/${child.id}/stop`, {});
  });
});

describe('the channel listing', () => {
  it('lists a team lead with its members on the lead\'s channel, with model and branch on every stub', T, async () => {
    const lead = await idle('lead a small team', { title: 'Small team', model: 'opus' });
    const a = await idle('member one', { parent_id: lead.id, source: 'team', title: 'Member one' });
    const b = await idle('member two', { parent_id: lead.id, source: 'team', title: 'Member two' });
    const channels = (await call('GET', '/channels')).body as any[];
    const scratch = channels.find((c) => c.id === 'scratch');
    const group = scratch.teams.find((g: any) => g.parent.id === lead.id);
    expect(group.children.map((c: any) => c.id)).toEqual([a.id, b.id]);
    expect(group.parent).toHaveProperty('model', h.thread(lead.id).model);
    expect(group.parent).toHaveProperty('branch', h.thread(lead.id).branch);
    expect(group.children[0]).toHaveProperty('source', 'team');

    // An archived member drops out; with none left the lead has no group.
    await call('PATCH', `/threads/${a.id}`, { archived: 1 });
    await call('PATCH', `/threads/${b.id}`, { archived: 1 });
    const after = ((await call('GET', '/channels/scratch')).body.teams ?? []) as any[];
    expect(after.find((g) => g.parent.id === lead.id)).toBeUndefined();
  });
});
