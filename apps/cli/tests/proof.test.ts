// The token goes only to a server on the install's port that proved it holds it (src/connection.ts client()).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OmniHttpError } from '@omni/client-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, PROOF_FRESH_MS } from '../src/connection.ts';
import { CliError } from '../src/io.ts';
import { run } from '../src/main.ts';
import { nodeIo } from '../src/node-io.ts';
import { BASE, TOKEN, detail, fake, needsYouFor, wire } from './helpers.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const SECRET = 'install-token-that-must-stay-home';

/** Something else on the install's port: it answers the proof wrongly and would take anything sent to it. */
describe('an impostor on the install port', () => {
  let server: Server;
  let port: number;
  let home: string;
  const seen: { method: string; url: string; auth: string | undefined; body: string }[] = [];

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'omni-cli-proof-'));
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, body });
        res.setHeader('content-type', 'application/json');
        res.end(req.url?.startsWith('/api/auth/proof') ? '{"proof":"deadbeef"}' : '{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  });

  /** The real Io on the real network, as the shim runs it: the install's port and token, nothing from a thread. */
  async function omni(...argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const io = {
      ...nodeIo(),
      env: { OMNI_INSTALL_PORT: String(port), OMNI_TOKEN: SECRET, HOME: home, TMPDIR: home, PATH: process.env.PATH },
      cwd: home,
      out: (t: string) => void out.push(t),
      err: (t: string) => void err.push(t),
      stdin: async () => null,
      run: async () => ({ code: null, stdout: '', stderr: '', missing: true }),
      launch: async () => true,
    };
    const code = await run(argv, io);
    return { code, out: out.join(''), err: err.join('') };
  }

  it.each([
    ['new', ['new', 'the secret plan', '-c', 'acme']],
    ['new --wait', ['new', 'the secret plan', '--wait']],
    ['send', ['send', ID, 'the secret plan']],
    ['send --wait', ['send', ID, 'the secret plan', '--wait']],
    ['threads', ['threads']],
    ['threads --needs-you', ['threads', '--needs-you']],
    ['show', ['show', ID]],
    ['status', ['status']],
    ['status --machine', ['status', '--machine', 'here']],
    ['open', ['open', 'acme']],
  ])('%s refuses it and sends neither the token nor the prompt', async (_name, argv) => {
    seen.length = 0;
    const r = await omni(...argv);
    expect(r.code).toBe(3);
    expect(r.err).toContain(`http://127.0.0.1:${port} answers as Omni, but not as this install's`);
    expect(r.err).toContain('The token was not sent');
    expect(seen.map((s) => s.url.replace(/nonce=\w+/, 'nonce=N'))).toEqual(['/api/auth/proof?nonce=N']);
    expect(seen.every((s) => s.auth === undefined && s.body === '')).toBe(true);
  });

  it('doctor says so, and keeps the token too', async () => {
    seen.length = 0;
    const r = await omni('doctor');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL\s+server\s+.*answers as Omni, but not with this token/);
    expect(seen.length).toBe(1);
    expect(seen[0].auth).toBeUndefined();
  });
});

describe('the proof before the token', () => {
  it('is asked once for requests made together, without the token, and every request then carries it', async () => {
    const f = fake({
      routes: [
        { method: 'GET', path: '/api/status', reply: { json: wire('status.json') } },
        { method: 'GET', path: '/api/needs-you', reply: { json: wire('needs-you.json') } },
        { method: 'GET', path: '/api/sync/status', reply: { json: wire('sync-status.json') } },
        { method: 'GET', path: '/api/update/fleet', reply: { json: wire('update-fleet.json') } },
      ],
    });
    expect(await f.run('status')).toBe(0);
    expect(f.probes).toHaveLength(1);
    expect(f.probes[0].auth).toBeUndefined();
    expect(f.sent.length).toBeGreaterThan(1);
    expect(f.sent.every((s) => s.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('is not asked of a server OMNI_URL names: a thread’s own server, or another machine', async () => {
    const f = fake({ env: { OMNI_URL: BASE }, proof: 'wrong', routes: [{ method: 'GET', path: '/api/threads?limit=20', reply: { json: wire('threads.json') } }] });
    expect(await f.run('threads')).toBe(0);
    expect(f.probes).toEqual([]);
  });

  it('reads an empty port as Omni not running, and sends nothing', async () => {
    const f = fake({ proof: 'refused', routes: [{ method: 'POST', path: '/api/threads', reply: { json: wire('thread-created.json') } }] });
    expect(await f.run('new', 'hi')).toBe(3);
    expect(f.err()).toContain(`cannot reach Omni at ${BASE} (connection refused)`);
    expect(f.sent).toEqual([]);
  });

  it('is asked again on every poll of a --wait, not only once', async () => {
    const running = detail('thread.json');
    const done = detail('thread-open.json', { id: ID });
    const f = fake({
      routes: [
        { method: 'POST', path: '/api/threads', reply: { json: wire('thread-created.json') } },
        { method: 'GET', path: `/api/threads/${ID}?history=recent`, reply: [running, running, done].map((json) => ({ json })) },
        { method: 'GET', path: `/api/needs-you?thread=${ID}`, reply: [needsYouFor(ID, null), needsYouFor(ID, null), needsYouFor(ID, '001')].map((json) => ({ json })) },
      ],
    });
    expect(await f.run('new', 'fix the cart', '--wait')).toBe(0);
    expect(f.slept.length).toBe(2);
    // One for the start and the first poll together, then one per poll after each sleep.
    expect(f.probes).toHaveLength(f.slept.length + 1);
  });

  it('is asked again once it is older than a moment, so a server replaced between polls gets nothing', async () => {
    const f = fake({ routes: [{ method: 'GET', path: '/api/status', reply: { json: wire('status.json') } }] });
    const c = client(f.io);
    await c.api.status();
    await c.api.status();
    expect(f.probes).toHaveLength(1);
    // The real server stops and something else takes the port while the command sleeps; no request failed meanwhile.
    await f.io.sleep(PROOF_FRESH_MS);
    f.setProof('wrong');
    await expect(c.api.status()).rejects.toBeInstanceOf(CliError);
    expect(f.probes).toHaveLength(2);
    expect(f.sent).toHaveLength(2);
  });

  it('is asked again after the server goes away, so what takes the port during a restart gets nothing', async () => {
    const f = fake({ routes: [{ method: 'GET', path: '/api/status', reply: [{ json: wire('status.json') }, { refused: true }, { json: wire('status.json') }] }] });
    const c = client(f.io);
    await c.api.status();
    await expect(c.api.status()).rejects.toBeInstanceOf(OmniHttpError);
    expect(f.probes).toHaveLength(1);
    f.setProof('wrong');
    await expect(c.api.status()).rejects.toBeInstanceOf(CliError);
    expect(f.probes).toHaveLength(2);
    expect(f.sent).toHaveLength(2);
    f.setProof('mine');
    await c.api.status();
    expect(f.probes).toHaveLength(3);
    expect(f.sent).toHaveLength(3);
  });
});
