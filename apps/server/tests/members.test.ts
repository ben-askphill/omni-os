// Group threads, slice 2 (ADR 0019, runner/members.ts): Ben seats agents in a thread with a typed agent mention, and
// each one answers there in a session of its own. A message with no mention goes to the lead; one with mentions goes
// only to the agents it names, which run at once (slice 3, parallel-members.test.ts). Each agent's turn opens with the messages
// since its last turn that it did not write, without tool calls; a new member's first opens with a small-model catch-up.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { CALLER_HEADER as CALLER } from '../caller-header.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
const T = { timeout: 30_000 };

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

/** The member thread an agent runs in. */
const sessionOf = (threadId: string, agent: string) => H.db.members.of(threadId, agent)!.session_thread;
/** The text each of an agent's sessions read, in order. */
const readBy = (threadId: string, agent: string) => H.claudeTexts(agent === 'lead' ? threadId : sessionOf(threadId, agent));
const replies = (threadId: string) => H.byKind(threadId, 'assistant_text').map((e) => [H.db.events.since(threadId).find((r) => r.id === e.id)!.agent, e.p.text as string]);
/** Every agent's session in the thread is idle and has `n` results between them. */
const untilIdle = (threadId: string, results: number) =>
  H.until(`${results} results in ${threadId}`, () => {
    const busy = [threadId, ...H.db.members.all(threadId).map((m) => m.session_thread)].some((id) => ['running', 'queued'].includes(H.thread(id).status));
    return !busy && H.byKind(threadId, 'result').length >= results;
  }, 20_000);

beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
  for (const [id, name] of [['lead', 'Lead'], ['designer', 'Designer'], ['critic', 'Critic']]) {
    expect((await call('/crew', json('POST', { id, fields: { name, harness: 'claude-code', model: 'sonnet' }, charter: `You are ${name}.` }))).status).toBe(201);
  }
});

async function groupThread(prompt = 'RICH plan the feature') {
  const t = await H.runner.createThread({ channel: 'scratch', prompt, role: 'lead' });
  await H.untilResults(t.id, 1);
  return t;
}

/** Hold exactly one small-model call so a test can act while the member's catch-up is in flight. */
async function holdCatchUp() {
  const aux = await import('../runner/aux.ts');
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<string | null>();
  const spy = vi.spyOn(aux, 'askHaiku').mockImplementationOnce(() => {
    started.resolve();
    return release.promise;
  });
  return {
    started: started.promise,
    finish() {
      release.resolve('Catch-up ready.');
      spy.mockRestore();
    },
  };
}

describe('seating by agent mention', () => {
  it('Stop cancels member starts still waiting for a catch-up', T, async () => {
    const t = await groupThread('plain start');
    const catchUp = await holdCatchUp();
    try {
      expect((await say(t.id, 'cancel this part', ['designer', 'Designer'])).status).toBe(200);
      await catchUp.started;
      expect((await call(`/threads/${t.id}/stop`, json('POST'))).status).toBe(200);
    } finally {
      catchUp.finish();
    }
    expect((await say(t.id, 'start fresh', ['designer', 'Designer'])).status).toBe(200);
    await untilIdle(t.id, 2);
    expect(readBy(t.id, 'designer')).toEqual([expect.stringContaining('start fresh')]);
  });

  it('seats a named agent, which alone replies, and writes the message once with a joined line', T, async () => {
    const t = await groupThread();
    expect((await say(t.id, 'look at the design', ['designer', 'Designer'])).status).toBe(200);
    await untilIdle(t.id, 2);

    expect(H.db.members.seated(t.id).map((m) => [m.agent, m.lead])).toEqual([['lead', 1], ['designer', 0]]);
    // Ben's message once, addressed; a joined line before it; the reply is Designer's.
    const users = H.byKind(t.id, 'user');
    expect(users.map((u) => u.p.text)).toEqual(['RICH plan the feature', 'look at the design']);
    expect(users[1].p.to).toEqual(['designer']);
    expect(H.byKind(t.id, 'member').map((e) => [e.p.event, e.p.agent])).toEqual([['joined', 'designer']]);
    expect(replies(t.id).at(-1)?.[0]).toBe('designer');
    // Only Designer's CLI got the message: the lead read nothing more.
    expect(readBy(t.id, 'lead')).toEqual(['RICH plan the feature']);
    expect(readBy(t.id, 'designer')).toHaveLength(1);
    // The member's session is a thread of its own, listed nowhere.
    const sid = sessionOf(t.id, 'designer');
    expect(H.thread(sid)).toMatchObject({ source: 'member', parent_id: t.id, role: 'designer' });
    expect(H.db.threads.byChannel('scratch').map((x) => x.id)).not.toContain(sid);
    expect(H.db.threads.children(t.id).map((x) => x.id)).not.toContain(sid);
  });

  it('tells only a lead who it is: a member’s system prompt already seats it (#1015)', T, async () => {
    const t = await groupThread();
    await say(t.id, 'have a look', ['designer', 'Designer']);
    await untilIdle(t.id, 2);
    const sid = sessionOf(t.id, 'designer');
    const spawned = H.spawns(sid)[0];
    const prompt = spawned.args[spawned.args.indexOf('--append-system-prompt') + 1] as string;
    expect(prompt).toContain('## Group thread');
    expect(prompt).toMatch(/Lead leads this thread/);
    // Designer said something; the lead's next turn opens with it, and with who the lead is, which its prompt lacks.
    await call(`/threads/${t.id}/messages`, json('POST', { prompt: 'and now?' }));
    await untilIdle(t.id, 3);
    const lead = readBy(t.id, 'lead').at(-1)!;
    expect(lead).toMatch(/^\[Group thread\] You are Lead, the lead of this thread\./);
    expect(lead).toContain('### Designer');
  });

  it('opens a new member with a small-model catch-up, then the messages since its last turn without tool calls', T, async () => {
    const t = await groupThread();
    await say(t.id, 'first look', ['designer', 'Designer']);
    await untilIdle(t.id, 2);
    const [first] = readBy(t.id, 'designer');
    expect(first).toMatch(/^\[Catch-up\]/);
    expect(first).toContain('Fake catch-up of 2 messages.');
    expect(first).toContain('first look');
    // The catch-up ran on the small model, not on the lead.
    expect(H.invocations().some((i) => i.mode !== 'stream' && i.entrypoint === 'omni-os-catch-up')).toBe(true);

    // The lead replies with a tool call (RICH); Designer then reads the lead's reply, authored, and none of its tools.
    await call(`/threads/${t.id}/messages`, json('POST', { prompt: 'RICH carry on' }));
    await untilIdle(t.id, 3);
    await say(t.id, 'what do you think now', ['designer', 'Designer']);
    await untilIdle(t.id, 4);
    const second = readBy(t.id, 'designer')[1];
    // Designer's system prompt seats it (Group thread), so the preamble does not say who it is again (#1015).
    expect(second).toMatch(/^\[Group thread\] The messages since your last turn/);
    expect(first).not.toMatch(/You are Designer|an agent seated in this thread/);
    expect(second).not.toMatch(/You are Designer|an agent seated in this thread/);
    expect(second).toContain('### Lead');
    expect(second).toContain('### the user\n\nRICH carry on');
    // The lead's turn ran tools (RICH): none of them, nor their output, reaches Designer.
    const tools = H.byKind(t.id, 'tool_use').map((e) => e.p.name as string);
    expect(tools.length).toBeGreaterThan(0);
    expect(H.byKind(t.id, 'tool_result').some((e) => second.includes(String(e.p.content ?? e.p.text ?? '').slice(0, 40)) && String(e.p.content ?? e.p.text ?? '').length > 20)).toBe(false);
    expect(second).toContain('---\n\nwhat do you think now');
  });

  it('includes a concurrent reply on the turn after a member’s catch-up', T, async () => {
    const t = await groupThread('plain start');
    const catchUp = await holdCatchUp();
    const concurrent = 'one more detail from Lead';
    let reply = '';
    try {
      await say(t.id, 'first look', ['designer', 'Designer']);
      await catchUp.started;
      await say(t.id, concurrent);
      reply = await H.until('Lead replied during catch-up', () => replies(t.id).find(([a, text]) => a === 'lead' && text?.includes(concurrent))?.[1]);
    } finally {
      catchUp.finish();
    }
    await untilIdle(t.id, 3);
    await say(t.id, 'second look', ['designer', 'Designer']);
    await untilIdle(t.id, 4);
    expect(readBy(t.id, 'designer')[1]).toContain(`### Lead\n\n${reply.trim()}`);
  });

  it('gives the lead the members’ replies since its last turn, and names the lead to a plain message', T, async () => {
    const t = await groupThread('plain start');
    await say(t.id, 'designer, sketch it', ['designer', 'Designer']);
    await untilIdle(t.id, 2);
    await call(`/threads/${t.id}/messages`, json('POST', { prompt: 'lead, what did designer say' }));
    await untilIdle(t.id, 3);
    const toLead = readBy(t.id, 'lead');
    expect(toLead).toHaveLength(2);
    expect(toLead[1]).toContain('### Designer');
    expect(toLead[1]).toContain('designer, sketch it');
    expect(toLead[1].endsWith('lead, what did designer say')).toBe(true);
    // No mention: the reply is the lead's, and Designer read nothing more.
    expect(replies(t.id).at(-1)?.[0]).toBe('lead');
    expect(readBy(t.id, 'designer')).toHaveLength(1);
  });

  it('runs several named agents at once, and each reads the others’ replies at its next turn', T, async () => {
    const t = await groupThread('plain start');
    await say(t.id, 'THINK:300 both of you, go', ['critic', 'Critic'], ['designer', 'Designer']);
    await untilIdle(t.id, 3);
    expect(replies(t.id).slice(1).map(([a]) => a).sort()).toEqual(['critic', 'designer']);
    // Side by side: neither read the other's reply to the same message.
    expect(readBy(t.id, 'designer')[0]).not.toContain('### Critic');
    expect(readBy(t.id, 'critic')[0]).not.toContain('### Designer');
    // Naming a seated member again seats nothing more, and it now reads what the other said.
    await say(t.id, 'critic again', ['critic', 'Critic']);
    await untilIdle(t.id, 4);
    expect(readBy(t.id, 'critic')[1]).toContain('### Designer');
    expect(H.db.members.seated(t.id).map((m) => m.agent)).toEqual(['lead', 'critic', 'designer']);
    expect(H.byKind(t.id, 'member')).toHaveLength(2);
  });

  it('naming the lead with a member sends to both, and an @name in a reply seats no one', T, async () => {
    const t = await groupThread('plain start');
    await say(t.id, 'SAY:@Critic please weigh in', ['lead', 'Lead'], ['designer', 'Designer']);
    await untilIdle(t.id, 3);
    expect(replies(t.id).slice(1).map(([a]) => a).sort()).toEqual(['designer', 'lead']);
    expect(H.db.members.of(t.id, 'critic')).toBeUndefined();
  });

  it('refuses the Conductor and an agent this machine has not got, before saving anything', T, async () => {
    const t = await groupThread('plain start');
    expect((await say(t.id, 'hi', ['conductor', 'Conductor'])).status).toBe(400);
    expect((await say(t.id, 'hi', ['nobody', 'Nobody'])).status).toBe(400);
    expect(H.byKind(t.id, 'user')).toHaveLength(1);
  });
});

describe('an agent mention on a new thread', () => {
  const create = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    call('/threads', { ...json('POST', { channel: 'scratch', role: 'lead', ...body }), headers: { 'content-type': 'application/json', ...headers } });

  it('seats the named agent, which alone answers the first message; the lead starts at the next plain message', T, async () => {
    const res = await create({ prompt: 'polish the copy', context: [mention('designer', 'Designer')] });
    expect(res.status).toBe(200);
    const id = res.json.id as string;
    await untilIdle(id, 1);

    expect(H.db.members.seated(id).map((m) => [m.agent, m.lead])).toEqual([['lead', 1], ['designer', 0]]);
    const users = H.byKind(id, 'user');
    expect(users.map((u) => [u.p.text, u.p.to])).toEqual([['polish the copy', ['designer']]]);
    expect(users[0].p.context).toEqual([expect.objectContaining({ kind: 'agent_mention', body: { agent: 'designer', name: 'Designer' } })]);
    expect(replies(id).map(([a]) => a)).toEqual(['designer']);
    // The lead has not run: the thread does not wait as queued for it.
    expect(readBy(id, 'lead')).toEqual([]);
    expect(H.thread(id).status).toBe('done');

    expect((await call(`/threads/${id}/messages`, json('POST', { prompt: 'now the lead' }))).status).toBe(200);
    await untilIdle(id, 2);
    expect(readBy(id, 'lead')).toEqual([expect.stringContaining('now the lead')]);
    expect(replies(id).at(-1)?.[0]).toBe('lead');
  });

  it('in a worktree channel, sends the first message to the named agent once the worktree is ready', T, async () => {
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' });
    const dir = join(H.tmp, 'repo-mention');
    mkdirSync(dir);
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'start');
    H.db.channels.create({ id: 'repo-mention', name: 'repo-mention', repo_path: dir, use_worktree: 1 });
    const res = await create({ channel: 'repo-mention', prompt: 'review the start', context: [mention('critic', 'Critic')] });
    expect(res.status).toBe(200);
    const id = res.json.id as string;
    await untilIdle(id, 1);
    expect(H.byKind(id, 'user').map((u) => u.p.to)).toEqual([['critic']]);
    expect(replies(id).map(([a]) => a)).toEqual(['critic']);
    expect(readBy(id, 'lead')).toEqual([]);
    expect(H.thread(id)).toMatchObject({ status: 'done', setup: null });
  });

  it('naming the lead with a member sends the first message to both', T, async () => {
    const res = await create({ prompt: 'both of you', context: [mention('lead', 'Lead'), mention('critic', 'Critic')] });
    expect(res.status).toBe(200);
    await untilIdle(res.json.id, 2);
    expect(replies(res.json.id).map(([a]) => a).sort()).toEqual(['critic', 'lead']);
  });

  it('refuses the Conductor, a quick ask, and an agent thread outside its own delegations, making no thread', T, async () => {
    const before = H.db.threads.byChannel('scratch').length;
    expect((await create({ prompt: 'hi', context: [mention('conductor', 'Conductor')] })).status).toBe(400);
    expect((await create({ prompt: 'hi', context: [mention('nobody', 'Nobody')] })).status).toBe(400);
    expect((await create({ prompt: 'hi', quick: true, context: [mention('designer', 'Designer')] })).status).toBe(400);
    const parent = await groupThread('plain start');
    const other = await create({ prompt: 'hi', context: [mention('designer', 'Designer')] }, { [CALLER]: parent.id });
    expect(other.status).toBe(403);
    expect(H.db.threads.byChannel('scratch').length).toBe(before + 1);
  });
});

describe('the member list', () => {
  it('Add an agent seats with a joined line and no turn; its first named turn opens with the catch-up', T, async () => {
    const t = await groupThread('plain start');
    const added = await call(`/threads/${t.id}/members`, json('POST', { agent: 'critic' }));
    expect(added.status).toBe(200);
    expect(added.json.members.map((m: { agent: string }) => m.agent)).toEqual(['lead', 'critic']);
    expect(H.byKind(t.id, 'member').map((e) => e.p.event)).toEqual(['joined']);
    expect(H.spawns(sessionOf(t.id, 'critic'))).toHaveLength(0);
    await say(t.id, 'now you', ['critic', 'Critic']);
    await untilIdle(t.id, 2);
    expect(readBy(t.id, 'critic')[0]).toMatch(/^\[Catch-up\]/);
  });

  it('shows members on the thread with their runs, and refuses to remove the lead', T, async () => {
    const t = await groupThread('plain start');
    await call(`/threads/${t.id}/members`, json('POST', { agent: 'designer' }));
    const got = await call(`/threads/${t.id}`);
    expect(got.json.thread.members.map((m: { agent: string; lead: boolean; harness: string }) => [m.agent, m.lead, m.harness])).toEqual([
      ['lead', true, 'claude-code'],
      ['designer', false, 'claude-code'],
    ]);
    expect((await call(`/threads/${t.id}/members/lead`, json('DELETE'))).status).toBe(409);
  });

  it('shows the Conductor the members of a group thread, and never lets an agent seat one', T, async () => {
    const t = await groupThread('plain start');
    await call(`/threads/${t.id}/members`, json('POST', { agent: 'designer' }));
    const summary = await call(`/threads/${t.id}/summary`);
    expect(summary.json.members.map((m: { agent: string; lead: boolean; state: string }) => [m.agent, m.lead, m.state])).toEqual([
      ['lead', true, 'done'],
      ['designer', false, 'idle'],
    ]);
    const listed = await call('/threads?channel=scratch&limit=50');
    expect(listed.json.find((r: { id: string }) => r.id === t.id).members.map((m: { name: string }) => m.name)).toEqual(['Lead', 'Designer']);
    const asAgent = { ...json('POST', { agent: 'critic' }), headers: { 'content-type': 'application/json', [CALLER]: t.id } };
    expect((await call(`/threads/${t.id}/members`, asAgent)).status).toBe(403);
  });

  it('removing a member closes its session and keeps its replies; seating it again starts a new session', T, async () => {
    const t = await groupThread('plain start');
    await say(t.id, 'hello designer', ['designer', 'Designer']);
    await untilIdle(t.id, 2);
    const first = sessionOf(t.id, 'designer');
    expect((await call(`/threads/${t.id}/members/designer`, json('DELETE'))).status).toBe(200);
    expect(H.byKind(t.id, 'member').map((e) => e.p.event)).toEqual(['joined', 'left']);
    await H.until('designer session closed', () => !H.runner.isLive(first));
    expect(replies(t.id).some(([a]) => a === 'designer')).toBe(true);
    await say(t.id, 'back again', ['designer', 'Designer']);
    await untilIdle(t.id, 3);
    const second = sessionOf(t.id, 'designer');
    expect(second).not.toBe(first);
    expect(H.spawns(second)[0].resume).toBe(false);
  });

  it('a member removed mid-turn finishes its turn, then the left line follows its reply', T, async () => {
    const t = await groupThread('plain start');
    await say(t.id, 'THINK:800 slow work', ['designer', 'Designer']);
    await H.untilStatus(sessionOf(t.id, 'designer'), 'running');
    expect((await call(`/threads/${t.id}/members/designer`, json('DELETE'))).status).toBe(200);
    expect(H.byKind(t.id, 'member').map((e) => e.p.event)).toEqual(['joined']);
    await untilIdle(t.id, 2);
    await H.until('left line', () => H.byKind(t.id, 'member').length === 2);
    const rows = H.db.events.since(t.id);
    const reply = rows.findLast((r) => r.kind === 'assistant_text')!;
    const left = rows.find((r) => r.kind === 'member' && JSON.parse(r.payload).event === 'left')!;
    expect(left.id).toBeGreaterThan(reply.id);
  });
});

describe('cards and the thread', () => {
  it('dismisses only the questions of the agents receiving a message', T, async () => {
    const t = await groupThread('plain start');
    await say(t.id, 'get started', ['designer', 'Designer'], ['critic', 'Critic']);
    await untilIdle(t.id, 3);
    const ask = (id: string) => call(`/threads/${id}/questions`, json('POST', { questions: [{ question: 'Which one?', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }] }));
    const state = async (id: string, question: string) => (await call(`/threads/${id}/questions/${question}?wait=0`)).json.state;
    const designer = sessionOf(t.id, 'designer');
    const critic = sessionOf(t.id, 'critic');
    const leadQuestion = (await ask(t.id)).json.id;
    const designerQuestion = (await ask(designer)).json.id;
    const criticQuestion = (await ask(critic)).json.id;
    await say(t.id, 'go with A', ['critic', 'Critic']);
    expect(await state(critic, criticQuestion)).toBe('dismissed');
    expect(await state(designer, designerQuestion)).toBe('pending');
    expect(await state(t.id, leadQuestion)).toBe('pending');
    await say(t.id, 'go with B');
    expect(await state(t.id, leadQuestion)).toBe('dismissed');
    expect(await state(designer, designerQuestion)).toBe('pending');
    await untilIdle(t.id, 5);
  });

  it('shows a member’s question card in the thread, naming it, and answers into that member’s session', T, async () => {
    const t = await groupThread('plain start');
    await say(t.id, 'TOOL:4000 think it over', ['designer', 'Designer']);
    const sid = sessionOf(t.id, 'designer');
    await H.untilTool(t.id);
    // The member's ask_user_question call asks on its own session, as its MCP server does.
    const asked = await call(`/threads/${sid}/questions`, json('POST', { questions: [{ question: 'Which one?', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }] }));
    expect(asked.status).toBe(200);
    const q = H.db.events.since(t.id).find((r) => r.kind === 'question')!;
    expect(q.agent).toBe('designer');
    // Its call waits on its own session while Ben answers on the group thread's card.
    const waiting = call(`/threads/${sid}/questions/${asked.json.id}?wait=10`);
    const answered = await call(`/threads/${t.id}/questions/${asked.json.id}/answer`, json('POST', { answers: [{ selected: ['A'], other: null }] }));
    expect(answered.status).toBe(200);
    expect(answered.json.via).toBe('tool');
    expect((await waiting).json.state).toBe('answered');
    expect(H.db.events.since(t.id).find((r) => r.kind === 'question_answer')!.agent).toBeNull();
    await untilIdle(t.id, 2);
  });

  it('a thread whose lead agent was deleted goes read-only', T, async () => {
    expect((await call('/crew', json('POST', { id: 'gone', fields: { name: 'Gone', harness: 'claude-code', model: 'sonnet' }, charter: 'x' }))).status).toBe(201);
    const t = await H.runner.createThread({ channel: 'scratch', prompt: 'start', role: 'gone' });
    await H.untilResults(t.id, 1);
    expect((await call('/crew/gone', json('DELETE'))).status).toBeLessThan(300);
    const got = await call(`/threads/${t.id}`);
    expect(got.json.thread.read_only).toMatch(/deleted/);
    expect((await call(`/threads/${t.id}/messages`, json('POST', { prompt: 'more' }))).status).toBe(409);
  });

  it('an Ask from an older client seats the agent in the asking thread', T, async () => {
    const t = await groupThread('plain start');
    const asked = await call(`/threads/${t.id}/ask`, json('POST', { role: 'critic', question: 'is this right?' }));
    expect(asked.status).toBeLessThan(300);
    await untilIdle(t.id, 2);
    expect(H.db.members.of(t.id, 'critic')?.removed_at).toBeNull();
    expect(replies(t.id).at(-1)?.[0]).toBe('critic');
    expect(H.db.threads.children(t.id)).toHaveLength(0);
  });

  it('refuses fork and continue while a member still runs', T, async () => {
    const t = await groupThread('plain start');
    await say(t.id, 'THINK:1500 long', ['designer', 'Designer']);
    await H.untilStatus(sessionOf(t.id, 'designer'), 'running');
    const r = await call(`/threads/${t.id}/continue`, json('POST', { harness: 'claude-code', model: 'sonnet', text: 'go on', request_id: 'r1', revision: 'x' }));
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.json)).toMatch(/Designer is still working/);
    await untilIdle(t.id, 2);
  });

  it('blocks moves and forks and stops a running member after it was removed', T, async () => {
    const t = await groupThread('plain start');
    await say(t.id, 'TOOL:15000 long edit', ['designer', 'Designer']);
    const sid = sessionOf(t.id, 'designer');
    await H.untilTool(t.id);
    expect((await call(`/threads/${t.id}/members/designer`, json('DELETE'))).status).toBe(200);
    const handoff = await call(`/threads/${t.id}/handoff`, json('POST', { to: 'another-machine' }));
    const fork = await call(`/threads/${t.id}/continue`, json('POST', { harness: 'claude-code', model: 'sonnet', text: 'go on', request_id: 'r1', revision: 'x' }));
    const stopped = await call(`/threads/${t.id}/stop`, json('POST'));
    expect(stopped.status).toBe(200);
    expect(handoff.json.error).toMatch(/Designer is still working/);
    expect(fork.json.error).toMatch(/Designer is still working/);
    await H.untilStatus(sid, 'stopped');
  });
});
