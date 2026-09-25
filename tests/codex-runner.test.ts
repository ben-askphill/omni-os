import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner, type Ev } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// The thinnest end-to-end Codex path, driven through the real runner against the fake app-server.
let H: Awaited<ReturnType<typeof startRunner>>;

const codex = { harness: 'codex', model: 'gpt-5.6-sol' };

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OPENAI_API_KEY: 'sk-should-be-stripped' });
  const svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('codex tracer', () => {
  it('makes the catalog list Codex as available with its config default', async () => {
    const { getCatalog } = await import('../server/harness/catalog-service.ts');
    const h = getCatalog().harnesses.find((x) => x.id === 'codex')!;
    expect(h.available).toBe(true);
    expect(h.models.find((m) => m.default)?.id).toBe('gpt-5.6-sol');
  });

  it('runs a turn: reply in the transcript, shell command as a Bash row, thread ends done', async () => {
    const t = await H.start('CMD list the files', codex);
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).harness).toBe('codex');
    expect(H.thread(t.id).status).toBe('done');
    expect(H.texts(t.id, 'assistant_text').join(' ')).toContain('ack:');
    const bash = H.byKind(t.id, 'tool_use').filter((e: Ev) => e.p.name === 'Bash');
    expect(bash.length).toBe(1);
    expect(H.byKind(t.id, 'tool_result').length).toBe(1);
    // The Codex session id is stored on the thread.
    expect(H.thread(t.id).session_id).toMatch(/^th_/);
  });

  it('never leaks the OpenAI api key into the codex process', () => {
    for (const r of H.codexRequests()) expect(r.api_auth).toEqual([]);
  });

  it('logs the session start with full access and developer instructions (Omni context)', () => {
    const start = H.codexRequests().find((r) => r.method === 'thread/start');
    expect(start).toBeTruthy();
    expect(start.params.approvalPolicy).toBe('never');
    expect(start.params.sandbox.mode).toBe('dangerFullAccess');
    expect(String(start.params.developerInstructions)).toContain('Omni OS');
  });

  it('continues the same warm session on a follow-up', async () => {
    const t = await H.start('CMD first', codex);
    await H.untilResults(t.id, 1);
    const pidsBefore = H.codexPids().length;
    H.runner.sendMessage(t.id, 'a follow up', { mode: 'steer' });
    await H.untilResults(t.id, 2);
    // Same number of codex processes: the follow-up reused the warm one.
    expect(H.codexPids().length).toBe(pidsBefore);
    expect(H.texts(t.id, 'assistant_text').length).toBe(2);
  });

  it('queues a message sent mid-turn and runs it as the next turn', async () => {
    const t = await H.start('SLOW first turn', codex);
    await H.untilStatus(t.id, 'running');
    H.runner.sendMessage(t.id, 'second turn', { mode: 'queue' });
    await H.untilResults(t.id, 2);
    expect(H.texts(t.id, 'assistant_text').length).toBe(2);
    expect(H.thread(t.id).status).toBe('done');
  });

  it('stops the process on interrupt, and the next message resumes the session', async () => {
    const t = await H.start('HANG long running', codex);
    // The Codex thread id is stored once the session starts; the turn then hangs until we stop it.
    const codexId = await H.until('codex session id', () => {
      const s = H.thread(t.id).session_id;
      return s.startsWith('th_') ? s : false;
    });
    H.runner.interruptThread(t.id);
    await H.untilStatus(t.id, 'stopped');

    H.runner.sendMessage(t.id, 'CMD carry on');
    await H.untilResults(t.id, 1, 12000);
    const resumes = H.codexRequests().filter((r) => r.method === 'thread/resume');
    expect(resumes.some((r) => r.params.threadId === codexId)).toBe(true);
    expect(H.thread(t.id).status).toBe('done');
  });
});
