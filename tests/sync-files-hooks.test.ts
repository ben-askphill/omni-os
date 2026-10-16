import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { waitFor } from './support.ts';

// Where the server moves files: after a turn, before a process resumes a thread, and when a thread is opened.
// The real runner and fake claude, with the in-memory relay as the active worker's transport and a temp home dir.
// Keep-alive 0, so each message starts a process and the resume path runs.

const r = await startRunner({ OMNI_KEEPALIVE_SECONDS: '0' });
const { MemoryTransport } = await import('../server/sync/transport.ts');
const sync = await import('../server/sync/worker.ts');
const files = await import('../server/sync/files.ts');
const { app } = await import('../server/app.ts');

const relay = new MemoryTransport();
const home = join(r.tmp, 'home');
mkdirSync(home);
files.configureFileSync({ home, env: {}, turnDelayMs: 20, openEveryMs: 0 });
const worker = sync.createSyncWorker({ transport: relay, machineId: 'mac-a' });
sync.setActiveWorker(worker);

const sha = (b: string) => createHash('sha256').update(b).digest('hex');
const text = (path: string) => Buffer.from(relay.objects.get(path) ?? []).toString();
const manifest = (id: string) => (relay.objects.has(`manifests/${id}.json`) ? JSON.parse(text(`manifests/${id}.json`)) : null);
const sessionFile = (t: { cwd: string; session_id: string }) =>
  join(home, '.claude', 'projects', files.claudeProjectDir(t.cwd), `${t.session_id}.jsonl`);
const write = (path: string, body: string) => (mkdirSync(dirname(path), { recursive: true }), writeFileSync(path, body));

/** What another Mac would have left in the relay for a thread. */
function fromOtherMac(id: string, m: { files?: Record<string, string>; session?: { sid: string; body: string } }) {
  const entry = (body: string) => ({ sha: sha(body), size: body.length, mtime: Date.now() });
  for (const body of Object.values(m.files ?? {})) relay.objects.set(`blobs/${sha(body)}`, Buffer.from(body));
  if (m.session) relay.objects.set(`sessions/claude-code/${m.session.sid}.jsonl`, Buffer.from(m.session.body));
  relay.objects.set(`manifests/${id}.json`, Buffer.from(JSON.stringify({
    v: 1,
    files: Object.fromEntries(Object.entries(m.files ?? {}).map(([rel, body]) => [rel, entry(body)])),
    sessions: m.session
      ? { [`claude-code:${m.session.sid}`]: { harness: 'claude-code', id: m.session.sid, files: { [`${m.session.sid}.jsonl`]: entry(m.session.body) } } }
      : {},
  })));
}

describe('file sync hooks', () => {
  it('uploads the thread\'s files and its session file after a turn', async () => {
    const t = await r.start('first', { title: 'Hooks' });
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    write(join(r.paths.threads, t.id, 'artifacts', 'report.html'), '<p>done</p>');
    write(sessionFile(thread), '{"turn":1}\n');

    await r.runner.postMessage(t.id, 'second');
    await r.untilResults(t.id, 2);
    const m = await waitFor(() => manifest(t.id)?.sessions[`claude-code:${thread.session_id}`] && manifest(t.id), 'manifest with the session');
    expect(m.files['artifacts/report.html'].sha).toBe(sha('<p>done</p>'));
    expect(text(`blobs/${sha('<p>done</p>')}`)).toBe('<p>done</p>');
    expect(text(`sessions/claude-code/${thread.session_id}.jsonl`)).toBe('{"turn":1}\n');
  });

  it('brings the other Mac\'s session file and uploads down before it resumes a thread here', async () => {
    const t = await r.start('first', { title: 'Resume' });
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    // Let the upload after the first turn land before the other Mac's version replaces the manifest.
    await waitFor(() => r.spawns(t.id).length === 1 && !r.runner.isLive(t.id), 'the first process to exit');
    await new Promise((res) => setTimeout(res, 100));
    fromOtherMac(t.id, { files: { 'uploads/brief.txt': 'the brief' }, session: { sid: thread.session_id, body: '{"from":"mac-b"}\n' } });

    await r.runner.postMessage(t.id, 'second');
    await r.untilResults(t.id, 2);
    expect(r.spawns(t.id).length).toBe(2);
    expect(r.spawns(t.id)[1].args).toContain('--resume');
    expect(readFileSync(sessionFile(thread), 'utf8')).toBe('{"from":"mac-b"}\n');
    expect(readFileSync(join(r.paths.threads, t.id, 'uploads', 'brief.txt'), 'utf8')).toBe('the brief');
  });

  it('drops a session download that lands after the runner stopped waiting for it', async () => {
    const t = await r.start('first', { title: 'Late download' });
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    await waitFor(() => !r.runner.isLive(t.id), 'the first process to exit');
    await new Promise((res) => setTimeout(res, 100));
    fromOtherMac(t.id, { files: { 'uploads/late.txt': 'late' }, session: { sid: thread.session_id, body: '{"from":"mac-b"}\n' } });
    const get = relay.getObject.bind(relay);
    let release = () => {};
    const gate = new Promise<void>((res) => (release = res));
    // Only the session body is slow, so the job is past the manifest and waiting on the download when the fence closes.
    const slow = vi.spyOn(relay, 'getObject').mockImplementation(async (p) => {
      if (p === `sessions/claude-code/${thread.session_id}.jsonl`) await gate;
      return get(p);
    });
    files.configureFileSync({ resumeTimeoutMs: 30 });
    try {
      // Times out: from here the harness owns the session file.
      expect(await files.beforeResume(thread)).toBe('timed-out');
      release();
      // The download finishes after that, and once the thread's queue is idle nothing it fetched was written.
      await files.threadFilesReady(t.id);
      expect(existsSync(sessionFile(thread))).toBe(false);
    } finally {
      slow.mockRestore();
      files.configureFileSync({ resumeTimeoutMs: 15_000 });
    }
  });

  it('never starts a session download that timed out while queued behind another job of the thread', async () => {
    const t = await r.start('first', { title: 'Queued download' });
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    await waitFor(() => !r.runner.isLive(t.id), 'the first process to exit');
    await new Promise((res) => setTimeout(res, 100));
    fromOtherMac(t.id, { files: { 'uploads/queued.txt': 'queued' }, session: { sid: thread.session_id, body: '{"from":"mac-b"}\n' } });
    const get = relay.getObject.bind(relay);
    const asked: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((res) => (release = res));
    const slow = vi.spyOn(relay, 'getObject').mockImplementation(async (p) => (asked.push(p), await gate, get(p)));
    files.configureFileSync({ resumeTimeoutMs: 30 });
    try {
      // Opening the thread starts a download that holds the thread's queue; the resume download waits behind it.
      const opened = files.threadOpened(t.id);
      expect(await files.beforeResume(thread)).toBe('timed-out');
      release();
      await opened;
      await files.threadFilesReady(t.id);
      // The opened download still lands; the resume job behind it never started, so it never even read the manifest:
      // the two reads are the two opens.
      expect(readFileSync(join(r.paths.threads, t.id, 'uploads', 'queued.txt'), 'utf8')).toBe('queued');
      expect(asked.filter((p) => p === `manifests/${t.id}.json`)).toHaveLength(2);
      expect(asked).not.toContain(`sessions/claude-code/${thread.session_id}.jsonl`);
      expect(existsSync(sessionFile(thread))).toBe(false);
    } finally {
      slow.mockRestore();
      files.configureFileSync({ resumeTimeoutMs: 15_000 });
    }
  });

  it('reports a session download that failed, and the harness starts on what is here', async () => {
    const t = await r.start('first', { title: 'Failed download' });
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    await waitFor(() => !r.runner.isLive(t.id), 'the first process to exit');
    await new Promise((res) => setTimeout(res, 100));
    fromOtherMac(t.id, { session: { sid: thread.session_id, body: '{"from":"mac-b"}\n' } });
    const broken = vi.spyOn(relay, 'getObject').mockRejectedValue(new Error('relay down'));
    try {
      expect(await files.beforeResume(thread)).toBe('failed');
      expect(existsSync(sessionFile(thread))).toBe(false);
    } finally {
      broken.mockRestore();
    }
    // Once the relay answers again, the next resume brings it.
    expect(await files.beforeResume(thread)).toBe('ready');
    expect(readFileSync(sessionFile(thread), 'utf8')).toBe('{"from":"mac-b"}\n');
  });

  it('fetches a thread\'s files in the background when it is opened', async () => {
    const t = await r.start('first', { title: 'Opened' });
    await r.untilResults(t.id, 1);
    await new Promise((res) => setTimeout(res, 100));
    fromOtherMac(t.id, { files: { 'artifacts/chart.svg': '<svg/>' } });
    // The relay is slow; the thread still answers at once.
    const get = relay.getObject.bind(relay);
    let release = () => {};
    const gate = new Promise<void>((res) => (release = res));
    const slow = vi.spyOn(relay, 'getObject').mockImplementation(async (p) => (await gate, get(p)));

    const res = await app.request(`/api/threads/${t.id}`);
    expect(res.status).toBe(200);
    const path = join(r.paths.threads, t.id, 'artifacts', 'chart.svg');
    expect(existsSync(path)).toBe(false);
    release();
    await waitFor(() => existsSync(path), 'the opened thread\'s file');
    expect(readFileSync(path, 'utf8')).toBe('<svg/>');
    slow.mockRestore();
  });

  it('serves an upload from the other Mac on the first ask, waiting for its download', async () => {
    const t = await r.start('first', { title: 'Upload' });
    await r.untilResults(t.id, 1);
    await new Promise((res) => setTimeout(res, 100));
    fromOtherMac(t.id, { files: { 'uploads/photo.png': 'png bytes' } });
    const res = await app.request(`/api/threads/${t.id}/uploads/photo.png`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('png bytes');
    expect((await app.request(`/api/threads/${t.id}/uploads/nope.png`)).status).toBe(404);
  });

  it('does nothing while sync is off', async () => {
    const t = await r.start('first', { title: 'Off' });
    await r.untilResults(t.id, 1);
    sync.setActiveWorker(null);
    try {
      const calls = vi.spyOn(relay, 'getObject');
      const puts = vi.spyOn(relay, 'putObject');
      write(join(r.paths.threads, t.id, 'artifacts', 'x.html'), 'x');
      await app.request(`/api/threads/${t.id}`);
      await r.runner.postMessage(t.id, 'second');
      await r.untilResults(t.id, 2);
      await new Promise((res) => setTimeout(res, 100));
      expect(calls).not.toHaveBeenCalled();
      expect(puts).not.toHaveBeenCalled();
      calls.mockRestore();
      puts.mockRestore();
    } finally {
      sync.setActiveWorker(worker);
    }
  });

  it('starts the turn anyway when the relay fails', async () => {
    const t = await r.start('first', { title: 'Offline' });
    await r.untilResults(t.id, 1);
    await waitFor(() => !r.runner.isLive(t.id), 'the first process to exit');
    relay.failNext(50, 'offline');
    try {
      await r.runner.postMessage(t.id, 'second');
      await r.untilResults(t.id, 2);
      expect(r.thread(t.id).status).toBe('done');
    } finally {
      relay.failNext(0);
    }
  });
});
