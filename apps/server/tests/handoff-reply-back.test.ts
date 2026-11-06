import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MemoryTransport } from '../sync/transport.ts';
import { tailscaleStatus, waitFor } from './support.ts';
import { bootMac, type Mac } from './two-macs.ts';

// Repro for the PR 554 thread: a worktree thread handed A -> B, a commit made on B, then Ben's next message sent on A.
// The reply moves the thread back to A (docs/user/sync.md "You can still just reply to an idle thread here"), but
// nothing carries B's worktree: A's turn runs on A's stale checkout, without B's commit.

const relay = new MemoryTransport();
const NODE_A = { id: 'nA', dns: 'mac-a.tail1234.ts.net' };
const NODE_B = { id: 'nB', dns: 'mac-b.tail1234.ts.net' };
const shared = mkdtempSync(join(tmpdir(), 'omni-reply-back-'));
afterAll(() => rmSync(shared, { recursive: true, force: true }));

let a: Mac;
let b: Mac;

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', dir, ...args], { encoding: 'utf8' }).trimEnd();
const write = (path: string, body: string) => (mkdirSync(dirname(path), { recursive: true }), writeFileSync(path, body));
const sessionFile = (m: Mac, t: { cwd: string; session_id: string }) =>
  join(m.home, '.claude', 'projects', m.files.claudeProjectDir(t.cwd), `${t.session_id}.jsonl`);
const idle = (m: Mac, id: string) => waitFor(() => !['running', 'queued'].includes(m.thread(id).status), `${m.id} to finish the turn`, 20_000);
const detail = async (m: Mac, id: string) => (await m.json(`/threads/${id}`)).body;
async function eventually(fn: () => Promise<unknown>, label: string, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  a = await bootMac('mac-a', 'Mac A', relay);
  a.tailnet(tailscaleStatus(NODE_A, [{ ...NODE_B, online: true }]));
  b = await bootMac('mac-b', 'Mac B', relay);
  b.tailnet(tailscaleStatus(NODE_B, [{ ...NODE_A, online: true }]));
  for (const m of [a, b]) {
    await m.sync();
    await waitFor(() => m.db.kv.get(`devices.${m.id}`), `${m.id} to describe itself`);
    await m.sync();
  }
  await a.sync();
}, 60_000);

describe('a worktree thread handed A -> B, then replied to on A', () => {
  it('runs on A without the commit B made', { timeout: 90_000 }, async () => {
    const origin = join(shared, 'origin.git');
    git(shared, 'init', '-q', '--bare', '-b', 'main', origin);
    const seed = join(shared, 'seed');
    git(shared, 'init', '-q', '-b', 'main', seed);
    writeFileSync(join(seed, 'README.md'), 'repo\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', 'first');
    git(seed, 'push', '-q', origin, 'HEAD:main');
    const cloneA = join(a.tmp, 'repo');
    const cloneB = join(b.tmp, 'repo');
    git(shared, 'clone', '-q', origin, cloneA);
    git(shared, 'clone', '-q', origin, cloneB);
    b.db.kv.set('sync.path_map', { [cloneA]: cloneB, [a.paths.data]: b.paths.data });
    a.db.kv.set('sync.path_map', { [cloneB]: cloneA, [b.paths.data]: a.paths.data });
    a.db.channels.create({ id: 'repo', name: 'Repo', kind: 'client', repo_path: cloneA, use_worktree: 1 });

    // 1. The thread runs a turn on A, then A hands it to B (as at 09:04Z: Mac -> omarchy).
    const t = await a.runner.createThread({ channel: 'repo', prompt: 'is there a tool for secrets?' });
    await idle(a, t.id);
    const wtA = a.thread(t.id).cwd;
    write(sessionFile(a, a.thread(t.id)), '{"type":"user","from":"mac-a"}\n');
    const baseA = git(wtA, 'rev-parse', 'HEAD');

    expect((await a.json(`/threads/${t.id}/handoff`, { body: { to: 'mac-b' } })).status).toBe(200);
    await eventually(async () => (await detail(a, t.id)).handoff?.state.phase === 'offered', 'the offer');
    await eventually(async () => {
      await a.sync();
      await b.sync();
      return (await detail(a, t.id)).handoff?.state.phase === 'accepted';
    }, 'B to take it');

    // 2. B runs a turn and its agent commits (as at 09:10Z: 2f3e091e on omarchy).
    expect((await b.json(`/threads/${t.id}/messages`, { body: { prompt: 'yes make it' } })).status).toBe(200);
    await waitFor(() => b.spawns(t.id).some((s) => s.args.includes('--resume')), 'B to run it', 20_000);
    await idle(b, t.id);
    const wtB = join(b.paths.worktrees, t.id);
    writeFileSync(join(wtB, 'secret-drop.ts'), 'export {};\n');
    git(wtB, 'add', 'secret-drop.ts');
    git(wtB, 'commit', '-q', '-m', 'set_secret tool');
    const commitB = git(wtB, 'rev-parse', 'HEAD');
    await b.sync();
    await a.sync();
    await b.sync();
    await a.sync();

    // What A shows before Ben replies: B holds it, idle, nothing blocks a reply here.
    const before = await detail(a, t.id);
    expect(a.db.assignments.get(t.id)?.machine).toBe('mac-b');
    expect(before.blocked).toBeUndefined();

    // 3. Ben replies on A (as at 10:06Z: "Commit your work, push the branch and open a PR").
    const resultsBefore = a.byKind(t.id, 'result').length;
    const reply = await a.json(`/threads/${t.id}/messages`, { body: { prompt: 'commit, push and open a PR' } });
    expect(reply.status).toBe(200);
    await waitFor(() => a.byKind(t.id, 'result').length > resultsBefore, 'A to run the reply', 20_000);
    await idle(a, t.id);

    // The thread is A's again: the reply claimed it, and no offer or request carried anything back.
    expect(a.db.assignments.get(t.id)?.machine).toBe('mac-a');
    expect(a.db.kv.get<{ to: { id: string } }>(`handoff.offer.${t.id}`)?.to.id).toBe('mac-b');
    expect(a.db.kv.get(`handoff.request.${t.id}`)).toBeFalsy();

    // The gap: A's turn ran in A's old checkout. B's commit is not in it, not on A's branch, not in A's repo at all.
    expect(git(wtA, 'rev-parse', 'HEAD')).toBe(baseA);
    expect(existsSync(join(wtA, 'secret-drop.ts'))).toBe(false);
    expect(() => git(cloneA, 'cat-file', '-e', `${commitB}^{commit}`)).toThrow();
    // B still has it, unpushed.
    expect(git(wtB, 'rev-parse', 'HEAD')).toBe(commitB);
  });
});
