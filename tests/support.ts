import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake-claude.mjs');
export const FAKE_CODEX = join(import.meta.dirname, 'fixtures', 'fake-codex.mjs');

/** Poll until fn returns something truthy. Beats fixed sleeps for process-driven tests. */
export async function waitFor<T>(fn: () => T | undefined | null | false, label: string | (() => string), timeout = 8000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out after ${timeout}ms waiting for ${typeof label === 'function' ? label() : label}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True while pid is a running fake CLI. Checks the command line so a recycled pid never counts. */
export function fakeAlive(pid: number, needle = 'fake-claude.mjs') {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).includes(needle);
  } catch {
    return false;
  }
}
