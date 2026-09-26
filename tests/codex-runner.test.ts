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
  it('lists the Codex models with their efforts and config.toml defaults, and reads the plan usage', async () => {
    const { getCatalog } = await import('../server/harness/catalog-service.ts');
    const h = getCatalog().harnesses.find((x) => x.id === 'codex')!;
    expect(h.available).toBe(true);
    // Both model/list pages, without the model Codex's own picker hides.
    expect(h.models.map((m) => m.id)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra']);
    expect(h.models.find((m) => m.default)?.id).toBe('gpt-5.6-sol');
    expect(h.models.find((m) => m.id === 'gpt-5.6-sol')).toMatchObject({
      label: 'GPT-5.6 Sol',
      efforts: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'high',
    });
    const { usageFor } = await import('../server/usage.ts');
    expect(usageFor('codex')).toMatchObject({ five_hour: { utilization: 0.08 }, seven_day: { utilization: 0.02 } });
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
    expect(start.params.sandbox).toBe('danger-full-access');
    expect(String(start.params.developerInstructions)).toContain('Omni OS');
  });

  it("keeps the usage card on the plan's rate limits, not a reserve model's", async () => {
    const t = await H.start('hello', codex);
    await H.untilResults(t.id, 1);
    // The reserve model's weekly bucket arrives after the plan's, at 90%.
    const { usageFor } = await import('../server/usage.ts');
    expect(usageFor('codex')).toMatchObject({
      five_hour: { utilization: 0.12, resetsAt: 1790328600 },
      seven_day: { utilization: 0.03, resetsAt: 1790922600 },
    });
  });

  it("shows Codex's plan as the live checklist", async () => {
    const t = await H.start('PLAN then answer', codex);
    await H.untilResults(t.id, 1);
    const todo = H.byKind(t.id, 'tool_use').find((e: Ev) => e.p.name === 'TodoWrite');
    expect(todo?.p.input.todos).toEqual([
      { content: 'Scaffold', status: 'completed' },
      { content: 'Wire adapter', status: 'in_progress' },
      { content: 'Test', status: 'pending' },
    ]);
    expect(H.thread(t.id).status).toBe('done');
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

  it('interrupts the turn but keeps the process warm, and the next message continues', async () => {
    const t = await H.start('HANG long running', codex);
    await H.until('codex session id', () => H.thread(t.id).session_id.startsWith('th_'));
    await H.until('turn started', () => H.byKind(t.id, 'init').length >= 1);
    const pidsBefore = H.codexPids().length;

    H.runner.interruptThread(t.id);
    await H.untilStatus(t.id, 'stopped');
    expect(H.runner.isLive(t.id)).toBe(true); // process kept warm
    expect(H.codexRequests().some((r) => r.method === 'turn/interrupt')).toBe(true);

    H.runner.sendMessage(t.id, 'CMD carry on');
    await H.untilResults(t.id, 1, 12000);
    expect(H.thread(t.id).status).toBe('done');
    // Same warm process continued the session: no new spawn, no resume.
    expect(H.codexPids().length).toBe(pidsBefore);
  });
});
