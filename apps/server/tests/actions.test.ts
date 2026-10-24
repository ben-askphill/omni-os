import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import type { ActionRun, ChannelAction, ThreadActions } from '@omni/shared/channel-actions.ts';
import { OUTPUT_LIMIT } from '@omni/shared/channel-actions.ts';
import { startRunner } from './runner-boot.ts';

// /api/channels/:id/actions and /api/threads/:id/actions: named commands run in a thread's verified checkout.

process.env.SHELL = '/bin/sh';
const r = await startRunner({ ANTHROPIC_API_KEY: 'sk-billing', SUPABASE_REFRESH_TOKEN: 'sync-token', GROKBOT_WEBHOOK_URL: 'https://hook' });
const { app } = await import('../app.ts');
const { PREVIEW_PORTS, stopAllRuns } = await import('../actions.ts');
const { db } = await import('../db/connection.ts');
afterAll(() => stopAllRuns());

// A Keychain with one channel secret in it. The names table says it is set; `security` hands out its value.
writeFileSync(
  join(r.tmp, 'bin', 'security'),
  `#!/bin/sh\ncase "$*" in *"channel:scratch/THEME_TOKEN"*) echo "shptka_secret_value"; exit 0;; esac\nexit 44\n`,
  { mode: 0o755 },
);
db.prepare(`INSERT INTO secrets (scope, name) VALUES ('channel:scratch', 'THEME_TOKEN')`).run();

const call = async <T = any>(method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
};

let n = 0;
/** An action in the scratch channel. */
async function action(command: string, extra: { secrets?: string[]; port?: number | null } = {}) {
  const res = await call<ChannelAction>('POST', '/channels/scratch/actions', { name: `Action ${++n}`, command, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** An idle thread in its own folder. */
async function thread() {
  const t = await r.start('hello', { title: 'Actions' });
  await r.untilResults(t.id, 1);
  const cwd = join(r.tmp, `cwd-${t.id.slice(0, 6)}`);
  mkdirSync(cwd, { recursive: true });
  r.db.threads.update(t.id, { cwd });
  return { id: t.id, cwd };
}

const run = (threadId: string, actionId: string) => call<ActionRun>('POST', `/threads/${threadId}/actions/${actionId}/run`);
const runs = async (threadId: string) => (await call<ThreadActions>('GET', `/threads/${threadId}/actions`)).body.runs;
const runOf = async (threadId: string, runId: string) => (await runs(threadId)).find((x) => x.id === runId)!;
async function ended(threadId: string, runId: string): Promise<ActionRun> {
  const end = Date.now() + 10_000;
  for (;;) {
    const x = await runOf(threadId, runId);
    if (x.state !== 'running') return x;
    if (Date.now() > end) throw new Error(`run ${runId} still running: ${JSON.stringify(x)}`);
    await new Promise((res) => setTimeout(res, 25));
  }
}
const until = async (what: string, fn: () => Promise<boolean>) => {
  const end = Date.now() + 8000;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((res) => setTimeout(res, 25));
  }
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('channel action settings', () => {
  it('stores the command and secret names, never a value', async () => {
    const a = await action('shopify theme check', { secrets: ['THEME_TOKEN', 'THEME_TOKEN'] });
    expect(a).toMatchObject({ channel_id: 'scratch', command: 'shopify theme check', secrets: ['THEME_TOKEN'], port: null });
    const edited = await call<ChannelAction>('PATCH', `/channels/scratch/actions/${a.id}`, { name: a.name, command: 'shopify theme check --fail-level error', secrets: ['THEME_TOKEN'], port: 0 });
    expect(edited.body).toMatchObject({ id: a.id, command: 'shopify theme check --fail-level error', port: 0 });
    expect((await call<ChannelAction[]>('GET', '/channels/scratch/actions')).body.map((x) => x.id)).toContain(a.id);
    const row = JSON.stringify(db.prepare('SELECT * FROM channel_actions').all());
    expect(row).not.toContain('shptka_secret_value');
  });

  it('refuses billing, sync and server keys, a repeated name, and a port the command hard-codes', async () => {
    for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'SUPABASE_REFRESH_TOKEN', 'GROKBOT_WEBHOOK_URL']) {
      const res = await call('POST', '/channels/scratch/actions', { name: 'Leaky', command: 'true', secrets: [name] });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(name);
    }
    const a = await action('true');
    expect((await call('POST', '/channels/scratch/actions', { name: a.name, command: 'true' })).status).toBe(409);
    const fixed = await call('POST', '/channels/scratch/actions', { name: 'Preview', command: 'shopify theme dev --port 9292' });
    expect(fixed.status).toBe(400);
    expect(fixed.body.error).toContain('$OMNI_PORT');
    expect((await call('POST', '/channels/scratch/actions', { name: 'Preview', command: 'shopify theme dev --port 9292', port: 9292 })).status).toBe(201);
  });

  it('deletes an action and keeps its runs', async () => {
    const t = await thread();
    const a = await action('echo kept');
    const started = await run(t.id, a.id);
    await ended(t.id, started.body.id);
    expect((await call('DELETE', `/channels/scratch/actions/${a.id}`)).status).toBe(200);
    expect(await runOf(t.id, started.body.id)).toMatchObject({ name: a.name, state: 'succeeded' });
    const retried = await call('POST', `/threads/${t.id}/action-runs/${started.body.id}/retry`);
    expect(retried.status).toBe(404);
  });
});

describe('a run', () => {
  it("runs in the thread's checkout and records success and failure", async () => {
    const t = await thread();
    const ok = await run(t.id, (await action('pwd -P; echo done')).id);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ thread_id: t.id, cwd: t.cwd, state: 'running' });
    const done = await ended(t.id, ok.body.id);
    expect(done).toMatchObject({ state: 'succeeded', exit_code: 0, error: null });
    expect(done.output.trim().split('\n')).toEqual([realpathSync(t.cwd), 'done']);
    expect(done.ended_at).toBeTruthy();

    const bad = await run(t.id, (await action('echo nope >&2; exit 3')).id);
    expect(await ended(t.id, bad.body.id)).toMatchObject({ state: 'failed', exit_code: 3, output: 'nope\n' });
  });

  it('keeps only the end of a long output, and says how much there was', async () => {
    const t = await thread();
    const res = await run(t.id, (await action(`i=0; while [ $i -lt 3000 ]; do printf 'line %05d %s\\n' $i xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; i=$((i+1)); done; printf '\\033[31mred\\033[0m end\\n'`)).id);
    const done = await ended(t.id, res.body.id);
    expect(done.state).toBe('succeeded');
    expect(done.output.length).toBe(OUTPUT_LIMIT);
    expect(done.output_bytes).toBeGreaterThan(OUTPUT_LIMIT * 2);
    expect(done.output.endsWith('line 02999 ' + 'x'.repeat(58) + '\nred end\n')).toBe(true);
  });

  it('stops the whole process group, and Retry runs it again', async () => {
    const t = await thread();
    const pidFile = join(r.tmp, `child-${t.id.slice(0, 6)}.pid`);
    const res = await run(t.id, (await action(`sleep 30 & echo $! > ${pidFile}; wait`)).id);
    await until('the child to start', async () => existsSync(pidFile) && !!readFileSync(pidFile, 'utf8').trim());
    const child = Number(readFileSync(pidFile, 'utf8').trim());
    expect(alive(child)).toBe(true);
    const again = await run(t.id, res.body.action_id!);
    expect(again.status).toBe(409);
    expect(again.body.error).toContain('already running');

    const stopped = await call<ActionRun>('POST', `/threads/${t.id}/action-runs/${res.body.id}/stop`);
    expect(stopped.body).toMatchObject({ state: 'stopped', error: 'Stopped by Ben.' });
    await until('the sleep to die', async () => !alive(child));
    // Stopping again changes nothing.
    expect((await call<ActionRun>('POST', `/threads/${t.id}/action-runs/${res.body.id}/stop`)).body).toMatchObject({ state: 'stopped', ended_at: stopped.body.ended_at });

    const retried = await call<ActionRun>('POST', `/threads/${t.id}/action-runs/${res.body.id}/retry`);
    expect(retried.status).toBe(201);
    expect(retried.body.id).not.toBe(res.body.id);
    expect(retried.body).toMatchObject({ action_id: res.body.action_id, state: 'running' });
    await call('POST', `/threads/${t.id}/action-runs/${retried.body.id}/stop`);
  });

  it('gets only the secrets it names, and none of the billing, sync or server keys', async () => {
    const t = await thread();
    const res = await run(t.id, (await action('env', { secrets: ['THEME_TOKEN'] })).id);
    const env = Object.fromEntries((await ended(t.id, res.body.id)).output.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    expect(env.THEME_TOKEN).toBe('shptka_secret_value');
    expect(env.OMNI_THREAD_ID).toBe(t.id);
    for (const name of ['ANTHROPIC_API_KEY', 'SUPABASE_REFRESH_TOKEN', 'GROKBOT_WEBHOOK_URL', 'NODE_OPTIONS', 'OMNI_PORT']) expect(env[name]).toBeUndefined();
    expect(JSON.stringify(db.prepare('SELECT command FROM action_runs').all())).not.toContain('shptka_secret_value');

    const missing = await run(t.id, (await action('true', { secrets: ['NOT_SET'] })).id);
    expect(missing.status).toBe(409);
    expect(missing.body.error).toContain('NOT_SET');
  });
});

describe('preview ports', () => {
  it('gives concurrent runs different free ports, as $OMNI_PORT', async () => {
    const [a, b] = [await thread(), await thread()];
    const preview = await action('echo "port=$OMNI_PORT/$PORT"; sleep 30', { port: 0 });
    const [ra, rb] = await Promise.all([run(a.id, preview.id), run(b.id, preview.id)]);
    expect([ra.status, rb.status]).toEqual([201, 201]);
    expect(ra.body.port).not.toBe(rb.body.port);
    for (const x of [ra.body, rb.body]) expect(x.port).toBeGreaterThanOrEqual(PREVIEW_PORTS.from);
    await until('the port to print', async () => (await runOf(a.id, ra.body.id)).output.includes(`port=${ra.body.port}/${ra.body.port}`));
    await call('POST', `/threads/${a.id}/action-runs/${ra.body.id}/stop`);
    await call('POST', `/threads/${b.id}/action-runs/${rb.body.id}/stop`);
  });

  it('skips a port another program holds, and refuses a fixed port that is taken', async () => {
    const holder: Server = createServer();
    await new Promise<void>((res) => holder.listen(PREVIEW_PORTS.from, '127.0.0.1', res));
    try {
      const t = await thread();
      const auto = await run(t.id, (await action('sleep 30', { port: 0 })).id);
      expect(auto.body.port).not.toBe(PREVIEW_PORTS.from);
      await call('POST', `/threads/${t.id}/action-runs/${auto.body.id}/stop`);

      const outside = await run(t.id, (await action('sleep 30', { port: PREVIEW_PORTS.from })).id);
      expect(outside.status).toBe(409);
      expect(outside.body.error).toContain('outside Omni');
    } finally {
      holder.close();
    }

    const [a, b] = [await thread(), await thread()];
    const fixed = await action('sleep 30', { port: PREVIEW_PORTS.to });
    const first = await run(a.id, fixed.id);
    expect(first.body.port).toBe(PREVIEW_PORTS.to);
    const second = await run(b.id, fixed.id);
    expect(second.status).toBe(409);
    expect(second.body.error).toContain(`Port ${PREVIEW_PORTS.to} is taken by "${fixed.name}"`);
    await call('POST', `/threads/${a.id}/action-runs/${first.body.id}/stop`);
    // Free again once the first run has stopped.
    const third = await run(b.id, fixed.id);
    expect(third.status).toBe(201);
    await call('POST', `/threads/${b.id}/action-runs/${third.body.id}/stop`);
  });
});

describe('when it may run', () => {
  it('never starts a run because a client reads, and settles a run left over from before a restart', async () => {
    const t = await thread();
    const a = await action('echo hi');
    for (let i = 0; i < 3; i++) expect((await call<ThreadActions>('GET', `/threads/${t.id}/actions`)).body).toMatchObject({ runs: [], blocked: null });
    // A run recorded as running by a server that has since stopped.
    db.prepare(`INSERT INTO action_runs (id, thread_id, action_id, name, command, cwd, state, started_at) VALUES ('orphan', ?, ?, ?, 'echo hi', ?, 'running', ?)`).run(
      t.id,
      a.id,
      a.name,
      t.cwd,
      new Date().toISOString(),
    );
    const listed = await runs(t.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: 'orphan', state: 'stopped', error: 'Omni stopped while it was running.' });
  });

  it('waits for a worktree being prepared, and refuses a checkout that is not the thread’s own worktree', async () => {
    const t = await thread();
    const a = await action('pwd -P');
    r.db.threads.update(t.id, { setup: 'preparing' });
    const busy = await run(t.id, a.id);
    expect(busy.status).toBe(409);
    expect((await call<ThreadActions>('GET', `/threads/${t.id}/actions`)).body.blocked).toContain('being prepared');
    r.db.threads.update(t.id, { setup: null });

    // A worktree thread pointed at the repo itself: never run there.
    const repo = join(r.tmp, 'repo-actions');
    mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args]);
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'README.md'), 'hi\n');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
    r.db.channels.create({ id: 'acts-repo', name: 'Acts', repo_path: repo, use_worktree: 1 });
    db.prepare('UPDATE threads SET channel_id = ?, branch = ?, cwd = ? WHERE id = ?').run('acts-repo', 'omni/actions', repo, t.id);
    const own = (await call<ChannelAction>('POST', '/channels/acts-repo/actions', { name: 'Where', command: 'pwd -P' })).body;
    const refused = await run(t.id, own.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('not ready');

    // Its own worktree on its own branch: runs there.
    const wt = join(r.tmp, 'wt-actions');
    git('worktree', 'add', '-q', '-b', 'omni/actions', wt);
    db.prepare('UPDATE threads SET cwd = ? WHERE id = ?').run(wt, t.id);
    const ok = await run(t.id, own.id);
    expect(ok.status).toBe(201);
    expect((await ended(t.id, ok.body.id)).output.trim()).toBe(realpathSync(wt));
    // Another channel's action is not this thread's to run.
    expect((await run(t.id, a.id)).status).toBe(404);
  });
});
