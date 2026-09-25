import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// Codex capped at 1, Claude at 8: a full Codex must not hold up a Claude thread.
let H: Awaited<ReturnType<typeof startRunner>>;
const codex = { harness: 'codex', model: 'gpt-5.6-sol' };

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_MAX_CONCURRENT: '8', OMNI_MAX_CONCURRENT_CODEX: '1' });
  const svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('per-harness concurrency', () => {
  it('starts a Claude thread while the Codex cap is full', async () => {
    const c1 = await H.start('HANG one', codex);
    await H.untilStatus(c1.id, 'running');
    const c2 = await H.start('HANG two', codex);
    await H.untilStatus(c2.id, 'queued'); // Codex cap 1 is full

    const claude = await H.start('do some claude work');
    await H.untilStatus(claude.id, 'running'); // starts right away despite Codex being full

    expect(H.thread(c2.id).status).toBe('queued');
    const slots = H.runner.slotsByHarness();
    expect(slots['codex']).toEqual({ running: 1, cap: 1 });
    expect(slots['claude-code'].cap).toBe(8);
  });

  it('reads Codex plan usage at catalog load, and reports none for Cursor', async () => {
    const { usageByHarness } = await import('../server/usage.ts');
    const u = usageByHarness();
    expect(u['codex']?.five_hour?.utilization).toBeCloseTo(0.08);
    expect(u['cursor']).toBeNull();
  });
});
