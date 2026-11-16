import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BOOT, CLI_SCRIPT, installCommandLine, legacyLauncher, NATIVE_CLI, nativeCommand, ownsUserCommand, planShim, shimText, type ShimFacts } from '../src/cli-shim.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'omni-cli-shim-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const facts: ShimFacts = { app: "/Users/me/Apps/Omni's.app/Contents/MacOS/Omni", dataDir: '/Users/me/Library/Application Support/Omni/data', logFile: '/Users/me/Library/Logs/Omni/server.log', port: 4747 };

/** The control script ~/.local/bin/omni held on omarchy for the old Linux service, as it began. */
const DEAD_LAUNCHER = '#!/usr/bin/env bash\n# Control the live Omni install (systemd user service omni-os.service, checkout ~/omni-os).\nset -euo pipefail\n\nSERVICE=omni-os\nLAUNCHER="$REPO/scripts/omni-linux.sh"\n';

describe('the omni shim', () => {
  it('names the install it was written for, quoting paths with spaces and quotes', () => {
    const text = shimText(facts);
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).toContain('# omni-cli-shim 2');
    expect(text).not.toContain('omni_native');
    expect(text).toContain(`export OMNI_APP='/Users/me/Apps/Omni'\\''s.app/Contents/MacOS/Omni'`);
    expect(text).toContain(`export OMNI_INSTALL_DATA_DIR='/Users/me/Library/Application Support/Omni/data'`);
    expect(text).toContain('export OMNI_INSTALL_PORT=4747');
    expect(text).toContain(`ELECTRON_RUN_AS_NODE=1 exec "$OMNI_APP" -e '${BOOT}' -- "$@"`);
  });

  it('runs the app as Node with the boot code and every argument as given', () => {
    const app = join(tmp, 'fake-app');
    // Stands in for the Electron binary: prints what it was started with.
    writeFileSync(app, `#!/bin/sh\necho "node=$ELECTRON_RUN_AS_NODE data=$OMNI_INSTALL_DATA_DIR"\nfor a in "$@"; do echo "[$a]"; done\n`, { mode: 0o755 });
    const shim = join(tmp, 'omni-run');
    writeFileSync(shim, shimText({ ...facts, app }), { mode: 0o755 });
    const out = execFileSync(shim, ['send', 'parent', "it's $HOME and \"quoted\""], { encoding: 'utf8' });
    expect(out.split('\n')).toEqual([`node=1 data=${facts.dataDir}`, '[-e]', `[${BOOT}]`, '[--]', '[send]', '[parent]', `[it's $HOME and "quoted"]`, '']);
  });

  it('says how to fix it when the app it names is gone', () => {
    const shim = join(tmp, 'omni-gone');
    writeFileSync(shim, shimText({ ...facts, app: join(tmp, 'no-such-app') }), { mode: 0o755 });
    const r = spawnSync(shim, ['status'], { encoding: 'utf8' });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('is gone. Open the Omni app once');
  });

  it("boots the bundled CLI from the app's resources and hands it the arguments", () => {
    // The staged layout: <resources>/omni/apps/cli/omni.mjs, built the way scripts/stage.ts builds it.
    const resources = join(tmp, 'resources');
    execFileSync(join(REPO, 'node_modules/.bin/tsx'), [join(REPO, 'apps/cli/scripts/bundle.ts'), join(resources, 'omni'), '1.2.3'], { cwd: REPO, stdio: 'ignore' });
    expect(existsSync(join(resources, ...CLI_SCRIPT))).toBe(true);
    // Electron sets process.resourcesPath in Node mode; a preload stands in for it on plain Node.
    const preload = join(tmp, 'resources-path.mjs');
    writeFileSync(preload, `process.resourcesPath = ${JSON.stringify(resources)};\n`);
    const r = spawnSync(process.execPath, ['--import', preload, '-e', BOOT, '--', '--version'], { encoding: 'utf8' });
    expect(r.stdout).toBe('omni 1.2.3\n');
    expect(r.status).toBe(0);
    const bad = spawnSync(process.execPath, ['--import', preload, '-e', BOOT, '--', 'nonsense'], { encoding: 'utf8' });
    expect(bad.status).toBe(64);
  }, 60_000);
});

describe('the Rust build of the command', () => {
  /** Stands in for the Electron binary and for the Rust one: each prints who it is and what it was started with. */
  const program = (name: string, body: string) => {
    const path = join(tmp, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return path;
  };
  const app = program('fake-electron', 'echo "the app as node"');
  const says = 'echo "native port=$OMNI_INSTALL_PORT app=$OMNI_APP"; for a in "$@"; do echo "[$a]"; done';

  it('is started by the shim with every argument and the facts of the install', () => {
    const native = program("omni's native", says);
    const shim = program('omni-native-run', '');
    writeFileSync(shim, shimText({ ...facts, app, native }), { mode: 0o755 });
    const out = execFileSync(shim, ['send', 'parent', "it's $HOME"], { encoding: 'utf8' });
    expect(out.split('\n')).toEqual([`native port=4747 app=${app}`, '[send]', '[parent]', "[it's $HOME]", '']);
  });

  it('gives way to the bundled CLI when the binary is gone, or when the call says OMNI_NATIVE_CLI=0', () => {
    const native = program('omni-native-there', says);
    const shim = program('omni-native-fallback', '');
    writeFileSync(shim, shimText({ ...facts, app, native }), { mode: 0o755 });
    expect(execFileSync(shim, ['status'], { encoding: 'utf8' })).toContain('native port=4747');
    expect(execFileSync(shim, ['status'], { encoding: 'utf8', env: { ...process.env, OMNI_NATIVE_CLI: '0' } })).toBe('the app as node\n');
    rmSync(native);
    expect(execFileSync(shim, ['status'], { encoding: 'utf8' })).toBe('the app as node\n');
  });

  it('is used only when the app carries it and it prints its version', () => {
    const appRoot = join(tmp, 'app-root');
    expect(nativeCommand({ appRoot, copyTo: null })).toEqual({ path: null, reason: null });
    const shipped = join(appRoot, ...NATIVE_CLI);
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
