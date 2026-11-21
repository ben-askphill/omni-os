import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { haikuAnswer, jevPicks, jevQuestions, scrubbed, SELF } from '../agent-router/routers.ts';
import { startRunner } from './runner-boot.ts';

// The shadow agent router (agent-router/shadow.ts): the first message of a new #conductor thread goes to Jev (a fake
// TypeSafe API here) and Haiku (the fake CLI's router answer), and the row they fill is joined with what the
// Conductor did in that turn. Nothing about the thread changes, whatever the routers do.

const KEY = 'jev-test-key-6c1f9a3e7b2d';
const jevCalls: { auth?: string; body: any }[] = [];
let jev: Server;
let H: Awaited<ReturnType<typeof startRunner>>;

beforeAll(async () => {
  jev = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const body = JSON.parse(raw);
      jevCalls.push({ auth: req.headers.authorization, body });
      const msg: string = body.state.message;
      // A refusal that echoes the request's key back, as a careless API might.
      if (msg.includes('JEV_FAIL')) return res.writeHead(401, { 'content-type': 'text/plain' }).end(`bad key: ${req.headers.authorization}`);
      const pick = /ROUTE:([\w-]+)/.exec(msg)?.[1] ?? SELF;
      const answers = Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: 'noul', noul: k === pick ? 0.91 : 0.1 }]));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'jev-1.14.0', answers, usage: { input_tokens: 900, output_tokens: 90 } }));
    });
  });
  await new Promise<void>((done) => jev.listen(0, '127.0.0.1', done));
  H = await startRunner({ OMNI_SHADOW_ROUTER: '1', OMNI_JEV_API_URL: `http://127.0.0.1:${(jev.address() as AddressInfo).port}`, OMNI_SECRET_STORE: 'file' });
  const { setSecret } = await import('../secrets.ts');
  await setSecret('global', 'JEV_API_KEY', KEY);
});

afterAll(() => new Promise<void>((done) => jev.close(() => done())));

const T = { timeout: 20_000 };

type Row = Record<string, any>;
const row = (threadId: string) => H.db.db.prepare('SELECT * FROM agent_router_shadow WHERE thread_id = ?').get(threadId) as Row | undefined;
const list = (v: string | null) => (v == null ? null : (JSON.parse(v) as string[]));
const conductor = (prompt: string) => H.start(prompt, { channel: 'conductor', role: 'conductor' });
/** The row once both routers answered and the Conductor's turn ended. */
const settled = (threadId: string) =>
  H.until(`shadow row of ${threadId}`, () => {
    const r = row(threadId);
    return r && r.conductor_at && (r.jev_picks || r.jev_error) && (r.haiku_picks || r.haiku_error) ? r : null;
  });

describe('shadow agent router', () => {
  it('logs both routers and the agent the Conductor delegated to in that turn', T, async () => {
    const t = await conductor('TOOL:1500 ROUTE:researcher why did checkout conversion drop last week?');
    // The Conductor delegates while its turn runs, as delegate does.
    await H.start('research the checkout drop', { parent_id: t.id, source: 'conductor', role: 'researcher' });
    await H.untilResults(t.id, 1);
    const r = await settled(t.id);

    expect(list(r.jev_picks)).toEqual(['researcher']);
    expect(r.jev_confidence).toBeCloseTo(0.91);
    expect(JSON.parse(r.jev_scores)).toMatchObject({ [SELF]: 0.1, researcher: 0.91, builder: 0.1 });
    expect(r).toMatchObject({ jev_model: 'jev-1.14.0', jev_tokens: 900, jev_error: null });
    expect(list(r.haiku_picks)).toEqual(['researcher']);
    expect(r).toMatchObject({ haiku_model: 'claude-haiku-5-5', haiku_via: 'cli', haiku_confidence: 0.8, haiku_error: null });
    expect(r.haiku_cost_usd).toBeGreaterThan(0);
    expect(r.jev_ms).toBeGreaterThanOrEqual(0);
    expect(r.haiku_ms).toBeGreaterThan(0);
    expect(list(r.conductor_picks)).toEqual(['researcher']);
    expect(r.conductor_status).toBe('done');

    // The agents on offer are the crew's delegatable ones at call time, the Conductor left out.
    const offered = list(r.agents)!;
    expect(offered).toEqual(expect.arrayContaining(['builder', 'researcher', 'reviewer']));
    expect(offered).not.toContain('conductor');
    const call = jevCalls.find((c) => c.body.state.message.includes('checkout conversion'))!;
    expect(Object.keys(call.body.questions)).toEqual([SELF, ...offered]);
    expect(call.auth).toBe(`Bearer ${KEY}`);
    const haiku = H.invocations().find((i) => i.entrypoint === 'omni-os-agent-router')!;
    expect(haiku.args).toEqual(expect.arrayContaining(['--model', 'claude-haiku-5-5', '--json-schema', '--system-prompt']));
  });

  it('logs no agent for a message the Conductor answers itself, and later turns change nothing', T, async () => {
    const t = await conductor('what is running right now?');
    await H.untilResults(t.id, 1);
    const r = await settled(t.id);
    expect(list(r.jev_picks)).toEqual([SELF]);
    expect(list(r.haiku_picks)).toEqual([SELF]);
    expect(list(r.conductor_picks)).toEqual([]);

    // A delegation in a later turn is that turn's, not the first message's.
    H.runner.sendMessage(t.id, 'TOOL:600 now build it');
    await H.until('second turn running', () => H.thread(t.id).status === 'running');
    await H.start('build it', { parent_id: t.id, source: 'conductor', role: 'builder' });
    await H.untilResults(t.id, 2);
    expect(row(t.id)).toMatchObject({ conductor_picks: '[]', conductor_at: r.conductor_at });
  });

  it('runs off the user path: the thread starts and its turn ends before a slow router answers', T, async () => {
    const t = await conductor('ROUTE_SLOW:2500 ROUTE:builder fix the cart drawer');
    expect(row(t.id)).toMatchObject({ haiku_picks: null, conductor_at: null });
    await H.untilResults(t.id, 1);
    expect(row(t.id)).toMatchObject({ haiku_picks: null, conductor_picks: '[]' });
    const r = await settled(t.id);
    expect(list(r.haiku_picks)).toEqual(['builder']);
    expect(r.haiku_ms).toBeGreaterThanOrEqual(2500);
  });

  it('logs a failed router and leaves the thread as it would be without the router', T, async () => {
    const t = await conductor('JEV_FAIL ROUTE_FAIL fix the checkout bug');
    await H.untilResults(t.id, 1);
    const r = await settled(t.id);
    expect(r.jev_error).toMatch(/^HTTP 401: bad key: Bearer \[redacted\]/);
    expect(r.haiku_error).toBe('the Haiku call failed or timed out');
    expect(r).toMatchObject({ jev_picks: null, haiku_picks: null, conductor_picks: '[]', conductor_status: 'done' });
    expect(H.thread(t.id).status).toBe('done');
    expect(H.texts(t.id, 'user')).toEqual(['JEV_FAIL ROUTE_FAIL fix the checkout bug']);
    expect(H.byKind(t.id, 'result')).toHaveLength(1);
    expect(H.byKind(t.id, 'error')).toEqual([]);
  });

  it('logs a missing Jev key and still asks Haiku', T, async () => {
    const { deleteSecret, setSecret } = await import('../secrets.ts');
    await deleteSecret('global', 'JEV_API_KEY');
    try {
      const t = await conductor('ROUTE:writer draft the release notes');
      await H.untilResults(t.id, 1);
      const r = await settled(t.id);
      expect(r).toMatchObject({ jev_error: 'JEV_API_KEY is not set', jev_picks: null });
      expect(list(r.haiku_picks)).toEqual(['writer']);
    } finally {
      await setSecret('global', 'JEV_API_KEY', KEY);
    }
  });

  it('never stores the Jev key', T, async () => {
    expect(jevCalls.some((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
    const rows = H.db.db.prepare('SELECT * FROM agent_router_shadow').all();
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(rows)).not.toContain(KEY);
    // Nor anywhere else in the database, its write-ahead log included.
    H.db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    for (const f of [H.paths.db, `${H.paths.db}-wal`]) if (existsSync(f)) expect(readFileSync(f).includes(KEY)).toBe(false);
  });

  it('logs only a new #conductor thread the user started', T, async () => {
    const elsewhere = await H.start('ROUTE:builder hello');
    const automated = await H.start('ROUTE:builder hello', { channel: 'conductor', role: 'conductor', source: 'automation' });
    await Promise.all([H.untilResults(elsewhere.id, 1), H.untilResults(automated.id, 1)]);
    expect(row(elsewhere.id)).toBeUndefined();
    expect(row(automated.id)).toBeUndefined();
  });

  it('scores the log with agreement.sql', T, async () => {
    H.db.db.exec('DELETE FROM agent_router_shadow');
    const ids = await Promise.all([1, 2, 3, 4].map((n) => H.start(`seed ${n}`).then((t) => t.id)));
    const insert = H.db.db.prepare(
      `INSERT INTO agent_router_shadow (thread_id, message_at, agents, jev_picks, jev_scores, haiku_picks, conductor_picks, conductor_at, created_at, updated_at)
       VALUES (?, '2026-11-21T10:00:00.000Z', '["builder","researcher"]', ?, ?, ?, ?, ?, '2026-11-21T10:00:00.000Z', '2026-11-21T10:00:00.000Z')`,
    );
    const scores = (self: number, builder: number, researcher: number) => JSON.stringify({ [SELF]: self, builder, researcher });
    // 1: all agree on builder. 2: the Conductor answered itself; Jev agrees, Haiku says researcher.
    // 3: the Conductor sent it to researcher; Jev says builder, Haiku researcher (jev+haiku: researcher).
    // 4: still in its turn, so not scored.
    insert.run(ids[0], '["builder"]', scores(0.1, 0.9, 0.2), '["builder"]', '["builder"]', '2026-11-21T10:01:00.000Z');
    insert.run(ids[1], `["${SELF}"]`, scores(0.8, 0.3, 0.2), '["researcher"]', '[]', '2026-11-21T10:01:00.000Z');
    insert.run(ids[2], '["builder"]', scores(0.1, 0.7, 0.6), '["researcher","builder"]', '["researcher"]', '2026-11-21T10:01:00.000Z');
    insert.run(ids[3], '["builder"]', scores(0.1, 0.7, 0.6), '["builder"]', null, null);

    const sql = readFileSync(join(import.meta.dirname, '../agent-router/agreement.sql'), 'utf8');
    expect(H.db.db.prepare(sql).all()).toEqual([
      { router: 'jev', scored: 3, agree: 2, agree_pct: 66.7, answer_or_delegate: 100, both_delegated: 2, agent_if_both: 50 },
      { router: 'haiku', scored: 3, agree: 2, agree_pct: 66.7, answer_or_delegate: 66.7, both_delegated: 2, agent_if_both: 100 },
      { router: 'jev+haiku', scored: 3, agree: 3, agree_pct: 100, answer_or_delegate: 100, both_delegated: 2, agent_if_both: 100 },
    ]);
  });
});

describe('router answers', () => {
  it("takes Jev's most likely answer first, then any other agent it is sure of", () => {
    expect(jevPicks({ [SELF]: 0.2, builder: 0.9, researcher: 0.75, reviewer: 0.4 })).toEqual({ picks: ['builder', 'researcher'], confidence: 0.9 });
    expect(jevPicks({ [SELF]: 0.8, builder: 0.71 })).toEqual({ picks: [SELF, 'builder'], confidence: 0.8 });
    expect(jevPicks({})).toEqual({ picks: [], confidence: null });
  });

  it('asks Jev one question per agent, built from its description', () => {
    const q = jevQuestions([{ id: 'writer', name: 'Writer', description: 'Drafts writing in the user voice.' }]);
    expect(Object.keys(q)).toEqual([SELF, 'writer']);
    expect(q.writer).toMatchObject({ type: 'noul', instructions: expect.stringContaining('the Writer agent'), criteria: { true: expect.stringContaining('Drafts writing') } });
  });

  it("reads Haiku's structured answer, or its result text, and drops agents not on offer", () => {
    const agents = [{ id: 'builder', name: 'Builder', description: '' }];
    const out = (o: object) => JSON.stringify({ type: 'result', is_error: false, total_cost_usd: 0.001, ...o });
    expect(haikuAnswer(out({ structured_output: { agents: ['builder', 'ghost'], confidence: 1.4 } }), agents)).toMatchObject({ picks: ['builder'], confidence: 1, costUsd: 0.001 });
    expect(haikuAnswer(out({ result: JSON.stringify({ agents: [SELF], confidence: 0.6 }) }), agents)).toMatchObject({ picks: [SELF], confidence: 0.6 });
    expect(() => haikuAnswer(out({ structured_output: { agents: ['ghost'], confidence: 0.5 } }), agents)).toThrow('picked no agent');
    expect(() => haikuAnswer(out({ is_error: true, result: 'overloaded' }), agents)).toThrow('failed: overloaded');
    expect(() => haikuAnswer('not json', agents)).toThrow('no JSON');
    expect(() => haikuAnswer(null, agents)).toThrow('failed or timed out');
  });

  it('keeps a secret out of an error it logs', () => {
    expect(scrubbed('HTTP 401: bad key sk-123 sk-123', 'sk-123')).toBe('HTTP 401: bad key [redacted] [redacted]');
    expect(scrubbed('x'.repeat(500))).toHaveLength(300);
  });
});
