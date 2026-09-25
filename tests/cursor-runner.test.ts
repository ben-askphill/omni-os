import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner, type Ev } from './runner-boot.ts';
import { FAKE_CURSOR } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
const cursor = { harness: 'cursor', model: 'gpt-5.6-sol', effort: 'high' };
const turns = (threadId: string) => H.cursorRequests().filter((r: any) => r.method === 'turn' && r.thread_id === threadId);

beforeAll(async () => {
  H = await startRunner({ OMNI_CURSOR_BIN: FAKE_CURSOR, CURSOR_API_KEY: 'should-be-stripped' });
  const svc = await import('../server/harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('cursor tracer', () => {
  it('lists Cursor in the catalog with families ordered, Claude last with the billing note', async () => {
    const { getCatalog } = await import('../server/harness/catalog-service.ts');
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
  });
});
