import { afterAll, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fakeAlive } from './support.ts';

// A runner test file must leave nothing behind: no fake CLI still running, no omni-runner-* tmp dir.
// Each case runs a fixture file from tests/fixtures/teardown in a vitest of its own, with the suite's
// config, and looks at what is left once that vitest has exited.

const ROOT = resolve(import.meta.dirname, '..');
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const CONFIG = 'tests/fixtures/teardown/vitest.config.ts';

type Report = { tmp: string; fakes: { pid: number; fixture: string }[] };

const reports = mkdtempSync(join(tmpdir(), 'omni-teardown-'));
const seen: Report[] = [];

afterAll(() => {
  // Whatever a failing case left, so a red run leaves nothing behind either.
  for (const r of seen) {
    for (const f of r.fakes) if (fakeAlive(f.pid, f.fixture)) { try { process.kill(f.pid, 'SIGKILL'); } catch { /* gone */ } }
    if (r.tmp.startsWith(join(tmpdir(), 'omni-runner-'))) rmSync(r.tmp, { recursive: true, force: true });
  }
  rmSync(reports, { recursive: true, force: true });
});

/** Run one fixture file in its own vitest; what it left behind once that vitest exited. */
async function runFixture(name: string) {
  const report = join(reports, `${name}.json`);
  // Without this run's VITEST_* variables, so the inner vitest starts like `npm test` does.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST')));
  const child = spawn(process.execPath, [VITEST, 'run', '--config', CONFIG, `${name}.fixture.ts`], {
    cwd: ROOT,
    env: { ...env, TEARDOWN_REPORT: report },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const code = await new Promise<number | null>((done) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
    // Not only on close: a process it leaked could hold the pipes open.
    child.on('exit', (c) => (clearTimeout(timer), setTimeout(() => done(c), 1000)));
    child.on('close', (c) => (clearTimeout(timer), done(c)));
  });
  if (!existsSync(report)) throw new Error(`${name} wrote no report:\n${output}`);
  const r: Report = JSON.parse(readFileSync(report, 'utf8'));
  seen.push(r);
  return { code, output, tmp: r.tmp, alive: r.fakes.filter((f) => fakeAlive(f.pid, f.fixture)) };
}

it('stops the fakes and removes the tmp dir of a file that boots the runner in beforeAll', async () => {
  const run = await runFixture('hung-turn');
  expect(run.alive, run.output).toEqual([]);
  expect(existsSync(run.tmp), run.output).toBe(false);
  expect(run.code, run.output).toBe(0);
}, 60_000);

it('still stops the fakes and removes the tmp dir when shutdownAll never finishes, and says so', async () => {
  const run = await runFixture('hung-shutdown');
  expect(run.alive, run.output).toEqual([]);
  expect(existsSync(run.tmp), run.output).toBe(false);
  expect(run.output).toMatch(/shutdownAll did not finish/);
}, 60_000);
