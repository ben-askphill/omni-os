import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startRunner } from './runner-boot.ts';

// A thread shows running while a thread it delegated works, at any depth (apps/server/delegating.ts).

let H: Awaited<ReturnType<typeof startRunner>>;
let D: typeof import('../delegating.ts');
let channelsApi: typeof import('../channels-api.ts').channelsApi;
let threadRoutesApi: typeof import('../thread-routes-api.ts').threadRoutesApi;
let stopWatch: () => void;

beforeAll(async () => {
  H = await startRunner();
  D = await import('../delegating.ts');
  ({ channelsApi } = await import('../channels-api.ts'));
  ({ threadRoutesApi } = await import('../thread-routes-api.ts'));
  stopWatch = D.watchDelegating();
});
afterAll(() => stopWatch?.());

const T = { timeout: 20_000 };

/** A thread row made directly, as a sync or a crash leaves it. */
function row(status: string, parent_id: string | null = null, extra: Record<string, unknown> = {}) {
  return H.db.threads.create({
    id: randomUUID(), channel_id: 'scratch', title: `${status} thread`, status: status as any, role: null, model: null,
    session_id: randomUUID(), cwd: H.paths.data, branch: null, parent_id, task_id: null, source: parent_id ? 'conductor' : 'manual', automation: null,
    ...extra,
  });
}

type Stub = { id: string; status: string; delegating: boolean };
async function scratch() {
  const res = await channelsApi.request('/scratch');
  return (await res.json()) as { running: number; active: Stub[]; recent: Stub[] };
}
async function detail(id: string) {
  return (await (await threadRoutesApi.request(`/${id}`)).json()) as { thread: Stub; children: Stub[] };
}
const working = (t: { status: string; delegating?: boolean }) => t.status === 'running' || t.status === 'queued' || !!t.delegating;

/** What the clients see of a thread on the feed, deduped: working or idle, decorated as the SSE writer does. */
function watchShown(id: string) {
  const log: string[] = [];
  const on = (e: any) => {
    if (e.type !== 'thread' || e.thread.id !== id) return;
    const s = working(D.withDelegating(e.thread)) ? 'working' : 'idle';
    if (log.at(-1) !== s) log.push(s);
  };
  H.bus.on('feed', on);
  return { log, stop: () => H.bus.off('feed', on) };
}

describe('delegating, from the statuses', () => {
  it('an idle parent with a running child is delegating, in the channel list, its count and the thread', async () => {
    const parent = row('done');
    const child = row('running', parent.id);
    expect(D.delegatingIds().has(parent.id)).toBe(true);
    expect(D.delegatingIds().has(child.id)).toBe(false);

    const ch = await scratch();
    expect(ch.active.find((t) => t.id === parent.id)).toMatchObject({ status: 'done', delegating: true });
    expect(ch.running).toBe(ch.active.filter(working).length);
    expect((await detail(parent.id)).thread).toMatchObject({ status: 'done', delegating: true });

    // The child finishes: the parent is idle again.
    H.db.threads.update(child.id, { status: 'done' });
    expect(D.delegatingIds().has(parent.id)).toBe(false);
    expect((await scratch()).active.some((t) => t.id === parent.id)).toBe(false);
    expect((await detail(parent.id)).thread.delegating).toBe(false);
  });

  it('counts a grandchild: every thread above a running one is delegating', () => {
    const top = row('done');
    const mid = row('done', top.id);
    const leaf = row('queued', mid.id);
    expect([top.id, mid.id].every((id) => D.delegatingIds().has(id))).toBe(true);
    H.db.threads.update(leaf.id, { status: 'failed' });
    expect([top.id, mid.id].some((id) => D.delegatingIds().has(id))).toBe(false);
  });

  it('ends on a parent_id cycle', () => {
    const a = row('running');
    const b = row('done', a.id);
    H.db.db.prepare('UPDATE threads SET parent_id = ? WHERE id = ?').run(b.id, a.id);
    const ids = D.delegatingIds();
    expect(ids.has(b.id)).toBe(true);
    H.db.threads.update(a.id, { status: 'stopped' });
    expect(D.delegatingIds().has(b.id)).toBe(false);
  });

  it('a dead child does not pin its parent: the boot sweep fails it, and an archived one counts for nothing', () => {
    const parent = row('done');
    const crashed = row('running', parent.id);
    expect(D.delegatingIds().has(parent.id)).toBe(true);
    // What Omni does with a run the last server left mid-turn (index.ts at boot).
    H.db.threads.failInterrupted();
    expect(H.thread(crashed.id).status).toBe('failed');
    expect(D.delegatingIds().has(parent.id)).toBe(false);

    const other = row('done');
    const stuck = row('running', other.id);
    H.db.db.prepare('UPDATE threads SET archived = 1 WHERE id = ?').run(stuck.id);
    expect(D.delegatingIds().has(other.id)).toBe(false);
  });
});

describe('delegating, live', () => {
  it('stays working from its own turn through its child to the report, then goes idle once, with no flicker', T, async () => {
    const conductor = await H.start('be the conductor');
    await H.untilResults(conductor.id, 1);
    const shown = watchShown(conductor.id);
    const child = await H.runner.createThread({ channel: 'scratch', prompt: 'THINK:600 do the work', parent_id: conductor.id, task_id: 'T-1', source: 'conductor' });

    await H.until('child running', () => H.thread(child.id).status === 'running');
    expect(H.thread(conductor.id).status).toBe('done');
    await H.until('conductor sent again as delegating', () => shown.log.includes('working'));
    expect((await scratch()).active.find((t) => t.id === conductor.id)).toMatchObject({ status: 'done', delegating: true });

    // The child's report wakes the conductor, whose turn then ends with nothing left delegated.
    await H.untilResults(child.id, 1);
    await H.untilResults(conductor.id, 2);
    await H.until('conductor idle on the feed', () => shown.log.at(-1) === 'idle');
    shown.stop();
    expect(shown.log).toEqual(['working', 'idle']);
    expect(D.delegatingIds().has(conductor.id)).toBe(false);
  });

  it('a delegate_team lead and its conductor work while the members run', T, async () => {
    const conductor = await H.start('be the conductor');
    await H.untilResults(conductor.id, 1);
    const { lead, members } = await H.runner.createTeam({
      channel: 'scratch',
      title: 'Mic research',
      prompt: 'Research the mic',
      parent_id: conductor.id,
      task_id: 'T-9',
      tasks: [
        { title: 'Price', prompt: 'THINK:400 find the price' },
        { title: 'Reviews', prompt: 'THINK:600 find reviews' },
      ],
    });
    await H.until('members running', () => members.every((m) => H.thread(m.id).status === 'running'));
    const ids = D.delegatingIds();
    expect(ids.has(lead.id)).toBe(true);
    expect(ids.has(conductor.id)).toBe(true);
    expect(H.thread(conductor.id).status).toBe('done');

    await H.untilResults(lead.id, 1);
    await H.untilResults(conductor.id, 2);
    expect(D.delegatingIds().has(conductor.id)).toBe(false);
    expect(D.delegatingIds().has(lead.id)).toBe(false);
  });
});
