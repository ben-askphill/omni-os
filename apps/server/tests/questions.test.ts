import { afterAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startRunner } from './runner-boot.ts';
import { sleep } from './support.ts';

// ask_user_question (apps/mcp/ask.ts, apps/server/runner/questions.ts) through the real runner and the fake claude CLI.
// The server listens on a real port, so the fake's ASK directive starts the omni-ask MCP server from the thread's
// mcp.json and that server polls the API exactly as it does under Claude Code.

const h = await startRunner();
const { app } = await import('../app.ts');
const { serve } = await import('@hono/node-server');
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
await once(server, 'listening');
const { about } = await import('../about.ts');
about.port = (server.address() as AddressInfo).port;
// A waiting call's long poll holds a connection open, which close() alone would wait for.
afterAll(() => {
  server.close();
  server.closeAllConnections();
});
const T = { timeout: 30_000 };

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const ok = async (method: string, path: string, body?: unknown) => {
  const res = await call(method, path, body);
  if (res.status !== 200) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

const Q4 = {
  question: 'Which Q4 goal should get the most of your time?',
  header: 'Q4 focus',
  options: [
    { label: 'Acne POC', description: 'Prove the move on one market.' },
    { label: 'Volero hypercare', description: 'Stay close while orders ramp up.' },
  ],
  multiSelect: false,
};
const MAIL = {
  question: 'Which clients get a weekly status email?',
  options: [
    { label: 'Volero', description: 'Imports and tickets.' },
    { label: 'Kamera Express', description: 'Migration milestones.' },
    { label: 'Pink Gellac', description: 'Page builds.' },
  ],
  multiSelect: true,
};

const ask = (id: string, questions: unknown[]) => ok('POST', `/threads/${id}/questions`, { questions }).then((r) => r.id as string);
const poll = (id: string, qid: string, wait = 0) => ok('GET', `/threads/${id}/questions/${qid}?wait=${wait}`);
const answer = (id: string, qid: string, answers: unknown) => call('POST', `/threads/${id}/questions/${qid}/answer`, { answers });
const blockers = async (id: string) =>
  (((await ok('GET', '/needs-you')).items as any[]).find((i) => i.thread.id === id)?.blockers ?? []).filter((b: any) => b.kind === 'question');
const answerEvents = (id: string) => h.byKind(id, 'question_answer').map((e) => e.p);
const idle = async (prompt = 'plan the quarter') => {
  const t = await h.start(prompt);
  await h.untilResults(t.id, 1);
  return t.id;
};
const busy = async (prompt = 'TOOL:5000 audit the checkout') => {
  const t = await h.start(prompt);
  await h.untilTool(t.id);
  return t.id;
};

describe('asking', () => {
  it('refuses a call it cannot show, with what the agent should fix', T, async () => {
    const id = await idle();
    const refused = async (body: unknown) => {
      const res = await call('POST', `/threads/${id}/questions`, body);
      expect(res.status).toBe(400);
      return res.body.error as string;
    };
    expect(await refused({})).toBe('questions must be a list of 1 to 4 questions');
    expect(await refused({ questions: [Q4, MAIL, Q4, MAIL, Q4] })).toBe('questions must be a list of 1 to 4 questions');
    expect(await refused({ questions: [{ ...Q4, options: [...Q4.options, { label: 'Other', description: '' }] }] })).toBe(
      'questions[0].options[2] is "Other": leave it out, the card always offers it',
    );
    expect(h.byKind(id, 'question')).toEqual([]);
    expect((await call('POST', '/threads/nope/questions', { questions: [Q4] })).status).toBe(404);
  });

  it('puts the card in the thread and in Needs you, even while the thread runs', T, async () => {
    const id = await busy();
    const qid = await ask(id, [Q4, MAIL]);
    expect(h.byKind(id, 'question').map((e) => e.p)).toEqual([{ id: qid, questions: [Q4, { ...MAIL, multiSelect: true }] }]);
    expect(h.thread(id).status).toBe('running');
    expect(await blockers(id)).toEqual([{ kind: 'question', detail: Q4.question, count: 2, at: expect.any(String) }]);
    expect(await poll(id, qid)).toEqual({ state: 'pending', text: 'The user has not answered yet.' });
    expect((await call('GET', `/threads/${id}/questions/nope`)).status).toBe(404);
  });
  it('shortens a header over 12 characters instead of refusing the call', T, async () => {
    const id = await idle();
    await ask(id, [{ ...Q4, header: 'Quarter focus' }]);
    expect(h.byKind(id, 'question')[0].p.questions[0].header).toBe('Quarter foc…');
  });
});

describe('answering', () => {
  it('returns the answers to the waiting call, which hears them at once, and adds no message', T, async () => {
    const id = await busy();
    const qid = await ask(id, [Q4, MAIL]);
    await poll(id, qid);
    const started = Date.now();
    const waiting = poll(id, qid, 20);
    const res = await answer(id, qid, [{ selected: ['Volero hypercare'], other: null }, { selected: ['Volero', 'Pink Gellac'], other: 'and Acne' }]);
    expect(res).toEqual({ status: 200, body: { state: 'answered', via: 'tool' } });
    expect(await waiting).toEqual({
      state: 'answered',
      text:
        'User has answered your questions: "Which Q4 goal should get the most of your time?"="Volero hypercare", ' +
        '"Which clients get a weekly status email?"="Volero, Pink Gellac, and Acne". You can now continue with the user\'s answers in mind.',
    });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await blockers(id)).toEqual([]);
    await h.untilResults(id, 1);
    expect(h.texts(id, 'user')).toEqual(['TOOL:5000 audit the checkout']);
  });

  it('checks the answers against the questions, and keeps the first answer', T, async () => {
    const id = await busy();
    const qid = await ask(id, [Q4, MAIL]);
    await poll(id, qid);
    const bad = async (answers: unknown) => {
      const res = await answer(id, qid, answers);
      expect(res.status).toBe(400);
      return res.body.error as string;
    };
    expect(await bad([null])).toBe('answers must have 2 entries');
    expect(await bad([{ selected: ['KE go-live'], other: null }, null])).toBe('answers[0] picks an option the question does not have');
    expect(await bad([{ selected: ['Acne POC', 'Volero hypercare'], other: null }, null])).toBe('answers[0] picks more than one on a single choice question');
    expect(answerEvents(id)).toEqual([]);

    expect((await answer(id, qid, [null, null])).body).toEqual({ state: 'skipped', via: 'tool' });
    const again = await answer(id, qid, [{ selected: ['Acne POC'], other: null }, null]);
    expect(again.status).toBe(409);
    expect(again.body.state).toBe('skipped');
    expect(answerEvents(id)).toEqual([{ id: qid, state: 'skipped', answers: [null, null], via: 'tool' }]);
    expect(await poll(id, qid)).toEqual({
      state: 'skipped',
      text: 'The user skipped these questions without answering. Go on with your best judgement and say what you assumed.',
    });
  });

  it('sends the answers as a message when no call waits for them, and the thread runs on them', T, async () => {
    const id = await idle();
    const qid = await ask(id, [Q4]);
    expect(await blockers(id)).toEqual([{ kind: 'question', detail: Q4.question, count: 1, at: expect.any(String) }]);
    expect((await answer(id, qid, [{ selected: [], other: 'Kamera Express first' }])).body).toEqual({ state: 'answered', via: 'message' });
    const said =
      'User has answered your questions: "Which Q4 goal should get the most of your time?"="Kamera Express first". ' +
      "You can now continue with the user's answers in mind.";
    await h.untilResults(id, 2);
    expect(h.texts(id, 'user')).toEqual(['plan the quarter', said]);
    expect(h.texts(id, 'assistant_text').at(-1)).toBe(`ack: ${said}`);
    expect(await blockers(id)).toEqual([]);
    expect((await answer(id, qid, [null])).status).toBe(409);
  });

  it('dismisses a waiting question when Ben writes instead, so the call returns and his message is read', T, async () => {
    const id = await busy();
    const qid = await ask(id, [Q4]);
    await poll(id, qid);
    const waiting = poll(id, qid, 20);
    // A message for after the turn leaves the question to him.
    await ok('POST', `/threads/${id}/messages`, { prompt: 'then write it up', mode: 'queue' });
    expect(answerEvents(id)).toEqual([]);
    await ok('POST', `/threads/${id}/messages`, { prompt: 'never mind, do the cart first', mode: 'steer' });
    expect(await waiting).toEqual({
      state: 'dismissed',
      text: 'The user did not answer these questions. Read their latest message in the thread and go on from there.',
    });
    expect(answerEvents(id)).toEqual([{ id: qid, state: 'dismissed', answers: null, via: 'tool' }]);
    expect(await blockers(id)).toEqual([]);
    expect((await answer(id, qid, [{ selected: ['Acne POC'], other: null }])).body.state).toBe('dismissed');
  });
});

describe('ask_user_question from the agent', () => {
  const tool = (id: string) => h.byKind(id, 'tool_use').find((e) => e.p.name === 'mcp__omni-ask__ask_user_question');
  // The card waits on the omni-ask server starting (tsx compiles it), which a loaded machine can take a while over.
  const asked = (id: string) => h.until('the question card', () => h.byKind(id, 'question')[0], 25_000);
  const E2E = { timeout: 60_000 };

  it('waits in the turn until Ben answers on the card, then the agent reads his answers', E2E, async () => {
    const t = await h.start('ASK plan the quarter');
    const question = await asked(t.id);
    expect(tool(t.id)?.p.input.questions).toHaveLength(4);
    expect(question.p.questions.map((q: any) => q.header)).toEqual(['Q4 focus', 'Status mail', 'Handover', 'CRO audit']);
    expect(await blockers(t.id)).toEqual([{ kind: 'question', detail: 'Which Q4 goal should get the most of your time between now and December?', count: 4, at: expect.any(String) }]);
    expect(h.thread(t.id).status).toBe('running');

    // The call polls one request after its question is saved; answering first would send the answer as a message.
    await sleep(1000);
    const res = await answer(t.id, question.p.id, [
      { selected: ['KE go-live'], other: null },
      { selected: ['Volero', 'Pink Gellac'], other: null },
      null,
      { selected: [], other: 'In January' },
    ]);
    expect(res.body).toEqual({ state: 'answered', via: 'tool' });
    await h.untilResults(t.id, 1);
    const said =
      'User has answered your questions: ' +
      '"Which Q4 goal should get the most of your time between now and December?"="KE go-live", ' +
      '"Which clients should get a weekly status email?"="Volero, Pink Gellac", ' +
      '"How should I hand over the Volero import runbook?"="skipped, use your best judgement", ' +
      '"When should the next CRO audit start?"="In January". ' +
      "You can now continue with the user's answers in mind.";
    const result = h.byKind(t.id, 'tool_result').find((e) => e.p.tool_use_id === tool(t.id)!.p.id);
    expect(result?.p).toMatchObject({ text: said, is_error: false });
    expect(h.texts(t.id, 'assistant_text').at(-1)).toBe(`ack: ASK plan the quarter | ${said}`);
    expect(h.thread(t.id).status).toBe('done');
    expect(h.texts(t.id, 'user')).toEqual(['ASK plan the quarter']);

    // Claude Code's own AskUserQuestion is off, and the call may wait a day.
    const spawned = h.spawns(t.id)[0];
    expect(spawned.args.join(' ')).toContain('--disallowedTools AskUserQuestion');
    expect(spawned.mcp_tool_timeout).toBe('86400000');
  });

  it('hands the call a steer from Ben: the call returns, and the agent reads his message in the same turn', E2E, async () => {
    const t = await h.start('ASK_ONE plan the quarter');
    const question = await asked(t.id);
    await ok('POST', `/threads/${t.id}/messages`, { prompt: 'skip that, fix the cart', mode: 'steer' });
    await h.untilResults(t.id, 1);
    const dismissed = 'The user did not answer these questions. Read their latest message in the thread and go on from there.';
    expect(h.byKind(t.id, 'tool_result').find((e) => e.p.tool_use_id === tool(t.id)!.p.id)?.p.text).toBe(dismissed);
    expect(h.texts(t.id, 'assistant_text').at(-1)).toBe(`ack: ASK_ONE plan the quarter | skip that, fix the cart | ${dismissed}`);
    expect(answerEvents(t.id)).toEqual([{ id: question.p.id, state: 'dismissed', answers: null, via: 'tool' }]);
    expect(h.byKind(t.id, 'result')).toHaveLength(1);
  });

  it('keeps the question after Stop, and the answer then wakes the thread as a message', E2E, async () => {
    const t = await h.start('ASK_ONE plan the quarter');
    const question = await asked(t.id);
    await ok('POST', `/threads/${t.id}/stop`);
    await h.untilStatus(t.id, 'stopped');
    expect(await blockers(t.id)).toEqual([{ kind: 'question', detail: 'Which Q4 goal should get the most of your time between now and December?', count: 1, at: expect.any(String) }]);
    expect((await answer(t.id, question.p.id, [{ selected: ['Acne POC'], other: null }])).body).toEqual({ state: 'answered', via: 'message' });
    await h.untilResults(t.id, 2);
    const said =
      'User has answered your questions: "Which Q4 goal should get the most of your time between now and December?"="Acne POC". ' +
      "You can now continue with the user's answers in mind.";
    expect(h.texts(t.id, 'user')).toEqual(['ASK_ONE plan the quarter', said]);
    expect(h.thread(t.id).status).toBe('done');
  });
});
