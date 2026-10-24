import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActionRun, ChannelAction, SetupMode, ThreadActions } from '@omni/shared/channel-actions.ts';
import { startRunner } from './runner-boot.ts';

// A channel's setup action (#211) runs in each new worktree once per preparation attempt, after the checkout is
// verified. Blocking: the agent starts only once it succeeds. Background: the agent starts while it runs. A failure
// or Ben's Stop keeps the first prompt for Retry setup, and no Retry starts the agent twice. Slow commands wait on a
// gate file the test creates, so each step is observed while it is happening.

process.env.SHELL = '/bin/sh';
const r = await startRunner();
const { app } = await import('../app.ts');
const { stopAllRuns } = await import('../actions.ts');
afterAll(() => stopAllRuns());

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

const call = async <T = any>(method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
};

let n = 0;
/** A worktree channel over a fresh repo with one commit, and a folder for its gate files. */
function channel(patch: Record<string, unknown> = {}) {
  const id = `setup-${++n}`;
  const dir = join(r.tmp, id);
  mkdirSync(join(dir, 'repo'), { recursive: true });
  mkdirSync(join(dir, 'gates'));
  git(join(dir, 'repo'), 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'repo', 'README.md'), 'hello\n');
  git(join(dir, 'repo'), 'add', '.');
  git(join(dir, 'repo'), 'commit', '-q', '-m', 'init');
  r.db.channels.create({ id, name: id, repo_path: join(dir, 'repo'), use_worktree: 1, ...patch });
  const gate = (name: string) => join(dir, 'gates', name);
  return { id, gate, open: (name: string) => writeFileSync(gate(name), '') };
}

async function setupAction(channelId: string, command: string, setup: SetupMode | null, extra: Record<string, unknown> = {}) {
  const res = await call<ChannelAction>('POST', `/channels/${channelId}/actions`, { name: `Install ${++n}`, command, setup, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** A command that prints, then waits until the gate exists, then exits with `code`. */
const waits = (gate: string, code = 0) => `echo "installing in $PWD"; while [ ! -f '${gate}' ]; do sleep 0.05; done; echo installed > .setup-done; exit ${code}`;

const actionsOf = async (id: string) => (await call<ThreadActions>('GET', `/threads/${id}/actions`)).body;
const setupRun = async (id: string) => (await actionsOf(id)).setup_run;
const setupRuns = async (id: string, actionId: string) => (await actionsOf(id)).runs.filter((x) => x.action_id === actionId);
const until = async (label: string, fn: () => Promise<boolean> | boolean) => {
  const end = Date.now() + 10_000;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await new Promise((res) => setTimeout(res, 25));
  }
};
const untilRun = (id: string, state: ActionRun['state']) => until(`the setup run to be ${state}`, async () => (await setupRun(id))?.state === state);
const retry = (id: string) => call('POST', `/threads/${id}/setup/retry`);
const settle = () => new Promise((res) => setTimeout(res, 300));

describe('a blocking setup action', () => {
  it('runs once in the verified worktree and holds the agent until it succeeds', async () => {
    const ch = channel();
    const action = await setupAction(ch.id, waits(ch.gate('go')), 'blocking');
    const t = await r.runner.createThread({ channel: ch.id, prompt: 'fix the cart' });
    await until('the setup output', async () => !!(await setupRun(t.id))?.output.includes('installing'));
    // Slow setup: still preparing, the prompt waits, no agent anywhere.
    expect(r.thread(t.id).setup).toBe('preparing');
    expect(r.spawns(t.id)).toEqual([]);
    const running = (await setupRun(t.id))!;
    expect(running).toMatchObject({ action_id: action.id, state: 'running', cwd: t.cwd });
    expect((await call('GET', `/threads/${t.id}`)).body.pending).toMatchObject([{ text: 'fix the cart', request_id: 'thread-start' }]);
    // Ben can't run it by hand meanwhile: that would be a second setup in the same attempt.
    expect((await call('POST', `/threads/${t.id}/actions/${action.id}/run`)).status).toBe(409);
    ch.open('go');
    await r.untilResults(t.id, 1);
    expect(existsSync(join(t.cwd, '.setup-done'))).toBe(true);
    expect(r.spawns(t.id)).toHaveLength(1);
    expect(await setupRun(t.id)).toMatchObject({ id: running.id, state: 'succeeded', exit_code: 0 });

    // Reconnecting and following up in the ready thread never run it again.
    await call('GET', `/threads/${t.id}`);
    await actionsOf(t.id);
    await call('POST', `/threads/${t.id}/messages`, { prompt: 'and the checkout' });
    await r.untilResults(t.id, 2);
    await settle();
    expect(await setupRuns(t.id, action.id)).toHaveLength(1);
  });

  it('fails visibly with the request and output kept, and Retry setup runs it again but starts the agent once', async () => {
    const ch = channel();
    const ok = ch.gate('ok');
    const action = await setupAction(ch.id, `echo "npm ERR! missing token" >&2; test -f '${ok}' || exit 3; echo fine`, 'blocking');
    const t = await r.runner.createThread({ channel: ch.id, prompt: 'ship it' });
    await r.until('setup to fail', () => r.thread(t.id).setup === 'failed');
    expect(r.thread(t.id)).toMatchObject({ status: 'failed' });
    expect(r.thread(t.id).setup_error).toMatch(/setup action "Install \d+" failed with exit code 3/);
    expect(r.spawns(t.id)).toEqual([]);
    const failedRun = (await setupRun(t.id))!;
    expect(failedRun).toMatchObject({ state: 'failed', exit_code: 3 });
    expect(failedRun.output).toMatch(/missing token/);
    expect((await call('GET', `/threads/${t.id}`)).body.pending).toMatchObject([{ text: 'ship it', delivery: 'recovered' }]);

    ch.open('ok');
    // Retry pressed twice at once, and Resume on the kept prompt: one more setup run, one agent, one prompt.
    const [a, b, c] = await Promise.all([retry(t.id), retry(t.id), call('POST', `/threads/${t.id}/requests/resume`, {})]);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    await r.untilResults(t.id, 1);
    await settle();
    expect(r.spawns(t.id)).toHaveLength(1);
    expect(r.texts(t.id, 'user')).toEqual(['ship it']);
    const runs = await setupRuns(t.id, action.id);
    expect(runs.map((x) => x.state)).toEqual(['succeeded', 'failed']);
    expect((await setupRun(t.id))!.id).toBe(runs[0].id);
    // Retry on a ready thread changes nothing.
    expect((await retry(t.id)).body.thread.setup).toBeNull();
    await settle();
    expect(r.spawns(t.id)).toHaveLength(1);
    expect(await setupRuns(t.id, action.id)).toHaveLength(2);
  });

  it("refuses to start when a secret it needs is missing, before anything runs", async () => {
    const ch = channel();
    await setupAction(ch.id, 'echo hi', 'blocking', { secrets: ['NOT_SET_ANYWHERE'] });
    const t = await r.runner.createThread({ channel: ch.id, prompt: 'go' });
    await r.until('setup to fail', () => r.thread(t.id).setup === 'failed');
    expect(r.thread(t.id).setup_error).toMatch(/could not start: .*NOT_SET_ANYWHERE/);
    expect(await setupRun(t.id)).toBeNull();
    expect(r.spawns(t.id)).toEqual([]);
  });
});

describe('Stop while a worktree is prepared', () => {
  it('stops the setup run, never starts the agent, and Retry setup starts it once', async () => {
    const ch = channel();
    const action = await setupAction(ch.id, `echo started; sleep 30`, 'blocking');
    const t = await r.runner.createThread({ channel: ch.id, prompt: 'build the page' });
    await until('the setup to print', async () => !!(await setupRun(t.id))?.output.includes('started'));
    expect((await call('POST', `/threads/${t.id}/stop`, {})).status).toBe(200);
    await r.until('the preparation to stop', () => r.thread(t.id).setup === 'failed');
    expect(r.thread(t.id)).toMatchObject({ status: 'stopped', setup_error: 'Stopped by Ben before the agent started.' });
    expect(await setupRun(t.id)).toMatchObject({ state: 'stopped' });
    await settle();
    expect(r.spawns(t.id)).toEqual([]);
    expect((await call('GET', `/threads/${t.id}`)).body.pending).toMatchObject([{ text: 'build the page' }]);

    await call('PATCH', `/channels/${ch.id}/actions/${action.id}`, { name: action.name, command: 'echo quick', setup: 'blocking' });
    await retry(t.id);
    await r.untilResults(t.id, 1);
    await settle();
    expect(r.spawns(t.id)).toHaveLength(1);
    expect(r.texts(t.id, 'user')).toEqual(['build the page']);
    expect((await setupRuns(t.id, action.id)).map((x) => x.state)).toEqual(['succeeded', 'stopped']);
  });

  it('stops during the checkout of a channel with no setup action', async () => {
    const ch = channel();
    const t = await r.runner.createThread({ channel: ch.id, prompt: 'never mind' });
    // The checkout itself is not interrupted: it ends, and the agent is not started after it.
    await call('POST', `/threads/${t.id}/stop`, {});
    await r.until('the preparation to stop', () => r.thread(t.id).setup === 'failed');
    expect(r.thread(t.id).status).toBe('stopped');
    await settle();
    expect(r.spawns(t.id)).toEqual([]);
  });
});

describe('a background setup action', () => {
  it('lets the agent start while it runs, and completes after', async () => {
    const ch = channel();
    const action = await setupAction(ch.id, waits(ch.gate('go')), 'background');
    const t = await r.runner.createThread({ channel: ch.id, prompt: 'start now' });
    await r.untilResults(t.id, 1);
    expect(r.thread(t.id).setup).toBeNull();
    expect(r.spawns(t.id)).toHaveLength(1);
    // Still visibly running while the agent has already replied.
    const running = (await setupRun(t.id))!;
    expect(running).toMatchObject({ action_id: action.id, state: 'running' });
    expect((await actionsOf(t.id)).blocked).toBeNull();
    ch.open('go');
    await untilRun(t.id, 'succeeded');
    expect(existsSync(join(t.cwd, '.setup-done'))).toBe(true);
    expect(await setupRuns(t.id, action.id)).toHaveLength(1);
  });

  it('a failure leaves the agent running and shows on the run', async () => {
    const ch = channel();
    await setupAction(ch.id, 'echo nope; exit 2', 'background');
    const t = await r.runner.createThread({ channel: ch.id, prompt: 'carry on' });
    await r.untilResults(t.id, 1);
    await untilRun(t.id, 'failed');
    expect(r.thread(t.id)).toMatchObject({ setup: null, setup_error: null });
    expect((await setupRun(t.id))!.exit_code).toBe(2);
  });
});

describe('no setup', () => {
  it('runs nothing for a thread that shares the channel checkout', async () => {
    const ch = channel({ use_worktree: 0 });
    const action = await setupAction(ch.id, 'echo never > never.txt', 'blocking');
    const t = await r.runner.createThread({ channel: ch.id, prompt: 'shared' });
    expect(t.setup).toBeNull();
    await r.untilResults(t.id, 1);
    await settle();
    expect(await setupRun(t.id)).toBeNull();
    expect(await setupRuns(t.id, action.id)).toEqual([]);
    expect(existsSync(join(t.cwd, 'never.txt'))).toBe(false);
  });
});

describe('the setting', () => {
  it('belongs to one action per channel at a time', async () => {
    const ch = channel();
    const first = await setupAction(ch.id, 'echo one', 'blocking');
    const second = await setupAction(ch.id, 'echo two', null);
    expect(second.setup).toBeNull();
    const patched = await call<ChannelAction>('PATCH', `/channels/${ch.id}/actions/${second.id}`, { name: second.name, command: 'echo two', setup: 'background' });
    expect(patched.body.setup).toBe('background');
    const list = (await call<ChannelAction[]>('GET', `/channels/${ch.id}/actions`)).body;
    expect(list.map((a) => [a.id, a.setup])).toEqual([
      [first.id, null],
      [second.id, 'background'],
    ]);
    expect((await call('POST', `/channels/${ch.id}/actions`, { name: 'Bad', command: 'x', setup: 'sometimes' })).status).toBe(400);
  });
});
