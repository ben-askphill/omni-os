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
});
