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

  it('a turn that ended with its sub-agents still working stays working, and so does the thread above it, until they finish', T, async () => {
    const conductor = await H.start('be the conductor');
    await H.untilResults(conductor.id, 1);
    const t = await H.runner.createThread({ channel: 'scratch', prompt: 'BG:1500 fan out', parent_id: conductor.id, task_id: 'T-2', source: 'conductor' });
    const shown = watchShown(t.id);
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).status).toBe('done');
    expect(H.runner.activeTasks().some((k) => k.thread_id === t.id && k.subagent)).toBe(true);

    const ids = D.delegatingIds();
    expect(ids.has(t.id)).toBe(true);
    expect(ids.has(conductor.id)).toBe(true);
    const ch = await scratch();
    expect(ch.active.find((x) => x.id === t.id)).toMatchObject({ status: 'done', delegating: true });
    expect(ch.running).toBe(ch.active.filter(working).length);
    expect((await detail(t.id)).thread).toMatchObject({ status: 'done', delegating: true });
    await H.until('sent on the feed as working', () => shown.log.includes('working'));

    // The agent finishes and the CLI runs a turn about it; once that is done, nothing works.
    await H.until('agent ended', () => !H.runner.activeTasks().some((k) => k.thread_id === t.id), 5000);
    await H.untilResults(t.id, 2);
    await H.until('idle on the feed', () => shown.log.at(-1) === 'idle');
    shown.stop();
    expect(D.delegatingIds().has(t.id)).toBe(false);
  });

  it('sub-agents a stopped or failed turn left running do not make it working', T, async () => {
    for (const status of ['stopped', 'failed'] as const) {
      const t = await H.start('BG:1500 left behind');
      await H.untilResults(t.id, 1);
      expect(D.delegatingIds().has(t.id)).toBe(true);
      H.db.threads.update(t.id, { status });
      expect(H.runner.activeTasks().some((k) => k.thread_id === t.id)).toBe(true);
      expect(D.delegatingIds().has(t.id)).toBe(false);
    }
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

describe('delegating, on another machine', () => {
  const OTHER = '00000000-0000-4000-8000-0000000000b2';
  const agent = (task_id: string) => ({ task_id, event: 'started', description: 'Audit', subagent_type: 'Explore', task_type: 'local_agent', background: true });
  /** A done thread the other machine holds, as sync leaves it here. */
  function heldElsewhere() {
    H.db.outbox.arm();
    const t = row('done');
    H.db.assignments.applyRemote({ thread_id: t.id, machine: OTHER, generation: 1, routed: false, at: new Date().toISOString() });
    return t;
  }

  it('its sub-agents still running there make it working here, until their end syncs in', () => {
    const t = heldElsewhere();
    H.db.events.add(t.id, 'task', agent('a1'));
    H.db.events.add(t.id, 'task', { task_id: 'a1', event: 'progress', last_tool: 'Bash', tool_uses: 3 });
    expect(D.delegatingIds().has(t.id)).toBe(true);
    H.db.events.add(t.id, 'task', { task_id: 'a1', event: 'ended', status: 'completed' });
    expect(D.delegatingIds().has(t.id)).toBe(false);
  });

  it('a synced task row sends the thread on the feed again', T, async () => {
    const t = heldElsewhere();
    const shown = watchShown(t.id);
    H.db.events.add(t.id, 'task', agent('a2'));
    H.bus.emit('synced_task');
    await H.until('sent as working', () => shown.log.includes('working'));
    H.db.events.add(t.id, 'task', { task_id: 'a2', event: 'ended', status: 'completed' });
    H.bus.emit('synced_task');
    await H.until('sent as idle', () => shown.log.at(-1) === 'idle');
    shown.stop();
  });

  it('does not count a silent one, a shell, a stopped thread or a thread held here', () => {
    const silent = heldElsewhere();
    H.db.events.add(silent.id, 'task', agent('a3'), new Date(Date.now() - D.REMOTE_TASK_STALE_MS - 60_000).toISOString());
    expect(D.delegatingIds().has(silent.id)).toBe(false);

    const shell = heldElsewhere();
    H.db.events.add(shell.id, 'task', { task_id: 'b1', event: 'started', description: 'npm test', task_type: 'local_bash', background: true });
    expect(D.delegatingIds().has(shell.id)).toBe(false);

    const stopped = heldElsewhere();
    H.db.events.add(stopped.id, 'task', agent('a4'));
    H.db.threads.update(stopped.id, { status: 'stopped' });
    expect(D.delegatingIds().has(stopped.id)).toBe(false);

    // Held here with no process: what a crash left. This machine settles its own threads.
    const mine = row('done');
    H.db.assignments.claim(mine.id);
    H.db.events.add(mine.id, 'task', agent('a5'));
    expect(D.delegatingIds().has(mine.id)).toBe(false);
  });

  it('counts for the thread above it too', () => {
    const parent = row('done');
    const t = heldElsewhere();
    H.db.db.prepare('UPDATE threads SET parent_id = ? WHERE id = ?').run(parent.id, t.id);
    H.db.events.add(t.id, 'task', agent('a6'));
    expect(D.delegatingIds().has(parent.id)).toBe(true);
  });
});
