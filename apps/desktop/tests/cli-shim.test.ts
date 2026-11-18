import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { proofFor } from '../src/backend/launch.ts';
import { installCommandLine, legacyLauncher, NATIVE_CLI, nativeCommand, ownsUserCommand, planShim, shimText, type ShimFacts } from '../src/cli-shim.ts';

const tmp = mkdtempSync(join(tmpdir(), 'omni-cli-shim-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Stands in for the Rust binary: prints the facts it was started with and every argument. */
const program = (name: string, body: string) => {
  const path = join(tmp, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return path;
};
const says = 'echo "port=$OMNI_INSTALL_PORT app=$OMNI_APP data=$OMNI_INSTALL_DATA_DIR"; for a in "$@"; do echo "[$a]"; done';
const BINARY = program('omni-binary', says);

const facts: ShimFacts = { app: "/Users/me/Apps/Omni's.app/Contents/MacOS/Omni", dataDir: '/Users/me/Library/Application Support/Omni/data', logFile: '/Users/me/Library/Logs/Omni/server.log', port: 4747, binary: BINARY };

/** The control script ~/.local/bin/omni held on omarchy for the old Linux service, as it began. */
const DEAD_LAUNCHER = '#!/usr/bin/env bash\n# Control the live Omni install (systemd user service omni-os.service, checkout ~/omni-os).\nset -euo pipefail\n\nSERVICE=omni-os\nLAUNCHER="$REPO/scripts/omni-linux.sh"\n';

describe('the omni shim', () => {
  it('names the install it was written for, quoting paths with spaces and quotes', () => {
    const text = shimText({ ...facts, binary: "/Users/me/Library/Application Support/Omni's/native/omni" });
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).toContain('# omni-cli-shim 3');
    expect(text).toContain(`export OMNI_APP='/Users/me/Apps/Omni'\\''s.app/Contents/MacOS/Omni'`);
    expect(text).toContain(`export OMNI_INSTALL_DATA_DIR='/Users/me/Library/Application Support/Omni/data'`);
    expect(text).toContain('export OMNI_INSTALL_PORT=4747');
    expect(text).toContain(`omni_bin='/Users/me/Library/Application Support/Omni'\\''s/native/omni'`);
    expect(text).not.toContain('ELECTRON_RUN_AS_NODE');
  });

  it('starts the binary with every argument as given and the facts of the install', () => {
    const shim = program('omni-run', '');
    writeFileSync(shim, shimText(facts), { mode: 0o755 });
    const out = execFileSync(shim, ['send', 'parent', "it's $HOME and \"quoted\""], { encoding: 'utf8' });
    expect(out.split('\n')).toEqual([`port=4747 app=${facts.app} data=${facts.dataDir}`, '[send]', '[parent]', `[it's $HOME and "quoted"]`, '']);
  });

  it('says how to fix it when the binary it names is gone', () => {
    const shim = program('omni-gone', '');
    writeFileSync(shim, shimText({ ...facts, binary: join(tmp, 'no-such-binary') }), { mode: 0o755 });
    const r = spawnSync(shim, ['status'], { encoding: 'utf8' });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('is gone. Open the Omni app once');
  });
});

describe('the binary the shim starts', () => {
  it('is the one the app carries, when it prints its version', () => {
    const appRoot = join(tmp, 'app-root');
    const shipped = join(appRoot, ...NATIVE_CLI);
    expect(nativeCommand({ appRoot, copyTo: null })).toEqual({ path: null, reason: `${shipped} is not there: this app was built without it (--native off)` });
    mkdirSync(join(shipped, '..'), { recursive: true });
    writeFileSync(shipped, '#!/bin/sh\necho "omni 1.2.3"\n', { mode: 0o755 });
    expect(nativeCommand({ appRoot, copyTo: null })).toEqual({ path: shipped, version: '1.2.3' });
    writeFileSync(shipped, '#!/bin/sh\nexit 3\n', { mode: 0o755 });
    expect(nativeCommand({ appRoot, copyTo: null })).toEqual({ path: null, reason: `${shipped} did not start (--version exited with 3)` });
    writeFileSync(shipped, '#!/bin/sh\necho "something else"\n', { mode: 0o755 });
    expect(nativeCommand({ appRoot, copyTo: null })).toEqual({ path: null, reason: `${shipped} did not start (something else)` });
    writeFileSync(shipped, 'not a program', { mode: 0o755 });
    expect(nativeCommand({ appRoot, copyTo: null })).toMatchObject({ path: null, reason: expect.stringContaining('did not start') });
  });

  it("is copied out of an AppImage's mount, and replaced only by another build", () => {
    const appRoot = join(tmp, 'mounted-root');
    const shipped = join(appRoot, ...NATIVE_CLI);
    mkdirSync(join(shipped, '..'), { recursive: true });
    writeFileSync(shipped, '#!/bin/sh\necho "omni 1.2.3"\n', { mode: 0o644 });
    const copyTo = join(tmp, 'userData', 'native', 'omni');
    expect(nativeCommand({ appRoot, copyTo })).toEqual({ path: copyTo, version: '1.2.3' });
    expect(statSync(copyTo).mode & 0o111).toBe(0o111);
    const first = statSync(copyTo).ino;
    expect(nativeCommand({ appRoot, copyTo })).toEqual({ path: copyTo, version: '1.2.3' });
    expect(statSync(copyTo).ino).toBe(first);
    writeFileSync(shipped, '#!/bin/sh\necho "omni 1.2.4"\n');
    expect(nativeCommand({ appRoot, copyTo })).toEqual({ path: copyTo, version: '1.2.4' });
    expect(statSync(copyTo).ino).not.toBe(first);
  });
});

describe('what the app does with a file already called omni', () => {
  const text = shimText(facts);
  it('writes where there is nothing, keeps its own, and replaces an older one of its own', () => {
    expect(planShim({ kind: 'none' }, text)).toEqual({ action: 'write' });
    expect(planShim({ kind: 'file', text }, text)).toEqual({ action: 'keep' });
    expect(planShim({ kind: 'file', text: shimText({ ...facts, port: 4800 }) }, text)).toEqual({ action: 'write' });
  });

  it("replaces Omni's own older launchers: the dead Linux control script and scripts/omni.sh", () => {
    expect(legacyLauncher(DEAD_LAUNCHER)).toBe(true);
    expect(planShim({ kind: 'file', text: DEAD_LAUNCHER }, text)).toEqual({ action: 'write' });
    expect(planShim({ kind: 'file', text: '#!/usr/bin/env bash\n# Quick capture into Omni OS from any terminal.\n' }, text)).toEqual({ action: 'write' });
    expect(planShim({ kind: 'link', target: '/Users/me/omni-os/scripts/omni.sh', dangling: false }, text)).toEqual({ action: 'write' });
    expect(planShim({ kind: 'link', target: '/gone', dangling: true }, text)).toEqual({ action: 'write' });
  });

  it('leaves anything else alone and says why', () => {
    expect(planShim({ kind: 'file', text: '#!/bin/sh\necho another omni\n' }, text)).toMatchObject({ action: 'skip' });
    expect(planShim({ kind: 'link', target: '/opt/omni/bin/omni', dangling: false }, text)).toEqual({ action: 'skip', reason: 'it links to /opt/omni/bin/omni' });
    expect(planShim({ kind: 'other' }, text)).toMatchObject({ action: 'skip' });
  });

  it('writes both copies, replaces a link instead of writing through it, and skips a foreign file', () => {
    const home = join(tmp, 'home');
    const binDir = join(home, 'userData', 'bin');
    const userPath = join(home, '.local', 'bin', 'omni');
    const first = installCommandLine({ facts, binDir, userPath });
    expect(first.map((r) => r.result)).toEqual(['written', 'written']);
    expect(readFileSync(userPath, 'utf8')).toBe(shimText(facts));
    expect(installCommandLine({ facts, binDir, userPath }).map((r) => r.result)).toEqual(['kept', 'kept']);

    const checkout = join(tmp, 'checkout', 'scripts');
    mkdirSync(checkout, { recursive: true });
    writeFileSync(join(checkout, 'omni.sh'), 'old script\n');
    rmSync(userPath);
    symlinkSync(join(checkout, 'omni.sh'), userPath);
    expect(installCommandLine({ facts, binDir: join(home, 'b2'), userPath })[1].result).toBe('written');
    expect(readFileSync(join(checkout, 'omni.sh'), 'utf8')).toBe('old script\n');

    writeFileSync(userPath, '#!/bin/sh\necho mine\n');
    const skipped = installCommandLine({ facts, binDir: join(home, 'b3'), userPath });
    expect(skipped[0].result).toBe('written');
    expect(skipped[1]).toEqual({ path: userPath, result: 'skipped', reason: 'another program named omni is there' });
    expect(readFileSync(userPath, 'utf8')).toBe('#!/bin/sh\necho mine\n');
  });

  it('removes its own shims, and nothing else, when the app has no binary', () => {
    const home = join(tmp, 'home-without');
    const binDir = join(home, 'userData', 'bin');
    const userPath = join(home, '.local', 'bin', 'omni');
    installCommandLine({ facts, binDir, userPath });
    expect(installCommandLine({ facts: { ...facts, binary: null }, binDir, userPath })).toEqual([
      { path: join(binDir, 'omni'), result: 'removed' },
      { path: userPath, result: 'removed' },
    ]);
    expect(existsSync(userPath)).toBe(false);
    writeFileSync(userPath, '#!/bin/sh\necho mine\n');
    expect(installCommandLine({ facts: { ...facts, binary: null }, binDir, userPath })).toEqual([]);
    expect(readFileSync(userPath, 'utf8')).toBe('#!/bin/sh\necho mine\n');
  });
});

describe('which launch claims ~/.local/bin/omni', () => {
  const installed = { packaged: true, dev: false, customDataDir: false, defaultPort: true, customUserData: false, app: '/Applications/Omni.app/Contents/MacOS/Omni' };
  it('the installed app, run from where it lives', () => {
    expect(ownsUserCommand(installed)).toBe(true);
    expect(ownsUserCommand({ ...installed, app: '/home/me/Applications/Omni.AppImage' })).toBe(true);
  });
  it('never a dev, QA or --data-dir launch, nor an app run from its disk image or a quarantine copy', () => {
    for (const change of [{ packaged: false }, { dev: true }, { customDataDir: true }, { defaultPort: false }, { customUserData: true }]) {
      expect(ownsUserCommand({ ...installed, ...change })).toBe(false);
    }
    expect(ownsUserCommand({ ...installed, app: '/Volumes/Omni/Omni.app/Contents/MacOS/Omni' })).toBe(false);
    expect(ownsUserCommand({ ...installed, app: '/private/var/folders/x/AppTranslocation/y/d/Omni.app/Contents/MacOS/Omni' })).toBe(false);
    expect(ownsUserCommand({ ...installed, app: '/tmp/.mount_OmniAbc/omni-os' })).toBe(false);
  });
});

// The real command behind the real shim: the shim always names this install's data folder, so the command must keep
// that folder's token to a server on this machine that proves it holds it (crates/omni-cli/src/connection.rs). Needs
// cargo, as the server's tests do; a machine without it skips.
const ROOT = resolve(import.meta.dirname, '../../..');
const cargo = spawnSync('cargo', ['--version'], { cwd: ROOT, stdio: 'ignore' });

describe.skipIf(!!cargo.error || cargo.status !== 0)('the command the shim starts, with only this install token', () => {
  const INSTALL_TOKEN = 'install-token-0123456789abcdef0123456789abcdef';
  const dir = join(tmp, 'install');
  const seen: { method: string; url: string; authorization: string | null }[] = [];
  let answersProof = false;
  let server: Server;
  let port = 0;
  let shim = '';

  beforeAll(async () => {
    const built = spawnSync('cargo', ['build', '--locked', '--quiet', '-p', 'omni-cli', '--target-dir', join(ROOT, 'target')], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    if (built.status !== 0) throw new Error(`cargo build -p omni-cli exited with ${built.status ?? built.signal}`);
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'api-token'), INSTALL_TOKEN, { mode: 0o600 });
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      seen.push({ method: req.method ?? '', url: url.pathname, authorization: req.headers.authorization ?? null });
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/auth/proof') {
        if (!answersProof) return void res.writeHead(404).end('{}');
        return void res.end(JSON.stringify({ proof: proofFor(INSTALL_TOKEN, port, url.searchParams.get('nonce') ?? '') }));
      }
      res.end('[]');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
    port = (server.address() as AddressInfo).port;
    shim = join(dir, 'omni');
    // The install's own port is one nothing holds: OMNI_URL names the server.
    writeFileSync(shim, shimText({ ...facts, dataDir: join(dir, 'data'), port: 9, binary: join(ROOT, 'target', 'debug', 'omni') }), { mode: 0o755 });
  }, 600_000);
  afterAll(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  /** The shim in a terminal with nothing of this machine's Omni set but OMNI_URL. */
  const run = (url: string, args: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
      execFile(shim, args, { env: { PATH: '/usr/bin:/bin', HOME: dir, OMNI_URL: url }, encoding: 'utf8' }, (err, stdout, stderr) =>
        done({ code: err ? Number((err as { code?: unknown }).code ?? 1) : 0, stdout, stderr }),
      );
    });

  it('sends neither the token nor the prompt to a loopback OMNI_URL that cannot prove it is this install', async () => {
    seen.length = 0;
    answersProof = false;
    const r = await run(`http://127.0.0.1:${port}`, ['new', 'a secret prompt']);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('The token was not sent');
    expect(seen).toEqual([{ method: 'GET', url: '/api/auth/proof', authorization: null }]);
  });

  it('refuses another machine before it sends anything, and says which token to set', async () => {
    seen.length = 0;
    const r = await run('https://omni.example.test', ['new', 'a secret prompt']);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("https://omni.example.test is another machine. The only token here is this machine's own");
    expect(r.stderr).toContain('Put that machine\'s token in OMNI_TOKEN or OMNI_TOKEN_FILE.');
    expect(seen).toEqual([]);
  });

  it('still reaches this install on a loopback OMNI_URL once it proves itself', async () => {
    seen.length = 0;
    answersProof = true;
    const r = await run(`http://localhost:${port}/`, ['threads']);
    expect(r).toEqual({ code: 0, stdout: 'No threads.\n', stderr: '' });
    expect(seen).toEqual([
      { method: 'GET', url: '/api/auth/proof', authorization: null },
      { method: 'GET', url: '/api/threads', authorization: `Bearer ${INSTALL_TOKEN}` },
    ]);
  });
});
