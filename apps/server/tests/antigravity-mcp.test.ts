// Antigravity's MCP servers and connectors (spec #977, ticket #981) through the real runner against the scripted fake
// `agy acp` (packages/test-fixtures/fake-agy.mjs): which servers a session gets, that no secret value rides in an
// entry, that Omni's own tools (steps, questions) work from an Antigravity thread, that the Notion token reaches agy's
// environment, and that a session start writes nothing into the user's Antigravity home or the folder it works in.
// The fake starts the stdio servers it is given, as the real agy 1.5.16 does (probed live for this ticket).
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRunner, type Ev } from './runner-boot.ts';
import { FAKE_AGY, hasMcpBuild } from './support.ts';

const T = { timeout: 60_000 };
const NOTION = 'ntn_test_secret_value_8841';
const CHANNEL_SECRET = 'channel-secret-value-5520';

let H: Awaited<ReturnType<typeof startRunner>>;
let tmp: string;
let home: string;
let agyLog: string;
let server: Server | undefined;
let call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
const agy = { harness: 'antigravity', model: 'gemini-4-neon' };

const requests = (): any[] => (existsSync(agyLog) ? readFileSync(agyLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const sessionNews = () => requests().filter((r) => r.kind === 'request' && r.method === 'session/new');
const spawns = () => requests().filter((r) => r.kind === 'spawn' && r.argv[0] === 'acp');
/** The MCP entries of the session a thread just opened (the newest session/new). */
const entries = () => sessionNews().at(-1)!.params.mcpServers as { name: string; command: string; args: string[]; env: { name: string; value: string }[] }[];
const names = () => entries().map((e) => e.name).sort();

/** Every file under a folder with a hash of what it holds, ignoring the folders agy itself fills with its conversations. */
function snapshot(root: string, skip: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      const path = join(dir, name);
      const rel = relative(root, path);
      if (skip.some((s) => rel === s || rel.startsWith(`${s}/`))) continue;
      if (statSync(path).isDirectory()) walk(path);
      else out[rel] = createHash('sha1').update(readFileSync(path)).digest('hex');
    }
  };
  walk(root);
  return out;
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'omni-agy-mcp-'));
  home = join(tmp, 'home');
  mkdirSync(home);
  agyLog = join(tmp, 'agy.jsonl');
  H = await startRunner({
    HOME: home,
    OMNI_ANTIGRAVITY_BIN: FAKE_AGY,
    OMNI_ANTIGRAVITY_CHECK_MS: '4000',
    OMNI_SECRET_STORE: 'file',
    FAKE_AGY_LOG: agyLog,
    FAKE_AGY_LOG_ENV: 'OMNI_NOTION_TOKEN,CHANNEL_SECRET',
    FAKE_AGY_SESSIONS: join(tmp, 'sessions'),
    OMNI_ANTIGRAVITY_CANCEL_MS: '800',
  });
  const svc = await import('../harness/catalog-service.ts');
  await svc.loadCatalog();
  // A thread's MCP servers call Omni over HTTP, as on a real install.
  const { app } = await import('../app.ts');
  const { serve } = await import('@hono/node-server');
  server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
  await once(server, 'listening');
  const { about } = await import('../about.ts');
  about.port = (server.address() as AddressInfo).port;
  call = async (method, path, body) => {
    const res = await app.request(`/api${path}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const { setSecret } = await import('../secrets.ts');
  await setSecret('global', 'OMNI_NOTION_TOKEN', NOTION);
  await setSecret('channel:scratch', 'CHANNEL_SECRET', CHANNEL_SECRET);
  // Agents of the user's own: one that reaches Omni's own tools, one that remembers, one that leads a team.
  const own = (id: string, text: string) => {
    mkdirSync(H.paths.personalCrew, { recursive: true });
    writeFileSync(join(H.paths.personalCrew, `${id}.md`), text);
  };
  own('omni-agent', '---\nname: Omni agent\nharness: antigravity\nmodel: gemini-4-neon\nmcp: [omni]\n---\nUse the Omni tools.\n');
  own('rememberer', '---\nname: Rememberer\nharness: antigravity\nmodel: gemini-4-neon\nmemory: read-write\n---\nRemember things.\n');
  own('team-lead', '---\nname: Team lead\nharness: antigravity\nmodel: gemini-4-neon\n---\nLead.\n');
  own('helper', '---\nname: Helper\n---\nHelp.\n');
}, 60_000);

afterAll(() => {
  server?.close();
  server?.closeAllConnections();
});

describe('the servers a session gets', () => {
  it('hands a plain agent the questions, renders, steps and threads servers as stdio entries with env name/value pairs', T, async () => {
    const t = await H.start('SAY hello', agy);
    await H.untilResults(t.id, 1);
    expect(names()).toEqual(hasMcpBuild ? ['omni-ask', 'omni-render', 'omni-steps', 'omni-threads'] : []);
    for (const e of entries()) {
      expect(typeof e.command).toBe('string');
      expect(Array.isArray(e.args)).toBe(true);
      expect(e.env.length).toBeGreaterThan(0);
      for (const pair of e.env) expect(Object.keys(pair).sort()).toEqual(['name', 'value']);
      const env = Object.fromEntries(e.env.map((p) => [p.name, p.value]));
      expect(env).toMatchObject({ OMNI_THREAD_ID: t.id });
      expect(env.OMNI_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
      expect(env.OMNI_TOKEN_FILE).toBeTruthy();
    }
  });

  it('has the question server hand a question back before agy ends the call at 3 minutes', T, async () => {
    if (!hasMcpBuild) return;
    const t = await H.start('SAY hello', agy);
    await H.untilResults(t.id, 1);
    const ask = entries().find((e) => e.name === 'omni-ask')!;
    expect(Object.fromEntries(ask.env.map((p) => [p.name, p.value])).OMNI_ASK_WAIT_SEC).toBe('150');
    // Only the question server is capped.
    for (const e of entries().filter((e) => e.name !== 'omni-ask')) expect(e.env.map((p) => p.name)).not.toContain('OMNI_ASK_WAIT_SEC');
  });

  it("gives an agent that reaches Omni's own tools the `omni` server", T, async () => {
    const t = await H.start('SAY hello', { ...agy, role: 'omni-agent' } as any);
    await H.untilResults(t.id, 1);
    expect(names()).toContain('omni');
    expect(names()).toContain('omni-ask');
    expect(names()).not.toContain('omni-threads');
  });

  it("gives a memory role the `omni-memory` server, with the role's id", T, async () => {
    if (!hasMcpBuild) return;
    const t = await H.start('SAY hello', { ...agy, role: 'rememberer' } as any);
    await H.untilResults(t.id, 1);
    expect(names()).toContain('omni-memory');
    expect(Object.fromEntries(entries().find((e) => e.name === 'omni-memory')!.env.map((p) => [p.name, p.value])).OMNI_ROLE).toBe('rememberer');
  });

  it("gives a team lead the team server, and its members' threads none of it", T, async () => {
    if (!hasMcpBuild) return;
    const conductor = await H.start('be the conductor');
    await H.untilResults(conductor.id, 1);
    const { mintThreadToken } = await import('../thread-tokens.ts');
    const token = mintThreadToken(conductor.id).token;
    const res = await fetch(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/threads/team`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel: 'scratch', title: 'Launch', prompt: 'SAY planning', role: 'team-lead', task_id: 'T-81', tasks: [{ title: 'Copy', prompt: 'write it', role: 'helper' }, { title: 'Look', prompt: 'design it', role: 'helper' }] }),
    });
    expect(res.status).toBe(200);
    const lead = (await res.json()).thread;
    await H.untilResults(lead.id, 1);
    expect(H.thread(lead.id).harness).toBe('antigravity');
    expect(names()).toContain('omni-team');
  });

  it('leaves the browser out, as every thread here has none, and writes no browser entry', T, async () => {
    const t = await H.start('SAY hello', agy);
    await H.untilResults(t.id, 1);
    expect(names()).not.toContain('omni-browser');
  });
});

describe('secrets', () => {
  it('puts no secret value in any entry, and gives the servers the thread token as a file path', T, async () => {
    const t = await H.start('SAY hello', agy);
    await H.untilResults(t.id, 1);
    const wire = JSON.stringify(sessionNews().map((r) => r.params.mcpServers));
    for (const secret of [NOTION, CHANNEL_SECRET]) expect(wire).not.toContain(secret);
    const { mintThreadToken } = await import('../thread-tokens.ts');
    const file = entries().flatMap((e) => e.env).find((p) => p.name === 'OMNI_TOKEN_FILE')?.value;
    if (hasMcpBuild) expect(file).toBeTruthy();
    if (file && existsSync(file)) expect(wire).not.toContain(readFileSync(file, 'utf8').trim());
    void mintThreadToken;
  });

  it("reaches agy's environment: the Notion token and the channel's secrets, as env variables only", T, async () => {
    const t = await H.start('SAY hello', agy);
    await H.untilResults(t.id, 1);
    const last = spawns().at(-1)!;
    expect(last.envKeys).toContain('OMNI_NOTION_TOKEN');
    expect(last.envValues).toEqual({ OMNI_NOTION_TOKEN: NOTION, CHANNEL_SECRET });
  });
});

describe('Omni tools from an Antigravity thread', () => {
  it("shows a set_steps call as the thread's steps", T, async () => {
    if (!hasMcpBuild) return;
    const t = await H.start('MCP omni-steps set_steps {"steps":["Look around","Wrap up"],"current":0}', agy);
    await H.untilResults(t.id, 1);
    const use = H.byKind(t.id, 'tool_use').find((e: Ev) => e.p.name === 'mcp__omni-steps__set_steps');
    expect(use?.p.input).toMatchObject({ steps: ['Look around', 'Wrap up'], current: 0 });
    expect(H.texts(t.id, 'assistant_text').join('')).toContain('Showing step 1 of 2, "Look around"');
    const { buildItems } = await import('@omni/shared/transcript-fold.ts');
    const { turnSteps } = await import('@omni/shared/steps.ts');
    const rows = H.db.events.since(t.id).map((r: { id: number; kind: string; payload: string; created_at: string }) => r);
    const view = turnSteps(buildItems(rows).items, { live: false });
    expect(view?.source).toBe('agent');
    expect(view?.steps.map((s) => s.title)).toEqual(['Look around', 'Wrap up']);
  });

  it('shows ask_user_question as a question card, and the answer reaches agy', T, async () => {
    if (!hasMcpBuild) return;
    const questions = [{ question: 'Which market goes first?', header: 'Market', options: [{ label: 'NL', description: 'Home' }, { label: 'DE', description: 'Bigger' }], multiSelect: false }];
    const t = await H.start(`MCP omni-ask ask_user_question ${JSON.stringify({ questions })}`, agy);
    const card = await H.until('the question card', () => H.byKind(t.id, 'question')[0], 25_000);
    expect(H.thread(t.id).status).toBe('running');
    // The call polls one request after its question is saved; answering first would send the answer as a message.
    await new Promise((r) => setTimeout(r, 1000));
    const res = await call('POST', `/threads/${t.id}/questions/${card.p.id}/answer`, { answers: [{ selected: ['DE'], other: null }] });
    expect(res.body).toEqual({ state: 'answered', via: 'tool' });
    await H.untilResults(t.id, 1);
    expect(H.texts(t.id, 'assistant_text').join('')).toContain('"Which market goes first?"="DE"');
    expect(H.thread(t.id).status).toBe('done');
  });
});

describe('what a session start leaves behind', () => {
  it("writes nothing into the user's Antigravity home or the folder the thread works in", T, async () => {
    // The user's own Antigravity setup: an MCP file and a rule, which must stay as they are.
    const gemini = join(home, '.gemini', 'antigravity-cli');
    mkdirSync(join(gemini, 'rules'), { recursive: true });
    writeFileSync(join(gemini, 'mcp_config.json'), '{"mcpServers":{"mine":{"command":"true"}}}\n');
    writeFileSync(join(gemini, 'rules', 'mine.md'), 'Always answer in Dutch.\n');
    const cwd = H.db.channels.get('scratch')!.base_dir!;
    const homeBefore = snapshot(home, ['.gemini/antigravity-cli/conversations', '.gemini/antigravity-cli/brain']);
    const cwdBefore = snapshot(cwd);
    const t = await H.start('SAY hello', agy);
    await H.untilResults(t.id, 1);
    expect(sessionNews().length).toBeGreaterThan(0);
    expect(snapshot(home, ['.gemini/antigravity-cli/conversations', '.gemini/antigravity-cli/brain'])).toEqual(homeBefore);
    expect(snapshot(cwd)).toEqual(cwdBefore);
    expect(readFileSync(join(gemini, 'mcp_config.json'), 'utf8')).toContain('"mine"');
  });
});
