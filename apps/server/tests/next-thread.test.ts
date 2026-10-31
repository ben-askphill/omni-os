import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-boot.ts';

// After a finished turn, Haiku can propose a follow-up thread: a card under the transcript that starts it.
const h = await startRunner({ OMNI_SUGGESTIONS: '1' });
const r = h.runner;
const { parseNextThread } = await import('../runner/aux.ts');
const { threadsApi } = await import('../threads-api.ts');
const T = { timeout: 20_000 };

const nextCalls = () => h.invocations().filter((i) => i.entrypoint === 'omni-os-next-thread');
const patch = (id: string, body: unknown) =>
  threadsApi.request(`/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('parseNextThread', () => {
  it('reads the title and the prompt, across lines', () => {
    expect(parseNextThread('TITLE: Fix the docs drift.\nPROMPT: Update docs/skills.md.\nWork on a branch.')).toEqual({
      title: 'Fix the docs drift',
      prompt: 'Update docs/skills.md.\nWork on a branch.',
    });
  });

  it('takes nothing from NONE or an answer in another shape', () => {
    expect(parseNextThread(`TITLE: Long\nPROMPT: ${'a'.repeat(1201)}`)).toBeNull();
    expect(parseNextThread(`TITLE: Long\nPROMPT: ${'a'.repeat(1200)}`)?.prompt).toHaveLength(1200);
    for (const out of ['NONE', 'none.', 'TITLE: only a title', 'PROMPT: only a prompt', 'Sure! Here is a card.']) expect(parseNextThread(out)).toBeNull();
  });
});

describe('runner: proposed follow-up threads', () => {
  it('stores one once a turn is done, without touching updated_at', T, async () => {
    const t = await h.start('NEXT_THREAD');
    await h.untilResults(t.id, 1);
    const done = h.thread(t.id).updated_at;
    await h.until('next thread', () => h.thread(t.id).next_title);
    expect(h.thread(t.id)).toMatchObject({
      next_title: 'Fix the docs drift',
      next_prompt: 'Update the skills catalog in docs/skills.md. Work on a branch.',
      updated_at: done,
    });
    expect(nextCalls().at(-1)?.args).toEqual(expect.arrayContaining(['--model', 'haiku', '--tools', '']));
  });

  it('stores nothing when the answer leaves no separate work', T, async () => {
    const n = nextCalls().length;
    const t = await h.start('hello');
    await h.untilResults(t.id, 1);
    await h.until('next-thread call ran', () => nextCalls().length > n);
    await new Promise((res) => setTimeout(res, 500));
    expect(h.thread(t.id).next_title).toBeNull();
  });

  it('drops it when a message is sent', T, async () => {
    const t = await h.start('NEXT_THREAD');
    await h.until('next thread', () => h.thread(t.id).next_title);
    r.sendMessage(t.id, 'carry on');
    expect(h.thread(t.id)).toMatchObject({ next_title: null, next_prompt: null });
  });

  it('drops an answer that comes back after another message was sent', T, async () => {
    const t = await h.start('NEXT_THREAD NEXT:800');
    await h.untilResults(t.id, 1);
    // The second turn's own suggestion reads the thread title. Until the title call lands, the title is the prompt, which
    // carries NEXT_THREAD, and that second turn would propose a card of its own. A loaded run saw it, so settle it first.
    await h.until('title', () => h.thread(t.id).title === 'Fake title');
    r.sendMessage(t.id, 'carry on');
    await h.untilResults(t.id, 2);
    await new Promise((res) => setTimeout(res, 1200));
    expect(h.thread(t.id).next_title).toBeNull();
  });

  it('PATCH next_thread: null dismisses it and keeps the thread in place', T, async () => {
    const t = await h.start('NEXT_THREAD');
    await h.until('next thread', () => h.thread(t.id).next_title);
    const before = h.thread(t.id).updated_at;
    const res = await patch(t.id, { next_thread: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: t.id, next_title: null, next_prompt: null });
    expect(h.thread(t.id).updated_at).toBe(before);
    expect((await patch(t.id, { next_thread: { title: 'x' } })).status).toBe(400);
  });
});
