// Group threads, slice 3 (ADR 0019): agents named in one message work at the same time in the thread's one worktree.
// Each takes a slot from its own harness's cap. Omni records which files each agent's turn edited, tells each running
// agent which files the other changed when two touch the same one (a steer for Claude Code and Codex, the next turn
// for Cursor Agent), and flags the file as a collision in the transcript and in Changes until the next commit or
// Ben's dismissal. One turn checkpoint covers the whole message. Stop ends every agent; only the lead commits.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CURSOR } from './support.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
const T = { timeout: 40_000 };

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body !== undefined && { body: JSON.stringify(body) }),
});
const call = async (path: string, init?: RequestInit) => {
  const res = await app.request(`/api${path}`, init);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};
const mention = (agent: string, name: string) => ({ id: randomUUID().slice(0, 12), kind: 'agent_mention', v: 1, label: `@${name}`, body: { agent, name } });
const say = (threadId: string, prompt: string, ...agents: [string, string][]) =>
  call(`/threads/${threadId}/messages`, json('POST', { prompt, context: agents.map(([a, n]) => mention(a, n)) }));

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

const sessionOf = (threadId: string, agent: string) => (agent === 'lead' ? threadId : H.db.members.of(threadId, agent)!.session_thread);
/** The text each of an agent's Claude Code processes read, in order. */
const readBy = (threadId: string, agent: string) => H.claudeTexts(sessionOf(threadId, agent));
const membersOf = async (threadId: string) => (await call(`/threads/${threadId}`)).json.thread.members as { agent: string; state: string }[];
const busy = (threadId: string) =>
  [threadId, ...H.db.members.all(threadId).map((m) => m.session_thread)].some((id) => ['running', 'queued'].includes(H.thread(id).status));
const untilIdle = (threadId: string, results: number) =>
  H.until(`${results} results in ${threadId}`, () => !busy(threadId) && H.byKind(threadId, 'result').length >= results, 25_000);

let n = 0;
/** A worktree channel on a fresh repo with one commit. */
function repoChannel() {
  const dir = join(H.tmp, `parallel-repo-${++n}`);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  const id = `parallel-${n}`;
  H.db.channels.create({ id, name: id, repo_path: dir, use_worktree: 1 });
  return id;
}

async function groupThread(channel = 'scratch') {
  const t = await H.runner.createThread({ channel, prompt: 'plain start', role: 'lead' });
  await H.untilResults(t.id, 1);
  return H.thread(t.id);
}

beforeAll(async () => {
  // Two Claude Code slots, so a third Claude Code agent named with two others queues; Cursor Agent has slots of its own.
  H = await startRunner({ OMNI_MAX_CONCURRENT: '2', OMNI_CURSOR_BIN: FAKE_CURSOR });
  ({ app } = await import('../app.ts'));
  for (const [id, name, harness] of [['lead', 'Lead', 'claude-code'], ['designer', 'Designer', 'claude-code'], ['critic', 'Critic', 'claude-code'], ['cursory', 'Cursory', 'cursor']]) {
    const fields = { name, harness, ...(harness === 'claude-code' && { model: 'sonnet' }) };
    expect((await call('/crew', json('POST', { id, fields, charter: `You are ${name}.` }))).status).toBe(201);
  }
  const svc = await import('../harness/catalog-service.ts');
  await svc.loadCatalog();
});

describe('parallel turns', () => {
  it('starts the agents one message names together, each in a slot of its own harness, and queues past the cap', T, async () => {
    const t = await groupThread();
    expect((await say(t.id, 'TOOL:1200 all three, go', ['lead', 'Lead'], ['designer', 'Designer'], ['critic', 'Critic'])).status).toBe(200);
    // Two Claude Code slots: the lead and Designer run at once, Critic waits for a slot.
    const status = (agent: string) => H.thread(sessionOf(t.id, agent)).status;
    const count = (s: string) => ['lead', 'designer', 'critic'].filter((a) => status(a) === s).length;
    await H.until('two agents at work', () => count('running') === 2 && count('queued') === 1);
    // The thread's mark counts all three: a queued agent is at work too.
    expect(Object.fromEntries((await membersOf(t.id)).map((m) => [m.agent, m.state]))).toEqual({ lead: 'working', designer: 'working', critic: 'working' });
    await untilIdle(t.id, 4);
    // Each read the message without the others' replies to it: they ran side by side.
    expect(readBy(t.id, 'designer')[0]).not.toContain('### Lead');
    expect(readBy(t.id, 'critic')[0]).not.toContain('### Designer');
  });

  it("lists a group thread with its agents in its channel, so the row draws their faces", T, async () => {
    const channel = repoChannel();
    const t = await groupThread(channel);
    await say(t.id, 'TOOL:1200 both of you, go', ['lead', 'Lead'], ['designer', 'Designer']);
    await H.until('both at work', () => ['lead', 'designer'].every((a) => H.thread(sessionOf(t.id, a)).status === 'running'));
    const listed = (await call('/channels')).json.find((c: { id: string }) => c.id === channel);
    const row = [...(listed.active ?? []), ...(listed.recent ?? [])].find((x: { id: string }) => x.id === t.id);
    expect(row.members.map((m: { agent: string; state: string }) => [m.agent, m.state])).toEqual([['lead', 'working'], ['designer', 'working']]);
    await untilIdle(t.id, 3);
  });

  it('tells each running agent mid-turn what the other changed when both edit a.ts, and flags a.ts', T, async () => {
    const t = await groupThread(repoChannel());
    await say(t.id, 'WRITE:a.ts TOOL:1500 both of you edit a.ts', ['lead', 'Lead'], ['designer', 'Designer']);
    await H.until('a collision on a.ts', () => H.byKind(t.id, 'collision').length > 0);
    // While both still run, the mark shows both avatars.
    expect((await membersOf(t.id)).map((m) => m.state)).toEqual(['working', 'working']);
    await untilIdle(t.id, 3);

    const [flag] = H.byKind(t.id, 'collision');
    expect(flag.p.path).toBe('a.ts');
    expect([...flag.p.agents].sort()).toEqual(['designer', 'lead']);
    // Each was told in the same turn, as a steer: one turn each for the message, and the notice among what it read.
    const toLead = readBy(t.id, 'lead').at(-1)!;
    const toDesigner = readBy(t.id, 'designer').at(-1)!;
    expect(toLead).toMatch(/Designer changed these files/);
    expect(toLead).toContain('a.ts');
    expect(toDesigner).toMatch(/Lead changed these files/);
    expect(H.byKind(t.id, 'result')).toHaveLength(3);
    // Changes flags it and still shows one combined diff.
    const changes = await call(`/threads/${t.id}/changes`);
    expect(changes.status).toBe(200);
    expect(changes.json.collisions.map((c: { path: string; label: string }) => [c.path, c.label])).toEqual([['a.ts', 'a.ts']]);
    expect(changes.json.groups.flatMap((g: { files: { path: string }[] }) => g.files.map((f) => f.path))).toContain('a.ts');
    // The Conductor sees the flag on the thread's summary.
    expect((await call(`/threads/${t.id}/summary`)).json.collisions).toEqual([{ path: 'a.ts', agents: flag.p.agents }]);
    // The notice is no message of Ben's: the transcript shows none.
    expect(H.byKind(t.id, 'user').map((u) => u.p.text)).toEqual(['plain start', 'WRITE:a.ts TOOL:1500 both of you edit a.ts']);
  });

  it('tells Cursor Agent at its next turn, without interrupting the one it runs', T, async () => {
    const t = await groupThread(repoChannel());
    await say(t.id, 'WRITE:a.ts TOOL:1200 edit a.ts', ['lead', 'Lead'], ['cursory', 'Cursory']);
    await untilIdle(t.id, 3);
    expect(H.byKind(t.id, 'collision')).toHaveLength(1);
    // The lead was told mid-turn; Cursor Agent ran its one turn whole.
    expect(readBy(t.id, 'lead').at(-1)).toMatch(/Cursory changed these files/);
    const sid = sessionOf(t.id, 'cursory');
    const prompts = () => H.cursorRequests().filter((r) => r.thread_id === sid && typeof r.prompt === 'string').map((r) => r.prompt as string);
    expect(prompts()).toHaveLength(1);
    await say(t.id, 'next step', ['cursory', 'Cursory']);
    await untilIdle(t.id, 4);
    expect(prompts().at(-1)).toMatch(/Lead changed these files[\s\S]*a\.ts/);
  });

  it('clears a flag at the lead’s next commit, and Ben can dismiss one sooner', T, async () => {
    const t = await groupThread(repoChannel());
    await say(t.id, 'WRITE:a.ts TOOL:1200 both edit', ['lead', 'Lead'], ['designer', 'Designer']);
    await untilIdle(t.id, 3);
    const [flag] = H.byKind(t.id, 'collision');
    // Ben dismisses it.
    expect((await call(`/threads/${t.id}/collisions/${flag.id}/dismiss`, json('POST'))).status).toBe(200);
    expect((await call(`/threads/${t.id}/changes`)).json.collisions).toEqual([]);
    expect(H.byKind(t.id, 'collision_cleared').map((e) => e.p)).toEqual([{ keys: [flag.p.key], by: 'dismiss' }]);

    // A second collision, then the lead commits: it clears.
    await say(t.id, 'WRITE:a.ts TOOL:1200 again', ['lead', 'Lead'], ['designer', 'Designer']);
    await untilIdle(t.id, 5);
    expect((await call(`/threads/${t.id}/changes`)).json.collisions).toHaveLength(1);
    const script = join(H.tmp, `commit-${t.id}.sh`);
    writeFileSync(script, 'set -e\ngit add -A\ngit -c user.email=t@example.com -c user.name=t commit -q -m "lead commits"\n');
    await call(`/threads/${t.id}/messages`, json('POST', { prompt: `RUN:${script} commit it` }));
    await untilIdle(t.id, 6);
    await H.until('cleared at the commit', () => H.byKind(t.id, 'collision_cleared').some((e) => e.p.by === 'commit'));
    expect((await call(`/threads/${t.id}/changes`)).json.collisions).toEqual([]);
  });

  it('saves one turn checkpoint for the message across every agent', T, async () => {
    const t = await groupThread(repoChannel());
    await H.until('first turn saved', () => H.db.turnSnapshots.forThread(t.id)[0]?.state === 'ready');
    await say(t.id, 'WRITE:lead.ts THINK:200 yours', ['lead', 'Lead'], ['designer', 'Designer']);
    await untilIdle(t.id, 3);
    await H.until('message turn saved', () => H.db.turnSnapshots.forThread(t.id).length === 2 && H.db.turnSnapshots.forThread(t.id)[0].state === 'ready');
    // No checkpoint of its own for a member's session: the thread's one covers both agents' edits.
    expect(H.db.turnSnapshots.forThread(sessionOf(t.id, 'designer'))).toHaveLength(0);
    const turn = (await call(`/threads/${t.id}/turns`)).json;
    expect(turn.groups[0].files.map((f: { path: string }) => f.path)).toEqual(['lead.ts']);
  });

  it('Stop ends every running agent', T, async () => {
    const t = await groupThread();
    await say(t.id, 'TOOL:6000 long work', ['lead', 'Lead'], ['designer', 'Designer']);
    await H.until('both running', () => H.thread(t.id).status === 'running' && H.thread(sessionOf(t.id, 'designer')).status === 'running');
    expect((await call(`/threads/${t.id}/stop`, json('POST'))).status).toBe(200);
    await H.until('both stopped', () => !busy(t.id));
    expect(H.thread(t.id).status).toBe('stopped');
    expect(H.thread(sessionOf(t.id, 'designer')).status).toBe('stopped');
  });

  it('steers only the agents a message goes to: a plain one, only the lead', T, async () => {
    const t = await groupThread();
    await say(t.id, 'TOOL:1500 long work', ['lead', 'Lead'], ['designer', 'Designer']);
    await H.until('both running', () => H.thread(t.id).status === 'running' && H.thread(sessionOf(t.id, 'designer')).status === 'running');
    await call(`/threads/${t.id}/messages`, json('POST', { prompt: 'lead only' }));
    await untilIdle(t.id, 3);
    expect(readBy(t.id, 'lead').at(-1)).toMatch(/lead only$/);
    expect(readBy(t.id, 'designer').some((x) => x.includes('lead only'))).toBe(false);
    // Steered into the turn the lead was running: no turn of its own.
    expect(H.byKind(t.id, 'result')).toHaveLength(3);
  });

  it('lets only the lead commit: a member edits files only', T, async () => {
    const t = await groupThread(repoChannel());
    await say(t.id, 'look', ['designer', 'Designer']);
    await untilIdle(t.id, 2);
    const spawn = H.spawns(sessionOf(t.id, 'designer'))[0];
    const denied = spawn.args[spawn.args.indexOf('--disallowedTools') + 1] as string;
    expect(denied).toContain('Bash(git commit:*)');
    expect(denied).toContain('Bash(git push:*)');
    const prompt = spawn.args[spawn.args.indexOf('--append-system-prompt') + 1] as string;
    expect(prompt).toMatch(/Lead leads this thread/);
    expect(prompt).not.toMatch(/The conductor handed you this task/);
    // The lead keeps git.
    const lead = H.spawns(t.id)[0];
    expect(lead.args[lead.args.indexOf('--disallowedTools') + 1]).not.toContain('git commit');
  });
});
