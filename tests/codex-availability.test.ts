import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';
import type { Catalog } from '../server/harness/catalog.ts';

// Codex installed but logged out.
let H: Awaited<ReturnType<typeof startRunner>>;
let svc: typeof import('../server/harness/catalog-service.ts');

const codexOf = (cat: Catalog) => cat.harnesses.find((h) => h.id === 'codex')!;

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, FAKE_CODEX_ACCOUNT: 'none' });
  svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('codex logged out', () => {
  it('shows the codex group disabled with the fix command', () => {
    const codex = codexOf(svc.getCatalog());
    expect(codex.available).toBe(false);
    expect(codex.fix).toBe('codex login');
    expect(codex.models).toEqual([]);
  });

  it('fails to create a codex thread with the same hint', async () => {
    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'hi', harness: 'codex' })).rejects.toThrow(/codex login/);
  });

  it('still creates Claude Code threads as before', async () => {
    const t = await H.start('hello');
    expect(t.harness).toBe('claude-code');
  });

  it('counts an API key login as logged out, since Omni runs Codex on the ChatGPT plan', async () => {
    process.env.FAKE_CODEX_ACCOUNT = 'apiKey';
    try {
      expect((await svc.probeCodex(FAKE_CODEX)).available).toBe(false);
    } finally {
      process.env.FAKE_CODEX_ACCOUNT = 'none';
    }
  });

  it('counts a Codex binary that will not run as unavailable, without crashing', async () => {
    expect(await svc.probeCodex('/nonexistent/codex')).toEqual({ available: false, models: [] });
  });
});
