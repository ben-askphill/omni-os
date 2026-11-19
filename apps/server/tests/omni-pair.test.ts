// scripts/omni-pair.sh, the Hermes pairing helper (docs/internals/remote-harness-protocol.md, Pairing). Each test runs
// the real script the way `curl ... | sh` does, with the script on stdin, against a throwaway Hermes home. It needs
// python3, as Hermes does; without it the file skips.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(import.meta.dirname, '../../../scripts/omni-pair.sh');
const hasPython = spawnSync('python3', ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)']).status === 0;

interface Started {
  child: ChildProcess;
  info: { link: string; code: string; url: string; pair: string; name: string; expires_at: number };
  stderr: () => string;
  exit: Promise<number | null>;
}

const homes: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function home(env?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'omni-pair-'));
  homes.push(dir);
  if (env !== undefined) writeFileSync(join(dir, '.env'), env, { mode: 0o600 });
  return dir;
}

/** The helper on a free port on 127.0.0.1, its first JSON line read. */
function start(hermesHome: string, extra: string[] = []): Promise<Started> {
  const child = spawn('sh', ['-s', '--', '--hermes-home', hermesHome, '--url', 'http://127.0.0.1:8642', '--port', '0', '--json', '--name', 'Hermes on test', ...extra], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '', HOME: hermesHome },
  });
  children.push(child);
  child.stdin!.end(readFileSync(SCRIPT));
  let err = '';
  child.stderr!.on('data', (d) => (err += d));
  const exit = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
  return new Promise((ok, fail) => {
    let out = '';
    child.stdout!.on('data', (d) => {
      out += d;
      const line = out.split('\n')[0];
      if (out.includes('\n')) ok({ child, info: JSON.parse(line), stderr: () => err, exit });
    });
    void exit.then((code) => fail(new Error(`omni-pair exited ${code} before printing: ${err}`)));
  });
}

const pair = (url: string, body: unknown) =>
  fetch(`${url}/v1/omni/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe.skipIf(!hasPython)('omni-pair.sh', () => {
  it('prints a pairing link and hands the key over once, for the right code typed any way', async () => {
    const h = home('API_SERVER_ENABLED=true\nAPI_SERVER_KEY="hermes-test-key"\n');
    const s = await start(h);
    expect(s.info.code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/);
    const link = new URL(s.info.link);
    expect(link.protocol).toBe('omni:');
    expect(link.host).toBe('connect-agent');
    expect(link.searchParams.get('url')).toBe('http://127.0.0.1:8642');
    expect(link.searchParams.get('pair')).toBe(s.info.pair);
    expect(link.searchParams.get('code')).toBe(s.info.code);

    expect((await pair(s.info.pair, { code: 'not-the-code' })).status).toBe(404);
    const typed = s.info.code.toLowerCase().replaceAll('-', ' ');
    const res = await pair(s.info.pair, { code: typed, client_id: 'm1', client_name: 'Omni on test-mac' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      protocol: 1,
      kind: 'runs-api',
      name: 'Hermes on test',
      url: 'http://127.0.0.1:8642',
      key: 'hermes-test-key',
      key_id: 'api-server-key',
      shared_key: true,
      revoke: false,
    });
    expect(await s.exit).toBe(0);
    expect(s.stderr()).toContain('Paired with Omni on test-mac');
    // It exits after one redeem, so the code cannot be spent again.
    await expect(pair(s.info.pair, { code: s.info.code })).rejects.toThrow();
  });

  it('makes API_SERVER_KEY when the .env has none, owner-only, and says to restart Hermes', async () => {
    const h = home();
    const s = await start(h);
    const env = readFileSync(join(h, '.env'), 'utf8');
    const key = /^API_SERVER_KEY=(.+)$/m.exec(env)?.[1];
    expect(key && key.length).toBeGreaterThanOrEqual(40);
    expect(env).toMatch(/^API_SERVER_ENABLED=true$/m);
    expect(statSync(join(h, '.env')).mode & 0o777).toBe(0o600);
    expect(s.stderr()).toContain('hermes gateway restart');
    const res = await pair(s.info.pair, { code: s.info.code });
    expect((await res.json()).key).toBe(key);
  });

  it('refuses to pair while the API server is off', async () => {
    const h = home('API_SERVER_KEY=k\n');
    const child = spawnSync('sh', ['-s', '--', '--hermes-home', h, '--json', '--port', '0'], { input: readFileSync(SCRIPT), env: { PATH: process.env.PATH ?? '', HOME: h } });
    expect(child.status).toBe(1);
    expect(String(child.stderr)).toContain('API_SERVER_ENABLED=true');
  });

  it('stops answering an address after ten wrong codes', async () => {
    const s = await start(home('API_SERVER_ENABLED=true\nAPI_SERVER_KEY=k\n'));
    for (let i = 0; i < 10; i++) expect((await pair(s.info.pair, { code: `wrong-${i}` })).status).toBe(404);
    const res = await pair(s.info.pair, { code: s.info.code });
    expect(res.status).toBe(429);
  });

  it('closes when the code expires', async () => {
    const s = await start(home('API_SERVER_ENABLED=true\nAPI_SERVER_KEY=k\n'), ['--ttl', '1']);
    expect(await s.exit).toBe(2);
    expect(s.stderr()).toContain('The code expired');
  });
});
