// GET /api/channels/:id/threads?paged=1: a channel's threads a page at a time, newest first, so the phone and iOS
// channel screens list every thread, not only the sidebar's preview (PRD #667, story 41).
import { beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];
const ids: string[] = [];

beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
  H.db.channels.create({ id: 'paged', name: 'Paged', kind: 'internal', use_worktree: 0, base_dir: H.tmp });
  // Seven threads, two of them with the same updated_at, so the cursor has to break a tie.
  for (let i = 0; i < 7; i++) {
    const id = `t-${i}`;
    H.db.threads.create({ id, channel_id: 'paged', title: id, status: 'done', role: null, model: null, session_id: id, cwd: H.tmp, branch: null, parent_id: null, task_id: null, source: 'manual', automation: null } as any);
    const at = `2030-01-01T00:00:0${i === 6 ? 5 : i}.000Z`;
    H.db.db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(at, id);
    ids.push(id);
  }
});

const page = async (q: string) => {
  const res = await app.request(`/api/channels/paged/threads?${q}`);
  return { status: res.status, body: (await res.json()) as { threads: { id: string }[]; next: string | null } };
};

describe('channel threads, paged', () => {
  it('walks every thread once, newest first, and says when it is at the end', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const { body } = await page(`paged=1&limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...body.threads.map((t) => t.id));
      cursor = body.next;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(['t-6', 't-5', 't-4', 't-3', 't-2', 't-1', 't-0']);
  });

  it('takes `before` for the cursor too, and refuses a broken one', async () => {
    const first = await page('paged=1&limit=2');
    const second = await page(`paged=1&limit=2&before=${first.body.next}`);
    expect(second.body.threads.map((t) => t.id)).toEqual(['t-4', 't-3']);
    expect((await page('paged=1&cursor=not-a-cursor')).status).toBe(400);
  });

  it('keeps the plain array without `paged`', async () => {
    const res = await app.request('/api/channels/paged/threads');
    expect(Array.isArray(await res.json())).toBe(true);
  });
});
