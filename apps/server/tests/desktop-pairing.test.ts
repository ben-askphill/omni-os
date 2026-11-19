import { afterEach, describe, expect, it } from 'vitest';
import { fstatSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adoptDesktopSecret, secretMatches } from '../desktop-pairing.ts';

// The desktop app hands the server its pairing secret on a descriptor (apps/desktop/src/backend/process.ts). The
// server keeps it in memory and leaves nothing a child could inherit: no variable, no open descriptor.
const SECRET = 'f'.repeat(64);
const dir = mkdtempSync(join(tmpdir(), 'omni-pair-'));
const fdWith = (text: string) => {
  const file = join(dir, `s-${Math.random().toString(16).slice(2)}`);
  writeFileSync(file, text);
  return openSync(file, 'r');
};
const isOpen = (fd: number) => {
  try {
    fstatSync(fd);
    return true;
  } catch {
    return false;
  }
};

afterEach(() => adoptDesktopSecret({}));

describe('adoptDesktopSecret', () => {
  it('reads the secret from the descriptor the app names, then closes it and drops the variable', () => {
    const fd = fdWith(`${SECRET}\n`);
    const env: NodeJS.ProcessEnv = { OMNI_DESKTOP_PAIR_FD: String(fd), PATH: '/bin' };
    adoptDesktopSecret(env);
    expect(secretMatches(SECRET)).toBe(true);
    expect(secretMatches('e'.repeat(64))).toBe(false);
    expect(isOpen(fd)).toBe(false);
    expect(env).toEqual({ PATH: '/bin' });
  });

  it("deletes a secret an older app put in the environment, and does not trust it", () => {
    // Deleting it does not clear the starting environment, which other processes of the same user can read.
    const env: NodeJS.ProcessEnv = { OMNI_DESKTOP_PAIR_SECRET: SECRET };
    adoptDesktopSecret(env);
    expect(secretMatches(SECRET)).toBe(false);
    expect('OMNI_DESKTOP_PAIR_SECRET' in env).toBe(false);
  });

  it('stops at the first line, so a writer that never closes cannot hold up the start', () => {
    adoptDesktopSecret({ OMNI_DESKTOP_PAIR_FD: String(fdWith(`${SECRET}\nmore that is never read`)) });
    expect(secretMatches(SECRET)).toBe(true);
  });

  it('holds no secret when the descriptor is not open, is too short, or names stdio', () => {
    adoptDesktopSecret({ OMNI_DESKTOP_PAIR_FD: '987' });
    expect(secretMatches(SECRET)).toBe(false);
    adoptDesktopSecret({ OMNI_DESKTOP_PAIR_FD: String(fdWith('short\n')) });
    expect(secretMatches('short')).toBe(false);
    adoptDesktopSecret({ OMNI_DESKTOP_PAIR_FD: '0' });
    expect(secretMatches(SECRET)).toBe(false);
  });

  it('never matches without a secret', () => {
    adoptDesktopSecret({});
    expect(secretMatches(undefined)).toBe(false);
    expect(secretMatches('')).toBe(false);
  });
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
