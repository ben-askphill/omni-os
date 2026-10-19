import { describe, it, expect } from 'vitest';
import { startRunner } from './runner-boot.ts';

// After a finished turn, Haiku guesses Ben's next reply: the reply box shows it and Tab fills it in.
const h = await startRunner({ OMNI_SUGGESTIONS: '1' });
const r = h.runner;
const T = { timeout: 20_000 };

const suggestCalls = () => h.invocations().filter((i) => i.entrypoint === 'omni-os-suggest');

describe('runner: reply suggestions', () => {
  it('stores a suggestion once a turn is done, without touching updated_at', T, async () => {
    const t = await h.start('hello');
    await h.untilResults(t.id, 1);
    const done = h.thread(t.id).updated_at;
    await h.until('suggestion', () => h.thread(t.id).suggestion);
    expect(h.thread(t.id).suggestion).toBe('Yes, open a PR');
    expect(h.thread(t.id).updated_at).toBe(done);
    expect(suggestCalls().at(-1)?.args).toEqual(expect.arrayContaining(['--model', 'haiku', '--tools', '']));
  });

  it('clears the suggestion when a message is sent', T, async () => {
    const t = await h.start('first');
    await h.until('suggestion', () => h.thread(t.id).suggestion);
    r.sendMessage(t.id, 'next');
    expect(h.thread(t.id).suggestion).toBeNull();
    await h.untilResults(t.id, 2);
    await h.until('new suggestion', () => h.thread(t.id).suggestion);
  });

  it('drops an answer that comes back after another message was sent', T, async () => {
    const t = await h.start('slow SUGGEST:800');
    // The turn's end starts the suggestion call, which takes 800ms to answer.
    await h.untilResults(t.id, 1);
    r.sendMessage(t.id, 'SUGGEST_NONE');
    await h.untilResults(t.id, 2);
    await new Promise((res) => setTimeout(res, 1200));
    expect(h.thread(t.id).suggestion).toBeNull();
  });

  it('stores nothing when there is no obvious next step', T, async () => {
    const n = suggestCalls().length;
    const t = await h.start('SUGGEST_NONE');
    await h.untilResults(t.id, 1);
    await h.until('suggest call ran', () => suggestCalls().length > n);
    await new Promise((res) => setTimeout(res, 500));
    expect(h.thread(t.id).suggestion).toBeNull();
  });
});
