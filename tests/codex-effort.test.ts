import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
  const svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('effort reaches the Codex app-server', () => {
  it('passes the effort on turn/start', async () => {
    const t = await H.start('please run', { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).effort).toBe('high');
    const turn = H.codexRequests().find((r) => r.method === 'turn/start' && r.thread_id === t.id);
    expect(turn.params.effort).toBe('high');
  });

  it('rejects an effort the model does not support', async () => {
    await expect(
      H.runner.createThread({ channel: 'scratch', prompt: 'x', harness: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' }),
    ).rejects.toThrow(/does not support effort/);
  });
});
