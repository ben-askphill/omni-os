// A team is one thread (ADR 0019, slice 6): delegate_team seats the lead and a member per agent with a part, the
// lead plans on the brief first and gives each member its part with message_members (POST /threads/:id/team/messages,
// with the lead's own thread token), the members run at once, and once every one has finished Omni wakes the lead with
// their replies. The crew report goes when that turn ends. Only the Conductor's own delegations get seats from it,
// never a #conductor thread. Teams made before this slice keep their tree.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { legacyTeam } from './legacy-team.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let tokenFile: (threadId: string) => string;
let mint: (threadId: string) => { token: string };

const T = { timeout: 40_000 };

type Res = { status: number; json: any };
/** A call as Ben's client (no caller), or as the thread whose token `token` is. */
async function call(method: string, path: string, body?: unknown, token?: string): Promise<Res> {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** The live token of a thread's harness process, as its MCP servers read it. */
const liveToken = (threadId: string) => readFileSync(tokenFile(threadId), 'utf8').trim();

const PARTS = [
  { title: 'Copy', prompt: 'write the copy', role: 'copywriter' },
  { title: 'Visuals', prompt: 'make the visuals', role: 'designer' },
  { title: 'Critique', prompt: 'critique the page', role: 'critic' },
];

/** delegate_team as the Conductor thread `conductor` calls it. */
const team = (conductor: string, extra: Record<string, unknown> = {}) =>
  call('POST', '/threads/team', { channel: 'scratch', title: 'Launch page', prompt: 'Plan the launch page', role: 'lead', task_id: 'T-9', tasks: PARTS, ...extra }, mint(conductor).token);

/** The lead's message_members call. */
const tell = (threadId: string, to: string[], message: string) => call('POST', `/threads/${threadId}/team/messages`, { to, message }, liveToken(threadId));

const sessionOf = (threadId: string, agent: string) => H.db.members.of(threadId, agent)!.session_thread;
/** The rows an agent wrote in the group thread. */
const rowsBy = (threadId: string, agent: string, kind: string) => H.db.events.since(threadId).filter((r) => r.kind === kind && r.agent === agent);

async function idle(prompt: string) {
  const t = await H.start(prompt);
  await H.untilResults(t.id, 1);
  return H.thread(t.id);
}

beforeAll(async () => {
  H = await startRunner({ FAKE_CLAUDE_CRASH_ON: 'CRASH_NOW' });
  ({ app } = await import('../app.ts'));
  ({ threadTokenPath: tokenFile } = await import('../config.ts'));
  ({ mintThreadToken: mint } = await import('../thread-tokens.ts'));
  for (const [id, name] of [['lead', 'Lead'], ['copywriter', 'Copywriter'], ['designer', 'Designer'], ['critic', 'Critic']]) {
    expect((await call('POST', '/crew', { id, fields: { name, harness: 'claude-code', model: 'sonnet' }, charter: `You are ${name}.` })).status).toBe(201);
  }
});

describe('delegate_team', () => {
  it('makes one thread with the lead and every member seated, whose first message is the brief to the lead', T, async () => {
    const conductor = await idle('be the conductor');
    const res = await team(conductor.id);
    expect(res.status).toBe(200);
    const t = res.json.thread;
    expect(t).toMatchObject({ channel_id: 'scratch', parent_id: conductor.id, task_id: 'T-9', source: 'conductor', role: 'lead' });
    expect(res.json.members).toEqual([
      { agent: 'copywriter', name: 'Copywriter', parts: ['Copy'] },
      { agent: 'designer', name: 'Designer', parts: ['Visuals'] },
      { agent: 'critic', name: 'Critic', parts: ['Critique'] },
    ]);
    expect(H.db.members.seated(t.id).map((m) => [m.agent, m.lead])).toEqual([['lead', 1], ['copywriter', 0], ['designer', 0], ['critic', 0]]);
    // One thread in the channel: the members run in hidden sessions under it.
    expect(H.db.threads.children(conductor.id).map((c) => c.id)).toEqual([t.id]);

    await H.untilResults(t.id, 1);
    const [brief, ...rest] = H.byKind(t.id, 'user');
    expect(rest).toEqual([]);
    expect(brief.p.source).toBe('conductor');
    expect(brief.p.text).toMatch(/^Plan the launch page\n\n## Your team's parts\n\n### Copywriter \(agent id `copywriter`\)\n\n\*\*Copy\*\*: write the copy/);
    // The lead planned first, and nobody else ran.
    expect(H.claudeTexts(t.id)).toHaveLength(1);
    for (const p of PARTS) expect(H.spawns(sessionOf(t.id, p.role))).toEqual([]);
  });

  it('the lead messages each member its part, they run at once, and it wakes once with every reply before its report goes', T, async () => {
    const conductor = await idle('be the conductor');
    const { thread: t } = (await team(conductor.id, { prompt: 'TOOL:2500 Plan the launch page' })).json;
    await H.untilTool(t.id);
    for (const [agent, part] of [['copywriter', 'THINK:900 write the copy'], ['designer', 'THINK:900 make the visuals'], ['Critic', 'THINK:900 critique it']]) {
      const sent = await tell(t.id, [agent], part);
      expect(sent.status).toBe(200);
    }
    // All three at once, while the lead still plans.
    await H.until('every member running', () => PARTS.every((p) => H.thread(sessionOf(t.id, p.role)).status === 'running'));
    expect(H.thread(t.id).status).toBe('running');

    // The planning turn ends first: no report reaches the Conductor for it.
    await H.until('the planning turn over', () => rowsBy(t.id, 'lead', 'result').length === 1);
    expect(H.byKind(conductor.id, 'crew_report')).toEqual([]);

    // Once all three have finished, the lead wakes once with their replies, and that turn's end sends the one report.
    await H.until('the report', () => H.byKind(conductor.id, 'crew_report').length === 1, 20_000);
    const texts = H.claudeTexts(t.id);
    expect(texts).toHaveLength(2);
    const woke = texts[1];
    expect(woke).toMatch(/^\[team\] All 3 members have finished\./);
    for (const [name, part] of [['Copywriter', 'write the copy'], ['Designer', 'make the visuals'], ['Critic', 'critique it']]) {
      expect(woke).toContain(`### ${name} · done`);
      expect(woke).toContain(part);
    }
    const wake = H.byKind(t.id, 'user').at(-1)!;
    expect(wake.p).toMatchObject({ text: 'All 3 members have finished.', source: 'team' });
    const [report] = H.byKind(conductor.id, 'crew_report');
    expect(report.p).toMatchObject({ thread_id: t.id, task_id: 'T-9', status: 'done' });
    expect(report.p.text).toContain('All 3 members have finished');
    expect(report.p.text).not.toContain('Plan the launch page');
    // The lead's messages are the lead's in the transcript, each to its member.
    const sent = H.db.events.since(t.id).filter((r) => r.kind === 'user' && JSON.parse(r.payload).source === 'lead');
    expect(sent.map((r) => [r.agent, JSON.parse(r.payload).to])).toEqual([['lead', ['copywriter']], ['lead', ['designer']], ['lead', ['critic']]]);
  });

  it('waits while a member waits on Ben, shown as Needs you, and counts a failed member as finished', T, async () => {
    const conductor = await idle('be the conductor');
    const { thread: t } = (await team(conductor.id, { prompt: 'TOOL:1500 Plan the launch page', tasks: PARTS.slice(0, 2) })).json;
    await H.untilTool(t.id);
    expect((await tell(t.id, ['copywriter'], 'TOOL:3000 write the copy')).status).toBe(200);
    expect((await tell(t.id, ['designer'], 'CRASH_NOW make the visuals')).status).toBe(200);
    // The copywriter asks Ben while its turn runs.
    const writer = sessionOf(t.id, 'copywriter');
    await H.untilTool(writer);
    const asked = await call('POST', `/threads/${writer}/questions`, { questions: [{ question: 'Formal or casual?', header: 'Tone', options: [{ label: 'Formal', description: 'B2B.' }, { label: 'Casual', description: 'Fun.' }], multiSelect: false }] });
    expect(asked.status).toBe(200);
    await H.until('the designer failed', () => H.thread(sessionOf(t.id, 'designer')).status === 'failed');
    await H.until('the planning turn over', () => rowsBy(t.id, 'lead', 'result').length === 1);
    const members = (await call('GET', `/threads/${t.id}`)).json.thread.members as { agent: string; state: string }[];
    expect(members.find((m) => m.agent === 'copywriter')!.state).toBe('needs');
    expect(H.claudeTexts(t.id)).toHaveLength(1);
    // The Conductor's crew_questions names the member that asks, on the team thread's one task id.
    const crew = (await call('GET', `/threads/${conductor.id}/crew-questions`)).json.items;
    expect(crew.map((c: any) => [c.thread_id, c.task_id, c.member])).toEqual([[t.id, 'T-9', { agent: 'copywriter', name: 'Copywriter' }]]);

    // Ben answers; once the copywriter finishes, the lead wakes with both, the failure said.
    expect((await call('POST', `/threads/${t.id}/questions/${asked.json.id}/answer`, { answers: [{ selected: ['Casual'], other: null }] })).status).toBe(200);
    await H.until('the report', () => H.byKind(conductor.id, 'crew_report').length === 1, 20_000);
    const woke = H.claudeTexts(t.id)[1];
    expect(woke).toContain('### Copywriter · done');
    expect(woke).toContain('### Designer · failed');
    expect(woke).toMatch(/Omni: claude exited with code 1/);
    expect(woke).toContain('what Designer could not finish');
  });

  it('gives an agent with two parts one seat, with both parts under it in the brief', T, async () => {
    const conductor = await idle('be the conductor');
    const tasks = [
      { title: 'Headline', prompt: 'write the headline', role: 'copywriter' },
      { title: 'Visuals', prompt: 'make the visuals', role: 'designer' },
      { title: 'Body', prompt: 'write the body', role: 'copywriter' },
      { title: 'Wrap up', prompt: 'sum it up' },
    ];
    const res = await team(conductor.id, { tasks });
    expect(res.json.members).toEqual([
      { agent: 'copywriter', name: 'Copywriter', parts: ['Headline', 'Body'] },
      { agent: 'designer', name: 'Designer', parts: ['Visuals'] },
    ]);
    const t = res.json.thread;
    expect(H.db.members.seated(t.id).map((m) => m.agent)).toEqual(['lead', 'copywriter', 'designer']);
    await H.untilResults(t.id, 1);
    const brief = H.byKind(t.id, 'user')[0].p.text as string;
    expect(brief).toContain('### Copywriter (agent id `copywriter`)\n\n1. **Headline**: write the headline\n\n2. **Body**: write the body');
    // A part that names no agent is the lead's own.
    expect(brief).toContain('## Parts for you\n\n**Wrap up**: sum it up');
  });

  it("refuses a team whose every part is the lead's, and a member the server cannot seat", T, async () => {
    const conductor = await idle('be the conductor');
    const alone = await team(conductor.id, { tasks: [{ title: 'All', prompt: 'do it all' }] });
    expect(alone.status).toBe(400);
    expect(alone.json.error).toMatch(/use delegate/);
    const conductorSeat = await team(conductor.id, { tasks: [{ title: 'Route', prompt: 'route', role: 'conductor' }] });
    expect(conductorSeat.status).toBe(409);
    expect(H.db.threads.children(conductor.id)).toEqual([]);
  });
});

describe('message_members', () => {
  it('posts only to seated members, from the team lead alone, and seats no one', T, async () => {
    const conductor = await idle('be the conductor');
    const { thread: t } = (await team(conductor.id, { prompt: 'TOOL:3000 plan', tasks: PARTS.slice(0, 1) })).json;
    await H.untilTool(t.id);
    // Not a member: refused, and nobody is seated.
    const stranger = await tell(t.id, ['designer'], 'make the visuals');
    expect(stranger.status).toBe(400);
    expect(stranger.json.error).toMatch(/not a member of this team\. Members: Copywriter \(copywriter\)/);
    // An @name in the text is plain text.
    expect((await tell(t.id, ['copywriter'], 'write the copy, and ask @designer for help')).status).toBe(200);
    await H.until('the copywriter running', () => H.spawns(sessionOf(t.id, 'copywriter')).length === 1);
    expect(H.db.members.seated(t.id).map((m) => m.agent)).toEqual(['lead', 'copywriter']);
    // Ben, a member's own token and another thread are refused.
    expect((await call('POST', `/threads/${t.id}/team/messages`, { to: ['copywriter'], message: 'hi' })).status).toBe(403);
    expect((await call('POST', `/threads/${t.id}/team/messages`, { to: ['copywriter'], message: 'hi' }, mint(sessionOf(t.id, 'copywriter')).token)).status).toBe(403);
    expect((await call('POST', `/threads/${t.id}/team/messages`, { to: ['copywriter'], message: 'hi' }, mint(conductor.id).token)).status).toBe(403);
  });

  it('works only in a team thread', T, async () => {
    const plain = await H.start('TOOL:3000 plain thread', { role: 'lead' });
    await H.untilTool(plain.id);
    const res = await tell(plain.id, ['copywriter'], 'hi');
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/only in a team thread/);
  });
});

describe('seating by an agent thread', () => {
  it('lets the Conductor seat agents only in a thread it delegated, outside #conductor', T, async () => {
    if (!H.db.channels.get('conductor')) H.db.channels.create({ id: 'conductor', name: 'Conductor', kind: 'internal', use_worktree: 0, base_dir: H.tmp });
    const conductor = await idle('be the conductor');
    const as = mint(conductor.id).token;
    const mention = (agent: string, name: string) => ({ id: `m-${agent}`, kind: 'agent_mention', v: 1, label: `@${name}`, body: { agent, name } });

    // At creation: a team or a delegation with members in #conductor is refused, and nothing is made.
    const inConductor = await call('POST', '/threads/team', { channel: 'conductor', title: 'x', prompt: 'x', role: 'lead', tasks: PARTS.slice(0, 1) }, as);
    expect(inConductor.status).toBe(403);
    expect(inConductor.json.error).toMatch(/never seated in a #conductor thread/);
    expect((await call('POST', '/threads', { channel: 'conductor', prompt: 'x', role: 'lead', members: ['designer'] }, as)).status).toBe(403);
    expect(H.db.threads.children(conductor.id)).toEqual([]);

    // delegate with members: seated with no turn; the brief goes to the lead, whose report comes back as before.
    const made = await call('POST', '/threads', { channel: 'scratch', prompt: 'build the page', role: 'lead', members: ['designer'], task_id: 'T-12' }, as);
    expect(made.status).toBe(200);
    const d = made.json;
    expect(d).toMatchObject({ parent_id: conductor.id, task_id: 'T-12' });
    expect(H.db.members.seated(d.id).map((m) => m.agent)).toEqual(['lead', 'designer']);
    await H.until('the report', () => H.byKind(conductor.id, 'crew_report').length === 1);
    expect(H.spawns(sessionOf(d.id, 'designer'))).toEqual([]);

    // A follow-up that mentions an agent seats it in the thread the Conductor delegated, and it works there.
    const follow = await call('POST', `/threads/${d.id}/messages`, { prompt: '@Critic check it', from: 'conductor', context: [mention('critic', 'Critic')], wake_cold: true }, as);
    expect(follow.status).toBe(200);
    await H.until('the critic replied', () => rowsBy(d.id, 'critic', 'result').length === 1);
    const critic = H.db.events.since(d.id).find((r) => r.kind === 'user' && JSON.parse(r.payload).to)!;
    expect(JSON.parse(critic.payload)).toMatchObject({ source: 'conductor', to: ['critic'] });

    // Not in a thread it did not delegate, nor in a #conductor thread, its own included.
    const bens = await idle('ben started this');
    const notMine = await call('POST', `/threads/${bens.id}/messages`, { prompt: '@Critic look', context: [mention('critic', 'Critic')], wake_cold: true }, as);
    expect(notMine.status).toBe(403);
    expect(notMine.json.error).toMatch(/only in a thread it delegated/);
    const own = H.db.threads.create({ ...H.thread(conductor.id), id: crypto.randomUUID(), channel_id: 'conductor', parent_id: conductor.id, session_id: crypto.randomUUID() });
    expect((await call('POST', `/threads/${own.id}/messages`, { prompt: '@Critic look', context: [mention('critic', 'Critic')], wake_cold: true }, as)).status).toBe(403);
    expect(H.db.members.seated(bens.id)).toEqual([]);

    // Ben seats agents in #conductor as anywhere (slice 2).
    const mine = await H.runner.createThread({ channel: 'conductor', prompt: 'mine', role: 'lead' });
    await H.untilResults(mine.id, 1);
    expect((await call('POST', `/threads/${mine.id}/messages`, { prompt: '@Critic look', context: [mention('critic', 'Critic')] })).status).toBe(200);
    expect(H.db.members.seated(mine.id).map((m) => m.agent)).toEqual(['lead', 'critic']);
  });
});

describe('a team made before one-thread teams', () => {
  it('keeps its tree: the members run, then the lead once with every reply, then one report to the Conductor', T, async () => {
    const conductor = await idle('be the conductor');
    const { lead, members } = await legacyTeam(H, {
      channel: 'scratch',
      title: 'Mic research',
      prompt: 'Research the mic',
      parent_id: conductor.id,
      task_id: 'T-8',
      tasks: [
        { title: 'Price', prompt: 'find the price' },
        { title: 'Reviews', prompt: 'THINK:600 find reviews' },
      ],
    });
    expect(members.map((m) => [m.parent_id, m.source, m.task_id])).toEqual([
      [lead.id, 'team', 'T-8.1'],
      [lead.id, 'team', 'T-8.2'],
    ]);
    await H.until('first report on the lead', () => H.byKind(lead.id, 'crew_report').length === 1);
    expect(H.spawns(lead.id)).toHaveLength(0);
    await H.untilResults(lead.id, 1);
    expect(H.flow(lead.id)).toEqual(['user', 'crew_report', 'crew_report', 'user', 'assistant_text', 'result']);
    expect(H.byKind(lead.id, 'user')[1].p).toMatchObject({ text: 'All 2 reports are in.', source: 'team' });
    await H.untilResults(conductor.id, 2);
    expect(H.byKind(conductor.id, 'crew_report').map((e) => e.p.thread_id)).toEqual([lead.id]);
    // Its lead gets no message_members: it is not a team thread.
    expect((await tell(lead.id, ['researcher'], 'hi')).status).toBe(409);
  });
});
