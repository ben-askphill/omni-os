import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The QA scripts keep PID files, logs, the API token and the bin/ that goes first on the server's PATH in one state
// dir. Each must refuse a dir that is a link, belongs to another user or that others can write, before reading it.
const ROOT = resolve(import.meta.dirname, '../../..');
const STACK = join(ROOT, 'scripts/qa-stack.sh');
const HANDOFF = join(ROOT, 'scripts/qa-handoff-stack.sh');
const SEED = join(ROOT, 'scripts/qa-seed-ios-thread.mjs');

const dirs: string[] = [];
const pids: number[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-qa-dir-test-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const pid of pids.splice(0)) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A live process that is not this checkout's, for a planted PID file to name. */
function stranger() {
  const p = spawn('sleep', ['60'], { cwd: scratch(), detached: true, stdio: 'ignore' });
  pids.push(p.pid!);
  return p.pid!;
}

/**
 * A `node` first on PATH that stands in for another user winning a race: right after the scripts' first state dir
 * check returns, it makes `dir` writable by anyone, with a PID file naming a live process and a token (for qa-stack.sh
 * and for server A of the handoff rig). It runs only the check and `node -e`, so a script that got past the check
 * could start nothing.
 */
function racingNode(dir: string) {
  const bin = join(scratch(), 'bin');
  mkdirSync(bin);
  const marker = join(scratch(), 'planted');
  const real = process.execPath;
  writeFileSync(
    join(bin, 'node'),
    `#!/bin/sh
case "$1" in
  *qa-private-dir.mjs)
    "${real}" "$@"; rc=$?
    if [ ! -e "${marker}" ]; then
      : >"${marker}"
      mkdir -m 777 "${dir}" && mkdir -p "${dir}/data" "${dir}/a/data" && echo ${stranger()} >"${dir}/server.pid" &&
        echo PLANTED-TOKEN >"${dir}/data/api-token" && echo PLANTED-TOKEN >"${dir}/a/data/api-token"
    fi
    exit $rc ;;
  -e) exec "${real}" "$@" ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  return `${bin}:${process.env.PATH}`;
}

function run(cmd: string, args: string[], env: Record<string, string>) {
  const { QA_SERVER_PORT: _p, QA_DIR: _d, QA_HANDOFF_DIR: _h, ...base } = process.env;
  return spawnSync(cmd, args, { cwd: ROOT, env: { ...base, ...env }, encoding: 'utf8', timeout: 20_000 });
}

/** A state dir that looks like a stack's, with a PID file in it. */
function stateDir(mode = 0o700) {
  const dir = join(scratch(), 'state');
  mkdirSync(dir, { mode: 0o700 });
  writeFileSync(join(dir, 'server.pid'), '999999');
  chmodSync(dir, mode);
  return dir;
}

/** A link at the state dir's path, to a dir this user owns. */
function linkedDir() {
  const target = stateDir();
  const link = join(scratch(), 'link');
  symlinkSync(target, link);
  return { link, target };
}

const rootOwnsSlash = statSync('/').uid !== process.getuid!();

describe('qa-stack.sh state dir', () => {
  it('refuses a state dir that is a symlink', () => {
    const { link } = linkedDir();
    const r = run('bash', [STACK, 'status'], { QA_DIR: link });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/symlink/);
  });

  it('refuses to take down a stack through a symlink, and leaves its files', () => {
    const { link, target } = linkedDir();
    const r = run('bash', [STACK, 'down'], { QA_SERVER_PORT: '4999', QA_DIR: link });
    expect(r.status).toBe(1);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(target, 'server.pid'))).toBe(true);
  });

  it('refuses a state dir that group or others can write', () => {
    const r = run('bash', [STACK, 'status'], { QA_DIR: stateDir(0o777) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/others can write/);
  });

  it.skipIf(!rootOwnsSlash)('refuses a state dir another user owns', () => {
    const r = run('bash', [STACK, 'status'], { QA_DIR: '/' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/owned by uid 0/);
  });

  it('closes a state dir of its own that others can read, and goes on', () => {
    const dir = stateDir(0o755);
    const r = run('bash', [STACK, 'status'], { QA_DIR: dir });
    expect(r.status).toBe(0);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('a missing state dir is not made by status', () => {
    const dir = join(scratch(), 'missing');
    const r = run('bash', [STACK, 'status'], { QA_DIR: dir });
    expect(r.status).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });

  it('reads nothing from a state dir that appears after the check found none', () => {
    const dir = join(scratch(), 'raced');
    const r = run('bash', [STACK, 'status'], { QA_DIR: dir, QA_NO_WEB: '1', PATH: racingNode(dir) });
    expect(existsSync(join(dir, 'server.pid'))).toBe(true);
    expect(r.stdout).not.toMatch(/PLANTED-TOKEN/);
    expect(r.stdout).not.toMatch(/server .* up/);
  });

  it('up makes and checks the state dir before it reads a PID file there', () => {
    const dir = join(scratch(), 'raced');
    const r = run('bash', [STACK, 'up', '--seed', '0'], { QA_DIR: dir, QA_SERVER_PORT: '4999', QA_NO_WEB: '1', PATH: racingNode(dir) });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toMatch(/already up|PLANTED-TOKEN/);
  }, 30_000);

  it('checks and reads the dir a link and .. lead to, not the one the path names on paper', () => {
    const root = scratch();
    mkdirSync(join(root, 'evil', 'nested'), { recursive: true });
    const hostile = join(root, 'evil', 'state');
    mkdirSync(hostile, { mode: 0o700 });
    chmodSync(hostile, 0o777);
    writeFileSync(join(hostile, 'server.pid'), String(stranger()));
    mkdirSync(join(hostile, 'data'));
    writeFileSync(join(hostile, 'data', 'api-token'), 'PLANTED-TOKEN');
    mkdirSync(join(root, 'state'), { mode: 0o700 });
    symlinkSync(join(root, 'evil', 'nested'), join(root, 'link'));
    // Spelled out: path.join would drop `link/..` the same way the old check did.
    const r = run('bash', [STACK, 'status'], { QA_DIR: `${root}/link/../state`, QA_NO_WEB: '1' });
    expect(r.status).toBe(1);
    expect(r.stdout).not.toMatch(/PLANTED-TOKEN/);
    expect(r.stderr).toMatch(/evil\/state is a dir group or others can write/);
  });

  it('refuses a state dir in a folder others can write without the sticky bit', () => {
    const open = join(scratch(), 'open');
    mkdirSync(open);
    chmodSync(open, 0o777);
    const dir = join(open, 'state');
    mkdirSync(dir, { mode: 0o700 });
    const r = run('bash', [STACK, 'status'], { QA_DIR: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/without the sticky bit/);
  });

  it('accepts a state dir in a shared folder with the sticky bit, as /tmp is', () => {
    const shared = join(scratch(), 'shared');
    mkdirSync(shared);
    chmodSync(shared, 0o1777);
    const dir = join(shared, 'state');
    mkdirSync(dir, { mode: 0o700 });
    const r = run('bash', [STACK, 'status'], { QA_DIR: dir });
    expect(r.status).toBe(0);
  });
});

describe('qa-private-dir.mjs --create', () => {
  it('makes a missing dir only this user can open', () => {
    const dir = join(scratch(), 'fresh');
    const r = run('node', [join(ROOT, 'scripts/qa-private-dir.mjs'), '--create', dir], {});
    expect(r.status).toBe(0);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('refuses a link where the dir should be, and makes nothing', () => {
    const { link } = linkedDir();
    const r = run('node', [join(ROOT, 'scripts/qa-private-dir.mjs'), '--create', link], {});
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/symlink/);
  });
});

describe('qa-handoff-stack.sh state dir', () => {
  it('refuses a rig dir that group or others can write', () => {
    const r = run('bash', [HANDOFF, 'status'], { QA_HANDOFF_DIR: stateDir(0o777) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/others can write/);
  });

  it('refuses a rig dir that is a symlink', () => {
    const r = run('bash', [HANDOFF, 'status'], { QA_HANDOFF_DIR: linkedDir().link });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/symlink/);
  });

  it('reads nothing from a rig dir that appears after the check found none', () => {
    const dir = join(scratch(), 'raced');
    const r = run('bash', [HANDOFF, 'env', 'A'], { QA_HANDOFF_DIR: dir, PATH: racingNode(dir) });
    expect(existsSync(join(dir, 'a', 'data', 'api-token'))).toBe(true);
    expect(r.stdout).not.toMatch(/PLANTED-TOKEN/);
  });
});

describe('qa-seed-ios-thread.mjs state dir', () => {
  it('refuses a state dir others can write before it reads the token or opens the database', () => {
    const dir = stateDir(0o777);
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'api-token'), 'planted');
    const r = run('node', [SEED, '--port', '4999', '--dir', dir], {});
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/others can write/);
  });
});
