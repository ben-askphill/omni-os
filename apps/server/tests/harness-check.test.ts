import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harnessCheck } from '@omni/shared/harness-check.ts';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX, FAKE_CURSOR } from './support.ts';

// Onboarding's harness check, from a real probe to what the wizard and `npm run setup` show: a CLI that is not there
// gets its install command, one that is installed but signed out only its sign-in command, and a reason (#757's
// sentences) is shown as text, never as a command to copy.
let svc: typeof import('../harness/catalog-service.ts');
let cat: typeof import('../harness/catalog.ts');
let harnessRow: typeof import('../meta-api.ts').harnessRow;
const dir = mkdtempSync(join(tmpdir(), 'omni-harness-check-'));

beforeAll(async () => {
  await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
  svc = await import('../harness/catalog-service.ts');
  cat = await import('../harness/catalog.ts');
  ({ harnessRow } = await import('../meta-api.ts'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) delete process.env[k];
  }
}

/** A row of GET /api/harnesses for this probe, and what onboarding makes of it. */
const codexRow = async (bin: string | null, env: Record<string, string> = {}) => harnessRow(cat.codexHarness(await withEnv(env, () => svc.probeCodex(bin)), 2), 0);
const cursorRow = async (bin: string | null) => harnessRow(cat.cursorHarness(await svc.probeCursor(bin), 2), 0);

describe('Codex', () => {
  it('installed but signed out: Sign in with codex login, no Install', async () => {
    const row = await codexRow(FAKE_CODEX, { FAKE_CODEX_ACCOUNT: 'none' });
    expect(row.install).toBeUndefined();
    expect(harnessCheck(row)).toEqual({ state: 'signed-out', command: 'codex login' });
  });

  it('not on PATH: Install, and the reason as text', async () => {
    const row = await codexRow(null);
    expect(row.missing).toBe(true);
    expect(harnessCheck(row)).toEqual({ state: 'missing', install: 'npm install -g @openai/codex', reason: `${cat.CODEX_NOT_FOUND}.` });
  });

  it('a codex that will not run: the reason as text, no Install and no command', async () => {
    const row = await codexRow('/nonexistent/codex');
    expect(harnessCheck(row)).toEqual({ state: 'error', reason: 'Omni could not run /nonexistent/codex (ENOENT). Set OMNI_CODEX_BIN to a codex that runs.' });
  });

  it('an API key login: a reason, not a command', async () => {
    const row = await codexRow(FAKE_CODEX, { FAKE_CODEX_ACCOUNT: 'apiKey' });
    expect(harnessCheck(row)).toEqual({ state: 'error', reason: `${cat.CODEX_API_KEY}.` });
  });

  it('signed in: ready', async () => {
    expect(harnessCheck(await codexRow(FAKE_CODEX))).toEqual({ state: 'ready' });
  });
});

describe('Cursor Agent', () => {
  it('not on PATH, or OMNI_CURSOR_BIN pointing at nothing: Install, then Sign in', async () => {
    for (const bin of [null, join(dir, 'no-cursor-agent')]) {
      expect(harnessCheck(await cursorRow(bin))).toEqual({ state: 'missing', install: 'curl https://cursor.com/install -fsS | bash', command: 'cursor-agent login' });
    }
  });

  it('installed but signed out: Sign in only', async () => {
    const bin = join(dir, 'cursor-agent');
    writeFileSync(bin, '#!/bin/sh\necho "Not logged in" >&2\nexit 1\n', { mode: 0o755 });
    const row = await cursorRow(bin);
    expect(row.install).toBeUndefined();
    expect(harnessCheck(row)).toEqual({ state: 'signed-out', command: 'cursor-agent login' });
  });

  it('signed in: ready', async () => {
    expect(harnessCheck(await cursorRow(FAKE_CURSOR))).toEqual({ state: 'ready' });
  });
});
