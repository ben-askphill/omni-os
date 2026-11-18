import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Claude Code on the first-run screens without a terminal (/api/setup/claude*), against the fake claude CLI: its state,
// the installer, and `claude auth login`'s page and pasted code. FAKE_CLAUDE_AUTH is the fake's login.

const dir = mkdtempSync(join(tmpdir(), 'omni-claude-setup-'));
const auth = join(dir, 'auth.json');
await startRunner({ FAKE_CLAUDE_AUTH: auth });
const { app } = await import('../app.ts');
const { claudeSetup, CLAUDE_INSTALL } = await import('../claude-setup.ts');

const send = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as any };
};
const signOut = () => writeFileSync(auth, JSON.stringify({ loggedIn: false }));
const until = async (ok: () => Promise<boolean>) => {
  for (let i = 0; i < 100 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 50));
};

describe('GET /api/setup/claude', () => {
  it('ready with the account, signed out, or missing with the installer', async () => {
    rmSync(auth, { force: true });
    expect((await send('GET', '/api/setup/claude')).body).toEqual({ state: 'ready', email: 'dev@example.com', plan: 'max' });
    signOut();
    expect((await send('GET', '/api/setup/claude')).body).toEqual({ state: 'signed-out' });
    expect(await claudeSetup(join(dir, 'no-claude'))).toEqual({ state: 'missing', install: CLAUDE_INSTALL });
  });
});

describe('sign in by pasting the code', () => {
  it('answers the page to open, refuses a wrong code in the CLI’s words, then signs in with the right one', async () => {
    signOut();
    const start = await send('POST', '/api/setup/claude/login');
    expect(start.status).toBe(200);
    expect(start.body.url).toMatch(/^https:\/\/claude\.com\/cai\/oauth\/authorize\?/);
    const bad = await send('POST', '/api/setup/claude/login/code', { flow: start.body.flow, code: 'bad' });
    expect(bad.body).toMatchObject({ state: 'failed', error: expect.stringMatching(/^Login failed: That code wasn't accepted/) });
    expect(bad.body.error).not.toContain('oauth/authorize');
    const again = await send('POST', '/api/setup/claude/login');
    // The old flow is gone: its code cannot finish the new sign-in.
    expect((await send('POST', '/api/setup/claude/login/code', { flow: start.body.flow, code: 'abc' })).body).toMatchObject({ state: 'failed' });
    const good = await send('POST', '/api/setup/claude/login/code', { flow: again.body.flow, code: ' abc#state ' });
    expect(good.body).toEqual({ state: 'done', setup: { state: 'ready', email: 'new@example.com', plan: 'pro' } });
  });

  it('refuses an empty code, and Cancel stops a sign-in', async () => {
    signOut();
    const start = await send('POST', '/api/setup/claude/login');
    expect((await send('POST', '/api/setup/claude/login/code', { flow: start.body.flow, code: '  ' })).status).toBe(400);
    expect((await send('POST', '/api/setup/claude/login/cancel', { flow: start.body.flow })).body).toEqual({ ok: true });
    expect((await send('POST', '/api/setup/claude/login/code', { flow: start.body.flow, code: 'abc' })).body).toMatchObject({ state: 'failed' });
  });
});

describe('install', () => {
  const run = async (command: string) => {
    process.env.OMNI_CLAUDE_INSTALL = command;
    const { body } = await send('POST', '/api/setup/claude/install');
    let step: any;
    await until(async () => (step = (await send('GET', `/api/setup/claude/install/${body.flow}`)).body).state !== 'running');
    delete process.env.OMNI_CLAUDE_INSTALL;
    return step;
  };

  it('runs the installer and says done, or fails with what it printed last', async () => {
    expect(await run('echo installing; exit 0')).toEqual({ state: 'done' });
    expect(await run('echo boom >&2; exit 3')).toEqual({ state: 'failed', error: 'boom' });
    expect((await send('GET', '/api/setup/claude/install/nope')).status).toBe(404);
  });
});
