// Connect an agent (agent-connect.ts, the /harnesses/connect routes): find what answers at an address, pair with a
// code, run the test turn, connect (secret, harness file, starter role) only after the test passed, undo it all when a
// step fails, and remove it again with its key revoked at the agent. Only Ben may do any of it.
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { startFakeHermes, type FakeHermes } from './fake-hermes.ts';
import { startFakeEve, type FakeEve } from './fake-eve.ts';

const CODE = 'GB8Z-DP5J-0TGX-R608-WYSB-WV2T-G8SV';

/** A pairing endpoint the way the helper or a template serves one, in front of a fake Runs API. */
interface FakePair {
  url: string;
  /** What the next redeem answers with, on top of the key and the runs URL. */
  answer: Record<string, unknown>;
  redeems: unknown[];
  revokes: { auth: string | null; body: unknown }[];
  close(): Promise<void>;
}

async function startPair(runs: FakeHermes): Promise<FakePair> {
  const fake: FakePair = { url: '', answer: {}, redeems: [], revokes: [], close: () => new Promise((r) => server.close(() => r())) };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    const send = (status: number, json?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(json === undefined ? '' : JSON.stringify(json));
    };
    if (req.url === '/v1/omni/pair' && req.method === 'GET') return send(405, { error: 'POST a pairing code' });
    if (req.url === '/v1/omni/pair' && req.method === 'POST') {
      fake.redeems.push(body);
      if (body?.code !== CODE) return send(404, { error: 'unknown or used code' });
      return send(200, { protocol: 1, kind: 'runs-api', name: 'Hermes on box', url: runs.url, key: runs.token, key_id: 'k-1', shared_key: true, revoke: false, ...fake.answer });
    }
    if (req.url === '/v1/omni/revoke' && req.method === 'POST') {
      fake.revokes.push({ auth: req.headers.authorization ?? null, body });
      return send(204);
    }
    send(404, { error: 'not found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  fake.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return fake;
}

let runs: FakeHermes;
let pair: FakePair;
let H: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let paths: { harnesses: string; data: string; crew: string };

beforeAll(async () => {
  runs = await startFakeHermes('paired-key-0123456789');
  pair = await startPair(runs);
  H = await startRunner({ HOME: mkdtempSync(join(tmpdir(), 'omni-connect-home-')), OMNI_SECRET_STORE: 'file' });
  ({ app } = await import('../app.ts'));
  ({ paths } = (await import('../config.ts')) as never);
});

afterAll(async () => {
  await pair.close();
  await runs.close();
});

beforeEach(async () => {
  runs.reset();
  pair.answer = {};
  pair.redeems = [];
  pair.revokes = [];
  (await import('../agent-connect.ts')).resetConnectDrafts();
});

const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
};
const secretValue = async (name: string) => (await import('../secrets.ts')).globalSecret(name);
const harnessFile = (slug: string) => join(paths.harnesses, `${slug}.yaml`);

describe('finding an agent', () => {
  it('reads a pairing link: the Runs API at url, a pairing address on the same host, and a code', async () => {
    const r = await post('harnesses/connect/find', { url: runs.url, pair: pair.url, code: CODE.toLowerCase(), name: 'Hermes on box' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ url: runs.url, pair: pair.url, kind: 'runs-api', supported: true, signIn: 'pairing', network: 'local', name: 'Hermes on box' });
    expect(r.json.problem).toBeUndefined();
    expect(r.json.can).toContain('Steer');
  });

  it('asks for a key from Secrets for a Runs API server without a code, and a code for a pairing address alone', async () => {
    expect((await post('harnesses/connect/find', { url: runs.url })).json).toMatchObject({ kind: 'runs-api', supported: true, signIn: 'key' });
    const alone = (await post('harnesses/connect/find', { url: pair.url })).json;
    expect(alone).toMatchObject({ kind: 'pairing', url: '', pair: pair.url, signIn: 'pairing' });
    expect(alone.problem).toMatch(/Add the code/);
    expect((await post('harnesses/connect/find', { url: pair.url, code: CODE })).json.problem).toBeUndefined();
  });

  it('says why it cannot connect: no address, plain http off the tailnet, a pairing address on another host, nothing there', async () => {
    expect((await post('harnesses/connect/find', { code: CODE })).json.problem).toMatch(/A code alone has no host in it/);
    expect((await post('harnesses/connect/find', { url: 'http://203.0.113.9:8642' })).json.problem).toMatch(/Plain http/);
    expect((await post('harnesses/connect/find', { url: runs.url, pair: 'http://localhost:9' })).json.problem).toMatch(/another host/);
    expect((await post('harnesses/connect/find', { url: 'http://127.0.0.1:9' })).json.problem).toMatch(/Could not reach 127.0.0.1:9/);
  });
});

describe('reading what an address answers', () => {
  it('stops reading a body past its cap, endless or declared too long, and reads a small one whole', async () => {
    const { readCapped } = await import('../agent-connect.ts');
    let sent = 0;
    const server = createServer((req, res) => {
      if (req.url === '/declared') {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(10 * 1024 * 1024) });
        return res.end();
      }
      if (req.url === '/small') return res.end('{"ok":true}');
      // Endless: a chunk whenever the socket takes one, until Omni hangs up.
      res.writeHead(200, { 'content-type': 'application/json' });
      const chunk = Buffer.alloc(16 * 1024, 'a');
      const more = () => {
        while (!res.destroyed && res.write(chunk)) sent += chunk.length;
        if (!res.destroyed) res.once('drain', more);
      };
      more();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const at = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      expect(await readCapped(await fetch(`${at}/endless`), 64 * 1024)).toBeNull();
      expect(sent).toBeLessThan(8 * 1024 * 1024);
      expect(await readCapped(await fetch(`${at}/declared`), 64 * 1024)).toBeNull();
      expect(await readCapped(await fetch(`${at}/small`), 64 * 1024)).toBe('{"ok":true}');
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});

describe('pairing, testing and connecting', () => {
  it('pairs, tests and connects, with the key only in the secret store, and makes its remote agent', async () => {
    const paired = await post('harnesses/connect/pair', { url: runs.url, pair: pair.url, code: CODE.toLowerCase().replaceAll('-', ' ') });
    expect(paired.status).toBe(200);
    expect(paired.json).toMatchObject({ url: runs.url, name: 'Hermes on box', sharedKey: true, revoke: false });
    expect(pair.redeems[0]).toMatchObject({ code: CODE, client_name: expect.stringMatching(/^Omni on /) });
    expect(paired.text).not.toContain(runs.token);

    // Not before the test passed.
    const early = await post('harnesses/connect', { slug: 'box', name: 'Hermes on box', draft: paired.json.draft, role: true });
    expect(early.status).toBe(409);
    expect(early.json.error).toMatch(/Run the test first/);
    expect(existsSync(harnessFile('box'))).toBe(false);

    const tested = await post('harnesses/connect/test', { draft: paired.json.draft });
    expect(tested.json).toMatchObject({ ok: true, reply: 'The command printed "hi".', model: 'claude-opus-5-5', tokens: { input: 11, output: 7 } });
    expect(tested.text).not.toContain(runs.token);
    const run = runs.calls.find((c) => c.method === 'POST' && c.path === '/v1/runs');
    expect(run?.authorization).toBe(`Bearer ${runs.token}`);
    expect((run?.body as { session_id: string }).session_id).toMatch(/^omni-test-/);

    const done = await post('harnesses/connect', { slug: 'box', name: 'Hermes on box', draft: paired.json.draft, role: true });
    expect(done.status).toBe(201);
    expect(done.text).not.toContain(runs.token);
    expect(done.json.harness).toMatchObject({ id: 'custom:box', url: runs.url, secret: 'AGENT_BOX_KEY', pairing: { keyId: 'k-1', at: pair.url, sharedKey: true, revoke: false, secretMade: true } });
    expect(done.json.harness.catalog).toMatchObject({ available: true });
    expect(done.json.role).toEqual({ id: 'box', name: 'Hermes on box' });
    expect(await secretValue('AGENT_BOX_KEY')).toBe(runs.token);
    const file = readFileSync(harnessFile('box'), 'utf8');
    expect(file).not.toContain(runs.token);
    expect(file).toMatch(/secret: AGENT_BOX_KEY/);
    const role = readFileSync(join(paths.data, 'crew', 'box.md'), 'utf8');
    expect(role).toMatch(/harness: custom:box/);
    expect(role).toMatch(/delegatable: true/);
    // No charter of Omni's: the server's own instructions lead (ADR 0020, Q28).
    expect(role).toMatch(/---\n$/);
    const { getCrew } = await import('../crew.ts');
    expect(getCrew('box')).toMatchObject({ harness: 'custom:box', delegateOnly: false, review: false, mcp: [] });
    // A draft is spent by Connect.
    expect((await post('harnesses/connect/test', { draft: paired.json.draft })).status).toBe(404);
  });

  it('refuses a wrong code, and a runs address on another host than the pairing one', async () => {
    const wrong = await post('harnesses/connect/pair', { url: runs.url, pair: pair.url, code: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA' });
    expect(wrong.status).toBe(400);
    expect(wrong.json.error).toMatch(/wrong, used or expired/);
    pair.answer = { url: 'https://elsewhere.example.com' };
    const moved = await post('harnesses/connect/pair', { pair: pair.url, code: CODE });
    expect(moved.status).toBe(502);
    expect(moved.json.error).toMatch(/another host than the one it paired on/);
  });

  it('connects a key already in Secrets once its test passed, and keeps that secret on Remove', async () => {
    const { setSecret } = await import('../secrets.ts');
    await setSecret('global', 'MANUAL_AGENT_KEY', runs.token);
    expect((await post('harnesses/connect', { slug: 'manual', name: 'Manual', url: runs.url, secret: 'MANUAL_AGENT_KEY', role: false })).status).toBe(409);
    expect((await post('harnesses/connect/test', { url: runs.url, secret: 'MANUAL_AGENT_KEY' })).json.ok).toBe(true);
    const done = await post('harnesses/connect', { slug: 'manual', name: 'Manual', url: runs.url, secret: 'MANUAL_AGENT_KEY', role: false });
    expect(done.status).toBe(201);
    // role: false from an older client still makes the agent: it is what connecting is for (ADR 0020).
    expect(done.json.role).toEqual({ id: 'manual', name: 'Manual' });
    expect(done.json.harness.pairing).toBeUndefined();
    const removed = await app.request('/api/harnesses/custom/manual', { method: 'DELETE' });
    expect(await removed.json()).toEqual({ deleted: true, revoked: null, secret: null });
    expect(await secretValue('MANUAL_AGENT_KEY')).toBe(runs.token);
  });

  it('says which step failed: a key the agent refuses fails the probe', async () => {
    const { setSecret } = await import('../secrets.ts');
    await setSecret('global', 'WRONG_AGENT_KEY', 'not-the-key');
    const r = await post('harnesses/connect/test', { url: runs.url, secret: 'WRONG_AGENT_KEY' });
    expect(r.json).toMatchObject({ ok: false, failed: 'probe', detail: expect.stringMatching(/refused the key/) });
    expect(runs.calls.some((c) => c.path === '/v1/runs')).toBe(false);
  });

  it('undoes everything a failed connect made, and revokes the key at an agent that can', async () => {
    pair.answer = { revoke: true, key_id: 'k-revocable', shared_key: false };
    const ac = await import('../agent-connect.ts');
    const paired = await ac.pairAgent({ url: runs.url, pair: pair.url, code: CODE });
    expect((await ac.testConnection({ draft: paired.draft })).ok).toBe(true);
    await expect(
      ac.connectAgent({ slug: 'halfway', name: 'Halfway', draft: paired.draft, role: true }, () => {
        throw new Error('role store broke');
      }),
    ).rejects.toThrow('role store broke');
    expect(existsSync(harnessFile('halfway'))).toBe(false);
    expect(await secretValue('AGENT_HALFWAY_KEY')).toBeNull();
    expect(pair.revokes).toEqual([{ auth: `Bearer ${runs.token}`, body: { key_id: 'k-revocable' } }]);
  });

  it('removes a paired agent: revokes its key at the agent, deletes the secret it made, and the file', async () => {
    pair.answer = { revoke: true, key_id: 'k-gone', shared_key: false };
    const paired = await post('harnesses/connect/pair', { url: runs.url, pair: pair.url, code: CODE });
    await post('harnesses/connect/test', { draft: paired.json.draft });
    expect((await post('harnesses/connect', { slug: 'gone', name: 'Gone', draft: paired.json.draft, role: false })).status).toBe(201);
    const res = await app.request('/api/harnesses/custom/gone', { method: 'DELETE' });
    expect(await res.json()).toEqual({ deleted: true, revoked: true, secret: 'AGENT_GONE_KEY' });
    expect(pair.revokes).toEqual([{ auth: `Bearer ${runs.token}`, body: { key_id: 'k-gone' } }]);
    expect(existsSync(harnessFile('gone'))).toBe(false);
    expect(await secretValue('AGENT_GONE_KEY')).toBeNull();
  });

  it('drops the pairing record when an edit points the harness at another secret, so Remove neither revokes nor deletes it', async () => {
    pair.answer = { revoke: true, key_id: 'k-edited', shared_key: false };
    const paired = await post('harnesses/connect/pair', { url: runs.url, pair: pair.url, code: CODE });
    await post('harnesses/connect/test', { draft: paired.json.draft });
    expect((await post('harnesses/connect', { slug: 'edited', name: 'Edited', draft: paired.json.draft, role: false })).status).toBe(201);
    expect(readFileSync(harnessFile('edited'), 'utf8')).toMatch(/secret: AGENT_EDITED_KEY\n\s+paired_at/);
    const { setSecret } = await import('../secrets.ts');
    await setSecret('global', 'OTHER_AGENT_KEY', 'a-key-for-something-else');
    const put = await app.request('/api/harnesses/custom/edited', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Edited', url: runs.url, secret: 'OTHER_AGENT_KEY' }),
    });
    expect(put.status).toBe(200);
    expect(readFileSync(harnessFile('edited'), 'utf8')).not.toMatch(/pairing/);
    const res = await app.request('/api/harnesses/custom/edited', { method: 'DELETE' });
    expect(await res.json()).toEqual({ deleted: true, revoked: null, secret: null });
    expect(pair.revokes).toEqual([]);
    expect(await secretValue('OTHER_AGENT_KEY')).toBe('a-key-for-something-else');
  });

  it('ignores a hand-edited pairing record that would revoke on another host or delete another secret', async () => {
    pair.answer = { revoke: true, key_id: 'k-hand', shared_key: false };
    const paired = await post('harnesses/connect/pair', { url: runs.url, pair: pair.url, code: CODE });
    await post('harnesses/connect/test', { draft: paired.json.draft });
    expect((await post('harnesses/connect', { slug: 'hand', name: 'Hand', draft: paired.json.draft, role: false })).status).toBe(201);
    const file = readFileSync(harnessFile('hand'), 'utf8');
    // The same pairing service under another host name: Omni must not send the key there.
    writeFileSync(harnessFile('hand'), file.replace(`at: ${pair.url}`, `at: ${pair.url.replace('127.0.0.1', 'localhost')}`));
    const res = await app.request('/api/harnesses/custom/hand', { method: 'DELETE' });
    expect(await res.json()).toEqual({ deleted: true, revoked: null, secret: null });
    expect(pair.revokes).toEqual([]);
    expect(await secretValue('AGENT_HAND_KEY')).toBe(runs.token);
  });

  it('tests a saved harness from its row with the key on this machine', async () => {
    const r = await post('harnesses/custom/box/test', {});
    expect(r.json).toMatchObject({ ok: true, reply: 'The command printed "hi".' });
  });

  it('names the pairing helper from this Omni\'s own repo, pinned to this build', async () => {
    const r = await app.request('/api/harnesses/connect/helper');
    const { command, ref, repo } = (await r.json()) as { command: string | null; ref: string; repo: string | null };
    expect(ref).toMatch(/^([0-9a-f]{40}|v\d+\.\d+\.\d+)$/);
    const { omniRepo } = await import('../user-config.ts');
    expect(repo).toBe(omniRepo());
    expect(command).toBe(repo ? `curl -fsSL https://raw.githubusercontent.com/${repo}/${ref}/scripts/omni-pair.sh | sh` : null);
  });
});

describe('who may connect an agent', () => {
  it('refuses an agent thread every step, and a remove', async () => {
    H.db.db.prepare('INSERT INTO threads (id, channel_id, title, status, session_id, cwd, source) VALUES (?, ?, ?, ?, ?, ?, ?)').run('agent-thread', 'scratch', 'Thread', 'done', 'agent-thread', H.tmp, 'manual');
    const { mintThreadToken } = await import('../thread-tokens.ts');
    const asThread = { authorization: `Bearer ${mintThreadToken('agent-thread').token}` };
    const named = { 'x-omni-thread': 'agent-thread' };
    for (const headers of [asThread, named]) {
      for (const [path, body] of [
        ['harnesses/connect/find', { url: runs.url }],
        ['harnesses/connect/pair', { url: runs.url, pair: pair.url, code: CODE }],
        ['harnesses/connect/test', { url: runs.url, secret: 'MANUAL_AGENT_KEY' }],
        ['harnesses/connect', { slug: 'sneaky', name: 'Sneaky', url: runs.url, secret: 'MANUAL_AGENT_KEY', role: true }],
        ['harnesses/custom/box/test', {}],
      ] as const) {
        const r = await post(path, body, headers);
        expect(r.status, path).toBe(403);
      }
      const del = await app.request('/api/harnesses/custom/box', { method: 'DELETE', headers });
      expect(del.status).toBe(403);
    }
    expect(pair.redeems).toEqual([]);
    expect(existsSync(harnessFile('box'))).toBe(true);
    expect(existsSync(harnessFile('sneaky'))).toBe(false);
  });
});

describe('an eve agent', () => {
  let eve: FakeEve;
  beforeAll(async () => {
    eve = await startFakeEve('eve-paired-key-0123456789');
  });
  afterAll(async () => {
    await eve.close();
  });
  beforeEach(() => eve.reset());

  it('is found at its own address: what it says it is, its Connect Omni page on its own host, and what a thread on it can do', async () => {
    const f = (await post('harnesses/connect/find', { url: eve.url })).json;
    expect(f).toMatchObject({ kind: 'eve', supported: true, signIn: 'pairing', name: 'Nomos', description: 'An eve agent for tests.', url: eve.url, codeUrl: `${eve.url}/omni` });
    expect(f.problem).toBeUndefined();
    expect(f.can).not.toContain('Steer');
    expect(f.cannot).toEqual(expect.arrayContaining(['Steering', 'Approvals']));
    // A code page on another host is not offered.
    eve.offer = { name: 'Nomos', code_url: 'https://evil.example.com/omni' };
    expect((await post('harnesses/connect/find', { url: eve.url })).json.codeUrl).toBeUndefined();
    // No pairing route: a key from Secrets.
    eve.offer = null;
    expect((await post('harnesses/connect/find', { url: eve.url })).json).toMatchObject({ kind: 'eve', supported: true, signIn: 'key', name: `eve agent on ${new URL(eve.url).host}` });
  });

  it('pairs with the code from its page, tests over eve\'s own API, and connects as a kind: eve harness', async () => {
    const paired = await post('harnesses/connect/pair', { url: eve.url, code: eve.code, name: 'Nomos', kind: 'eve' });
    expect(paired.status).toBe(200);
    expect(paired.json).toMatchObject({ url: eve.url, name: 'Nomos', sharedKey: false, revoke: true });
    expect(paired.text).not.toContain(eve.key);
    const tested = await post('harnesses/connect/test', { draft: paired.json.draft });
    expect(tested.json).toMatchObject({ ok: true, reply: 'You have two reminders.', model: 'deepseek/deepseek-v4-pro', tokens: { input: 40, output: 9 } });
    expect(eve.calls.find((c) => c.path === '/eve/v1/info')?.authorization).toBe(`Bearer ${eve.key}`);
    // The test's own session is retired after.
    expect(eve.calls.some((c) => c.path.endsWith('/reset'))).toBe(true);
    const done = await post('harnesses/connect', { slug: 'nomos', name: 'Nomos', draft: paired.json.draft, role: false });
    expect(done.status).toBe(201);
    expect(done.json.harness).toMatchObject({ id: 'custom:nomos', kind: 'eve', url: eve.url, secret: 'AGENT_NOMOS_KEY', pairing: { keyId: 'omni-k1', revoke: true } });
    expect(done.json.harness.catalog).toMatchObject({ available: true, capabilities: { steer: false } });
    expect(readFileSync(harnessFile('nomos'), 'utf8')).toMatch(/kind: eve/);
    expect(await secretValue('AGENT_NOMOS_KEY')).toBe(eve.key);
    // Remove revokes the key at the agent.
    const gone = await app.request('/api/harnesses/custom/nomos', { method: 'DELETE' });
    expect((await gone.json()) as unknown).toMatchObject({ revoked: true, secret: 'AGENT_NOMOS_KEY' });
  });

  it('says how to get past Vercel\'s login wall instead of calling it unreachable', async () => {
    const server = createServer((req, res) => {
      res.writeHead(302, { location: `https://vercel.com/sso-api?url=${encodeURIComponent(`https://x.vercel.app${req.url}`)}` });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const at = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      expect((await post('harnesses/connect/find', { url: at })).json.problem).toMatch(/Vercel's login wall.*Deployment Protection/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
