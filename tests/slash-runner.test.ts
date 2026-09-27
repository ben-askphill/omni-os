import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

// Every message that enters a thread, whoever sent it, is resolved against the thread's
// command list, and the user event stores what it resolved to. The text itself goes to
// Claude Code unchanged.

const r = await startRunner();
const { runAutomation } = await import('../server/automations.ts');

const TDD = { name: 'tdd', source: 'personal', description: 'Test-driven development with a red-green-refactor loop.', start: 0, end: 4 };
const PDF = { name: 'document-skills:pdf', source: 'plugin', description: 'Read, create and edit PDF files', start: 0, end: 4 };

describe('the resolved command on the user event', () => {
  it('is stored for the message Ben starts a thread with, and the text reaches Claude Code unchanged', async () => {
    const t = await r.start('/tdd fix the login bug');
    await r.untilResults(t.id, 1);
    const [u] = r.byKind(t.id, 'user');
    expect(u.p).toMatchObject({ text: '/tdd fix the login bug', source: 'manual', slash: { command: TDD } });
    expect(r.texts(t.id, 'assistant_text')).toEqual(['Output of /tdd']);
  });

  it('is stored for a follow-up, matched by alias', async () => {
    const t = await r.start('hello');
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/pdf summarise the brief');
    await r.untilResults(t.id, 2);
    expect(r.byKind(t.id, 'user')[1].p).toMatchObject({ text: '/pdf summarise the brief', source: 'ben', slash: { command: PDF } });
  });

  it('is stored for a message from the Conductor', async () => {
    const t = await r.start('hello');
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/tdd 31', { from: 'conductor' });
    await r.untilResults(t.id, 2);
    expect(r.byKind(t.id, 'user')[1].p).toMatchObject({ source: 'conductor', slash: { command: TDD } });
  });

  it('is stored for a thread an Automation starts', async () => {
    const t = await runAutomation(
      { id: 'nightly', name: 'Nightly', cron: '0 3 * * *', timezone: 'Europe/Amsterdam', channel: 'scratch', prompt: '/tdd run the suite', enabled: true, file: '' },
      'manual',
    );
    await r.untilResults(t.id, 1);
    expect(r.byKind(t.id, 'user')[0].p).toMatchObject({ source: 'automation', slash: { command: TDD } });
  });

  it('keeps the message searchable by its text', async () => {
    const t = await r.start('/tdd fix the checkout totals');
    await r.untilResults(t.id, 1);
    expect(r.db.search('/tdd checkout').map((h) => h.thread_id)).toContain(t.id);
  });

  it('is left off plain text, paths and commands Claude Code does not have', async () => {
    for (const text of ['hello there', '/Users/ben/notes.md read this', '/nope do it']) {
      const t = await r.start(text);
      await r.untilResults(t.id, 1);
      expect(r.byKind(t.id, 'user')[0].p.slash).toBeUndefined();
    }
  });
});
