import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActionRun, ChannelAction } from '@omni/shared/channel-actions.ts';
import { startRunner } from './runner-boot.ts';

// Adding, changing, running or retrying a channel action puts a command in a login shell on this machine, so each
// takes the credential the terminal takes (request-trust.ts): the install's token, or a session paired with it. A
// Google, Omni Connect or app session gets 403, and nothing reaches the shell. The login shell here is a stub that
// writes down the command it was handed and runs none of it, so every case is checked by what reached the launcher.

const r = await startRunner();
const LAUNCHES = join(r.tmp, 'launches.log');
const STUB_SHELL = join(r.tmp, 'bin', 'stub-login-shell');
// A command with FAIL in it exits 3, for a setup step that fails.
writeFileSync(STUB_SHELL, `#!/bin/sh\n[ "$1" = "-lc" ] && printf '%s\\n' "$2" >> '${LAUNCHES}'\ncase "$2" in *FAIL*) exit 3;; esac\nexit 0\n`, { mode: 0o755 });
process.env.SHELL = STUB_SHELL;

const { app } = await import('../app.ts');
const { actionsApi } = await import('../actions-api.ts');
const { stopAllRuns } = await import('../actions.ts');
const { cookieName, sessionCookieName } = await import('../api-token.ts');
const auth = await import('../google-auth.ts');
afterAll(() => stopAllRuns());

/** Every command the stub login shell was handed, in order. */
const launched = () => (existsSync(LAUNCHES) ? readFileSync(LAUNCHES, 'utf8').split('\n').filter(Boolean) : []);

// The owner is linked, so a Google session is live (google-auth.ts liveRow).
auth.linkOwner({ issuer: 'https://clerk.test', sub: 'user_ben', email: 'ben@example.com', name: 'Ben' });

/** How each kind of client proves itself, as request-guard.ts reads it. */
const cookie = (token: string) => ({ authorization: '', cookie: `${sessionCookieName()}=${token}` });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const CREDENTIALS = {
  'install token': { headers: bearer(process.env.OMNI_TOKEN!), shell: true },
  'browser paired with the token': { headers: cookie(auth.createSession('Chrome', 'browser', '', 'token').token), shell: true },
  "an older build's raw-token cookie": { headers: { authorization: '', cookie: `${cookieName()}=${process.env.OMNI_TOKEN}` }, shell: true },
  'Google browser session (and Omni Connect)': { headers: cookie(auth.createSession('Chrome', 'browser', 'user_ben', 'google').token), shell: false },
  'Google app session': { headers: bearer(auth.createSession('iPhone', 'app', 'user_ben', 'google').token), shell: false },
  'paired app (pairing code)': { headers: bearer(auth.createSession('iPhone', 'app', '', 'pairing').token), shell: false },
  'no credential': { headers: { authorization: '' }, shell: false },
} satisfies Record<string, { headers: Record<string, string>; shell: boolean }>;
type Who = keyof typeof CREDENTIALS;
const WHO = Object.keys(CREDENTIALS) as Who[];
const TOKEN: Who = 'install token';

const call = async <T = any>(who: Who, method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...CREDENTIALS[who].headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
};

/** What a refused shell route answers: 401 with no credential at all, else 403 naming the rule. */
function expectRefused(who: Who, res: { status: number; body: unknown }) {
  if (who === 'no credential') return expect(res.status).toBe(401);
  expect(res.status, JSON.stringify(res.body)).toBe(403);
  expect((res.body as { error?: string }).error).toMatch(/install's token or a browser paired with it/);
}

let n = 0;
const marker = (who: Who) => `echo launched-by-${who.replace(/\W+/g, '-')}-${++n}`;

/** An action the install token adds, in the scratch channel. */
async function tokenAction(extra: Record<string, unknown> = {}) {
  const res = await call<ChannelAction>(TOKEN, 'POST', '/channels/scratch/actions', { name: `Action ${++n}`, command: `echo token-${n}`, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** An idle thread in the scratch channel, in its own folder. */
async function thread() {
  const t = await r.start('hello', { title: 'Actions' });
  await r.untilResults(t.id, 1);
  const cwd = join(r.tmp, `cwd-${t.id.slice(0, 6)}`);
  mkdirSync(cwd, { recursive: true });
  r.db.threads.update(t.id, { cwd });
  return t.id;
}

async function ended(threadId: string, runId: string): Promise<ActionRun> {
  const end = Date.now() + 10_000;
  for (;;) {
    const run = (await call<{ runs: ActionRun[] }>(TOKEN, 'GET', `/threads/${threadId}/actions`)).body.runs.find((x) => x.id === runId)!;
    if (run.state !== 'running') return run;
    if (Date.now() > end) throw new Error(`run ${runId} still running`);
    await new Promise((res) => setTimeout(res, 25));
  }
}

describe('adding or changing an action', () => {
  for (const who of WHO)
    it(`${who}: ${CREDENTIALS[who].shell ? 'may' : 'may not'} add one, edit its command, or make it a setup or teardown step`, async () => {
      const command = marker(who);
      const added = await call<ChannelAction>(who, 'POST', '/channels/scratch/actions', { name: `Added ${n}`, command });
      const mine = await tokenAction();
      const edited = await call<ChannelAction>(who, 'PATCH', `/channels/scratch/actions/${mine.id}`, { name: mine.name, command });
      const hooked = await call<ChannelAction>(who, 'PATCH', `/channels/scratch/actions/${mine.id}`, { name: mine.name, command: mine.command, teardown: true, setup: 'background' });
      if (CREDENTIALS[who].shell) {
        expect(added.status).toBe(201);
        expect(edited.body.command).toBe(command);
        expect(hooked.body).toMatchObject({ teardown: true, setup: 'background' });
        return;
      }
      for (const res of [added, edited, hooked]) expectRefused(who, res);
      const stored = r.db.channelActions.list('scratch');
      expect(stored.some((a) => a.command === command)).toBe(false);
      expect(r.db.channelActions.get(mine.id)).toMatchObject({ command: mine.command, setup: null, teardown: false });
    });
});

describe('running or retrying an action', () => {
  for (const who of WHO)
    it(`${who}: ${CREDENTIALS[who].shell ? 'starts' : 'never starts'} a run, or a retry of one`, async () => {
      const id = await thread();
      const action = await tokenAction();
      // A run the token started and that has ended, for the retry.
      const prior = await call<ActionRun>(TOKEN, 'POST', `/threads/${id}/actions/${action.id}/run`);
      expect(prior.status, JSON.stringify(prior.body)).toBe(201);
      await ended(id, prior.body.id);
      const before = launched().length;
      const run = await call<ActionRun>(who, 'POST', `/threads/${id}/actions/${action.id}/run`);
      if (run.status === 201) await ended(id, run.body.id);
      const retry = await call<ActionRun>(who, 'POST', `/threads/${id}/action-runs/${prior.body.id}/retry`);
      if (retry.status === 201) await ended(id, retry.body.id);
      if (CREDENTIALS[who].shell) {
        expect(run.status, JSON.stringify(run.body)).toBe(201);
        expect(retry.status, JSON.stringify(retry.body)).toBe(201);
        expect(launched().slice(before)).toEqual([action.command, action.command]);
        return;
      }
      expectRefused(who, run);
      expectRefused(who, retry);
      expect(launched().length).toBe(before);
      expect(r.db.actionRuns.byThread(id).map((x) => x.id)).toEqual([prior.body.id]);
    });
});

describe('another spelling of a shell route', () => {
  it('never reaches the shell for a restricted session', async () => {
    const id = await thread();
    const action = await tokenAction();
    const before = launched().length;
    const spellings = [
      `/threads/${id}/actions/${action.id}/run/`,
      `/threads/${id}/actions/${action.id}/%72un`,
      `/threads/${id}/actions/${encodeURIComponent(action.id)}/run`,
      `//threads/${id}/actions/${action.id}/run`,
      `/threads/${id}/actions/${action.id}/RUN`,
      `/threads/${id}/actions/${action.id}/run?x=1`,
      `/threads/${id}/./actions/${action.id}/run`,
    ];
    for (const path of spellings) {
      const res = await call('paired app (pairing code)', 'POST', path);
      expect(res.status, path).not.toBe(201);
    }
    expect(launched().length).toBe(before);
  });
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args]);
/** A worktree channel over a fresh repo with one commit. */
function worktreeChannel() {
  const ch = `hook-${++n}`;
  const repo = join(r.tmp, ch);
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'hello\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  r.db.channels.create({ id: ch, name: ch, repo_path: repo, use_worktree: 1 });
  return ch;
}

describe('Retry setup, which runs the setup step again', () => {
  for (const who of WHO)
    it(`${who}: ${CREDENTIALS[who].shell ? 'reruns' : 'never reruns'} a failed setup step, through Retry setup or Resume`, async () => {
      const ch = worktreeChannel();
      const install = await call<ChannelAction>(TOKEN, 'POST', `/channels/${ch}/actions`, { name: 'Install', command: `echo install-${++n} FAIL`, setup: 'blocking' });
      expect(install.status, JSON.stringify(install.body)).toBe(201);
      const t = await r.runner.createThread({ channel: ch, prompt: 'fix the cart' });
      await r.until('setup to fail', () => r.thread(t.id).setup === 'failed');
      const runs = () => launched().filter((x) => x === install.body.command).length;
      expect(runs()).toBe(1);
      // Resume and Fresh context refuse a thread whose setup failed before they would send anything.
      for (const path of [`/threads/${t.id}/session/retry`, `/threads/${t.id}/session/fresh`]) {
        const before = runs();
        expect((await call(who, 'POST', path, {})).status, path).toBe(who === 'no credential' ? 401 : 409);
        expect(runs(), path).toBe(before);
      }
      for (const path of [`/threads/${t.id}/setup/retry`, `/threads/${t.id}/requests/resume`]) {
        const before = runs();
        const res = await call(who, 'POST', path, {});
        if (!CREDENTIALS[who].shell) {
          expectRefused(who, res);
          await new Promise((done) => setTimeout(done, 300));
          expect(runs(), path).toBe(before);
          expect(r.thread(t.id).setup).toBe('failed');
          continue;
        }
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        await r.until(`setup to run again through ${path}`, () => runs() === before + 1 && r.thread(t.id).setup === 'failed');
      }
    });

  it('stays open to every signed-in device when the channel has no setup step, since nothing runs a shell', async () => {
    for (const who of WHO.filter((w) => w !== 'no credential')) {
      const ch = worktreeChannel();
      const t = await r.runner.createThread({ channel: ch, prompt: 'fix the cart' });
      await r.untilResults(t.id, 1);
      r.db.threads.update(t.id, { setup: 'failed', setup_error: 'checkout failed' });
      const res = await call(who, 'POST', `/threads/${t.id}/setup/retry`, {});
      expect(res.status, `${who}: ${JSON.stringify(res.body)}`).toBe(200);
    }
  });

  // The retry was let in because the channel had no setup step, but the step is looked up again once the checkout
  // is made. One the token adds meanwhile must not run for the restricted caller's retry.
  for (const who of WHO.filter((w) => w !== 'no credential'))
    it(`${who}: ${CREDENTIALS[who].shell ? 'runs' : 'never runs'} a setup step added while its retry checks the branch out`, async () => {
      const ch = worktreeChannel();
      const t = await r.runner.createThread({ channel: ch, prompt: 'fix the cart' });
      await r.untilResults(t.id, 1);
      r.db.threads.update(t.id, { setup: 'failed', setup_error: 'checkout failed' });
      const res = await call(who, 'POST', `/threads/${t.id}/setup/retry`, {});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(r.thread(t.id).setup).toBe('preparing');
      const command = marker(who);
      expect((await call(TOKEN, 'POST', `/channels/${ch}/actions`, { name: 'Install', command, setup: 'blocking' })).status).toBe(201);
      await r.until('the retry to finish', () => r.thread(t.id).setup !== 'preparing');
      if (CREDENTIALS[who].shell) {
        expect(launched()).toContain(command);
        expect(r.thread(t.id).setup).toBeNull();
        return;
      }
      expect(launched()).not.toContain(command);
      expect(r.thread(t.id).setup).toBe('failed');
      expect(r.thread(t.id).setup_error).toMatch(/install's token or a browser paired with it/);
    });
});

describe('a setup step a restricted session tried to add', () => {
  for (const who of WHO.filter((w) => !CREDENTIALS[w].shell && w !== 'no credential'))
    it(`${who}: never runs when a new worktree is prepared`, async () => {
      const ch = worktreeChannel();
      const command = marker(who);
      expectRefused(who, await call(who, 'POST', `/channels/${ch}/actions`, { name: 'Install', command, setup: 'blocking' }));
      const t = await r.runner.createThread({ channel: ch, prompt: 'fix the cart' });
      await r.untilResults(t.id, 1);
      expect(r.thread(t.id).setup).not.toBe('failed');
      expect(launched()).not.toContain(command);
    });
});

describe('what stays open to every signed-in device', () => {
  it('reading actions and runs, stopping a run and removing an action take no shell', async () => {
    const id = await thread();
    const action = await tokenAction();
    const run = (await call<ActionRun>(TOKEN, 'POST', `/threads/${id}/actions/${action.id}/run`)).body;
    await ended(id, run.id);
    for (const who of WHO.filter((w) => w !== 'no credential')) {
      expect((await call(who, 'GET', '/channels/scratch/actions')).status).toBe(200);
      expect((await call(who, 'GET', `/threads/${id}/actions`)).status).toBe(200);
      expect((await call(who, 'POST', `/threads/${id}/action-runs/${run.id}/stop`)).status).toBe(200);
    }
    expect((await call('paired app (pairing code)', 'DELETE', `/channels/scratch/actions/${action.id}`)).status).toBe(200);
  });

  it('covers every route actions-api.ts adds that is not a read, a stop or a removal', async () => {
    // A route added later is a shell route until it is listed here on purpose.
    const OPEN = new Set(['POST /threads/:id/action-runs/:run/stop', 'DELETE /channels/:id/actions/:action']);
    const routes = actionsApi.routes.filter((x) => x.method !== 'GET' && !OPEN.has(`${x.method} ${x.path}`));
    expect(routes.map((x) => `${x.method} ${x.path}`).sort()).toEqual([
      'PATCH /channels/:id/actions/:action',
      'POST /channels/:id/actions',
      'POST /threads/:id/action-runs/:run/retry',
      'POST /threads/:id/actions/:action/run',
    ]);
    for (const route of routes) {
      const path = route.path.replace(/:\w+/g, 'nope');
      const res = await call('Google app session', route.method, path, { name: 'x', command: 'echo x' });
      expectRefused('Google app session', res);
    }
  });
});
