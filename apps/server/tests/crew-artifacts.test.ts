import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import { startRunner } from './runner-boot.ts';

// A parent thread's crew_artifacts: the files and screenshots of every thread it delegated to, at any depth (a team's
// members under their lead), newest first with each one's thread title, in the detail and live on its stream.

let H: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let register: (typeof import('../artifacts.ts'))['register'];
let bus: (typeof import('../bus.ts'))['bus'];
let paths: (typeof import('../config.ts'))['paths'];

beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
  ({ register } = await import('../artifacts.ts'));
  ({ bus } = await import('../bus.ts'));
  ({ paths } = await import('../config.ts'));
});

let n = 0;
/** A thread under `parent`, as delegate or delegate_team makes one, without running it. */
const thread = (title: string, parent: string | null = null, source = parent ? 'conductor' : 'manual') => {
  const id = `crew-art-${++n}`;
  H.db.threads.create({
    id, channel_id: 'scratch', title, status: 'done', role: null, model: null, session_id: id, cwd: H.tmp,
    branch: null, parent_id: parent, task_id: null, source: source as 'manual', automation: null,
  });
  return id;
};

/** Write a file where an agent would (its artifacts folder, or browser/ for a screenshot) and record it as the watcher does. */
const write = (threadId: string, name: string, area: 'artifacts' | 'browser' = 'artifacts') => {
  const dir = join(paths.threads, threadId, area);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `${threadId} ${name}`);
  const row = register(relative(paths.threads, join(dir, name)));
  if (!row) throw new Error(`not recorded: ${name}`);
  return row;
};

const detail = async (id: string) => {
  const res = await app.request(`/api/threads/${id}?history=recent`);
  expect(res.status).toBe(200);
  return (await res.json()) as { artifacts: { id: number }[]; crew_artifacts: { id: number; name: string; kind: string; thread_id: string; thread_title: string; channel_id: string }[] };
};

/** The messages each thread's stream got while `fn` ran. */
const streamed = (ids: string[], fn: () => void) => {
  const seen = new Map<string, any[]>(ids.map((id) => [id, []]));
  const offs = ids.map((id) => {
    const on = (e: unknown) => seen.get(id)!.push(e);
    bus.on(`thread:${id}`, on);
    return () => bus.off(`thread:${id}`, on);
  });
  try {
    fn();
  } finally {
    offs.forEach((off) => off());
  }
  return seen;
};

describe('crew artifacts', () => {
  it("lists every delegated thread's files and screenshots on the parent, through each level, never its own", async () => {
    const conductor = thread('Conductor');
    const lead = thread('Checkout lead', conductor);
    const member = thread('Cart member', lead, 'team');
    const other = thread('Copy writer', conductor);
    write(conductor, 'own.html');
    write(lead, 'plan.md');
    write(member, 'cart.png', 'browser');
    write(other, 'copy.html');

    const top = await detail(conductor);
    expect(top.artifacts).toHaveLength(1);
    expect(top.crew_artifacts.map((a) => [a.name, a.kind, a.thread_title])).toEqual([
      ['copy.html', 'html', 'Copy writer'],
      ['cart.png', 'screenshot', 'Cart member'],
      ['plan.md', 'markdown', 'Checkout lead'],
    ]);
    expect(top.crew_artifacts[0]).toMatchObject({ thread_id: other, channel_id: 'scratch' });
    // The same row the Library reads (artifacts.json), which the clients already parse.
    const [library] = JSON.parse(readFileSync(join(WIRE_FIXTURES, 'artifacts.json'), 'utf8'));
    expect(Object.keys(top.crew_artifacts[0]).sort()).toEqual(Object.keys(library).sort());
    // The lead sees its member's, the member sees none.
    expect((await detail(lead)).crew_artifacts.map((a) => a.name)).toEqual(['cart.png']);
    expect((await detail(member)).crew_artifacts).toEqual([]);
  });

  it('pushes a new one to every thread above it as crew_artifact, and to its own thread as artifact', () => {
    const conductor = thread('Conductor');
    const lead = thread('Lead', conductor);
    const member = thread('Member', lead, 'team');
    const bystander = thread('Unrelated');
    const seen = streamed([conductor, lead, member, bystander], () => write(member, 'shot.png', 'browser'));
    expect(seen.get(member)!.map((e) => e.kind)).toEqual(['artifact']);
    for (const id of [conductor, lead]) {
      expect(seen.get(id)).toEqual([{ kind: 'crew_artifact', artifact: expect.objectContaining({ name: 'shot.png', kind: 'screenshot', thread_id: member, thread_title: 'Member', channel_id: 'scratch' }) }]);
    }
    expect(seen.get(bystander)).toEqual([]);
  });

  it('ends a parent_id cycle instead of following it', async () => {
    const a = thread('A');
    const b = thread('B', a);
    H.db.db.prepare('UPDATE threads SET parent_id = ? WHERE id = ?').run(b, a);
    write(b, 'loop.html');
    expect((await detail(a)).crew_artifacts.map((x) => x.name)).toEqual(['loop.html']);
    expect((await detail(b)).crew_artifacts.map((x) => x.thread_id)).not.toContain(b);
  });
});
