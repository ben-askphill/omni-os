import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// scripts/qa-stack.sh down: it must never stop a stack another thread started on the same port.
const ROOT = resolve(import.meta.dirname, '../../..');
const SCRIPT = join(ROOT, 'scripts/qa-stack.sh');

const pids: number[] = [];
const dirs: string[] = [];

// A stand-in for a stack process: its own process group, like detach() in the script, run from `cwd`.
function sleeper(cwd: string) {
  const p = spawn('sleep', ['60'], { cwd, detached: true, stdio: 'ignore' });
  pids.push(p.pid!);
  return p.pid!;
}

// What up actually records: the subshell that ran detach(), whose child leads its own process group.
function subshellWithDetachedChild(cwd: string) {
  const p = spawn('bash', ['-c', `perl -e 'setpgrp(0, 0); exec @ARGV' sleep 60; :`], { cwd, stdio: 'ignore' });
  pids.push(p.pid!);
  return p.pid!;
}

const childOf = async (pid: number) => {
  for (let i = 0; i < 40; i++) {
    const out = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).stdout.trim();
    if (out) return Number(out.split('\n')[0]);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`no child of ${pid}`);
};

function stackDir(pid: number) {
  const dir = mkdtempSync(join(tmpdir(), 'omni-qa-test-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'server.pid'), String(pid));
  return dir;
}

function down(env: Record<string, string>) {
  const { QA_SERVER_PORT: _drop, ...base } = process.env;
  return spawnSync('bash', [SCRIPT, 'down'], { cwd: ROOT, env: { ...base, ...env }, encoding: 'utf8' });
}

const isAlive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const waitDead = async (pid: number) => {
  for (let i = 0; i < 40 && isAlive(pid); i++) await new Promise((r) => setTimeout(r, 50));
  return !isAlive(pid);
};

afterEach(() => {
  for (const pid of pids.splice(0)) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('qa-stack.sh down', () => {
  it('refuses to run without an explicit port and stops nothing', () => {
    const pid = sleeper(ROOT);
    const dir = stackDir(pid);
    const r = down({ QA_DIR: dir });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/needs QA_SERVER_PORT/);
    expect(isAlive(pid)).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });

  it('leaves a stack started from another checkout running', () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'omni-qa-other-')));
    dirs.push(elsewhere);
    const pid = sleeper(elsewhere);
    const dir = stackDir(pid);
    const r = down({ QA_SERVER_PORT: '4999', QA_DIR: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not ours/);
    expect(isAlive(pid)).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });

  it('stops a stack this checkout started and removes its dir', async () => {
    const pid = sleeper(ROOT);
    const dir = stackDir(pid);
    const r = down({ QA_SERVER_PORT: '4999', QA_DIR: dir });
    expect(r.status).toBe(0);
    expect(await waitDead(pid)).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('stops the detached group under the recorded subshell, as up starts it', async () => {
    const pid = subshellWithDetachedChild(ROOT);
    const child = await childOf(pid);
    pids.push(child);
    const dir = stackDir(pid);
    const r = down({ QA_SERVER_PORT: '4999', QA_DIR: dir });
    expect(r.status).toBe(0);
    expect(await waitDead(child)).toBe(true);
  });
});
