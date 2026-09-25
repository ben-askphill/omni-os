import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';

// No OMNI_CODEX_BIN and no codex on PATH: the harness is unavailable.
let H: Awaited<ReturnType<typeof startRunner>>;

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: '' });
  const svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('codex unavailable', () => {
  it('shows the codex group disabled with the fix command', async () => {
    const { getCatalog } = await import('../server/harness/catalog-service.ts');
    const codex = getCatalog().harnesses.find((h) => h.id === 'codex')!;
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
});
