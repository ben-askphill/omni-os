import { beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX, FAKE_CURSOR } from './support.ts';

// Every message that enters a thread, whoever sent it, is resolved against the thread's
// command list, and the user event stores what it resolved to. The text itself goes to
// Claude Code and Cursor Agent unchanged; Codex gets its skill to load with it.

const r = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_CURSOR_BIN: FAKE_CURSOR });
const { runAutomation } = await import('../server/automations.ts');
await (await import('../server/harness/catalog-service.ts')).loadCatalog();

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

describe('an Omni command that arrives from outside the composer', () => {
  it('is stored and sent as plain text, and Omni neither renames nor starts a thread', async () => {
    const t = await r.start('hello', { title: 'Old title' });
    await r.untilResults(t.id, 1);
    const threadsBefore = r.db.threads.byChannel('scratch').length;
    await r.runner.postMessage(t.id, '/rename Better title');
    await r.untilResults(t.id, 2);
    await r.runner.postMessage(t.id, '/clear start over', { from: 'conductor' });
    await r.untilResults(t.id, 3);

    const [, rename, clear] = r.byKind(t.id, 'user');
    expect(rename.p).toMatchObject({ text: '/rename Better title', source: 'ben' });
    expect(clear.p).toMatchObject({ text: '/clear start over', source: 'conductor' });
    expect(rename.p.slash).toBeUndefined();
    expect(clear.p.slash).toBeUndefined();
    // The fake answers any text that starts with a slash as a local command, so this is the text as sent.
    expect(r.texts(t.id, 'assistant_text').slice(-2)).toEqual(['Output of /rename', 'Output of /clear']);
    expect(r.thread(t.id).title).toBe('Old title');
    expect(r.db.threads.byChannel('scratch')).toHaveLength(threadsBefore);
  });

  it('is plain text in the prompt of a thread an Automation starts', async () => {
    const threadsBefore = r.db.threads.byChannel('scratch').length;
    const t = await runAutomation(
      { id: 'digest', name: 'Digest', cron: '0 7 * * *', timezone: 'Europe/Amsterdam', channel: 'scratch', prompt: '/new daily digest', enabled: true, file: '' },
      'manual',
    );
    await r.untilResults(t.id, 1);
    const [u] = r.byKind(t.id, 'user');
    expect(u.p).toMatchObject({ text: '/new daily digest', source: 'automation' });
    expect(u.p.slash).toBeUndefined();
    expect(r.db.threads.byChannel('scratch')).toHaveLength(threadsBefore + 1);
  });
});

describe('a Codex skill command', () => {
  const codex = { harness: 'codex', model: 'gpt-5.6-sol' };
  const TDD = { type: 'skill', name: 'tdd', path: '/Users/dev/.agents/skills/tdd/SKILL.md' };
  const text = (t: string) => ({ type: 'text', text: t, text_elements: [] });
  /** The input of each turn/start (or turn/steer) Codex got for a thread. */
  const inputs = (id: string, method = 'turn/start') =>
    r.codexRequests().filter((q) => q.method === method && q.thread_id === id).map((q) => q.params.input);

  // A repo skill in the scratch channel's folder, written before Codex first lists it.
  const shipCheck = join(r.tmp, 'scratch', '.agents', 'skills', 'ship-check', 'SKILL.md');
  beforeAll(() => {
    mkdirSync(join(shipCheck, '..'), { recursive: true });
    writeFileSync(shipCheck, '---\nname: ship-check\ndescription: Run the pre-ship checklist\n---\nDo it.\n');
  });

  it('reaches Codex as $name with the skill to load, and the transcript keeps what Ben typed', async () => {
    const t = await r.start('/tdd fix the parser', codex);
    await r.untilResults(t.id, 1);
    expect(inputs(t.id)).toEqual([[text('$tdd fix the parser'), TDD]]);
    const [u] = r.byKind(t.id, 'user');
    expect(u.p).toMatchObject({ text: '/tdd fix the parser', source: 'manual', slash: { command: { name: 'tdd', source: 'personal', start: 0, end: 4 } } });
    expect(u.p.slash.command).not.toHaveProperty('path');
  });

  it("loads a repo skill from the thread's own folder", async () => {
    const t = await r.start('/ship-check', codex);
    await r.untilResults(t.id, 1);
    expect(inputs(t.id)).toEqual([[text('$ship-check'), { type: 'skill', name: 'ship-check', path: shipCheck }]]);
  });

  it('loads the skill for a message from the Conductor', async () => {
    const t = await r.start('hello', codex);
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/tdd 31', { from: 'conductor' });
    await r.untilResults(t.id, 2);
    expect(inputs(t.id)[1]).toEqual([text('$tdd 31'), TDD]);
  });

  it('loads the skill for a thread an Automation starts', async () => {
    const t = await runAutomation(
      { id: 'nightly-codex', name: 'Nightly', cron: '0 3 * * *', timezone: 'Europe/Amsterdam', channel: 'scratch', prompt: '/tdd run the suite', enabled: true, file: '', ...codex },
      'manual',
    );
    await r.untilResults(t.id, 1);
    expect(inputs(t.id)).toEqual([[text('$tdd run the suite'), TDD]]);
  });

  it('loads the skill when the message steers a running turn', async () => {
    const t = await r.start('SLOW original task', codex);
    await r.until('the turn to start', () => r.byKind(t.id, 'init').length >= 1);
    await r.runner.postMessage(t.id, '/tdd and add a test', { mode: 'steer' });
    await r.untilResults(t.id, 1);
    expect(inputs(t.id, 'turn/steer')).toEqual([[text('$tdd and add a test'), TDD]]);
  });

  it('sends plain text and commands Codex does not have as typed, with no skill', async () => {
    for (const typed of ['hello there', '/nope do it']) {
      const t = await r.start(typed, codex);
      await r.untilResults(t.id, 1);
      expect(inputs(t.id)).toEqual([[text(typed)]]);
    }
  });
});

describe('a Cursor Agent command', () => {
  const cursor = { harness: 'cursor', model: 'gpt-5.6-sol' };
  const prompts = (id: string) => r.cursorRequests().filter((q) => q.method === 'turn' && q.thread_id === id).map((q) => q.prompt);

  it('reaches Cursor Agent as typed, and the transcript shows the command', async () => {
    const t = await r.start('/tdd fix the parser', cursor);
    await r.untilResults(t.id, 1);
    expect(r.byKind(t.id, 'user')[0].p).toMatchObject({ text: '/tdd fix the parser', slash: { command: { name: 'tdd', source: 'personal', start: 0, end: 4 } } });
    // A session's first message has Omni's context in front, and Cursor Agent finds a command anywhere after a space.
    expect(prompts(t.id)[0]).toMatch(/\n\/tdd fix the parser$/);
  });

  it('is stored for a follow-up, which goes as typed', async () => {
    const t = await r.start('hello', cursor);
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, '/goal ship the release');
    await r.untilResults(t.id, 2);
    expect(r.byKind(t.id, 'user')[1].p).toMatchObject({ slash: { command: { name: 'goal', source: 'builtin' } } });
    expect(prompts(t.id)[1]).toBe('/goal ship the release');
  });
});
