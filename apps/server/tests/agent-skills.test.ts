import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// An agent's skills (`skills:` in its crew file, skills.ts): saved from Settings, listed from the harnesses, and
// loaded when a thread of the agent starts, by Claude Code's Skill tool or as Codex skill items, with no brief or
// charter naming them. Unticked, the next thread loads none.

const home = mkdtempSync(join(tmpdir(), 'omni-skills-home-'));
const r = await startRunner({ HOME: home, OMNI_CODEX_BIN: FAKE_CODEX });
await (await import('../harness/catalog-service.ts')).loadCatalog();
const { app } = await import('../app.ts');
const { paths } = await import('../config.ts');
const { getCrew } = await import('../crew.ts');
const { skillLines, threadSkills } = await import('../skills.ts');

const shipped = mkdtempSync(join(tmpdir(), 'omni-skills-shipped-'));
paths.crew = shipped;
writeFileSync(join(shipped, 'builder.md'), '---\nname: Builder\nmodel: auto\n---\nShip code.\n');

// A repo skill in the scratch channel's folder, which Codex lists there, and a personal one in ~/.agents that neither
// fake harness lists, so a thread reads its file. Both written before anything lists the folder.
const shipCheck = join(r.tmp, 'scratch', '.agents', 'skills', 'ship-check', 'SKILL.md');
mkdirSync(join(shipCheck, '..'), { recursive: true });
writeFileSync(shipCheck, '---\nname: ship-check\ndescription: Run the pre-ship checklist\n---\nDo it.\n');
const goal = join(home, '.agents', 'skills', 'goal', 'SKILL.md');
mkdirSync(join(goal, '..'), { recursive: true });
writeFileSync(goal, '---\nname: goal\ndescription: Keep a goal\n---\nKeep it.\n');

const send = (method: string, path: string, body?: unknown) =>
  app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;
const tick = async (skills: string[] | null) => expect((await send('PUT', '/crew/builder', { fields: { skills } })).status).toBe(200);

/** The system prompt a thread's first Claude Code process was started with. */
const claudePrompt = (id: string) => {
  const [spawn] = r.spawns(id);
  return spawn.args[spawn.args.indexOf('--append-system-prompt') + 1] as string;
};
const codex = { harness: 'codex', model: 'gpt-5.6-sol' };
const text = (t: string) => ({ type: 'text', text: t, text_elements: [] });
const inputs = (id: string) => r.codexRequests().filter((q) => q.method === 'turn/start' && q.thread_id === id).map((q) => q.params.input);
const TDD = { type: 'skill', name: 'tdd', path: '/Users/dev/.agents/skills/tdd/SKILL.md' };
const SHIP_CHECK = { type: 'skill', name: 'ship-check', path: shipCheck };

describe("saving an agent's skills", () => {
  it('writes the ticked skills into its file, refuses a name no harness could list, and drops the key when none are left', async () => {
    await tick(['tdd', 'superpowers:brainstorming', 'tdd']);
    expect((await json(await send('GET', '/crew/builder'))).role.skills).toEqual(['tdd', 'superpowers:brainstorming']);
    expect(readFileSync(join(paths.personalCrew, 'builder.md'), 'utf8')).toMatch(/^skills:\n {2}- tdd\n {2}- superpowers:brainstorming$/m);

    const bad = await send('PUT', '/crew/builder', { fields: { skills: ['not a skill'] } });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toMatch(/^A skill is named as its harness lists it/);

    await tick(null);
    expect(getCrew('builder')?.skills).toEqual([]);
    expect(readFileSync(join(paths.personalCrew, 'builder.md'), 'utf8')).not.toContain('skills');
  });
});

describe('GET /api/skills', () => {
  it("merges the skills each harness here lists by name, without their built-in commands or MCP prompts", async () => {
    const body = await json(await send('GET', '/skills'));
    expect(body.listed).toEqual(['claude-code', 'codex']);
    expect(body.loading).toEqual([]);
    const by = Object.fromEntries(body.skills.map((s: any) => [s.name, s]));
    expect(by.tdd).toMatchObject({ source: 'personal', harnesses: ['claude-code', 'codex'] });
    expect(by['document-skills:pdf']).toMatchObject({ source: 'plugin', plugin: 'document-skills', harnesses: ['claude-code'], description: 'Read, create and edit PDF files' });
    expect(by.imagegen).toMatchObject({ source: 'builtin', harnesses: ['codex'] });
    for (const builtin of ['compact', 'clear', 'model', 'review']) expect(by[builtin]).toBeUndefined();
    expect(by['ship-check']).toBeUndefined();
  });

  it("adds the project skills of a channel's repo, and refuses a channel there is none of", async () => {
    const body = await json(await send('GET', '/skills?channel=scratch'));
    expect(body.skills.find((s: any) => s.name === 'ship-check')).toMatchObject({ source: 'project', harnesses: ['codex'] });
    expect((await send('GET', '/skills?channel=nope')).status).toBe(404);
  });
});

describe('a thread of an agent with skills', () => {
  it('on Claude Code, has the agent load each with the Skill tool before anything else, and read the file of one Claude Code does not list', async () => {
    await tick(['tdd', 'pdf', 'goal', 'nope']);
    const t = await r.start('fix the parser', { role: 'builder', harness: 'claude-code', model: 'sonnet' });
    await r.untilResults(t.id, 1);
    const prompt = claudePrompt(t.id);
    // The brief names no skill: the prompt does, after the charter.
    expect(r.claudeTexts(t.id)).toEqual(['fix the parser']);
    expect(prompt.indexOf('## Skills')).toBeGreaterThan(prompt.indexOf('## Your agent: Builder'));
    expect(prompt).toContain('Builder loads these skills in every thread. Before anything else, load each one with the Skill tool, one call per skill, even when the task looks like it does not need it: `tdd`, `document-skills:pdf`.');
    expect(prompt).toContain(`These load from their files, since Claude Code does not load them itself here: read each SKILL.md in full before anything else and follow it as a skill: \`goal\` (${goal}).`);
    expect(prompt).toContain('Also ticked for Builder, but not on this machine, so they did not load: `nope`.');
  });

  it("on Claude Code, reads the file of a skill the Skill tool refuses, one only a typed /name may run", async () => {
    const bro = join(home, '.claude', 'skills', 'bro', 'SKILL.md');
    mkdirSync(join(bro, '..'), { recursive: true });
    writeFileSync(bro, '---\nname: bro\ndescription: Restate it\ndisable-model-invocation: true\n---\nRestate it.\n');
    await tick(['bro', 'tdd']);
    const t = await r.start('fix the parser', { role: 'builder', harness: 'claude-code', model: 'sonnet' });
    await r.untilResults(t.id, 1);
    const prompt = claudePrompt(t.id);
    expect(prompt).toContain('one call per skill, even when the task looks like it does not need it: `tdd`.');
    expect(prompt).toContain(`These load from their files, since Claude Code does not load them itself here: read each SKILL.md in full before anything else and follow it as a skill: \`bro\` (${bro}).`);
  });

  it("on Codex, sends each skill Codex lists with the session's first turn, and none with the next", async () => {
    await tick(['tdd', 'ship-check']);
    const t = await r.start('fix the parser', { role: 'builder', ...codex });
    await r.untilResults(t.id, 1);
    await r.runner.postMessage(t.id, 'and add a test');
    await r.untilResults(t.id, 2);
    expect(inputs(t.id)).toEqual([[text('fix the parser'), TDD, SHIP_CHECK], [text('and add a test')]]);
    const start = r.codexRequests().find((q) => q.method === 'thread/start' && q.thread_id === t.id);
    expect(start.params.developerInstructions).toContain('Builder loads these skills in every thread. They came loaded with your first message: `tdd`, `ship-check`. Follow them.');
  });

  it('loads none once they are unticked, on either harness', async () => {
    await tick(null);
    const claude = await r.start('fix the parser', { role: 'builder', harness: 'claude-code', model: 'sonnet' });
    const gpt = await r.start('fix the parser', { role: 'builder', ...codex });
    await r.untilResults(claude.id, 1);
    await r.untilResults(gpt.id, 1);
    expect(claudePrompt(claude.id)).not.toContain('## Skills');
    expect(inputs(gpt.id)).toEqual([[text('fix the parser')]]);
  });
});

describe('where skills do not load', () => {
  const role = { skills: ['tdd'] };
  const thread = (harness: string, extra = {}) => ({ harness, cwd: join(r.tmp, 'scratch'), ...extra });

  it('loads none on a harness that runs off this machine, in a quick ask, or for an agent with none ticked', async () => {
    for (const h of ['hermes', 'cursor-cloud', 'custom:nomos']) expect(await threadSkills(role, thread(h), r.tmp)).toBeNull();
    expect(await threadSkills(role, thread('claude-code', { quick: 1 }), r.tmp)).toBeNull();
    expect(await threadSkills({ skills: [] }, thread('claude-code'), r.tmp)).toBeNull();
  });

  it('has Cursor Agent load each by name from its first prompt', () => {
    expect(skillLines({ harness: 'cursor', native: [{ name: 'tdd' }], files: [], missing: [] }, 'Builder')).toEqual([
      '',
      '## Skills',
      'Builder loads these skills in every thread. Before anything else, load each one and follow it, even when the task looks like it does not need it: `tdd`.',
    ]);
  });
});
