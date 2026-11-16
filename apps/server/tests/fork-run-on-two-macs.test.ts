import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// A fork follows Settings > Threads' "Run new threads on": made on Mac A, the hub, it goes to Box B as a new thread's
// offer that carries the source's checkout, and runs there. Two real servers in one process with fake claude and one
// in-memory relay, and one repo at the same path on both machines.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'mac-a.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'box-b.tail1234.ts.net' };
const shared = mkdtempSync(join(tmpdir(), 'omni-fork-runon-'));
const repo = join(shared, 'repo');
afterAll(() => rmSync(shared, { recursive: true, force: true }));
const T = { timeout: 30_000 };

let a: Mac;
let b: Mac;
const both = async () => {
  await a.sync();
  await b.sync();
  await a.sync();
};
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();
const claude = { harness: 'claude-code', model: 'sonnet', effort: 'high' };

beforeAll(async () => {
  a = await bootMac('mac-a', 'Mac A', relay);
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.txt'), 'a as committed\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
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

afterAll(async () => {
  await a.json('/setup', { method: 'PUT', body: { runOn: { device: '' } } });
});

describe('a fork with "Run new threads on" set to another machine', () => {
  let source: string;
  let fork: string;

  it('is made on the hub, waits for the other machine and lays out nothing here', async () => {
    const t = await a.runner.createThread({ channel: 'code', prompt: 'edit a.txt', title: 'Edit a', device: 'here' });
    source = t.id;
    await a.untilResults(source, 1);
    const cwd = a.thread(source).cwd;
    writeFileSync(join(cwd, 'a.txt'), 'a as the source left it\n');
    writeFileSync(join(cwd, 'new.txt'), 'untracked in the source\n');

    expect((await a.json('/setup', { method: 'PUT', body: { runOn: { device: 'box-b' } } })).status).toBe(200);
    const p = await a.json(`/threads/${source}/continue/preview`, { body: claude });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({ runs_on: { id: 'box-b', name: 'Box B' }, blocked: null });
    const res = await a.json(`/threads/${source}/continue`, { body: { ...claude, text: 'carry on', request_id: randomUUID(), revision: p.body.revision } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    fork = res.body.thread.id;

    expect(a.runner.isLive(fork)).toBe(false);
    expect(a.thread(fork)).toMatchObject({ status: 'stopped', setup: null, continued_from: source });
    expect(existsSync(a.thread(fork).cwd)).toBe(false);
    expect(a.db.assignments.get(fork)).toMatchObject({ machine: 'box-b', routed: true });
    const offer = a.db.kv.get<any>(`handoff.offer.${fork}`);
    expect(offer).toMatchObject({ state: 'offered', fresh: true, queued: ['carry on'], to: { id: 'box-b' } });
    expect(offer.bundle).toMatchObject({ base: git(cwd, 'rev-parse', 'HEAD') });
  }, T.timeout);

  it("runs on the other machine, in a worktree holding the source's changes, with its Carryover", async () => {
    await both();
    await waitFor(() => b.db.threads.get(fork) && b.byKind(fork, 'result').length >= 1, () => `the fork to run on B: ${JSON.stringify(b.db.threads.get(fork))}`, 20_000);
    const t = b.thread(fork);
    expect(t.setup).toBeNull();
    expect(readFileSync(join(t.cwd, 'a.txt'), 'utf8')).toBe('a as the source left it\n');
    expect(readFileSync(join(t.cwd, 'new.txt'), 'utf8')).toBe('untracked in the source\n');
    expect(b.db.assignments.holder(fork)).toBe('box-b');
    // The first session read the Carryover ahead of Ben's message.
    const [sent] = b.claudeTexts(fork);
    expect(sent.startsWith('<omni-carryover>')).toBe(true);
    expect(sent).toContain('[the user] edit a.txt');
    expect(sent.endsWith("the user's message:\ncarry on")).toBe(true);
    expect(b.texts(fork, 'user')).toEqual(['carry on']);
    expect(a.runner.isLive(fork)).toBe(false);
  }, T.timeout);

  it('is blocked in the preview, and refused, while that machine is offline', async () => {
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: false }]));
    try {
      const p = await a.json(`/threads/${source}/continue/preview`, { body: claude });
      expect(p.status, JSON.stringify(p.body)).toBe(200);
      expect(p.body.runs_on).toBeNull();
      expect(p.body.blocked).toMatchObject({ code: 'machine', message: expect.stringContaining('Box B is offline') });
      const res = await a.json(`/threads/${source}/continue`, { body: { ...claude, text: 'again', request_id: randomUUID(), revision: p.body.revision } });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'busy', block: { code: 'machine' } });
    } finally {
      a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
    }
  }, T.timeout);

  it('runs here, with no machine named, once the setting is this machine again', async () => {
    expect((await a.json('/setup', { method: 'PUT', body: { runOn: { device: '' } } })).status).toBe(200);
    const p = await a.json(`/threads/${source}/continue/preview`, { body: claude });
    expect(p.body).toMatchObject({ runs_on: null, blocked: null });
  }, T.timeout);
});

// The Fork dialog's machine picker: `device` names the machine for this fork, over Settings' default, as the new-thread
// composer's Run on does.
describe('a fork with a machine picked in the dialog', () => {
  let source: string;

  beforeAll(async () => {
    expect((await a.json('/setup', { method: 'PUT', body: { runOn: { device: '' } } })).status).toBe(200);
    const t = await a.runner.createThread({ channel: 'code', prompt: 'edit a.txt again', title: 'Edit a again', device: 'here' });
    source = t.id;
    await a.untilResults(source, 1);
  }, T.timeout);

  it('goes to the picked machine while Settings says this one, and its Carryover says where it runs', async () => {
    const p = await a.json(`/threads/${source}/continue/preview`, { body: { ...claude, device: 'box-b' } });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({ runs_on: { id: 'box-b', name: 'Box B' }, blocked: null });
    expect(p.body.carryover.constraints).toContainEqual(expect.stringMatching(/^Machine: you run on Box B\. The source ran on Mac A/));
    const request_id = randomUUID();
    const res = await a.json(`/threads/${source}/continue`, { body: { ...claude, device: 'box-b', text: 'carry on there', request_id, revision: p.body.revision } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const fork = res.body.thread.id;
    expect(a.thread(fork)).toMatchObject({ status: 'stopped', setup: null, continued_from: source });
    expect(a.db.assignments.get(fork)).toMatchObject({ machine: 'box-b', routed: true });
    expect(a.db.kv.get<any>(`handoff.offer.${fork}`)).toMatchObject({ state: 'offered', fresh: true, queued: ['carry on there'], to: { id: 'box-b' } });

    // The same request id for another machine is another request.
    const again = await a.json(`/threads/${source}/continue`, { body: { ...claude, device: 'here', text: 'carry on there', request_id, revision: p.body.revision } });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'request_reused' });
  }, T.timeout);

  it('runs here when this machine is picked, while Settings sends new threads to the other one', async () => {
    expect((await a.json('/setup', { method: 'PUT', body: { runOn: { device: 'box-b' } } })).status).toBe(200);
    const p = await a.json(`/threads/${source}/continue/preview`, { body: { ...claude, device: 'here' } });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({ runs_on: null, blocked: null });
    expect(p.body.carryover.constraints.join('\n')).not.toMatch(/^Machine:/m);
    // A preview for another machine is another preview: Start refuses its revision.
    const elsewhere = await a.json(`/threads/${source}/continue/preview`, { body: claude });
    expect(elsewhere.body).toMatchObject({ runs_on: { id: 'box-b' } });
    expect(elsewhere.body.revision).not.toBe(p.body.revision);

    const res = await a.json(`/threads/${source}/continue`, { body: { ...claude, device: 'here', text: 'carry on here', request_id: randomUUID(), revision: p.body.revision } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const fork = res.body.thread.id;
    expect(a.db.assignments.get(fork)?.machine ?? null).not.toBe('box-b');
    expect(a.db.kv.get(`handoff.offer.${fork}`)).toBeFalsy();
    await a.untilResults(fork, 1);
    expect(a.texts(fork, 'user')).toEqual(['carry on here']);
  }, T.timeout);

  it('is blocked for a machine that is not synced', async () => {
    const p = await a.json(`/threads/${source}/continue/preview`, { body: { ...claude, device: 'nowhere' } });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.blocked).toMatchObject({ code: 'machine', message: expect.stringContaining('No synced machine has that id') });
  }, T.timeout);

  it('names the machine the source ran on, not the one that forks it', async () => {
    expect((await a.json('/setup', { method: 'PUT', body: { runOn: { device: '' } } })).status).toBe(200);
    const t = await b.runner.createThread({ channel: 'code', prompt: 'edit a.txt on B', title: 'Edit a on B', device: 'here' });
    await b.untilResults(t.id, 1);
    await both();
    await waitFor(() => a.db.threads.get(t.id)?.status === 'done' && a.db.assignments.holder(t.id) === 'box-b', 'the thread B ran to sync to A');

    const here = await a.json(`/threads/${t.id}/continue/preview`, { body: { ...claude, device: 'here' } });
    expect(here.status, JSON.stringify(here.body)).toBe(200);
    expect(here.body.runs_on).toBeNull();
    expect(here.body.carryover.constraints).toContainEqual(expect.stringMatching(/^Machine: you run on Mac A\. The source ran on Box B/));

    const there = await a.json(`/threads/${t.id}/continue/preview`, { body: { ...claude, device: 'box-b' } });
    expect(there.status, JSON.stringify(there.body)).toBe(200);
    expect(there.body.runs_on).toMatchObject({ id: 'box-b' });
    expect(there.body.carryover.constraints.join('\n')).not.toMatch(/^Machine:/m);
  }, T.timeout);

  it('writes no Machine: line for a blocked pick, and keeps runs_on in a changed refusal', async () => {
    expect((await a.json('/setup', { method: 'PUT', body: { runOn: { device: '' } } })).status).toBe(200);
    const t = await b.runner.createThread({ channel: 'code', prompt: 'edit a.txt on B too', title: 'Edit a on B too', device: 'here' });
    await b.untilResults(t.id, 1);
    await both();
    await waitFor(() => a.db.threads.get(t.id)?.status === 'done' && a.db.assignments.holder(t.id) === 'box-b', 'the thread B ran to sync to A');

    const blocked = await a.json(`/threads/${t.id}/continue/preview`, { body: { ...claude, device: 'nowhere' } });
    expect(blocked.body.blocked).toMatchObject({ code: 'machine' });
    expect(blocked.body.carryover.constraints.join('\n')).not.toMatch(/^Machine:/m);

    const stale = await a.json(`/threads/${t.id}/continue`, { body: { ...claude, device: 'box-b', text: 'x', request_id: randomUUID(), revision: 'stale' } });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'changed', preview: { runs_on: { id: 'box-b' } } });
  }, T.timeout);

  it('takes the machine through the transitions API too', async () => {
    expect((await a.json('/setup', { method: 'PUT', body: { runOn: { device: '' } } })).status).toBe(200);
    const p = await a.json(`/threads/${source}/transitions/preview`, { body: { kind: 'fork', run: claude, device: 'box-b' } });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({ kind: 'fork', runs_on: { id: 'box-b', name: 'Box B' } });
  }, T.timeout);
});
