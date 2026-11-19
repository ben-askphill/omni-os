import { beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX, FAKE_CURSOR } from './support.ts';

vi.mock('../secrets.ts', async (original) => ({
  ...(await original<typeof import('../secrets.ts')>()),
  globalSecret: async () => null,
  secretsEnv: async () => ({}),
}));

// Audit finding 12, parts 1 and 2: every spawn of a thread's harness holds a token of its own instead of the install's,
// and the server decides who is calling from it. Each test takes the credential the way a thread's shell has it, from
// the fake CLI's own environment (OMNI_TOKEN), so on a build that still hands threads the install token the rules
// below do not hold and the tests fail.
let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];
const INSTALL = process.env.OMNI_TOKEN!;

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_CURSOR_BIN: FAKE_CURSOR });
  await (await import('../harness/catalog-service.ts')).loadCatalog(['codex', 'cursor']);
  ({ app } = await import('../app.ts'));
});

type Res = { status: number; body: any };
const call = async (method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token ?? INSTALL}`, ...opts.headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/** A thread on the fake Claude Code, run to its first result, and the OMNI_TOKEN its process got. */
async function spawned(extra: Record<string, unknown> = {}) {
  const t = await H.start('hello', extra);
  await H.untilResults(t.id, 1);
  const token = H.spawns(t.id).at(-1)?.omni_token as string;
  return { id: t.id, token };
}

/** Puts the thread under an automation, as if one had started it. */
const underAutomation = (id: string) => H.db.db.prepare(`UPDATE threads SET source = 'automation', automation = 'nightly' WHERE id = ?`).run(id);

const automation = (name: string) => ({ fields: { name, enabled: true, cron: '0 9 * * 1-5', channel: 'scratch', prompt: 'Check the shop.' } });

describe('what each harness process holds', () => {
  it('Claude Code: its own token in OMNI_TOKEN, and its MCP servers read the same one from its own file', async () => {
    const { id, token } = await spawned();
    expect(token).toMatch(/^omt_/);
    expect(token).not.toBe(INSTALL);
    const file = join(H.paths.threads, id, 'token');
    expect(readFileSync(file, 'utf8').trim()).toBe(token);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const mcp = readFileSync(join(H.paths.threads, id, 'mcp.json'), 'utf8');
    expect(mcp).not.toContain(INSTALL);
    expect(mcp).not.toContain('api-token');
    for (const server of Object.values(JSON.parse(mcp).mcpServers) as { env?: Record<string, string> }[]) {
      if (server.env?.OMNI_TOKEN_FILE) expect(server.env.OMNI_TOKEN_FILE).toBe(file);
    }
  });

  it('Codex: its own token, in the process and in the MCP config it starts the thread with', async () => {
    const t = await H.start('hello', { harness: 'codex' });
    await H.untilResults(t.id, 1);
    const reqs = H.codexRequests().filter((r) => r.thread_id === t.id);
    const token = reqs[0]?.omni_token as string;
    expect(token).toMatch(/^omt_/);
    expect(token).not.toBe(INSTALL);
    const start = reqs.find((r) => r.method === 'thread/start');
    const config = JSON.stringify(start?.params?.config ?? {});
    expect(config).not.toContain(INSTALL);
    expect(config).not.toContain('api-token');
  });

  it('Cursor Agent: its own token, in each turn and in its plugin folder', async () => {
    const t = await H.start('hello', { harness: 'cursor' });
    await H.untilResults(t.id, 1);
    const turns = H.cursorRequests().filter((r) => r.thread_id === t.id && r.omni_token);
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) {
      expect(turn.omni_token).toMatch(/^omt_/);
      expect(turn.omni_token).not.toBe(INSTALL);
    }
    const plugin = readFileSync(join(H.paths.threads, t.id, 'cursor-plugin', '.mcp.json'), 'utf8');
    expect(plugin).not.toContain(INSTALL);
    expect(plugin).not.toContain('api-token');
  });

  it('the token is that thread on the API, and no other', async () => {
    const { id, token } = await spawned();
    expect((await call('GET', '/auth/account', { token })).body.via).toBe('thread');
    expect((await call('GET', '/capabilities', { token })).body.auth.via).toBe('thread');
    expect((await call('GET', `/threads/${id}`, { token })).status).toBe(200);
    // A header that names another thread is a wiring bug: refused, not quietly read as either.
    const other = await call('GET', `/threads/${id}`, { token, headers: { 'x-omni-thread': 'someone-else' } });
    expect(other.status).toBe(403);
    // Threads reach the server on loopback. A copy that arrives through a proxy counts for nothing.
    expect((await call('GET', `/threads/${id}`, { token, headers: { 'x-forwarded-for': '203.0.113.9' } })).status).toBe(401);
  });

  it('stops working once its process exits', async () => {
    const { id, token } = await spawned();
    expect((await call('GET', '/threads', { token })).status).toBe(200);
    await H.runner.releaseForHandoff(id);
    expect((await call('GET', '/threads', { token })).status).toBe(401);
  });
});

describe('a thread under an automation, with no header', () => {
  it('cannot create an automation, where the install token can', async () => {
    const { id, token } = await spawned();
    underAutomation(id);
    const refused = await call('POST', '/automations', { token, body: automation('From the run') });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/automation "nightly"/);
    expect((await call('POST', '/automations', { body: automation('From Ben') })).status).toBe(201);
  });

  it('cannot rotate the install token, which an interactive thread still may', async () => {
    const run = await spawned();
    underAutomation(run.id);
    expect((await call('POST', '/auth/rotate-token', { token: run.token })).status).toBe(403);
    // The test server's token is pinned by OMNI_TOKEN, so the rotation itself answers 409: past the guard.
    const interactive = await spawned();
    expect((await call('POST', '/auth/rotate-token', { token: interactive.token })).status).toBe(409);
  });

  it('cannot continue a thread outside its own lineage', async () => {
    const elsewhere = await spawned();
    const run = await spawned();
    underAutomation(run.id);
    const res = await call('POST', `/threads/${elsewhere.id}/continue`, {
      token: run.token,
      body: { harness: 'codex', text: 'go on', request_id: 'r1', revision: 'x' },
    });
    expect(res.status).toBe(403);
    // A fork through the transitions route is the same start, and held the same way.
    const fork = await call('POST', `/threads/${elsewhere.id}/transitions`, {
      token: run.token,
      body: { kind: 'fork', run: { harness: 'codex', model: '', effort: '' }, text: 'go on', request_id: 'r2', revision: 'x' },
    });
    expect(fork.status).toBe(403);
    // Its own run is no escape: a thread continued from it is still under the automation, so that is not refused here.
    const root = await spawned();
    underAutomation(root.id);
    const child = await spawned({ parent_id: root.id, source: 'conductor' });
    const own = await call('POST', `/threads/${root.id}/continue`, { token: child.token, body: { harness: 'codex', text: 'go on', request_id: 'r3', revision: 'x' } });
    expect(own.status).not.toBe(403);
  });
});

describe('any thread token', () => {
  it("posts as the Conductor, never as Ben, so it is not Ben's answer", async () => {
    const { benAnswered } = await import('../automation-guard.ts');
    const target = await spawned();
    const { token } = await spawned();
    expect((await call('POST', `/threads/${target.id}/messages`, { token, body: { prompt: 'yes, save it', mode: 'queue' } })).status).toBe(200);
    const sent = await H.until('the message', () => H.byKind(target.id, 'user').find((e) => e.p.text === 'yes, save it'));
    expect(sent.p.source).toBe('conductor');
    expect(benAnswered(target.id)).toBe(false);
  });

  it("cannot answer a question card, its own or another thread's", async () => {
    const { id, token } = await spawned();
    const asked = await call('POST', `/threads/${id}/questions`, { token, body: { questions: [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes', description: 'Now.' }, { label: 'No', description: 'Later.' }], multiSelect: false }] } });
    expect(asked.status).toBe(200);
    const answer = await call('POST', `/threads/${id}/questions/${asked.body.id}/answer`, { token, body: { answers: [{ selected: ['Yes'], other: null }] } });
    expect(answer.status).toBe(403);
    // Nor ask on another thread's card, where Ben's answer would count as his say in that thread.
    const other = await spawned();
    const elsewhere = await call('POST', `/threads/${other.id}/questions`, { token, body: { questions: [{ question: 'Save the role?', header: 'Role', options: [{ label: 'Yes', description: 'Now.' }, { label: 'No', description: 'Later.' }], multiSelect: false }] } });
    expect(elsewhere.status).toBe(403);
  });

  it('files a thread it starts under itself, and cannot file one elsewhere', async () => {
    const { lineage } = await import('../automation-guard.ts');
    const run = await spawned();
    underAutomation(run.id);
    const made = await call('POST', '/threads', { token: run.token, body: { channel: 'scratch', prompt: 'side job', parent_id: null } });
    expect(made.status).toBe(200);
    expect(made.body.parent_id).toBe(run.id);
    expect(lineage(made.body.id).automation).toBe('nightly');
    const outside = await spawned();
    const refused = await call('POST', '/threads', { token: run.token, body: { channel: 'scratch', prompt: 'elsewhere', parent_id: outside.id } });
    expect(refused.status).toBe(403);
    const team = await call('POST', '/threads/team', { token: run.token, body: { channel: 'scratch', prompt: 'lead', parent_id: outside.id, tasks: [{ prompt: 'a' }] } });
    expect(team.status).toBe(403);
  });

  it('pairs no browser, app or desktop window, and links no Google account', async () => {
    const { token } = await spawned();
    expect((await call('POST', '/auth/pair', { token })).status).toBe(403);
    expect((await call('POST', '/auth/app-pairings', { token, body: {} })).status).toBe(403);
    expect((await call('POST', '/auth/desktop-nonce', { token })).status).toBe(403);
    expect((await call('DELETE', '/auth/google', { token })).status).toBe(403);
  });

  it('keeps working when Ben rotates the install token', async () => {
    const { token } = await spawned();
    const { rotateToken, tokenPath } = await import('../api-token.ts');
    // Unpinned for this one call, so it really rewrites data/api-token.
    rotateToken({});
    process.env.OMNI_TOKEN = readFileSync(tokenPath(), 'utf8').trim();
    expect(existsSync(tokenPath())).toBe(true);
    expect((await call('GET', '/threads', { token: INSTALL })).status).toBe(401);
    expect((await call('GET', '/threads', { token })).status).toBe(200);
  });
});
