import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { macFixture } from './fixture-shape.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// A running thread handed from one Mac to the other, on two real servers in one process with fake claude and one
// in-memory relay. A stops the turn and offers it; B resumes the same Claude Code session with a continuation, then
// runs what was queued on A. A shows it running on B, and neither Mac lists the stop in Needs you.
// Each Mac's fake claude logs where the env said when it spawned, so A's first thread starts before B boots.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'mac-a.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'mac-b.tail1234.ts.net' };
// The channel's folder, at the same path on both Macs.
const shared = mkdtempSync(join(tmpdir(), 'omni-handoff-shop-'));
afterAll(() => rmSync(shared, { recursive: true, force: true }));
const T = { timeout: 30_000 };

let a: Mac;
let b: Mac;
let id: string;
let offerId: string;
/** What the Mac app decodes from a handoff, kept as the tests get it. */
const fixtures = new Map<string, unknown>();

const sessionFile = (m: Mac, t: { cwd: string; session_id: string }) =>
  join(m.home, '.claude', 'projects', m.files.claudeProjectDir(t.cwd), `${t.session_id}.jsonl`);
const write = (path: string, body: string) => (mkdirSync(dirname(path), { recursive: true }), writeFileSync(path, body));
const detail = async (m: Mac, threadId = id) => (await m.json(`/threads/${threadId}`)).body;
const handOff = (m: Mac, threadId: string, to: string) => m.json(`/threads/${threadId}/handoff`, { body: { to } });
const listed = async (m: Mac, threadId = id) =>
  ((await m.json('/needs-you')).body.items as { thread: { id: string } }[]).find((i) => i.thread.id === threadId);
const userEvents = (m: Mac, threadId = id) => m.byKind(threadId, 'user').map((e) => ({ text: e.p.text as string, source: e.p.source as string }));
/** Poll an async check until it gives something truthy. */
async function eventually<T>(fn: () => Promise<T | false | null | undefined>, label: string, timeout = 15_000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out after ${timeout}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const offered = (m: Mac, threadId: string) =>
  eventually(async () => {
    const d = await detail(m, threadId);
    return d.handoff?.state.phase === 'offered' && d;
  }, 'the offer to go out');
const both = async () => {
  await a.sync();
  await b.sync();
  await a.sync();
};

beforeAll(async () => {
  a = await bootMac('mac-a', 'Mac A', relay);
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  a.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: shared, notes: '' });
  const t = await a.runner.createThread({ channel: 'shop', prompt: 'TOOL:60000 audit the checkout', title: 'Audit the checkout' });
  id = t.id;
  await a.untilTool(id);
  // What Claude Code has written of the session so far.
  write(sessionFile(a, a.thread(id)), '{"type":"user","from":"mac-a"}\n');
  const queued = await a.json(`/threads/${id}/messages`, { body: { prompt: 'TOOL:60000 then the cart drawer', mode: 'queue' } });
  expect(queued.status).toBe(200);

  b = await bootMac('mac-b', 'Mac B', relay);
  b.tailnet(tailscaleStatus(NODE_B, [{ ...NODE_A, online: true }]));
  // Each Mac describes itself after a sync; the next sync carries it.
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
    await m.sync();
  }
  await a.sync();
}, 60_000);

describe('handing a running thread to the other Mac', () => {
  it('lists the other Mac as up', async () => {
    const { body } = await a.json('/devices');
    expect(body).toEqual([{ id: 'mac-b', name: 'Mac B', reachability: 'online', dnsName: NODE_B.dns, lastSeen: null }]);
    fixtures.set('devices.json', body);
  });

  it('refuses this Mac, an unknown or offline Mac, a thread not running here, and a session not reported yet', async () => {
    const thread = (threadId: string, patch: Record<string, unknown>) =>
      a.db.threads.create({
        id: threadId, channel_id: 'shop', title: threadId, status: 'done', role: null, model: null, session_id: threadId, cwd: shared,
        branch: null, parent_id: null, task_id: null, source: 'manual', automation: null, ...(patch as object),
      });
    thread('idle', {});
    thread('codex-new', { harness: 'codex' });
    const refusals = [
      [await handOff(a, id, 'mac-a'), /this Mac/],
      [await handOff(a, id, 'mac-z'), /No synced Mac/],
      [await handOff(a, 'idle', 'mac-b'), /Only a thread running on this Mac/],
      [await handOff(a, 'codex-new', 'mac-b'), /Codex has not reported this thread's session/],
    ] as const;
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: false, lastSeen: '2026-10-23T07:00:00Z' }]));
    const offline = await handOff(a, id, 'mac-b');
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
    for (const [res, why] of [...refusals, [offline, /Mac B is offline on Tailscale, last seen 2026-10-23T07:00:00.000Z/] as const]) {
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(why);
    }
    expect((await detail(a)).handoff).toBeNull();
    expect(a.thread(id).status).toBe('running');
  });

  it('A stops the turn, ends its process and offers the thread, and takes no turn of its own meanwhile', T, async () => {
    const [spawn] = a.spawns(id);
    const res = await handOff(a, id, 'mac-b');
    expect(res.status).toBe(200);
    expect(res.body.handoff).toMatchObject({ outgoing: true, from: { id: 'mac-a', name: 'Mac A' }, to: { id: 'mac-b', name: 'Mac B' } });
    expect(res.body.handoff.state).toEqual({ phase: 'preparing', step: 'stopping' });
    offerId = res.body.handoff.id;

    const waiting = await offered(a, id);
    expect(waiting.blocked).toBe('Waiting for Mac B to pick it up.');
    fixtures.set('thread-handoff.json', waiting);
    expect(a.thread(id).status).toBe('stopped');
    expect(a.runner.isLive(id)).toBe(false);
    expect(a.fakeAlive(spawn.pid)).toBe(false);
    const sent = await a.json(`/threads/${id}/messages`, { body: { prompt: 'one more thing' } });
    expect(sent.status).toBe(409);
    expect(sent.body.error).toBe('Waiting for Mac B to pick it up.');
    // The stop is a result like any other, read at once.
    expect(a.db.completions.latest(id)?.status).toBe('stopped');
    expect(await listed(a)).toBeUndefined();
  });

  it('B resumes the same session with a continuation, then runs what was queued on A', T, async () => {
    await a.sync();
    await b.sync();
    await waitFor(() => userEvents(b).length >= 3, () => `B to run both messages: ${JSON.stringify(userEvents(b))}`, 20_000);

    expect(userEvents(b)).toEqual([
      { text: 'TOOL:60000 audit the checkout', source: 'manual' },
      { text: 'Handed off from Mac A. Continue where you left off.', source: 'handoff' },
      { text: 'TOOL:60000 then the cart drawer', source: 'ben' },
    ]);
    const t = b.thread(id);
    expect(t.session_id).toBe(a.thread(id).session_id);
    const [spawn] = b.spawns(id);
    expect(spawn.args[spawn.args.indexOf('--resume') + 1]).toBe(t.session_id);
    expect(readFileSync(sessionFile(b, t), 'utf8')).toBe('{"type":"user","from":"mac-a"}\n');
    expect(b.db.messageRequests.byRequestId(id, `handoff:${offerId}`)?.prompt).toMatch(
      /^This thread was moved from Mac A to this Mac \(Mac B\) while you were working, and your last turn was cut off at the handoff\./,
    );
    expect(t.status).toBe('running');
    const d = await detail(b);
    expect(d.blocked).toBeUndefined();
    expect(d.handoff).toMatchObject({ outgoing: false, from: { name: 'Mac A' }, state: { phase: 'accepted' } });
  });

  it('A shows it running on B, read-only, and neither Mac lists the stop in Needs you', T, async () => {
    await both();
    const d = await detail(a);
    expect(d.blocked).toBe('This thread is running on Mac B.');
    expect(d.handoff).toMatchObject({ id: offerId, outgoing: true, state: { phase: 'accepted' } });
    expect(a.thread(id).status).toBe('running');
    expect(a.db.threads.runMachine(id)).toBe('mac-b');
    // Neither Mac's later syncs undo who runs it.
    await both();
    expect(b.thread(id).status).toBe('running');
    expect(b.db.threads.runMachine(id)).toBe('mac-b');
    expect(a.db.threads.runMachine(id)).toBe('mac-b');
    expect(userEvents(a).map((e) => e.source)).toEqual(['manual', 'handoff', 'ben']);
    expect(await listed(a)).toBeUndefined();
    expect(await listed(b)).toBeUndefined();
    // B lists no running thread anyway; what keeps the stop out once B's turns end is that B has it read too.
    const stop = a.db.completions.forThread(id).find((c) => c.status === 'stopped')!;
    expect(b.db.completions.get(stop.uid)).toBeDefined();
    expect(b.db.resultReads.get(id)).toMatchObject({ uid: stop.uid, n: stop.n });
    // A's queued message went with the thread; it is not waiting on A.
    expect(a.db.messageRequests.forThread(id).map((r) => r.state)).toEqual(['cancelled']);
  });

  it('sends the Mac app the shapes its fixtures hold', () => {
    const places = [a.tmp, b.tmp, shared].flatMap((p) => [realpathSync(p), p]);
    expect([...fixtures.keys()].sort()).toEqual(['devices.json', 'thread-handoff.json']);
    for (const [name, value] of fixtures) macFixture(name, value, places);
  });
});

describe('a handoff that does not go through', () => {
  const startOnA = async (prompt: string, cwd: string) => {
    a.db.channels.create({ id: `c-${cwd.length}-${prompt.length}`, name: 'Elsewhere', kind: 'client', use_worktree: 0, base_dir: cwd, notes: '' });
    const t = await a.runner.createThread({ channel: `c-${cwd.length}-${prompt.length}`, prompt });
    await a.untilTool(t.id);
    await a.json(`/threads/${t.id}/messages`, { body: { prompt: 'and the footer', mode: 'queue' } });
    return t.id;
  };

  it('cancelled before B picks it up: stays stopped on A, with the queued message waiting for Resume', T, async () => {
    const other = await startOnA('TOOL:60000 check the footer', shared);
    expect((await handOff(a, other, 'mac-b')).status).toBe(200);
    await offered(a, other);
    const res = await a.json(`/threads/${other}/handoff/cancel`, { body: {} });
    expect(res.status).toBe(200);
    expect(res.body.handoff.state).toEqual({ phase: 'cancelled' });
    await both();
    expect(b.byKind(other, 'user').map((e) => e.p.source)).toEqual(['manual']);
    expect(b.runner.isLive(other)).toBe(false);
    const d = await detail(a, other);
    expect(d.blocked).toBeUndefined();
    expect(d.pending.map((p: { text: string; delivery: string }) => [p.text, p.delivery])).toEqual([['and the footer', 'recovered']]);
    expect((await listed(a, other)) as unknown).toMatchObject({ blockers: [{ kind: 'recovered', count: 1 }] });
  });

  it('B cannot pick it up: A says why, keeps it stopped and takes the queued message back', T, async () => {
    // A folder only A has: both Macs share this disk, so B maps it to one it does not have.
    const onlyA = join(a.tmp, 'only-a');
    mkdirSync(onlyA);
    b.db.kv.set('sync.path_map', { [onlyA]: join(b.tmp, 'not-here') });
    const other = await startOnA('TOOL:60000 check the header', onlyA);
    expect((await handOff(a, other, 'mac-b')).status).toBe(200);
    await offered(a, other);
    await both();
    const d = await eventually(async () => {
      await both();
      const v = await detail(a, other);
      return v.handoff?.state.phase === 'failed' && v;
    }, 'B to refuse it');
    expect(d.handoff.state).toEqual({ phase: 'failed', where: 'there', error: expect.stringContaining("This thread's folder is not on this Mac") });
    expect(d.blocked).toBeUndefined();
    expect(d.pending.map((p: { text: string; delivery: string }) => [p.text, p.delivery])).toEqual([['and the footer', 'recovered']]);
    expect(b.runner.isLive(other)).toBe(false);
  });
});

describe('a worktree thread', () => {
  const git = (dir: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', dir, ...args], { encoding: 'utf8' }).trimEnd();
  const status = (dir: string) => git(dir, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).sort();

  it('arrives in B\'s own worktree with A\'s unpushed commit and uncommitted changes, and runs there', { timeout: 60_000 }, async () => {
    // One remote, a clone on each Mac. B finds A's clone and data folder at its own through its path map.
    const origin = join(shared, 'origin.git');
    git(shared, 'init', '-q', '--bare', '-b', 'main', origin);
    const seed = join(shared, 'seed');
    git(shared, 'init', '-q', '-b', 'main', seed);
    writeFileSync(join(seed, 'README.md'), 'theme\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', 'first');
    git(seed, 'push', '-q', origin, 'HEAD:main');
    const cloneA = join(a.tmp, 'theme');
    const cloneB = join(b.tmp, 'theme');
    git(shared, 'clone', '-q', origin, cloneA);
    git(shared, 'clone', '-q', origin, cloneB);
    b.db.kv.set('sync.path_map', { [cloneA]: cloneB, [a.paths.data]: b.paths.data });
    a.db.channels.create({ id: 'theme', name: 'Theme', kind: 'client', repo_path: cloneA, use_worktree: 1 });

    const t = await a.runner.createThread({ channel: 'theme', prompt: 'TOOL:60000 restyle the cart' });
    await a.untilTool(t.id);
    const wtA = a.thread(t.id).cwd;
    expect(wtA).toBe(join(a.paths.worktrees, t.id));
    write(sessionFile(a, a.thread(t.id)), '{"type":"user","from":"mac-a"}\n');
    writeFileSync(join(wtA, 'cart.css'), '.cart { color: red; }\n');
    git(wtA, 'add', 'cart.css');
    git(wtA, 'commit', '-q', '-m', 'cart colours');
    writeFileSync(join(wtA, 'README.md'), 'theme, restyled\n');
    writeFileSync(join(wtA, 'notes.md'), 'try blue\n');
    const head = git(wtA, 'rev-parse', 'HEAD');

    expect((await handOff(a, t.id, 'mac-b')).status).toBe(200);
    await offered(a, t.id);
    await a.sync();
    await b.sync();
    await waitFor(() => b.spawns(t.id).some((s) => s.args.includes('--resume')), 'B to resume it', 20_000);

    const wtB = join(b.paths.worktrees, t.id);
    expect(b.thread(t.id).cwd).toBe(wtB);
    expect(realpathSync(b.spawns(t.id).find((s) => s.args.includes('--resume'))!.cwd)).toBe(realpathSync(wtB));
    expect(git(wtB, 'branch', '--show-current')).toBe(a.thread(t.id).branch);
    expect(git(wtB, 'rev-parse', 'HEAD')).toBe(head);
    expect(status(wtB)).toEqual([' M README.md', '?? notes.md']);
    expect(readFileSync(join(wtB, 'cart.css'), 'utf8')).toBe('.cart { color: red; }\n');
    // A's checkout is as A left it.
    expect(status(wtA)).toEqual([' M README.md', '?? notes.md']);
  });
});
