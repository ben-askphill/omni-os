import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner, type Ev } from './runner-boot.ts';
import { FAKE_CURSOR } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
const cursor = { harness: 'cursor', model: 'gpt-5.6-sol', effort: 'high' };
const turns = (threadId: string) => H.cursorRequests().filter((r: any) => r.method === 'turn' && r.thread_id === threadId);

beforeAll(async () => {
  H = await startRunner({ OMNI_CURSOR_BIN: FAKE_CURSOR, CURSOR_API_KEY: 'should-be-stripped' });
  const svc = await import('../harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('cursor tracer', () => {
  it('lists Cursor in the catalog with families ordered, Claude last with the billing note', async () => {
    const { getCatalog } = await import('../harness/catalog-service.ts');
    const h = getCatalog().harnesses.find((x) => x.id === 'cursor')!;
    expect(h.available).toBe(true);
    const ids = h.models.map((m) => m.id);
    expect(ids[0]).toBe('auto');
    const claude = h.models.filter((m) => m.id.startsWith('claude'));
    expect(claude.every((m) => m.note === 'Bills Cursor, not your Claude plan')).toBe(true);
  });

  it('runs a turn: reply in the transcript, shell command as a Bash row, thread done', async () => {
    const t = await H.start('CMD list files', cursor);
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).harness).toBe('cursor');
    expect(H.thread(t.id).status).toBe('done');
    expect(H.texts(t.id, 'assistant_text').join(' ')).toContain('ack:');
    expect(H.byKind(t.id, 'tool_use').filter((e: Ev) => e.p.name === 'Bash').length).toBe(1);
    // The chat id was created up front and stored.
    expect(H.thread(t.id).session_id).toMatch(/^chat_/);
    // Only Ben's text is in the transcript — the user echo was dropped, so exactly one user event.
    expect(H.byKind(t.id, 'user').length).toBe(1);
  });

  it('stores a named nested tool when it starts and attaches one result when it completes', async () => {
    const t = await H.start('CMD TOOL:1500 list files', cursor);
    await H.until('started Bash row', () => H.byKind(t.id, 'tool_use').length === 1);
    expect(H.byKind(t.id, 'tool_use')[0].p).toMatchObject({ id: 'tc_1', name: 'Bash', input: { command: 'ls -a' } });
    expect(H.byKind(t.id, 'tool_result')).toHaveLength(0);
    await H.untilResults(t.id, 1);
    expect(H.byKind(t.id, 'tool_use')).toHaveLength(1);
    expect(H.byKind(t.id, 'tool_result')).toHaveLength(1);
    expect(H.byKind(t.id, 'tool_result')[0].p).toMatchObject({ tool_use_id: 'tc_1', text: 'a\nb\n', is_error: false });
  });

  it('runs with full access and never leaks the Cursor api key', () => {
    const turn = H.cursorRequests().find((r: any) => r.method === 'turn');
    for (const r of H.cursorRequests()) expect(r.cursor_auth).toEqual([]);
    void turn;
  });

  it('adds Omni context on the first turn only, and resumes the same chat on follow-ups', async () => {
    const t = await H.start('CMD first', cursor);
    await H.untilResults(t.id, 1);
    const chatId = H.thread(t.id).session_id;
    H.runner.sendMessage(t.id, 'a follow up', { mode: 'queue' });
    await H.untilResults(t.id, 2);

    const ts = turns(t.id);
    expect(ts.length).toBe(2);
    expect(ts[0].prompt).toContain('Omni OS'); // context on the first turn
    expect(ts[1].prompt).not.toContain('Omni OS'); // not on the follow-up
    expect(ts.every((r: any) => r.resume === chatId)).toBe(true); // every turn resumes the chat
  });

  it('queues a steer instead of rejecting it, running it as the next turn', async () => {
    const t = await H.start('CMD one', cursor);
    await H.untilResults(t.id, 1);
    H.runner.sendMessage(t.id, 'and now this', { mode: 'steer' });
    await H.untilResults(t.id, 2);
    expect(turns(t.id).length).toBe(2);
  });

  it('interrupts by killing the turn, and the next message resumes the chat', async () => {
    const t = await H.start('HANG forever', cursor);
    const chatId = await H.until('chat id', () => {
      const s = H.thread(t.id).session_id;
      return s.startsWith('chat_') ? s : false;
    });
    await H.until('turn running', () => turns(t.id).length >= 1);
    H.runner.interruptThread(t.id);
    await H.untilStatus(t.id, 'stopped');

    H.runner.sendMessage(t.id, 'CMD carry on');
    await H.untilResults(t.id, 1, 12000);
    expect(H.thread(t.id).status).toBe('done');
    expect(turns(t.id).some((r: any) => r.resume === chatId)).toBe(true);
    expect(turns(t.id).at(-1).prompt).toContain('Omni records tool failures reported by your harness automatically.');
    H.runner.sendMessage(t.id, 'follow up after resume');
    await H.untilResults(t.id, 2, 12000);
    expect(turns(t.id).at(-1).prompt).toBe('follow up after resume');
  });
});

describe('cursor usage', () => {
  const PERIOD = { billingCycleStart: '1790233029000', billingCycleEnd: '1792825029000', planUsage: { totalPercentUsed: 43.08, autoPercentUsed: 39.49, apiPercentUsed: 82.31, totalSpend: 56_436, includedSpend: 7000, bonusSpend: 49_436 } };

  it('meters each turn from its usage: exact for one call, an estimate with tools, tokens summed', async () => {
    const ctx = await import('../context.ts');
    const t = await H.start('plain hello', cursor);
    await H.untilResults(t.id, 1);
    const first = ctx.contextView(H.thread(t.id)).context!;
    // The fake reports 24,000 input and 6,000 cache read; gpt-5.6-sol's label names no window, so 200K.
    expect(first).toMatchObject({ used: 30_000, max: 200_000, source: 'cursor', calls: 1 });
    expect(first.spend).toMatchObject({ turns: 1, input: 24_000, output: 120, cacheRead: 6000, cents: null });

    H.runner.sendMessage(t.id, 'CMD now with a tool');
    await H.untilResults(t.id, 2);
    const second = ctx.contextView(H.thread(t.id)).context!;
    // One tagged call ran the tool, one wrote the reply: 30,000 over two calls, but never below the last exact reading.
    expect(second).toMatchObject({ used: 30_000, source: 'cursor-estimate', calls: 2 });
    expect(second.spend).toMatchObject({ turns: 2, input: 48_000, cacheRead: 12_000 });
  });

  it("sets each thread's exact cost from the usage events that name its chat, and the plan's monthly cycle", async () => {
    const usage = await import('../cursor-usage.ts');
    const { usageFor } = await import('../usage.ts');
    const ctx = await import('../context.ts');
    const t = await H.start('plain cost me', cursor);
    await H.untilResults(t.id, 1);
    const chat = H.thread(t.id).session_id;
    let since = 0;
    usage.setCursorDashboard({
      planUsage: async () => (await import('../harness/cursor/dashboard.ts')).mapPlanUsage(PERIOD),
      usageEvents: async (s) => {
        since = s;
        const ev = (id: string, conversationId: string | null, cents: number) => ({ id, at: Date.now(), conversationId, model: 'default', cents, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
        return [ev('e1', chat, 2.78), ev('e2', chat, 1.5), ev('e2', chat, 1.5), ev('e3', 'someone-else', 99), ev('e4', null, 7)];
      },
    });
    await usage.refreshCursorUsage();
    expect(since).toBeLessThanOrEqual(Date.parse(H.thread(t.id).created_at));
    // e2 came twice and counts once; other chats and chat-less events don't count.
    expect(ctx.contextView(H.thread(t.id)).context!.spend).toMatchObject({ cents: 4.28, billedAt: expect.any(String) });
    expect(usageFor('cursor')).toMatchObject({
      monthly: { utilization: 0.4308, resetsAt: 1_792_825_029, startsAt: 1_790_233_029, auto: 0.3949, api: 0.8231, spendCents: 56_436, includedCents: 7000 },
    });
  });

  it('keeps the last plan reading while the dashboard fails, then drops it to no data once stale', async () => {
    const usage = await import('../cursor-usage.ts');
    const { usageFor, recordUsage } = await import('../usage.ts');
    usage.setCursorDashboard({ planUsage: async () => null, usageEvents: async () => null });
    const fresh = new Date();
    recordUsage('cursor', { monthly: { utilization: 0.4, resetsAt: 1 }, updated_at: fresh.toISOString() });
    await usage.refreshCursorPlan(new Date(fresh.getTime() + 10 * 60_000));
    expect(usageFor('cursor')?.monthly?.utilization).toBe(0.4);
    await usage.refreshCursorPlan(new Date(fresh.getTime() + 2 * 3600_000));
    expect(usageFor('cursor')).toBeNull();
    // A throwing dashboard is the same as no data.
    usage.setCursorDashboard({ planUsage: () => Promise.reject(new Error('x')), usageEvents: () => Promise.reject(new Error('x')) });
    await expect(usage.refreshCursorUsage()).resolves.toBeUndefined();
  });

  it('caps the monthly window at 100% and keeps percents as 0 to 1', async () => {
    const { planToUsage } = await import('../cursor-usage.ts');
    const u = planToUsage({ totalPercent: 160, autoPercent: null, apiPercent: 5, spendCents: null, includedCents: null, bonusCents: null, cycleStart: null, cycleEnd: 99 });
    expect(u.monthly).toEqual({ utilization: 1, resetsAt: 99, api: 0.05 });
  });
});
