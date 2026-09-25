import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX, FAKE_CURSOR } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_CURSOR_BIN: FAKE_CURSOR });
  const svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('conductor delegates on any harness', () => {
  it('delegates on a named harness, model and effort', async () => {
    const parent = await H.start('be my parent');
    const t = await H.runner.createThread({
      channel: 'scratch',
      prompt: 'CMD do it',
      harness: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'high',
      parent_id: parent.id,
      task_id: 'T-1',
      source: 'conductor',
    });
    expect(t.harness).toBe('codex');
    expect(t.model).toBe('gpt-5.6-sol');
    expect(t.effort).toBe('high');
    expect(t.source).toBe('conductor');
    expect(t.parent_id).toBe(parent.id);
  });

  it('uses the role defaults when no harness is named', async () => {
    const t = await H.runner.createThread({ channel: 'scratch', prompt: 'build it', role: 'builder', source: 'conductor' });
    expect(t.harness).toBe('claude-code'); // builder sets only a model, so it stays on Claude Code
    expect(t.model).toBe('claude-opus-5-5');
  });

  it('rejects an unknown model with the valid options', async () => {
    await expect(H.runner.createThread({ channel: 'scratch', prompt: 'x', harness: 'codex', model: 'gpt-9' })).rejects.toThrow(/gpt-5.6-sol/);
  });

  it('queues a steer to a Cursor thread instead of rejecting it', async () => {
    const t = await H.start('HANG forever', { harness: 'cursor', model: 'gpt-5.6-sol', effort: 'high' });
    await H.until('turn running', () => H.cursorRequests().some((r: any) => r.method === 'turn' && r.thread_id === t.id));
    // A conductor steer to a harness that can't steer is queued.
    H.runner.sendMessage(t.id, 'adjust the plan', { from: 'conductor', mode: 'steer' });
    await H.until('steer queued', () => H.runner.pendingFor(t.id).some((p: any) => p.state === 'held' && p.text.includes('adjust the plan')));
  });
});
