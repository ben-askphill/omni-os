import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionRun, ChannelAction, ThreadActions } from '@omni/shared/channel-actions.ts';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX, FAKE_CURSOR } from './support.ts';


// The desktop app hands the server a pairing secret (apps/desktop/src/backend/process.ts). With it, any process could
// trade the secret for a nonce at /api/auth/desktop-nonce and the nonce for a desktop window session at /desktop-pair,
// which counts as Ben. The server keeps it, and no thread's process, terminal or action gets it. The test starts the
// server the way both an older app (the secret in the environment) and this one (a descriptor) would. Each process
// reports only whether the variable was in its environment, never its value.
const SECRET = 'desktop-pair-secret-0123456789abcdef0123456789abcdef';
process.env.SHELL = '/bin/sh';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];
const INSTALL = () => process.env.OMNI_TOKEN!;

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_CURSOR_BIN: FAKE_CURSOR });
  await (await import('../harness/catalog-service.ts')).loadCatalog(['codex', 'cursor']);
  ({ app } = await import('../app.ts'));
  const file = join(mkdtempSync(join(tmpdir(), 'omni-pair-')), 'secret');
  writeFileSync(file, `${SECRET}\n`);
  Object.assign(process.env, { OMNI_DESKTOP_PAIR_SECRET: SECRET, OMNI_DESKTOP_PAIR_FD: String(openSync(file, 'r')) });
  // What index.ts does first, before anything starts a child.
  (await import('../desktop-pairing.ts')).adoptDesktopSecret();
});

const call = async <T = any>(method: string, path: string, opts: { token?: string | null; body?: unknown; headers?: Record<string, string> } = {}) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: {
      ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
      authorization: opts.token === null ? '' : `Bearer ${opts.token ?? INSTALL()}`,
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
};

describe("the desktop app's pairing secret", () => {
  it('is gone from the server environment every child copies', () => {
    expect('OMNI_DESKTOP_PAIR_SECRET' in process.env).toBe(false);
    expect('OMNI_DESKTOP_PAIR_FD' in process.env).toBe(false);
  });

  it('never reaches a Claude Code thread or the MCP servers it starts', async () => {
    const t = await H.start('hello');
    await H.untilResults(t.id, 1);
    const spawns = H.spawns(t.id);
    expect(spawns.length).toBeGreaterThan(0);
    for (const s of spawns) expect(s.pair_secret).toBe(false);
    expect(readFileSync(join(H.paths.threads, t.id, 'mcp.json'), 'utf8')).not.toContain(SECRET);
  });

  it('never reaches a Codex thread or its MCP config', async () => {
    const t = await H.start('hello', { harness: 'codex' });
    await H.untilResults(t.id, 1);
    const reqs = H.codexRequests().filter((r) => r.thread_id === t.id);
    expect(reqs.length).toBeGreaterThan(0);
    for (const r of reqs) expect(r.pair_secret).toBe(false);
    expect(JSON.stringify(reqs)).not.toContain(SECRET);
  });

  it('never reaches a Cursor Agent thread or its plugin folder', async () => {
    const t = await H.start('hello', { harness: 'cursor' });
    await H.untilResults(t.id, 1);
    const reqs = H.cursorRequests().filter((r) => r.thread_id === t.id);
    expect(reqs.length).toBeGreaterThan(0);
    for (const r of reqs) expect(r.pair_secret).toBe(false);
    expect(readFileSync(join(H.paths.threads, t.id, 'cursor-plugin', '.mcp.json'), 'utf8')).not.toContain(SECRET);
  });

  it("never reaches a thread's terminal", async () => {
    const { terminalEnv } = await import('../terminal-env.ts');
    expect('OMNI_DESKTOP_PAIR_SECRET' in terminalEnv()).toBe(false);
  });

  it('never reaches a channel action run', async () => {
    const t = await H.start('hello', { title: 'Actions' });
    await H.untilResults(t.id, 1);
    const made = await call<ChannelAction>('POST', '/channels/scratch/actions', {
      body: { name: 'Pair secret probe', command: 'if [ -n "${OMNI_DESKTOP_PAIR_SECRET+x}" ]; then echo present; else echo absent; fi' },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const run = await call<ActionRun>('POST', `/threads/${t.id}/actions/${made.body.id}/run`);
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    let done: ActionRun | undefined;
    const end = Date.now() + 10_000;
    while (!done || done.state === 'running') {
      if (Date.now() > end) throw new Error('the action run did not end');
      await new Promise((r) => setTimeout(r, 25));
      done = (await call<ThreadActions>('GET', `/threads/${t.id}/actions`)).body.runs.find((x) => x.id === run.body.id);
    }
    expect(done.output.trim()).toBe('absent');
  });

  it('still earns the desktop app a nonce, and the nonce a window session', async () => {
    const minted = await call<{ nonce: string }>('POST', '/auth/desktop-nonce', { token: null, headers: { 'x-omni-desktop-secret': SECRET } });
    expect(minted.status).toBe(200);
    const res = await app.request(`/api/auth/desktop-pair?nonce=${minted.body.nonce}`, { headers: { authorization: '' } });
    expect(res.status).toBe(302);
    expect(res.headers.get('set-cookie') ?? '').toContain('omni_s_');
  });

  it("earns a thread's own token no nonce, with or without the secret", async () => {
    const t = await H.start('hello');
    await H.untilResults(t.id, 1);
    const token = H.spawns(t.id).at(-1)?.omni_token as string;
    expect(token).toMatch(/^omt_/);
    expect((await call('POST', '/auth/desktop-nonce', { token })).status).toBe(403);
    expect((await call('POST', '/auth/desktop-nonce', { token, headers: { 'x-omni-desktop-secret': SECRET } })).status).toBe(403);
  });
});
