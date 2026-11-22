import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startRunner } from './runner-boot.ts';

const r = await startRunner();
const { channelsApi } = await import('../channels-api.ts');

describe('Conductor handoffs in channel listings', () => {
  it('persists a delegated child and returns it nested under its parent and in its destination channel', async () => {
    if (!r.db.channels.get('conductor')) r.db.channels.create({ id: 'conductor', name: 'Conductor', kind: 'internal', use_worktree: 0, base_dir: r.paths.data });
    r.db.channels.create({ id: 'marketing', name: 'Marketing', kind: 'internal', use_worktree: 0, base_dir: r.paths.data });

    const parent = r.db.threads.create({
      id: randomUUID(), channel_id: 'conductor', title: 'Plan campaign', status: 'done', role: null, model: null,
      session_id: randomUUID(), cwd: r.paths.data, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
    });
    const child = r.db.threads.create({
      id: randomUUID(), channel_id: 'marketing', title: 'Draft landing page', status: 'running', role: null, model: null,
      session_id: randomUUID(), cwd: r.paths.data, branch: null, parent_id: parent.id, task_id: null, source: 'conductor', automation: null,
    });

    // The relationship is stored on the thread row, so a fresh read retains it.
    expect(r.db.threads.get(child.id)?.parent_id).toBe(parent.id);

    const response = await channelsApi.request('/');
    expect(response.status).toBe(200);
    const body = await response.json() as Array<{ id: string; active: Array<{ id: string; parent_id?: string | null }>; handoffs?: Array<{ parent: { id: string }; children: Array<{ id: string; parent_id?: string | null }> }> }>;
    expect(body.find((channel) => channel.id === 'conductor')?.handoffs).toEqual([
      expect.objectContaining({
        parent: expect.objectContaining({ id: parent.id }),
        children: [expect.objectContaining({ id: child.id, parent_id: parent.id, source: 'conductor' })],
      }),
    ]);
    expect(body.find((channel) => channel.id === 'marketing')?.active).toContainEqual(expect.objectContaining({ id: child.id, parent_id: parent.id }));
  });

  it('nests work a seated agent opened under the #conductor thread it is seated in, not its hidden session', async () => {
    if (!r.db.channels.get('conductor')) r.db.channels.create({ id: 'conductor', name: 'Conductor', kind: 'internal', use_worktree: 0, base_dir: r.paths.data });
    if (!r.db.channels.get('seated')) r.db.channels.create({ id: 'seated', name: 'Seated', kind: 'internal', use_worktree: 0, base_dir: r.paths.data });
    const make = (over: Partial<Parameters<typeof r.db.threads.create>[0]>) =>
      r.db.threads.create({
        id: randomUUID(), channel_id: 'conductor', title: 'Thread', status: 'done', role: null, model: null,
        session_id: randomUUID(), cwd: r.paths.data, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null, ...over,
      });
    const job = make({ title: 'Cursor parity', role: 'conductor' });
    const seat = make({ title: 'Builder in Cursor parity', role: 'builder', parent_id: job.id, source: 'member' });
    const folder = r.db.folders.create({ channel_id: 'seated', name: 'Features' });
    const work = make({ channel_id: 'seated', title: 'Cursor harness parity', role: 'builder', status: 'running', parent_id: seat.id, task_id: 'T-AEAF', source: 'conductor', folder_id: folder.id });

    type Listing = Array<{ id: string; handoffs?: Array<{ parent: { id: string }; children: Array<{ id: string; parent_id: string | null; folder_id: string | null }> }>; folders?: Array<{ id: string; threads: Array<{ id: string }> }> }>;
    const listing = async () => (await (await channelsApi.request('/')).json()) as Listing;
    const body = await listing();
    const handoffs = body.find((channel) => channel.id === 'conductor')?.handoffs ?? [];
    expect(handoffs.find((g) => g.parent.id === seat.id)).toBeUndefined();
    expect(handoffs.find((g) => g.parent.id === job.id)).toEqual({
      parent: expect.objectContaining({ id: job.id, source: 'manual' }),
      children: [expect.objectContaining({ id: work.id, parent_id: seat.id, folder_id: folder.id })],
    });
    // Filed in a folder, it still lists there, and its row keeps the seat as parent: crew reports go to the seated agent.
    expect(body.find((channel) => channel.id === 'seated')?.folders?.find((f) => f.id === folder.id)?.threads).toContainEqual(expect.objectContaining({ id: work.id }));
    expect(r.db.threads.get(work.id)?.parent_id).toBe(seat.id);

    // An archived job takes its tree with it, as before.
    r.db.threads.update(job.id, { archived: 1 });
    expect((await listing()).find((channel) => channel.id === 'conductor')?.handoffs?.some((g) => g.parent.id === job.id || g.parent.id === seat.id) ?? false).toBe(false);
  });
});
