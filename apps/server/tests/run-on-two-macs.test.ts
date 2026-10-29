import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// Run on: Mac A is the hub Ben talks to and Box B the machine with the CPU. A new thread for B is made on A, goes out
// as a fresh handoff offer, and runs on B; Ben's next message and Stop on A reach B through synced kv records. Two
// real servers in one process with fake claude and one in-memory relay; a machine hears of the other only on sync.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'mac-a.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'box-b.tail1234.ts.net' };
// The channel's folder, at the same path on both machines.
const shared = mkdtempSync(join(tmpdir(), 'omni-runon-shop-'));
const repo = join(shared, 'repo');
afterAll(() => rmSync(shared, { recursive: true, force: true }));
afterAll(async () => {
  for (const m of [a, b]) {
    for (const t of m.db.threads.running().filter((r) => m.runner.isLive(r.id))) {
      await m.json(`/threads/${t.id}/stop`, { body: {} });
      await waitFor(() => !m.runner.isLive(t.id), 'the turn to stop');
      await m.files.turnFinished(t.id);
    }
  }
}, 30_000);
const T = { timeout: 30_000 };

let a: Mac;
let b: Mac;

const both = async () => {
  await a.sync();
  await b.sync();
  await a.sync();
};
const userTexts = (m: Mac, id: string) => m.byKind(id, 'user').map((e) => e.p.text as string);

beforeAll(async () => {
  a = await bootMac('mac-a', 'Mac A', relay);
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  a.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: shared, notes: '' });
  // A repo at the same path on both machines, for a worktree thread.
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  a.db.channels.create({ id: 'code', name: 'Code', kind: 'internal', use_worktree: 1, repo_path: repo, notes: '' });
  b = await bootMac('box-b', 'Box B', relay);
  b.tailnet(tailscaleStatus(NODE_B, [{ ...NODE_A, online: true }]));
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
    await m.sync();
  }
  await a.sync();
}, 60_000);

describe('a thread run on another machine', () => {
  let id: string;

  it('is made on the hub and runs on the other machine', async () => {
    const res = await a.json('/threads', { body: { channel: 'shop', prompt: 'TOOL:60000 audit the checkout', device: 'box-b' } });
    expect(res.status).toBe(200);
    id = res.body.id;
    // Nothing runs on the hub: the thread waits for the other machine.
    expect(a.runner.isLive(id)).toBe(false);
    expect(a.db.kv.get(`runon.thread.${id}`)).toBe('box-b');
    expect(a.db.kv.get<any>(`handoff.offer.${id}`)).toMatchObject({ state: 'offered', fresh: true, queued: ['TOOL:60000 audit the checkout'], to: { id: 'box-b' } });

    await both();
    await waitFor(() => b.runner.isLive(id), 'the thread to start on B');
    await b.untilTool(id);
    expect(userTexts(b, id)).toEqual(['TOOL:60000 audit the checkout']);
    expect(b.db.threads.holder(id)).toBe('box-b');

    // The hub shows the run as it syncs back, once its own edits (the title) have gone round.
    for (let n = 0; n < 5 && a.thread(id).status !== 'running'; n++) await both();
    expect(a.thread(id).status, `A ${a.thread(id).status}, B ${b.thread(id).status}`).toBe('running');
    expect(a.runner.isLive(id)).toBe(false);
  }, T.timeout);

  it("forwards Ben's next message to the machine running it", async () => {
    const res = await a.json(`/threads/${id}/messages`, { body: { prompt: 'and the cart drawer', mode: 'queue', request_id: 'msg-1' } });
    expect(res.status).toBe(200);
    expect(res.body.request).toMatchObject({ id: 'msg-1', state: 'accepted' });
    expect(res.body.forwarded_to).toBe('Box B');
    expect(a.runner.isLive(id)).toBe(false);

    await both();
    const taken = await waitFor(() => b.db.messageRequests.byRequestId(id, 'runon:msg-1'), 'B to take the message');
    // A second sync finds it saved and sends nothing again.
    await both();
    expect(b.db.messageRequests.byRequestId(id, 'runon:msg-1')!.id).toBe(taken.id);
  }, T.timeout);

  it('forwards Stop', async () => {
    expect((await a.json(`/threads/${id}/stop`, { body: {} })).status).toBe(200);
    expect(a.db.kv.get(`runon.stop.${id}.mac-a`)).toBeTruthy();
    await both();
    await waitFor(() => !['running', 'queued'].includes(b.thread(id).status), 'B to stop the turn');
  }, T.timeout);
});

describe('a worktree thread run on another machine', () => {
  it('has its worktree cut there, not on the hub', async () => {
    const res = await a.json('/threads', { body: { channel: 'code', prompt: 'TOOL:60000 refactor the cart', device: 'box-b' } });
    expect(res.status).toBe(200);
    const id = res.body.id as string;
    expect(existsSync(join(a.paths.worktrees, id))).toBe(false);
    await both();
    await waitFor(() => b.runner.isLive(id), () => `the thread to start on B: ${JSON.stringify(b.thread(id))}`, 20_000);
    expect(existsSync(join(b.paths.worktrees, id))).toBe(true);
    expect(existsSync(join(a.paths.worktrees, id))).toBe(false);
    expect(b.thread(id).setup).toBeNull();
  }, T.timeout);
});

describe('a delegated thread run on another machine', () => {
  it('reports back to the parent on the hub', async () => {
    const parent = await a.runner.createThread({ channel: 'shop', prompt: 'plan the sprint', device: 'here' });
    await a.untilResults(parent.id, 1);
    const res = await a.json('/threads', { body: { channel: 'shop', prompt: 'check the footer', parent_id: parent.id, source: 'conductor', device: 'box-b' } });
    expect(res.status).toBe(200);
    const child = res.body.id as string;
    await both();
    await b.untilResults(child, 1);
    // The report waits in B's record for A, which holds the parent.
    await both();
    await waitFor(() => a.byKind(parent.id, 'crew_report').length === 1, () => `the report on A: ${JSON.stringify(a.flow(parent.id))}`, 15_000);
    expect(a.byKind(parent.id, 'crew_report')[0].p).toMatchObject({ thread_id: child, status: 'done' });
    expect(b.byKind(parent.id, 'crew_report')).toHaveLength(0);
    // Another sync files nothing twice.
    await both();
    expect(a.byKind(parent.id, 'crew_report')).toHaveLength(1);
  }, T.timeout);
});

describe('picking where a thread runs', () => {
  it('runs here when asked, or when no default is set', async () => {
    for (const device of ['here', undefined]) {
      const res = await a.json('/threads', { body: { channel: 'shop', prompt: 'TOOL:60000 local work', ...(device ? { device } : {}) } });
      expect(res.status).toBe(200);
      await waitFor(() => a.runner.isLive(res.body.id), 'the thread to run on A');
      expect(a.db.kv.get(`runon.thread.${res.body.id}`)).toBeUndefined();
      await a.json(`/threads/${res.body.id}/stop`, { body: {} });
    }
  }, T.timeout);

  it('refuses a machine that is not synced, and one Tailscale sees offline', async () => {
    const unknown = await a.json('/threads', { body: { channel: 'shop', prompt: 'x', device: 'nope' } });
    expect(unknown.status).toBe(409);
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: false, lastSeen: '2026-10-29T10:00:00Z' }]));
    const offline = await a.json('/threads', { body: { channel: 'shop', prompt: 'x', device: 'box-b' } });
    expect(offline.status).toBe(409);
    expect(offline.body.error).toMatch(/Box B is offline/);
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  }, T.timeout);
});
