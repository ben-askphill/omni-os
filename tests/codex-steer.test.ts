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

describe('codex steer, interrupt and images', () => {
  it('steers a running turn without starting a new one', async () => {
    const t = await H.start('SLOW original task', codex);
    await H.until('turn started', () => H.byKind(t.id, 'init').length >= 1);
    H.runner.sendMessage(t.id, 'adjust course', { mode: 'steer' });
    await H.untilResults(t.id, 1);

    const steer = H.codexRequests().find((r) => r.method === 'turn/steer' && r.thread_id === t.id);
    expect(steer).toBeTruthy();
    expect(String(steer.params.expectedTurnId)).toMatch(/^turn_/);
    // Only one turn was started for this thread.
    expect(H.codexRequests().filter((r) => r.method === 'turn/start' && r.thread_id === t.id).length).toBe(1);
    expect(H.texts(t.id, 'assistant_text').join(' ')).toContain('steered: adjust course');
  });

  it('runs a steer as the next turn when no turn is active', async () => {
    const t = await H.start('CMD first', codex);
    await H.untilResults(t.id, 1);
    H.runner.sendMessage(t.id, 'a follow up', { mode: 'steer' });
    await H.untilResults(t.id, 2);
    expect(H.texts(t.id, 'assistant_text').length).toBe(2);
    expect(H.codexRequests().filter((r) => r.method === 'turn/start' && r.thread_id === t.id).length).toBe(2);
  });

  it('sends attached images to Codex as local images', async () => {
    const png = new File([Buffer.from('\x89PNG fake data')], 'shot.png', { type: 'image/png' });
    const t = await H.runner.createThread({ channel: 'scratch', prompt: 'look at this', ...codex, files: [png] });
    await H.untilResults(t.id, 1);
    const start = H.codexRequests().find((r) => r.method === 'turn/start' && r.thread_id === t.id);
    const img = start.params.input.find((i: any) => i.type === 'localImage');
    expect(img).toBeTruthy();
    expect(String(img.path)).toMatch(/shot\.png$/);
  });

  it('sends other attachments as a path note, not as an image', async () => {
    const txt = new File([Buffer.from('some notes here')], 'notes.txt', { type: 'text/plain' });
    const t = await H.runner.createThread({ channel: 'scratch', prompt: 'read my notes', ...codex, files: [txt] });
    await H.untilResults(t.id, 1);
    const start = H.codexRequests().find((r) => r.method === 'turn/start' && r.thread_id === t.id);
    const textItem = start.params.input.find((i: any) => i.type === 'text');
    expect(textItem).toMatchObject({ text: expect.stringContaining('notes.txt'), text_elements: [] });
    expect(start.params.input.some((i: any) => i.type === 'localImage')).toBe(false);
  });
});
