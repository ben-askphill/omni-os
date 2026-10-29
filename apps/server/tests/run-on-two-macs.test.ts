import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { newContext } from '@omni/shared/message-context.ts';
import { terminalExcerpt, selectExcerpt } from '@omni/shared/message-context-terminal.ts';
import { MemoryTransport } from '../sync/transport.ts';
import { FAKE_CODEX, tailscaleStatus, waitFor } from './support.ts';
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
  a = await bootMac('mac-a', 'Mac A', relay, { OMNI_CODEX_BIN: FAKE_CODEX });
  await (await import('../harness/catalog-service.ts')).loadCatalog();
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  a.db.channels.create({ id: 'shop', name: 'Shop', kind: 'client', use_worktree: 0, base_dir: shared, notes: '' });
  // A repo at the same path on both machines, for a worktree thread.
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  a.db.channels.create({ id: 'code', name: 'Code', kind: 'internal', use_worktree: 1, repo_path: repo, notes: '' });
  b = await bootMac('box-b', 'Box B', relay, { OMNI_CODEX_BIN: FAKE_CODEX });
  await (await import('../harness/catalog-service.ts')).loadCatalog();
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

  it("takes Ben's switch and reply on the hub for a thread a routed thread delegated", async () => {
    const res = await a.json('/threads', { body: { channel: 'shop', prompt: 'lead the sprint', device: 'box-b' } });
    const lead = res.body.id as string;
    await both();
    await b.untilResults(lead, 1);
    // The lead delegates on B, so the child is never routed itself: it just runs where its lead does.
    const child = (await b.runner.createThread({ channel: 'shop', prompt: 'check the header', parent_id: lead, source: 'conductor', device: 'here' })).id;
    await b.untilResults(child, 1);
    await both();
    expect(a.db.kv.get(`runon.thread.${child}`)).toBeUndefined();
    expect(a.db.threads.holder(child)).toBe('box-b');

    // The hub records the switch; sync carries it to B. The next message goes to B, not a worktree here.
    const switched = await a.json(`/threads/${child}/run`, { body: { harness: 'codex', model: 'gpt-5.6-sol' } });
    expect(switched.status, JSON.stringify(switched.body)).toBe(200);
    expect(switched.body).toMatchObject({ harness: 'codex', model: 'gpt-5.6-sol' });
    const reply = await a.json(`/threads/${child}/messages`, { body: { prompt: 'and the footer', request_id: 'child-reply' } });
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    expect(reply.body.forwarded_to).toBe('Box B');
    expect(a.runner.isLive(child)).toBe(false);
    expect(existsSync(join(a.paths.worktrees, child))).toBe(false);

    await both();
    await b.untilResults(child, 2);
    expect(b.thread(child)).toMatchObject({ harness: 'codex', model: 'gpt-5.6-sol' });
    expect(b.codexRequests().some((r) => r.method === 'turn/start' && r.thread_id === child)).toBe(true);
  }, T.timeout);
});

describe('a thread delegated on the other machine', () => {
  // A parent that runs on B delegates there: the child is made on B, never routed from A, and its worktree is only on
  // B. It stays on B (it reports to its parent there), so A sends it everything, after a switch or a limit stop too.
  const delegated = async (prompt: string) => {
    const parent = await b.runner.createThread({ channel: 'shop', prompt: 'plan on B', device: 'here' });
    await b.untilResults(parent.id, 1);
    const child = await b.runner.createThread({ channel: 'code', prompt, parent_id: parent.id, source: 'conductor', harness: 'codex', model: 'gpt-5.6-sol', device: 'here' });
    await b.untilResults(child.id, 1);
    // The turn ends at the plan's usage limit, as records.ts limitStop leaves it.
    b.db.threads.setLimit(child.id, { state: 'limited', resets_at: '2026-10-30T01:47:00.000Z', id: `stop-${child.id}`, machine: 'box-b' });
    b.db.threads.update(child.id, { status: 'failed' });
    for (let n = 0; n < 5 && !a.db.threads.limit(child.id); n++) await both();
    expect(a.db.kv.get(`runon.thread.${child.id}`)).toBeUndefined();
    expect(a.db.threads.holder(child.id)).toBe('box-b');
    return child.id;
  };

  it('switches harness and sends the next message to that machine, not a worktree here', async () => {
    const id = await delegated('fix the cart on B');
    expect(existsSync(join(b.paths.worktrees, id))).toBe(true);
    // The switch Ben picked on A, then his message.
    expect((await a.json(`/threads/${id}/run`, { body: { harness: 'claude-code', model: '', effort: '' } })).status).toBe(200);
    const res = await a.json(`/threads/${id}/messages`, { body: { prompt: 'Resume', request_id: 'after-switch' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.forwarded_to).toBe('Box B');
    expect(a.runner.isLive(id)).toBe(false);
    expect(existsSync(join(a.paths.worktrees, id))).toBe(false);

    await both();
    await b.untilResults(id, 2);
    expect(b.thread(id).harness).toBe('claude-code');
    expect(b.claudeTexts(id).at(-1)).toContain('Resume');
    // The message moved it on, so the stop is gone on both.
    await both();
    expect(b.db.threads.limit(id)).toBeUndefined();
    expect(a.db.threads.limit(id)).toBeUndefined();
  }, T.timeout);

  it("offers the limit stop's Resume on the hub and sends it to that machine", async () => {
    const id = await delegated('fix the footer on B');
    // Not "the other Mac's" on A: A acts for B.
    expect(a.thread(id).limit_elsewhere).toBe(0);
    const res = await a.json(`/threads/${id}/limit/resume`, { body: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(a.runner.isLive(id)).toBe(false);
    expect(existsSync(join(a.paths.worktrees, id))).toBe(false);

    await both();
    await b.untilResults(id, 2);
    expect(b.byKind(id, 'user').at(-1)!.p).toMatchObject({ text: 'Continue where you left off.', source: 'limit' });
    await both();
    expect(a.db.threads.limit(id)).toBeUndefined();
    // A second sync acts on nothing twice.
    await both();
    expect(b.byKind(id, 'user').filter((e) => e.p.source === 'limit')).toHaveLength(1);
  }, T.timeout);
});

describe('remote preparation and takeover', () => {
  it('resolves skills and mentions for fresh prompts and replies, and carries context', async () => {
    writeFileSync(join(shared, 'remote-notes.txt'), 'REMOTE FILE CONTENT');
    const res = await a.json('/threads', { body: { channel: 'shop', prompt: '/tdd read @remote-notes.txt', device: 'box-b' } });
    expect(res.status).toBe(200);
    const id = res.body.id;
    await both();
    await b.untilResults(id, 1);
    expect(b.byKind(id, 'user')[0].p).toMatchObject({ source: 'manual', slash: { command: { name: 'tdd' } } });
    expect(b.claudeTexts(id)[0]).toContain(join(shared, 'remote-notes.txt'));
    await both();
    const excerpt = selectExcerpt('REMOTE TERMINAL CONTEXT', { thread: id, cwd: shared, pid: 42, at: new Date() });
    if (!excerpt.ok) throw new Error(excerpt.error);
    const context = newContext(terminalExcerpt, excerpt.value, 'check this output');
    expect((await a.json(`/threads/${id}/messages`, { body: { prompt: '/tdd check @remote-notes.txt', context: [context], request_id: 'prepared-reply' } })).status).toBe(200);
    await both();
    await b.untilResults(id, 2);
    expect(b.byKind(id, 'user').at(-1)!.p).toMatchObject({ slash: { command: { name: 'tdd' } }, context: [{ kind: 'terminal_excerpt', note: 'check this output' }] });
    expect(b.claudeTexts(id).at(-1)).toContain('REMOTE TERMINAL CONTEXT');
    expect(b.claudeTexts(id).at(-1)).toContain(join(shared, 'remote-notes.txt'));
  }, T.timeout);

  it('passes Codex the skill file for fresh remote prompts and replies', async () => {
    const res = await a.json('/threads', { body: { channel: 'shop', prompt: '/tdd remote codex', harness: 'codex', model: 'gpt-5.6-sol', device: 'box-b' } });
    expect(res.status).toBe(200);
    const id = res.body.id;
    await both();
    await b.untilResults(id, 1);
    await both();
    expect((await a.json(`/threads/${id}/messages`, { body: { prompt: '/tdd follow up', request_id: 'codex-skill' } })).status).toBe(200);
    await both();
    await b.untilResults(id, 2);
    const inputs = b.codexRequests().filter((r) => r.method === 'turn/start' && r.thread_id === id).map((r) => r.params.input);
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(input).toContainEqual({ type: 'skill', name: 'tdd', path: '/Users/dev/.agents/skills/tdd/SKILL.md' });
  }, T.timeout);

  it('prepares a fresh worktree prompt after setup', async () => {
    const res = await a.json('/threads', { body: { channel: 'code', prompt: '/tdd remote worktree', device: 'box-b' } });
    const id = res.body.id;
    await both();
    await b.untilResults(id, 1);
    expect(b.byKind(id, 'user')[0].p).toMatchObject({ source: 'manual', slash: { command: { name: 'tdd' } } });
  }, T.timeout);

  it('never replays a delivered reply after takeover or a handoff back', async () => {
    const res = await a.json('/threads', { body: { channel: 'shop', prompt: 'start remote', device: 'box-b' } });
    const id = res.body.id;
    await both();
    await b.untilResults(id, 1);
    await both();
    await a.json(`/threads/${id}/messages`, { body: { prompt: 'reply exactly once', request_id: 'no-replay' } });
    await both();
    await b.untilResults(id, 2);
    await both();
    expect(a.db.messageRequests.byRequestId(id, 'runon:no-replay')).toBeUndefined();
    const t = b.thread(id);
    const session = join(b.home, '.claude', 'projects', b.files.claudeProjectDir(t.cwd), `${t.session_id}.jsonl`);
    mkdirSync(dirname(session), { recursive: true });
    writeFileSync(session, '{"type":"user","from":"box-b"}\n');
    expect((await a.json(`/threads/${id}/takeover`, { body: {} })).status).toBe(200);
    for (let n = 0; n < 100 && a.db.threads.holder(id) !== 'mac-a'; n++) { await both(); await new Promise((r) => setTimeout(r, 20)); }
    await waitFor(() => a.db.threads.holder(id) === 'mac-a', 'A to take over');
    await both();
    await both();
    expect(userTexts(a, id).filter((t) => t === 'reply exactly once')).toHaveLength(1);
    expect(a.db.messageRequests.byRequestId(id, 'runon:no-replay')).toBeUndefined();
    expect(a.runner.isLive(id)).toBe(false);
    expect(a.db.kv.get(`runon.accepted.${id}.no-replay`)).toBe(true);
    expect((await a.json(`/threads/${id}/handoff`, { body: { to: 'box-b' } })).status).toBe(200);
    for (let n = 0; n < 100 && b.db.threads.holder(id) !== 'box-b'; n++) { await both(); await new Promise((r) => setTimeout(r, 20)); }
    await waitFor(() => b.db.threads.holder(id) === 'box-b', 'B to take it back');
    await both();
    expect(userTexts(b, id).filter((t) => t === 'reply exactly once')).toHaveLength(1);
  }, T.timeout);
});

describe('files sent to a thread run on another machine', () => {
  const multipart = async (m: Mac, path: string, body: unknown, files: File[]) => {
    const fd = new FormData();
    fd.append('payload', JSON.stringify(body));
    for (const f of files) fd.append('files', f, f.name);
    const res = await m.app.request(`/api${path}`, { method: 'POST', body: fd });
    return { status: res.status, body: (await res.json()) as any };
  };
  const onB = (id: string, name: string) => join(b.paths.threads, id, 'uploads', name);

  it('go with the first message and with replies, and land on that machine', async () => {
    const res = await multipart(a, '/threads', { channel: 'shop', prompt: 'read the brief', device: 'box-b' }, [new File(['FIRST BRIEF'], 'brief.txt', { type: 'text/plain' })]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const id = res.body.id as string;
    // The hub keeps a copy for its own transcript.
    expect(readFileSync(join(a.paths.threads, id, 'uploads', 'brief.txt'), 'utf8')).toBe('FIRST BRIEF');
    await both();
    await b.untilResults(id, 1);
    expect(readFileSync(onB(id, 'brief.txt'), 'utf8')).toBe('FIRST BRIEF');
    expect(b.byKind(id, 'user')[0].p.attachments).toMatchObject([{ name: 'brief.txt', path: onB(id, 'brief.txt') }]);
    expect(b.claudeTexts(id)[0]).toContain(onB(id, 'brief.txt'));
    await both();

    const reply = await multipart(a, `/threads/${id}/messages`, { prompt: 'and this screenshot', request_id: 'with-files' }, [
      new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'shot.png', { type: 'image/png' }),
    ]);
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    expect(reply.body.forwarded_to).toBe('Box B');
    await both();
    await b.untilResults(id, 2);
    expect(b.byKind(id, 'user').at(-1)!.p.attachments).toMatchObject([{ name: 'shot.png', image: true, path: onB(id, 'shot.png') }]);
    expect(b.claudeTexts(id).at(-1)).toContain(onB(id, 'shot.png'));
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
    expect((await a.json('/setup', { method: 'PUT', body: { runOn: { device: 'box-b' } } })).status).toBe(200);
    const count = a.db.threads.list({}).length;
    expect((await a.json('/threads', { body: { channel: 'shop', prompt: 'offline default' } })).status).toBe(409);
    expect(a.db.threads.list({})).toHaveLength(count);
    await a.json('/setup', { method: 'PUT', body: { runOn: { device: '' } } });
    a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  }, T.timeout);
});
