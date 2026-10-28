import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { macFixture } from './fixture-shape.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// Take over: Mac B asks for a thread Mac A holds, and A hands it over on its next sync as if Ben had handed it off
// there. Two real servers in one process with fake claude and one in-memory relay; a Mac hears of the other only when
// the test syncs it, so "A is asleep" is A not syncing. Each Mac's fake claude logs where the env said when it
// spawned, so A's first thread starts before B boots.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'mac-a.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'mac-b.tail1234.ts.net' };
const MAC_A = { id: 'mac-a', name: 'Mac A' };
const MAC_B = { id: 'mac-b', name: 'Mac B' };
// The channel's folder, at the same path on both Macs.
const shared = mkdtempSync(join(tmpdir(), 'omni-takeover-shop-'));
afterAll(() => rmSync(shared, { recursive: true, force: true }));
// Turns still running end here, while both databases are open, so the uploads their ends start have somewhere to go.
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
let id: string;
/** What the Mac app decodes from a Take over, kept as the tests get it. */
const fixtures = new Map<string, unknown>();

const sessionFile = (m: Mac, t: { cwd: string; session_id: string }) =>
  join(m.home, '.claude', 'projects', m.files.claudeProjectDir(t.cwd), `${t.session_id}.jsonl`);
const write = (path: string, body: string) => (mkdirSync(dirname(path), { recursive: true }), writeFileSync(path, body));
const detail = async (m: Mac, threadId = id) => (await m.json(`/threads/${threadId}`)).body;
const takeOver = (m: Mac, threadId: string) => m.json(`/threads/${threadId}/takeover`, { body: {} });
const cancel = (m: Mac, threadId: string) => m.json(`/threads/${threadId}/handoff/cancel`, { body: {} });
const handOff = (m: Mac, threadId: string, to: string) => m.json(`/threads/${threadId}/handoff`, { body: { to } });
const request = (m: Mac, threadId: string) => m.db.kv.get<any>(`handoff.request.${threadId}`);
const offer = (m: Mac, threadId: string) => m.db.kv.get<any>(`handoff.offer.${threadId}`);
const listed = async (m: Mac, threadId = id) =>
  ((await m.json('/needs-you')).body.items as { thread: { id: string } }[]).find((i) => i.thread.id === threadId);
const userEvents = (m: Mac, threadId = id) => m.byKind(threadId, 'user').map((e) => ({ text: e.p.text as string, source: e.p.source as string }));
const busy = (m: Mac, threadId: string) => ['running', 'queued'].includes(m.thread(threadId).status);
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

/** A thread row on A that A holds between turns, with no process behind it. */
function heldByA(threadId: string, patch: Record<string, unknown> = {}) {
  a.db.threads.create({
    id: threadId, channel_id: 'shop', title: threadId, status: 'done', role: null, model: null, session_id: threadId, cwd: shared,
    branch: null, parent_id: null, task_id: null, source: 'manual', automation: null, ...(patch as object),
  });
  a.db.threads.hold(threadId);
  return threadId;
}

/** A thread with a turn running on A, and one message queued behind it. */
async function runningOnA(prompt: string) {
  const t = await a.runner.createThread({ channel: 'shop', prompt });
  await a.untilTool(t.id);
  write(sessionFile(a, a.thread(t.id)), '{"type":"user","from":"mac-a"}\n');
  expect((await a.json(`/threads/${t.id}/messages`, { body: { prompt: 'and the footer', mode: 'queue' } })).status).toBe(200);
  await both();
  return t.id;
}

beforeAll(async () => {
  a = await bootMac('mac-a', 'Mac A', relay);
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  a.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: shared, notes: '' });
  const t = await a.runner.createThread({ channel: 'shop', prompt: 'TOOL:60000 audit the checkout', title: 'Audit the checkout' });
  id = t.id;
  await a.untilTool(id);
  write(sessionFile(a, a.thread(id)), '{"type":"user","from":"mac-a"}\n');
  expect((await a.json(`/threads/${id}/messages`, { body: { prompt: 'TOOL:60000 then the cart drawer', mode: 'queue' } })).status).toBe(200);

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

describe('taking over a running thread', () => {
  let requestId: string;
  let offerId: string;

  it('B shows it running on A, with Take over', async () => {
    const d = await detail(b);
    expect(d.blocked).toBe('This thread is running on Mac A.');
    expect(d.takeover).toEqual({ from: MAC_A, to: MAC_B, running: true, refused: null });
    fixtures.set('thread-takeover.json', d);
    expect((await detail(a)).takeover).toBeUndefined();
  });

  it('asks A once, however often Ben clicks', async () => {
    const res = await takeOver(b, id);
    expect(res.status).toBe(200);
    expect(res.body.handoff).toMatchObject({ outgoing: false, requested: true, from: MAC_A, to: MAC_B, state: { phase: 'requested', stale: false } });
    requestId = res.body.handoff.id;
    const again = await takeOver(b, id);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('This thread is already on its way between Macs.');
    expect(request(b, id)).toMatchObject({ id: requestId, by: MAC_B, from: MAC_A, state: 'pending' });

    const d = await detail(b);
    expect(d.takeover).toBeUndefined();
    expect(d.blocked).toBe('This thread is running on Mac A.');
    expect(d.handoff).toMatchObject({ id: requestId, state: { phase: 'requested', stale: false } });
    fixtures.set('thread-takeover-requested.json', d);
    expect(a.runner.isLive(id)).toBe(true);
  });

  it('A stops its turn on its next sync and offers the thread to B', T, async () => {
    const [spawn] = a.spawns(id);
    await b.sync();
    await a.sync();
    const giving = await offered(a, id);
    expect(giving.handoff).toMatchObject({ outgoing: true, requested: true, to: MAC_B });
    offerId = giving.handoff.id;
    expect(offer(a, id)).toMatchObject({ request: requestId, state: 'offered' });
    expect(a.thread(id).status).toBe('stopped');
    expect(a.fakeAlive(spawn.pid)).toBe(false);
    expect(await listed(a)).toBeUndefined();
  });

  it('B resumes the same session with the continuation, then what was queued on A', T, async () => {
    await a.sync();
    await b.sync();
    await waitFor(() => userEvents(b).length >= 3, () => `B to run both messages: ${JSON.stringify(userEvents(b))}`, 20_000);
    expect(userEvents(b)).toEqual([
      { text: 'TOOL:60000 audit the checkout', source: 'manual' },
      { text: 'Taken over from Mac A. Continue where you left off.', source: 'handoff' },
      { text: 'TOOL:60000 then the cart drawer', source: 'ben' },
    ]);
    const t = b.thread(id);
    expect(t.session_id).toBe(a.thread(id).session_id);
    const [spawn] = b.spawns(id);
    expect(spawn.args[spawn.args.indexOf('--resume') + 1]).toBe(t.session_id);
    expect(readFileSync(sessionFile(b, t), 'utf8')).toBe('{"type":"user","from":"mac-a"}\n');
    const d = await detail(b);
    expect(d.takeover).toBeUndefined();
    expect(d.blocked).toBeUndefined();
    expect(d.handoff).toMatchObject({ id: offerId, outgoing: false, requested: true, state: { phase: 'accepted' } });
    expect(b.db.kv.get(`handoff.holder.${id}`)).toBe('mac-b');
  });

  it('A shows it running on B, with Take over, and neither Mac lists the stop in Needs you', T, async () => {
    await both();
    const d = await detail(a);
    expect(d.blocked).toBe('This thread is running on Mac B.');
    expect(d.takeover).toEqual({ from: MAC_B, to: MAC_A, running: true, refused: null });
    expect(d.handoff).toMatchObject({ id: offerId, outgoing: true, requested: true, state: { phase: 'accepted' } });
    expect(await listed(a)).toBeUndefined();
    expect(await listed(b)).toBeUndefined();
    // B ends the request it no longer needs, and A never answers it twice.
    await both();
    expect(request(b, id)).toMatchObject({ id: requestId, state: 'cancelled' });
    expect(offer(a, id)).toMatchObject({ id: offerId });
    expect(b.thread(id).status).toBe('running');
  });

  it('A cannot hand off a thread it no longer holds, and B cannot take over its own', async () => {
    const res = await handOff(a, id, 'mac-b');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('This thread is on Mac B. Take it over instead.');
    const own = await takeOver(b, id);
    expect(own.status).toBe(409);
    expect(own.body.error).toBe('This thread is on this Mac already.');
  });

  it('sends the Mac app the shapes its fixtures hold', () => {
    const places = [a.tmp, b.tmp, shared].flatMap((p) => [realpathSync(p), p]);
    expect([...fixtures.keys()].sort()).toEqual(['thread-takeover-requested.json', 'thread-takeover.json']);
    for (const [name, value] of fixtures) macFixture(name, value, places);
  });
});

describe('taking over an idle thread', () => {
  it('moves it between turns: no continuation on B, A shows it on B, and the next message runs on B', T, async () => {
    const t = await a.runner.createThread({ channel: 'shop', prompt: 'check the footer' });
    await waitFor(() => !busy(a, t.id), 'the turn to end', 20_000);
    write(sessionFile(a, a.thread(t.id)), '{"type":"user","from":"mac-a"}\n');
    await both();
    const before = await detail(b, t.id);
    expect(before.takeover).toEqual({ from: MAC_A, to: MAC_B, running: false, refused: null });
    expect(before.blocked).toBeUndefined();

    expect((await takeOver(b, t.id)).status).toBe(200);
    expect((await detail(b, t.id)).blocked).toBe('Asking Mac A to hand this thread over.');
    await b.sync();
    await a.sync();
    expect((await offered(a, t.id)).handoff).toMatchObject({ idle: true, requested: true });
    const taken = await eventually(async () => {
      await a.sync();
      await b.sync();
      const d = await detail(b, t.id);
      return d.handoff?.state.phase === 'accepted' && d;
    }, 'B to take it');
    expect(taken.handoff).toMatchObject({ idle: true, requested: true, outgoing: false });
    expect(taken.takeover).toBeUndefined();
    expect(taken.blocked).toBeUndefined();
    // Nothing was cut off, so B sends no continuation and starts no turn. (B's fake claude log also holds A's first turn.)
    expect(b.spawns(t.id).filter((s) => s.args.includes('--resume'))).toEqual([]);
    expect(b.byKind(t.id, 'user').map((e) => e.p.source)).toEqual(['manual']);

    await both();
    expect((await detail(a, t.id)).takeover).toEqual({ from: MAC_B, to: MAC_A, running: false, refused: null });
    expect((await handOff(a, t.id, 'mac-b')).body.error).toBe('This thread is on Mac B. Take it over instead.');
    expect((await b.json(`/threads/${t.id}/messages`, { body: { prompt: 'and the header' } })).status).toBe(200);
    await waitFor(() => b.spawns(t.id).some((s) => s.args.includes('--resume')), 'B to resume it for the next message', 20_000);
  });

  it('a worktree thread arrives in B\'s own worktree with A\'s unpushed commit and uncommitted changes', { timeout: 60_000 }, async () => {
    const git = (dir: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', dir, ...args], { encoding: 'utf8' }).trimEnd();
    const status = (dir: string) => git(dir, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).sort();
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

    const t = await a.runner.createThread({ channel: 'theme', prompt: 'restyle the cart' });
    await waitFor(() => !busy(a, t.id), 'the turn to end', 20_000);
    const wtA = a.thread(t.id).cwd;
    expect(wtA).toBe(join(a.paths.worktrees, t.id));
    write(sessionFile(a, a.thread(t.id)), '{"type":"user","from":"mac-a"}\n');
    writeFileSync(join(wtA, 'cart.css'), '.cart { color: red; }\n');
    git(wtA, 'add', 'cart.css');
    git(wtA, 'commit', '-q', '-m', 'cart colours');
    writeFileSync(join(wtA, 'README.md'), 'theme, restyled\n');
    writeFileSync(join(wtA, 'notes.md'), 'try blue\n');
    const head = git(wtA, 'rev-parse', 'HEAD');
    await both();

    expect((await takeOver(b, t.id)).status).toBe(200);
    await b.sync();
    await a.sync();
    await offered(a, t.id);
    await eventually(async () => {
      await a.sync();
      await b.sync();
      return (await detail(b, t.id)).handoff?.state.phase === 'accepted';
    }, 'B to take it', 30_000);

    const wtB = join(b.paths.worktrees, t.id);
    expect(b.thread(t.id).cwd).toBe(wtB);
    expect(git(wtB, 'branch', '--show-current')).toBe(a.thread(t.id).branch);
    expect(git(wtB, 'rev-parse', 'HEAD')).toBe(head);
    expect(status(wtB)).toEqual([' M README.md', '?? notes.md']);
    expect(readFileSync(join(wtB, 'cart.css'), 'utf8')).toBe('.cart { color: red; }\n');
    expect(status(wtA)).toEqual([' M README.md', '?? notes.md']);
    expect(busy(b, t.id)).toBe(false);
  });
});

describe('a Take over that is refused', () => {
  it('when no Mac is known to hold the thread', async () => {
    a.db.threads.create({
      id: 'unheld', channel_id: 'shop', title: 'unheld', status: 'done', role: null, model: null, session_id: 'unheld', cwd: shared,
      branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
    });
    await both();
    expect((await detail(b, 'unheld')).takeover).toBeUndefined();
    const res = await takeOver(b, 'unheld');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('No Mac is known to hold this thread yet. Once it runs again, it can be taken over.');
  });

  it('for a crew thread, a session not reported yet, or a usage limit stop, said before Ben asks', async () => {
    heldByA('crew-lead');
    const cases = [
      [heldByA('crew-member', { parent_id: 'crew-lead' }), 'This thread reports to the thread that delegated it, so it stays on Mac A.'],
      [heldByA('codex-new', { harness: 'codex' }), "Codex has not reported this thread's session yet, so another Mac could not resume it. Try again once it has replied."],
      [heldByA('limited'), 'This thread is waiting on a usage limit on Mac A. Resume it first.'],
    ] as const;
    a.db.threads.setLimit('limited', { state: 'limited', resets_at: null, id: 'limit-1', machine: 'mac-a' });
    await both();
    for (const [threadId, why] of cases) {
      expect((await detail(b, threadId)).takeover).toEqual({ from: MAC_A, to: MAC_B, running: false, refused: why });
      const res = await takeOver(b, threadId);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(why);
      expect(request(b, threadId)).toBeUndefined();
    }
  });
});

describe('the holding Mac answers only what it may', () => {
  it('declines a running thread that became a crew thread after B asked, and keeps running it', T, async () => {
    const tid = await runningOnA('TOOL:60000 check the totals');
    expect((await takeOver(b, tid)).status).toBe(200);
    a.db.db.prepare('UPDATE threads SET parent_id = ? WHERE id = ?').run('crew-lead', tid);
    await b.sync();
    await a.sync();
    const why = 'This thread reports to the thread that delegated it, so it stays on Mac A.';
    expect(offer(a, tid)).toMatchObject({ state: 'declined', error: why, request: request(b, tid).id, from: MAC_A, to: MAC_B });
    await both();
    const there = await detail(b, tid);
    expect(there.handoff).toMatchObject({ outgoing: false, requested: true, state: { phase: 'declined', error: why } });
    expect(there.blocked).toBe('This thread is running on Mac A.');
    expect(request(b, tid)).toMatchObject({ state: 'cancelled' });
    expect((await detail(a, tid)).handoff).toMatchObject({ outgoing: true, state: { phase: 'declined', error: why } });
    expect(a.runner.isLive(tid)).toBe(true);
    expect(a.thread(tid).status).toBe('running');
  });

  it('declines an idle thread that stopped at a usage limit after B asked', async () => {
    const tid = heldByA('limit-later');
    await both();
    expect((await takeOver(b, tid)).status).toBe(200);
    a.db.threads.setLimit(tid, { state: 'scheduled', resets_at: '2026-10-29T09:00:00Z', id: 'limit-2', machine: 'mac-a' });
    await b.sync();
    await a.sync();
    expect(offer(a, tid)).toMatchObject({ state: 'declined', error: 'This thread is waiting on a usage limit on Mac A. Resume it first.' });
  });

  it('does not answer a request for a thread that has moved on to another Mac, and B ends it', async () => {
    const tid = heldByA('moved-on');
    await both();
    expect((await takeOver(b, tid)).status).toBe(200);
    // Stands in for a third Mac taking the thread meanwhile: only the Mac a thread moves to writes its holder.
    a.db.kv.set(`handoff.holder.${tid}`, 'mac-c');
    await b.sync();
    await a.sync();
    expect(offer(a, tid)).toBeUndefined();
    await b.sync();
    expect(request(b, tid)).toMatchObject({ state: 'cancelled' });
    expect((await detail(b, tid)).handoff).toBeNull();
  });

  it('never writes a decline over a handoff on its way, and declines once it is over', async () => {
    const tid = heldByA('busy-key');
    a.db.threads.update(tid, { archived: 1 });
    const own = { id: 'own-offer', thread: tid, from: MAC_A, to: MAC_B, at: new Date().toISOString(), idle: true };
    a.db.kv.set(`handoff.offer.${tid}`, { ...own, state: 'preparing', step: 'uploading' });
    b.db.kv.set(`handoff.request.${tid}`, { id: 'asked-x', thread: tid, by: MAC_B, from: MAC_A, at: new Date().toISOString(), after: null, state: 'pending' });
    await b.sync();
    await a.sync();
    expect(offer(a, tid)).toMatchObject({ id: 'own-offer', state: 'preparing' });
    a.db.kv.set(`handoff.offer.${tid}`, { ...own, state: 'failed', error: 'stand-in' });
    await a.sync();
    expect(offer(a, tid)).toMatchObject({ request: 'asked-x', state: 'declined', error: 'This thread is archived. Restore it first.' });
  });

  it('gives a thread it already handed to B, before hearing B ask, only once', T, async () => {
    const tid = await runningOnA('TOOL:60000 check the wishlist');
    expect((await takeOver(b, tid)).status).toBe(200);
    await b.sync();
    // A hands it off before it hears of the request, then hears of it.
    expect((await handOff(a, tid, 'mac-b')).status).toBe(200);
    const first = (await offered(a, tid)).handoff.id;
    await a.sync();
    expect(request(a, tid)).toMatchObject({ state: 'pending' });
    expect(offer(a, tid)).toMatchObject({ id: first, state: 'offered' });
    expect(offer(a, tid).request).toBeUndefined();

    await b.sync();
    await waitFor(() => userEvents(b, tid).length >= 3, () => `B to run it: ${JSON.stringify(userEvents(b, tid))}`, 20_000);
    await both();
    await both();
    expect(offer(a, tid)).toMatchObject({ id: first });
    expect(request(b, tid)).toMatchObject({ state: 'cancelled' });
    expect(userEvents(b, tid).map((e) => e.source)).toEqual(['manual', 'handoff', 'ben']);
    expect(a.runner.isLive(tid)).toBe(false);
  });
});

describe('Ben cancels, or A does not answer', () => {
  it('cancelled before A hears of it: A never stops', T, async () => {
    const tid = await runningOnA('TOOL:60000 check the coupon field');
    expect((await takeOver(b, tid)).status).toBe(200);
    const res = await cancel(b, tid);
    expect(res.status).toBe(200);
    expect(res.body.handoff).toBeNull();
    expect((await cancel(b, tid)).status).toBe(200);
    await both();
    expect(request(b, tid)).toMatchObject({ state: 'cancelled' });
    expect(offer(a, tid)).toBeUndefined();
    expect(a.runner.isLive(tid)).toBe(true);
    expect((await detail(b, tid)).takeover).toEqual({ from: MAC_A, to: MAC_B, running: true, refused: null });
  });

  it('cancelled after A answered: B refuses the offer, and A keeps the queued message for Resume', T, async () => {
    const tid = await runningOnA('TOOL:60000 check the gift cards');
    expect((await takeOver(b, tid)).status).toBe(200);
    await b.sync();
    await a.sync();
    await offered(a, tid);
    expect((await cancel(b, tid)).status).toBe(200);
    await b.sync();
    await waitFor(() => b.db.kv.get<any>(`handoff.reply.${tid}`), 'B to answer the offer');
    expect(b.db.kv.get(`handoff.reply.${tid}`)).toMatchObject({ state: 'failed', error: 'Cancelled on Mac B' });
    const d = await eventually(async () => {
      await both();
      const v = await detail(a, tid);
      return v.handoff?.state.phase === 'failed' && v.pending.length && v;
    }, 'A to take the queued message back');
    expect(d.handoff.state).toEqual({ phase: 'failed', where: 'there', error: 'Cancelled on Mac B' });
    expect(d.pending.map((p: { text: string; delivery: string }) => [p.text, p.delivery])).toEqual([['and the footer', 'recovered']]);
    expect(b.runner.isLive(tid)).toBe(false);
    expect(userEvents(b, tid).map((e) => e.source)).toEqual(['manual']);
  });

  it('A asleep: the request goes stale, and A still answers it when it wakes', T, async () => {
    const tid = heldByA('asleep');
    await both();
    expect((await takeOver(b, tid)).status).toBe(200);
    b.db.kv.set(`handoff.request.${tid}`, { ...request(b, tid), at: new Date(Date.now() - 2 * 60_000).toISOString() });
    const d = await detail(b, tid);
    expect(d.handoff.state).toEqual({ phase: 'requested', stale: true });
    expect(d.blocked).toBe('Mac A has not answered. It may be asleep; it hands the thread over when it wakes.');
    await b.sync();
    await a.sync();
    await offered(a, tid);
    await eventually(async () => {
      await a.sync();
      await b.sync();
      return (await detail(b, tid)).handoff?.state.phase === 'accepted';
    }, 'B to take it');
  });

  it('past an hour B ends the request, and A, waking later, ignores it', async () => {
    const tid = heldByA('overslept');
    await both();
    expect((await takeOver(b, tid)).status).toBe(200);
    b.db.kv.set(`handoff.request.${tid}`, { ...request(b, tid), at: new Date(Date.now() - 61 * 60_000).toISOString() });
    await b.sync();
    expect(request(b, tid)).toMatchObject({ state: 'expired' });
    await b.sync();
    const d = await detail(b, tid);
    expect(d.handoff).toMatchObject({ requested: true, state: { phase: 'expired' } });
    expect(d.blocked).toBeUndefined();
    expect(d.takeover).toEqual({ from: MAC_A, to: MAC_B, running: false, refused: null });
    await a.sync();
    expect(offer(a, tid)).toBeUndefined();
  });

  it('past an hour A ignores the request even when B, asleep too, has not ended it yet', async () => {
    const tid = heldByA('both-asleep');
    await both();
    expect((await takeOver(b, tid)).status).toBe(200);
    b.db.kv.set(`handoff.request.${tid}`, { ...request(b, tid), at: new Date(Date.now() - 61 * 60_000).toISOString() });
    // B's last sync before it sleeps sends the request still pending; it ends it only on the sync after.
    await b.sync();
    await a.sync();
    expect(offer(a, tid)).toBeUndefined();
  });

  it('shows the request over an older offer whatever the two clocks say', async () => {
    const tid = heldByA('skewed');
    // The thread's last handoff, written by A with its clock ten minutes ahead of B's.
    a.db.kv.set(`handoff.offer.${tid}`, { id: 'earlier', thread: tid, from: MAC_A, to: MAC_B, at: new Date(Date.now() + 10 * 60_000).toISOString(), state: 'cancelled' });
    await both();
    expect((await takeOver(b, tid)).status).toBe(200);
    const d = await detail(b, tid);
    expect(d.handoff).toMatchObject({ requested: true, state: { phase: 'requested', stale: false } });
    expect(d.blocked).toBe('Asking Mac A to hand this thread over.');
    expect((await cancel(b, tid)).status).toBe(200);
  });
});
