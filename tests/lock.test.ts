import { afterAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { releaseLock, takeLock } from '../server/lock.ts';

// The data dir's lock, server/lock.ts: one server per data dir, whatever pid a dead one left in it.

const ROOT = resolve(import.meta.dirname, '..');
const RACER = join(import.meta.dirname, 'fixtures', 'lock-racer.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'omni-lock-'));
const children: ChildProcess[] = [];

afterAll(() => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
});

/** A pid no process has any more. */
const deadPid = () => spawnSync('/usr/bin/true').pid!;

/** A lock file left by a server that died without removing it. */
function staleLock(name: string) {
  const file = join(mkdtempSync(join(tmp, `${name}-`)), 'server.pid');
  writeFileSync(file, `${deadPid()}\n`);
  return file;
}

type Racer = { child: ChildProcess; line: () => Promise<string> };

function racer(file: string): Racer {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', RACER, file], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpdir() },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  children.push(child);
  const lines = createInterface({ input: child.stdout! })[Symbol.asyncIterator]();
  return {
    child,
    line: async () => {
      const next = await lines.next();
      if (next.done) throw new Error(`racer ${child.pid} exited (${child.exitCode}) before it answered`);
      return next.value;
    },
  };
}

/** n processes call takeLock on file at the same moment. What each got, once all have answered. */
async function race(file: string, n: number) {
  const racers = Array.from({ length: n }, () => racer(file));
  for (const r of racers) expect(await r.line()).toBe('ready');
  const at = String(Date.now() + 50);
  for (const r of racers) r.child.stdin!.write(`${at}\n`);
  const results = await Promise.all(racers.map(async (r) => JSON.parse(await r.line()) as { pid: number; holder: number | string | null }));
  await Promise.all(racers.map((r) => new Promise((done) => (r.child.stdin!.end(), r.child.once('exit', done)))));
  return results;
}

describe('takeLock', () => {
  it('gives a stale lock to exactly one of the servers racing for it, and the others name that one', async () => {
    for (let round = 0; round < 30; round++) {
      const results = await race(staleLock('race'), 8);
      const winners = results.filter((r) => r.holder === null);
      expect({ round, winners: winners.length }).toEqual({ round, winners: 1 });
      for (const r of results) if (r.holder !== null) expect({ round, holder: r.holder }).toEqual({ round, holder: winners[0].pid });
    }
  }, 60_000);

  it('is free once its server is killed, while a process that server started lives on', async () => {
    const file = staleLock('killed');
    const script = `const { spawn } = require('node:child_process');
      import(${JSON.stringify(join(ROOT, 'server', 'lock.ts'))}).then(({ takeLock }) => {
        const holder = takeLock(process.argv[1]);
        const helper = spawn('/bin/sleep', ['30'], { stdio: 'ignore', detached: true });
        helper.unref();
        console.log(JSON.stringify({ holder, helper: helper.pid }));
        setInterval(() => {}, 1000);
      });`;
    const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '-e', script, file], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpdir() },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    children.push(server);
    const first = await createInterface({ input: server.stdout! })[Symbol.asyncIterator]().next();
    if (first.done) throw new Error(`the server exited (${server.exitCode}) before it answered`);
    const { holder, helper } = JSON.parse(first.value) as { holder: number | null; helper: number };
    try {
      expect(holder).toBeNull();
      expect(takeLock(file)).toBe(server.pid);

      server.kill('SIGKILL');
      await new Promise((r) => server.once('exit', r));
      expect(() => process.kill(helper, 0)).not.toThrow();
      expect(takeLock(file)).toBeNull();
      expect(readFileSync(file, 'utf8')).toBe(`${process.pid}\n`);
    } finally {
      releaseLock(file);
      process.kill(helper, 'SIGKILL');
    }
  });

  it('takes over a lock whose pid now belongs to another node program', async () => {
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' });
    children.push(other);
    await new Promise((r) => other.once('spawn', r));
    const file = join(mkdtempSync(join(tmp, 'recycled-')), 'server.pid');
    writeFileSync(file, `${other.pid}\n`);
    try {
      expect(takeLock(file)).toBeNull();
      expect(readFileSync(file, 'utf8')).toBe(`${process.pid}\n`);
    } finally {
      releaseLock(file);
      other.kill('SIGKILL');
    }
  });
});
