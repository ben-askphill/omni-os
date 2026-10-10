import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Sidebar folders: the repo (server/db/repos/folders.ts), PATCH /api/threads/:id filing a thread, and the
// folders the channel list carries. A fresh database per file.

let db: typeof import('../server/db.ts');
let foldersApi: typeof import('../server/folders-api.ts').foldersApi;
let threadsApi: typeof import('../server/threads-api.ts').threadsApi;

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), 'omni-folders-'));
  db = await import('../server/db.ts');
  ({ foldersApi } = await import('../server/folders-api.ts'));
  ({ threadsApi } = await import('../server/threads-api.ts'));
});

let n = 0;
const channel = () => db.channels.create({ id: `ch-${++n}`, name: `Channel ${n}`, kind: 'internal' }).id;
const thread = (channelId: string, extra: Partial<import('../server/db.ts').Thread> = {}) => {
  const id = `t-${++n}`;
  return db.threads.create({
    id, channel_id: channelId, title: `Thread ${id}`, status: 'done', role: null, model: null, session_id: id, cwd: '/tmp',
    branch: null, parent_id: null, task_id: null, source: 'manual', automation: null, ...extra,
  });
};
const names = (ch: string) => db.folders.byChannel(ch).map((f) => f.name);

let ch: string;
beforeEach(() => {
  ch = channel();
});

describe('creating folders', () => {
  it('makes "New folder" by default, open and in name order', () => {
    const f = db.folders.create({ channel_id: ch });
    expect(f).toMatchObject({ channel_id: ch, name: 'New folder', parent_id: null, position: null, collapsed: 0 });
  });

  it('numbers a name another folder in the channel has, ignoring case', () => {
    db.folders.create({ channel_id: ch });
    expect(db.folders.create({ channel_id: ch }).name).toBe('New folder 2');
    expect(db.folders.create({ channel_id: ch, name: 'NEW FOLDER' }).name).toBe('NEW FOLDER 3');
    // Another channel has its own names.
    expect(db.folders.create({ channel_id: channel() }).name).toBe('New folder');
  });

  it('trims the name and refuses a blank or overlong one', () => {
    expect(db.folders.create({ channel_id: ch, name: '  Store   ops ' }).name).toBe('Store ops');
    expect(() => db.folders.create({ channel_id: ch, name: '   ' })).toThrow(/required/);
    expect(() => db.folders.create({ channel_id: ch, name: 'x'.repeat(61) })).toThrow(/60 characters/);
    expect(db.folders.create({ channel_id: ch, name: 'y'.repeat(60) }).name).toHaveLength(60);
  });

  it('keeps a numbered name within 60 characters', () => {
    const long = 'z'.repeat(60);
    db.folders.create({ channel_id: ch, name: long });
    const second = db.folders.create({ channel_id: ch, name: long }).name;
    expect(second).toBe('z'.repeat(58) + ' 2');
  });

  it('refuses nesting and unknown channels', () => {
    const parent = db.folders.create({ channel_id: ch });
    expect(() => db.folders.create({ channel_id: ch, parent_id: parent.id })).toThrow(/not supported/);
    expect(() => db.folders.create({ channel_id: 'nope' })).toThrow(/channel not found/);
  });

  it('sorts by name until Ben orders them by hand, then lands new ones last', () => {
    const b = db.folders.create({ channel_id: ch, name: 'beta' });
    const a = db.folders.create({ channel_id: ch, name: 'Alpha' });
    const c = db.folders.create({ channel_id: ch, name: 'gamma' });
    expect(names(ch)).toEqual(['Alpha', 'beta', 'gamma']);
    db.folders.reorder(ch, [c.id, a.id, b.id]);
    expect(names(ch)).toEqual(['gamma', 'Alpha', 'beta']);
    db.folders.create({ channel_id: ch, name: 'aardvark' });
    expect(names(ch)).toEqual(['gamma', 'Alpha', 'beta', 'aardvark']);
  });

  it('refuses an order that leaves a folder out or lists one twice', () => {
    const a = db.folders.create({ channel_id: ch, name: 'a' });
    const b = db.folders.create({ channel_id: ch, name: 'b' });
    expect(() => db.folders.reorder(ch, [a.id])).toThrow(/each/);
    expect(() => db.folders.reorder(ch, [a.id, a.id])).toThrow(/each/);
    expect(() => db.folders.reorder(ch, [a.id, b.id, 'x'])).toThrow(/each/);
  });
});

describe('renaming', () => {
  it('renames, and refuses a name another folder in the channel has', () => {
    const f = db.folders.create({ channel_id: ch, name: 'Draft' });
    db.folders.create({ channel_id: ch, name: 'Taken' });
    expect(db.folders.rename(f.id, '  Final ').name).toBe('Final');
    expect(() => db.folders.rename(f.id, 'taken')).toThrow(/already exists/);
    // Its own name in another case is fine.
    expect(db.folders.rename(f.id, 'FINAL').name).toBe('FINAL');
  });

  it('refuses a blank name and an unknown folder', () => {
    const f = db.folders.create({ channel_id: ch });
    expect(() => db.folders.rename(f.id, '')).toThrow(/required/);
    expect(() => db.folders.rename('nope', 'x')).toThrow(/not found/);
  });

  it('remembers whether it is collapsed', () => {
    const f = db.folders.create({ channel_id: ch });
    expect(db.folders.setCollapsed(f.id, true).collapsed).toBe(1);
    expect(db.folders.get(f.id)!.collapsed).toBe(1);
    expect(db.folders.setCollapsed(f.id, false).collapsed).toBe(0);
  });
});

describe('duplicating', () => {
  it('copies the settings into "<name> copy", without the threads', () => {
    const f = db.folders.create({ channel_id: ch, name: 'Audits' });
    db.folders.setCollapsed(f.id, true);
    const t = thread(ch);
    db.folders.moveThread(t.id, f.id);
    const copy = db.folders.duplicate(f.id);
    expect(copy).toMatchObject({ channel_id: ch, name: 'Audits copy', collapsed: 1, parent_id: null });
    expect(db.threads.get(t.id)!.folder_id).toBe(f.id);
    expect(db.threads.filed(ch).filter((x) => x.folder_id === copy.id)).toEqual([]);
    expect(db.folders.duplicate(f.id).name).toBe('Audits copy 2');
  });

  it('places the copy right after the original in a manual order', () => {
    const a = db.folders.create({ channel_id: ch, name: 'a' });
    const b = db.folders.create({ channel_id: ch, name: 'b' });
    db.folders.reorder(ch, [b.id, a.id]);
    db.folders.duplicate(b.id);
    expect(names(ch)).toEqual(['b', 'b copy', 'a']);
  });
});

describe('deleting', () => {
  it('keeps its threads, back in the ungrouped list', () => {
    const f = db.folders.create({ channel_id: ch, name: 'Doomed' });
    const t1 = thread(ch);
    const t2 = thread(ch);
    const other = thread(ch);
    db.folders.moveThread(t1.id, f.id);
    db.folders.moveThread(t2.id, f.id);
    expect(db.folders.remove(f.id)).toBe(2);
    expect(db.folders.get(f.id)).toBeUndefined();
    for (const t of [t1, t2, other]) expect(db.threads.get(t.id)).toMatchObject({ id: t.id, folder_id: null });
  });

  it('refuses an unknown folder', () => {
    expect(() => db.folders.remove('nope')).toThrow(/not found/);
  });
});

describe('moving threads', () => {
  it('files a thread and takes it out again, keeping its place in the lists', () => {
    const f = db.folders.create({ channel_id: ch });
    const t = thread(ch);
    db.folders.moveThread(t.id, f.id);
    expect(db.threads.get(t.id)).toMatchObject({ folder_id: f.id, updated_at: t.updated_at });
    db.folders.moveThread(t.id, null);
    expect(db.threads.get(t.id)!.folder_id).toBeNull();
  });

  it("refuses a folder of another channel, and unknown ids", () => {
    const elsewhere = db.folders.create({ channel_id: channel() });
    const t = thread(ch);
    expect(() => db.folders.moveThread(t.id, elsewhere.id)).toThrow(/its own channel/);
    expect(() => db.folders.moveThread(t.id, 'nope')).toThrow(/not found/);
    expect(() => db.folders.moveThread('nope', null)).toThrow(/thread not found/);
  });

  it('a thread moved to another channel leaves its folder', () => {
    const f = db.folders.create({ channel_id: ch });
    const t = thread(ch);
    db.folders.moveThread(t.id, f.id);
    db.threads.setChannel(t.id, channel());
    expect(db.threads.get(t.id)!.folder_id).toBeNull();
  });

  it('new threads land ungrouped unless created in a folder', () => {
    const f = db.folders.create({ channel_id: ch });
    expect(thread(ch).folder_id).toBeNull();
    expect(thread(ch, { folder_id: f.id }).folder_id).toBe(f.id);
  });

  it('lists filed threads without archived ones', () => {
    const f = db.folders.create({ channel_id: ch });
    const live = thread(ch);
    const gone = thread(ch);
    db.folders.moveThread(live.id, f.id);
    db.folders.moveThread(gone.id, f.id);
    db.threads.update(gone.id, { archived: 1 });
    expect(db.threads.filed(ch).map((t) => t.id)).toEqual([live.id]);
  });

  it('finds a folder by id or by name ignoring case', () => {
    const f = db.folders.create({ channel_id: ch, name: 'Store Ops' });
    expect(db.folders.find(ch, f.id)?.id).toBe(f.id);
    expect(db.folders.find(ch, ' store  ops ')?.id).toBe(f.id);
    expect(db.folders.find(channel(), f.id)).toBeUndefined();
  });
});

describe('the API', () => {
  const call = async (app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> }, method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };

  it('creates, renames, collapses, duplicates, orders and deletes', async () => {
    const created = await call(foldersApi, 'POST', '/', { channel: ch });
    expect(created).toMatchObject({ status: 201, body: { name: 'New folder' } });
    const id = created.body.id;
    expect((await call(foldersApi, 'PATCH', `/${id}`, { name: 'Ops' })).body.name).toBe('Ops');
    expect((await call(foldersApi, 'PATCH', `/${id}`, { collapsed: true })).body.collapsed).toBe(1);
    const copy = await call(foldersApi, 'POST', `/${id}/duplicate`);
    expect(copy).toMatchObject({ status: 201, body: { name: 'Ops copy' } });
    expect((await call(foldersApi, 'PUT', '/order', { channel: ch, ids: [copy.body.id, id] })).body.map((f: any) => f.name)).toEqual(['Ops copy', 'Ops']);
    expect((await call(foldersApi, 'GET', `/?channel=${ch}`)).body).toHaveLength(2);
    expect(await call(foldersApi, 'DELETE', `/${copy.body.id}`)).toMatchObject({ status: 200, body: { ok: true, moved: 0 } });
  });

  it('answers refusals with their status and sentence', async () => {
    const f = (await call(foldersApi, 'POST', '/', { channel: ch, name: 'A' })).body;
    await call(foldersApi, 'POST', '/', { channel: ch, name: 'B' });
    expect(await call(foldersApi, 'PATCH', `/${f.id}`, { name: 'b' })).toMatchObject({ status: 409, body: { error: expect.stringMatching(/already exists/) } });
    expect(await call(foldersApi, 'PATCH', `/${f.id}`, { name: ' ' })).toMatchObject({ status: 400 });
    expect(await call(foldersApi, 'PATCH', `/${f.id}`, {})).toMatchObject({ status: 400 });
    expect(await call(foldersApi, 'PATCH', '/nope', { name: 'x' })).toMatchObject({ status: 404 });
    expect(await call(foldersApi, 'DELETE', '/nope')).toMatchObject({ status: 404 });
    expect(await call(foldersApi, 'POST', '/', { channel: 'nope' })).toMatchObject({ status: 404 });
  });

  it('files a thread with PATCH /api/threads/:id, and takes it out with null', async () => {
    const f = db.folders.create({ channel_id: ch });
    const t = thread(ch);
    expect(await call(threadsApi, 'PATCH', `/${t.id}`, { folder_id: f.id })).toMatchObject({ status: 200, body: { folder_id: f.id, title: t.title } });
    expect((await call(threadsApi, 'PATCH', `/${t.id}`, { folder_id: null })).body.folder_id).toBeNull();
    const elsewhere = db.folders.create({ channel_id: channel() });
    expect(await call(threadsApi, 'PATCH', `/${t.id}`, { folder_id: elsewhere.id })).toMatchObject({ status: 400 });
  });

  it('lists each channel with its folders, their counts, running threads and threads', async () => {
    const { channelsApi } = await import('../server/channels-api.ts');
    const f = db.folders.create({ channel_id: ch, name: 'Busy' });
    db.folders.create({ channel_id: ch, name: 'Empty' });
    const done = thread(ch);
    const running = thread(ch, { status: 'running' });
    thread(ch);
    db.folders.moveThread(done.id, f.id);
    db.folders.moveThread(running.id, f.id);
    const one = (await call(channelsApi, 'GET', `/${ch}`)).body;
    expect(one.folders.map((x: any) => [x.name, x.count, x.running, x.threads.length])).toEqual([
      ['Busy', 2, 1, 2],
      ['Empty', 0, 0, 0],
    ]);
    const all = (await call(channelsApi, 'GET', '/')).body.find((c: any) => c.id === ch);
    expect(all.folders).toEqual(one.folders);
    expect(all.active.find((t: any) => t.id === running.id).folder_id).toBe(f.id);
  });
});
