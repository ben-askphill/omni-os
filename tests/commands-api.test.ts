import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// GET /api/commands?thread=<id>: the thread's `/` menu, from the folder the thread runs in.

const r = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
const { commandsApi } = await import('../server/commands-api.ts');
const { runAutomation } = await import('../server/automations.ts');
await (await import('../server/harness/catalog-service.ts')).loadCatalog();

const get = async (query: string) => {
  const res = await commandsApi.request(`/?${query}`);
  return { status: res.status, body: await res.json() };
};

/** A Claude Code thread in `dir` with no process running it, as once its keepalive ran out. */
const idle = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  return r.db.threads.create({
    id: randomUUID(),
    channel_id: 'scratch',
    title: 'Idle',
    status: 'done',
    role: null,
    model: null,
    session_id: randomUUID(),
    cwd: dir,
    branch: null,
    parent_id: null,
    task_id: null,
    source: 'manual',
    automation: null,
  });
};

describe('GET /api/commands', () => {
  it("lists a thread's commands, with the project commands of the folder it runs in", async () => {
    const t = idle(join(r.tmp, 'shop'));
    mkdirSync(join(t.cwd, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(t.cwd, '.claude', 'commands', 'ship-check.md'), '---\ndescription: Run the pre-ship checklist\n---\nDo it.\n');

    const { status, body } = await get(`thread=${t.id}&wait=1`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'ready', fetchedAt: expect.any(Number) });
    expect(body.commands).toContainEqual({ name: 'ship-check', description: 'Run the pre-ship checklist', source: 'project', mentionable: true });
    expect(body.commands).toContainEqual(expect.objectContaining({ name: 'tdd', source: 'personal' }));
  });

  it('answers at once without wait, and serves the cache after', async () => {
    const t = idle(join(r.tmp, 'other'));
    expect((await get(`thread=${t.id}`)).body).toEqual({ status: 'loading', commands: [], fetchedAt: null, recent: [] });
    const fresh = (await get(`thread=${t.id}&wait=1`)).body;
    expect(fresh.status).toBe('ready');
    expect((await get(`thread=${t.id}`)).body).toEqual(fresh);
  });

  it("lists what a running Claude Code thread's own process can run, MCP prompts included", async () => {
    const t = await r.start('hello');
    await r.untilResults(t.id, 1);
    // Its MCP servers connect after it started.
    await vi.waitFor(async () =>
      expect((await get(`thread=${t.id}`)).body.commands).toContainEqual({
        name: 'mcp__plugin_github_github__AssignCodingAgent',
        description: 'Assign the GitHub coding agent to a task in a repository',
        source: 'mcp',
        mentionable: false,
      }),
    );
    const { body } = await get(`thread=${t.id}`);
    expect(body).toMatchObject({ status: 'ready', fetchedAt: expect.any(Number) });
    expect(body.commands).toContainEqual(expect.objectContaining({ name: 'tdd', source: 'personal' }));
  });

  it("lists a Codex thread's skills, not Claude Code's commands", async () => {
    const t = await r.start('hello', { harness: 'codex', model: 'gpt-5.6-sol' });
    await r.untilResults(t.id, 1);
    const { body } = await get(`thread=${t.id}&wait=1`);
    expect(body.status).toBe('ready');
    expect(body.commands).toContainEqual(expect.objectContaining({ name: 'tdd', source: 'personal', path: '/Users/dev/.agents/skills/tdd/SKILL.md' }));
    expect(body.commands.map((c: { name: string }) => c.name)).not.toContain('document-skills:pdf');
  });

  it('is 404 for a thread that does not exist', async () => {
    expect((await get('thread=nope')).status).toBe(404);
    expect((await get('')).status).toBe(404);
  });
});

describe('recent commands in GET /api/commands', () => {
  it("names the commands Ben used most recently on the thread's harness, in any thread, newest first", async () => {
    const a = await r.start('/tdd fix the parser');
    await r.untilResults(a.id, 1);
    await r.runner.postMessage(a.id, '/pdf summarise the brief');
    await r.untilResults(a.id, 2);
    // Typed in claude-bar's hotkey prompt.
    const b = await r.start('/bro', { source: 'capture' });
    await r.untilResults(b.id, 1);
    await r.runner.postMessage(a.id, '/tdd and add a test');
    await r.untilResults(a.id, 3);
    // A Mention names a command without running it.
    await r.runner.postMessage(a.id, 'now try /pdf on it');
    await r.untilResults(a.id, 4);
    expect(r.byKind(a.id, 'user')[3].p.slash).toMatchObject({ mentions: [{ name: 'document-skills:pdf' }] });
    // Not Ben's: the Conductor's and an Automation's.
    await r.runner.postMessage(b.id, '/compact', { from: 'conductor' });
    await r.untilResults(b.id, 2);
    const nightly = await runAutomation(
      { id: 'nightly', name: 'Nightly', cron: '0 3 * * *', timezone: 'Europe/Amsterdam', channel: 'scratch', prompt: '/context', enabled: true, file: '' },
      'manual',
    );
    await r.untilResults(nightly.id, 1);
    // On another harness.
    const codex = await r.start('/imagegen a logo', { harness: 'codex', model: 'gpt-5.6-sol' });
    await r.untilResults(codex.id, 1);

    expect((await get(`thread=${b.id}`)).body.recent).toEqual(['tdd', 'bro', 'document-skills:pdf']);
    expect((await get(`thread=${codex.id}`)).body.recent).toEqual(['imagegen']);
  });
});
