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
});
