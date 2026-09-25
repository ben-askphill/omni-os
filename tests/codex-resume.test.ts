import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// With keepalive off, the warm process closes after each turn, so every follow-up is a resume.
let H: Awaited<ReturnType<typeof startRunner>>;
const codex = { harness: 'codex', model: 'gpt-5.6-sol' };

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_KEEPALIVE_SECONDS: '0' });
  const svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('codex resume after the process closes', () => {
  it('starts a fresh process that resumes the stored Codex session', async () => {
    const t = await H.start('CMD first', codex);
    await H.untilResults(t.id, 1);
    const codexId = H.thread(t.id).session_id;
    expect(codexId).toMatch(/^th_/);

    // keepalive 0 closes the process after the turn.
    await H.until('warm process closed', () => !H.runner.isLive(t.id));
    const pidsBefore = H.codexPids().length;

    H.runner.sendMessage(t.id, 'CMD second');
    await H.untilResults(t.id, 2);

    expect(H.codexPids().length).toBe(pidsBefore + 1);
    const resumes = H.codexRequests().filter((r) => r.method === 'thread/resume' && r.params.threadId === codexId);
    expect(resumes.length).toBeGreaterThanOrEqual(1);
    expect(H.texts(t.id, 'assistant_text').length).toBe(2);
  });
});
