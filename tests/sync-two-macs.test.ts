import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { waitFor } from './support.ts';
import { MemoryTransport } from '../server/sync/transport.ts';

// The whole story on two Macs in one process: each boots the real server (runner, API, sync worker, file hooks)
// against its own data dir and home dir, with fake claude, and both talk to one in-memory relay. A channel, a
// thread with its events, an artifact file and Claude Code's session file are made on A. B has the channel's
// folder somewhere else, maps it, and continues the thread, resuming A's session. Then A sees B's turn.
// No network, no Keychain.

async function mac(name: string) {
  vi.resetModules();
  const r = await startRunner({ OMNI_KEEPALIVE_SECONDS: '0' });
  const sync = await import('../server/sync/worker.ts');
  const files = await import('../server/sync/files.ts');
  const { app } = await import('../server/app.ts');
  const home = join(r.tmp, 'home');
  mkdirSync(home);
  files.configureFileSync({ home, env: {}, turnDelayMs: 20, openEveryMs: 0 });
  const worker = sync.createSyncWorker({ transport: relay, machineId: name });
  sync.setActiveWorker(worker);
  const sessionFile = (t: { cwd: string; session_id: string }) =>
    join(home, '.claude', 'projects', files.claudeProjectDir(t.cwd), `${t.session_id}.jsonl`);
  return { ...r, name, home, worker, files, app, sessionFile };
}

const relay = new MemoryTransport();
const write = (path: string, body: string) => (mkdirSync(dirname(path), { recursive: true }), writeFileSync(path, body));
const clean = (r: { error?: string }) => expect(r.error).toBeUndefined();

let a: Awaited<ReturnType<typeof mac>>;
let b: Awaited<ReturnType<typeof mac>>;
let threadId: string;
let folderA: string;
let folderB: string;

// Everything A runs happens before B boots: fake claude reads its log paths from the env each boot sets.
beforeAll(async () => {
  a = await mac('mac-a');
  folderA = join(a.tmp, 'work', 'volero');
  mkdirSync(folderA, { recursive: true });
  a.db.channels.create({ id: 'volero', name: 'Volero', kind: 'client', use_worktree: 0, base_dir: folderA, notes: 'theme work' });

  const t = await a.runner.createThread({ channel: 'volero', prompt: 'the cart drawer flickers', title: 'Cart drawer' });
  threadId = t.id;
  await a.untilResults(t.id, 1);
  await waitFor(() => !a.runner.isLive(t.id), 'A\'s process to exit');
  const thread = a.thread(t.id);
  expect(thread.cwd).toBe(folderA);

  // What the turn left behind: an artifact, and the CLI's session file.
  const report = join(a.paths.threads, t.id, 'artifacts', 'report.html');
  write(report, '<p>drawer fixed</p>');
  a.db.artifacts.upsert({ thread_id: t.id, path: report, name: 'report.html', kind: 'html', size: 19 });
  write(a.sessionFile(thread), '{"type":"user","from":"mac-a"}\n');
  // The runner's own after-turn upload ran before these existed; the hook again, as after the next turn.
  await a.files.turnFinished(t.id);
  clean(await a.worker.syncNow());
}, 30_000);

describe('a thread started on one Mac, continued on the other', () => {
  it('B gets the channel, thread, events and artifact, with its own folder for the channel', async () => {
    b = await mac('mac-b');
    folderB = join(b.tmp, 'code', 'volero');
    const map = await b.app.request('/api/sync/path-map', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ map: { [join(a.tmp, 'work')]: join(b.tmp, 'code') } }),
    });
    expect(map.status).toBe(200);
    clean(await b.worker.syncNow());

    expect(b.db.channels.get('volero')).toMatchObject({ name: 'Volero', base_dir: folderB, notes: 'theme work' });
    const t = b.thread(threadId);
    expect(t).toMatchObject({ title: 'Cart drawer', channel_id: 'volero', status: 'done', has_run: 1, cwd: folderB });
    expect(b.flow(threadId)).toEqual(a.flow(threadId));
    expect(b.texts(threadId, 'user')).toEqual(['the cart drawer flickers']);
    const [art] = b.db.artifacts.byThread(threadId);
    expect(art).toMatchObject({ name: 'report.html', kind: 'html', path: join(b.paths.threads, threadId, 'artifacts', 'report.html') });
  });

  it('refuses a turn until the mapped folder exists on B', async () => {
    const res = await b.app.request(`/api/threads/${threadId}`);
    const detail = (await res.json()) as { blocked?: string };
    expect(detail.blocked).toContain(folderB);
    const sent = await b.app.request(`/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'too early' }),
    });
    expect(sent.status).toBe(409);
    expect(b.texts(threadId, 'user')).toEqual(['the cart drawer flickers']);
    mkdirSync(folderB, { recursive: true });
    const again = (await (await b.app.request(`/api/threads/${threadId}`)).json()) as { blocked?: string };
    expect(again.blocked).toBeUndefined();
  });

  it('serves the artifact file from A on B', async () => {
    const [art] = b.db.artifacts.byThread(threadId);
    const res = await b.app.request(`/api/artifacts/${art.id}/raw`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<p>drawer fixed</p>');
  });

  it('B continues the thread, resuming A\'s session from its own Claude project folder', async () => {
    const sent = await b.app.request(`/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'now the checkout button' }),
    });
    expect(sent.status).toBe(200);
    await b.untilResults(threadId, 2);

    const t = b.thread(threadId);
    const [spawn] = b.spawns(threadId);
    expect(spawn.args).toContain('--resume');
    expect(spawn.args[spawn.args.indexOf('--resume') + 1]).toBe(t.session_id);
    expect(spawn.cwd).toBe(realpathSync(folderB));
    // The session A wrote, in the folder Claude Code uses for B's cwd.
    expect(readFileSync(b.sessionFile(t), 'utf8')).toBe('{"type":"user","from":"mac-a"}\n');
    expect(b.sessionFile(t)).not.toBe(a.sessionFile(a.thread(threadId)));
  });

  it('A sees B\'s turn, and keeps its own folder', async () => {
    await waitFor(() => !b.runner.isLive(threadId), 'B\'s process to exit');
    clean(await b.worker.syncNow());
    clean(await a.worker.syncNow());

    expect(a.texts(threadId, 'user')).toEqual(['the cart drawer flickers', 'now the checkout button']);
    expect(a.flow(threadId)).toEqual(b.flow(threadId));
    expect(a.thread(threadId)).toMatchObject({ status: 'done', cwd: folderA });
    expect(a.db.channels.get('volero')?.base_dir).toBe(folderA);
    expect(a.db.artifacts.byThread(threadId)).toHaveLength(1);
    // Nothing A applied goes back up.
    const before = relay.changes.length;
    clean(await a.worker.syncNow());
    clean(await b.worker.syncNow());
    expect(relay.changes.length).toBe(before);
    expect(existsSync(a.sessionFile(a.thread(threadId)))).toBe(true);
  });
});
