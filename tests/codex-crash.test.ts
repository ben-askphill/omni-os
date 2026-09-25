import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
const codex = { harness: 'codex', model: 'gpt-5.6-sol' };

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
  const svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('codex failures', () => {
  it('fails the turn when the process crashes mid-turn, and the next message resumes', async () => {
    const t = await H.start('CRASH right now', codex);
    await H.untilStatus(t.id, 'failed', 12000);
    const codexId = H.thread(t.id).session_id;
    expect(codexId).toMatch(/^th_/);
    expect(H.byKind(t.id, 'error').length).toBeGreaterThanOrEqual(1);

    H.runner.sendMessage(t.id, 'CMD carry on');
    await H.untilResults(t.id, 1, 12000);
    expect(H.thread(t.id).status).toBe('done');
    const resumes = H.codexRequests().filter((r) => r.method === 'thread/resume' && r.params.threadId === codexId);
    expect(resumes.length).toBeGreaterThanOrEqual(1);
  });

  it('ends the turn with the plan-limit error text (including the reset time)', async () => {
    const t = await H.start('BADTURN please', codex);
    await H.untilResults(t.id, 1, 12000);
    expect(H.thread(t.id).status).toBe('failed');
    const statuses = H.byKind(t.id, 'status');
    expect(statuses.some((s) => /resets at/i.test(String(s.p.text)))).toBe(true);
  });
});
