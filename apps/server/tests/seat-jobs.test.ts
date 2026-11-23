import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startRunner } from './runner-boot.ts';

// Work an agent seated in a #conductor thread opened keeps the agent's hidden session as its parent (its crew report
// goes there) and records the #conductor thread (`job_id`) and the agent (`seat_agent`) when it is made, so nothing
// hops parents to find them. Every way the clients get a thread decorates it the same (delegating.ts withDelegating).

const r = await startRunner();
const { migrate } = await import('../db.ts');
const { publishFeed } = await import('../bus.ts');
const { channelsApi } = await import('../channels-api.ts');
const { feedApi } = await import('../feed-api.ts');
const { threadRoutesApi } = await import('../thread-routes-api.ts');
const { STEP_READS_MAX, heldStepReads, progressField } = await import('../step-line.ts');

for (const id of ['conductor', 'acme']) {
  if (!r.db.channels.get(id)) r.db.channels.create({ id, name: id, kind: 'internal', use_worktree: 0, base_dir: r.paths.data });
}

type Made = Parameters<typeof r.db.threads.create>[0];
const make = (over: Partial<Made>) =>
  r.db.threads.create({
    id: randomUUID(), channel_id: 'acme', title: 'Thread', status: 'done', role: null, model: null, session_id: randomUUID(),
    cwd: r.paths.data, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null, ...over,
  });

/** A #conductor thread with the Builder seated, the work the Builder opened, and a thread the job delegated itself. */
function job() {
  const conductor = make({ channel_id: 'conductor', title: 'Fix the labels', role: 'conductor' });
  const seat = make({ channel_id: 'conductor', title: 'Builder in Fix the labels', role: 'builder', parent_id: conductor.id, source: 'member' });
  const work = make({ title: 'Fix labels', role: 'builder', parent_id: seat.id, task_id: 'T-SEAT', source: 'conductor' });
  const direct = make({ title: 'Review labels', role: 'reviewer', parent_id: conductor.id, task_id: 'T-DIRE', source: 'conductor' });
  return { conductor, seat, work, direct };
}

const count = () => (r.db.db.prepare('SELECT COUNT(*) AS n FROM threads WHERE job_id IS NOT NULL').get() as { n: number }).n;

describe('the #conductor thread a seated agent opened work from', () => {
  it('is recorded on the work when it is made, with the agent', () => {
    const { conductor, seat, work, direct } = job();
    expect(r.db.threads.get(work.id)).toMatchObject({ parent_id: seat.id, job_id: conductor.id, seat_agent: 'builder' });
    // A thread the job delegated itself, the seat and the job have none: the parent is the thread they show under.
    for (const t of [direct, seat, conductor]) expect(r.db.threads.get(t.id)).toMatchObject({ job_id: null, seat_agent: null });
    // A seat in a thread outside #conductor opens nothing a #conductor card shows.
    const group = make({ title: 'Group' });
    const elsewhere = make({ title: 'Reviewer in Group', role: 'reviewer', parent_id: group.id, source: 'member' });
    expect(r.db.threads.get(make({ parent_id: elsewhere.id, source: 'conductor' }).id)?.job_id).toBeNull();
  });

  it('is filled in on threads made before, by the migration, and nothing else moves', () => {
    const { conductor, work, direct } = job();
    const want = count();
    r.db.db.exec('UPDATE threads SET job_id = NULL, seat_agent = NULL');
    expect(count()).toBe(0);
    migrate();
    expect(count()).toBe(want);
    expect(r.db.threads.get(work.id)).toMatchObject({ job_id: conductor.id, seat_agent: 'builder' });
    expect(r.db.threads.get(direct.id)?.job_id).toBeNull();
    // Safe to run again.
    migrate();
    expect(count()).toBe(want);
  });

  it('nests the work under the #conductor thread in the lists, keeping the seat as parent', async () => {
    const { conductor, seat, work, direct } = job();
    const listing = (await (await channelsApi.request('/')).json()) as { id: string; handoffs?: { parent: { id: string }; children: { id: string; parent_id: string }[] }[] }[];
    const handoffs = listing.find((c) => c.id === 'conductor')?.handoffs ?? [];
    expect(handoffs.find((g) => g.parent.id === seat.id)).toBeUndefined();
    expect(handoffs.find((g) => g.parent.id === conductor.id)?.children).toEqual([
      expect.objectContaining({ id: work.id, parent_id: seat.id }),
      expect.objectContaining({ id: direct.id, parent_id: conductor.id }),
    ]);
  });
});

/** The next `thread` frame for `id` on /api/feed, as the clients read it, once `send` has run. */
async function fromFeed(id: string, send: () => void): Promise<Record<string, unknown>> {
  const res = await feedApi.request('/feed');
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let sent = false;
  try {
    for (;;) {
      // The writer subscribes before its first frame: send once the stream is open.
      if (!sent) setTimeout(send, 20), (sent = true);
      const { value, done } = await reader.read();
      if (done) throw new Error('the feed ended');
      const lines = (buf + value).split('\n');
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const e = JSON.parse(line.slice(6)) as { type?: string; thread?: Record<string, unknown> };
        if (e.type === 'thread' && e.thread?.id === id) return e.thread;
      }
    }
  } finally {
    await reader.cancel();
  }
}

/** What a delegation card reads of a thread: its list in brief, and the #conductor thread a seat opened it from. */
const card = (t: Record<string, unknown> | undefined) => ({ progress: t?.progress, seated_delegation: t?.seated_delegation });

describe('one decorator', () => {
  it('sends the same progress and seated_delegation on the feed, the detail and every list', { timeout: 20_000 }, async () => {
    const { conductor, work, direct } = job();
    // Both work threads keep a list and are on step 2 of 3.
    for (const t of [work, direct]) {
      r.db.events.add(t.id, 'user', { text: 'Fix the labels' });
      r.db.events.add(t.id, 'tool_use', { id: `s-${t.id}`, name: 'mcp__omni-steps__set_steps', input: { steps: ['Find the labels', 'Fix them', 'Check the page'], current: 1 } });
      r.db.events.add(t.id, 'tool_result', { tool_use_id: `s-${t.id}`, text: 'Showing step 2 of 3', is_error: false });
    }
    const get = async (path: string, api: { request: (p: string) => Response | Promise<Response> } = threadRoutesApi) =>
      (await (await api.request(path)).json()) as unknown;
    const find = (list: unknown, id: string) => (list as { id: string }[]).find((t) => t.id === id) as Record<string, unknown> | undefined;

    for (const [t, seated] of [[work, { thread_id: conductor.id, agent: 'builder' }], [direct, undefined]] as const) {
      const want = { progress: expect.objectContaining({ count: 3, done: 1, at: 2, title: 'Fix them' }), seated_delegation: seated };
      const views = {
        detail: card(find(((await get(`/${conductor.id}`)) as { children: unknown }).children, t.id)),
        own: card(((await get(`/${t.id}`)) as { thread: Record<string, unknown> }).thread),
        threads: card(find(await get('/?channel=acme'), t.id)),
        channel: card(find(await get('/acme/threads', channelsApi), t.id)),
        recent: card(find(await get('/recent', feedApi), t.id)),
        feed: card(await fromFeed(t.id, () => publishFeed({ type: 'thread', thread: r.db.threads.get(t.id) }))),
      };
      for (const [where, got] of Object.entries(views)) expect({ where, ...got }).toEqual({ where, ...want });
    }
  });
});

describe('the step reads', () => {
  it('hold at most STEP_READS_MAX threads, dropping the one read longest ago', () => {
    const parent = make({ title: 'Parent' });
    const kids = Array.from({ length: STEP_READS_MAX + 5 }, (_, i) => make({ title: `Kid ${i}`, parent_id: parent.id, source: 'conductor' }));
    for (const k of kids) progressField(k);
    // Read again, the first kid still held counts as read now.
    const kept = heldStepReads()[0];
    progressField(r.db.threads.get(kept)!);
    progressField(make({ title: 'One more', parent_id: parent.id, source: 'conductor' }));
    const held = heldStepReads();
    expect(held).toHaveLength(STEP_READS_MAX);
    expect(held).toContain(kept);
    expect(held).not.toContain(kids[0].id);
    expect(held).toContain(kids.at(-1)!.id);
  });
});
