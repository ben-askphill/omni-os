import { afterAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CrewQuestion } from '@omni/shared/question.ts';
import { startRunner } from './runner-boot.ts';
import { sleep } from './support.ts';

// A delegated thread's ask_user_question (apps/server/runner/questions.ts): its card shows on every thread above it
// (GET /threads/:id/crew-questions), its Needs you blocker sits on the thread Ben delegated from, and an answer given
// there goes to the asking thread's own endpoint, so its waiting call returns it.

const h = await startRunner();
const { app } = await import('../app.ts');
const { serve } = await import('@hono/node-server');
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
await once(server, 'listening');
const { about } = await import('../about.ts');
about.port = (server.address() as AddressInfo).port;
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

const Q = {
  question: 'Which market goes first?',
  header: 'Market',
  options: [
    { label: 'NL', description: 'Home market.' },
    { label: 'DE', description: 'Bigger.' },
  ],
  multiSelect: false,
};
const ask = (id: string) => ok('POST', `/threads/${id}/questions`, { questions: [Q] }).then((r) => r.id as string);
const poll = (id: string, qid: string, wait = 0) => ok('GET', `/threads/${id}/questions/${qid}?wait=${wait}`);
const answer = (id: string, qid: string, answers: unknown) => call('POST', `/threads/${id}/questions/${qid}/answer`, { answers });
const crew = async (id: string) => (await ok('GET', `/threads/${id}/crew-questions`)).items as CrewQuestion[];
const asking = async () =>
  ((await ok('GET', '/needs-you')).items as any[]).filter((i) => i.blockers.some((b: any) => b.kind === 'question')).map((i) => i.thread.id as string);

const idle = async (prompt: string, extra: Record<string, unknown> = {}) => {
  const t = await h.start(prompt, extra);
  await h.untilResults(t.id, 1);
  return h.thread(t.id);
};
const busy = async (prompt: string, extra: Record<string, unknown> = {}) => {
  const t = await h.start(`TOOL:8000 ${prompt}`, extra);
  await h.untilTool(t.id);
  return h.thread(t.id);
};

describe('a delegated thread asks', () => {
  it('shows its card on the delegating thread, and its blocker there instead of on itself', T, async () => {
    const conductor = await idle('be the conductor');
    const child = await busy('build the export', { parent_id: conductor.id, title: 'Build the export' });
    const qid = await ask(child.id);

    expect(await crew(conductor.id)).toEqual([
      {
        thread_id: child.id,
        thread_title: 'Build the export',
        task_id: child.task_id,
        channel_id: child.channel_id,
        question: { id: qid, event_id: expect.any(Number), questions: [Q], state: 'pending', answers: null },
      },
    ]);
    expect(child.task_id).toMatch(/^T-/);
    expect(await crew(child.id)).toEqual([]);
    const needs = await asking();
    expect(needs).toContain(conductor.id);
    expect(needs).not.toContain(child.id);
    // The child's own card stays in its transcript.
    expect(h.byKind(child.id, 'question').map((e) => e.p.id)).toEqual([qid]);
  });

  it('takes the answer on the delegating thread, returns it to the waiting call, and closes it on both', T, async () => {
    const conductor = await idle('be the conductor');
    const child = await busy('pick a market', { parent_id: conductor.id });
    const qid = await ask(child.id);
    await poll(child.id, qid);
    const waiting = poll(child.id, qid, 20);

    const [shown] = await crew(conductor.id);
    expect((await answer(shown.thread_id, shown.question.id, [{ selected: ['DE'], other: null }])).body).toEqual({ state: 'answered', via: 'tool' });
    expect(await waiting).toEqual({
      state: 'answered',
      text: 'User has answered your questions: "Which market goes first?"="DE". You can now continue with the user\'s answers in mind.',
    });
    expect(await crew(conductor.id)).toEqual([]);
    expect(await asking()).not.toContain(conductor.id);
    expect(h.byKind(child.id, 'question_answer').map((e) => e.p)).toEqual([
      { id: qid, state: 'answered', answers: [{ selected: ['DE'], other: null }], via: 'tool' },
    ]);
    // Answered once: a second answer, from either thread's card, is refused.
    expect((await answer(child.id, qid, [{ selected: ['NL'], other: null }])).status).toBe(409);
  });

  it('closes the card on the delegating thread when Ben answers in the delegated one', T, async () => {
    const conductor = await idle('be the conductor');
    const child = await busy('pick a market', { parent_id: conductor.id });
    const qid = await ask(child.id);
    expect(await crew(conductor.id)).toHaveLength(1);
    expect((await answer(child.id, qid, [null])).status).toBe(200);
    expect(await crew(conductor.id)).toEqual([]);
    expect(await asking()).not.toContain(conductor.id);
  });

  it("brings a team member's question up to the top thread, through its lead", T, async () => {
    const conductor = await idle('be the conductor');
    const lead = await idle('lead the team', { parent_id: conductor.id, title: 'Lead' });
    const member = await busy('do my part', { parent_id: lead.id, source: 'team', title: 'Member' });
    const qid = await ask(member.id);

    for (const above of [conductor.id, lead.id]) {
      expect((await crew(above)).map((c) => [c.thread_id, c.thread_title, c.question.id])).toEqual([[member.id, 'Member', qid]]);
    }
    const needs = await asking();
    expect(needs).toContain(conductor.id);
    expect(needs).not.toContain(lead.id);
    expect(needs).not.toContain(member.id);
  });

  it('brings the delegating thread back out of done for the question', T, async () => {
    const conductor = await idle('be the conductor');
    const child = await busy('pick a market', { parent_id: conductor.id });
    await ok('PATCH', `/threads/${conductor.id}`, { done: true });
    expect(h.thread(conductor.id).done_at).not.toBeNull();
    await ask(child.id);
    expect(h.thread(conductor.id).done_at).toBeNull();
    expect(await asking()).toContain(conductor.id);
  });

  it('keeps a thread nobody delegated as it was: its question waits on itself', T, async () => {
    const solo = await busy('plan alone');
    await ask(solo.id);
    expect(await crew(solo.id)).toEqual([]);
    expect(await asking()).toContain(solo.id);
    expect((await call('GET', '/threads/nope/crew-questions')).status).toBe(404);
  });
});

describe('ask_user_question from a delegated agent', () => {
  it('waits until Ben answers on the delegating thread, then the agent goes on with the answer', { timeout: 60_000 }, async () => {
    const conductor = await idle('be the conductor');
    const child = await h.start('ASK_ONE plan the quarter', { parent_id: conductor.id });
    // The card waits on the omni-ask server starting (tsx compiles it), which a loaded machine can take a while over.
    await h.until('the question card', () => h.byKind(child.id, 'question')[0], 25_000);
    const [shown] = await crew(conductor.id);
    expect(shown.thread_id).toBe(child.id);
    expect(h.thread(child.id).status).toBe('running');

    // The call polls one request after its question is saved; answering first would send the answer as a message.
    await sleep(1000);
    expect((await answer(shown.thread_id, shown.question.id, [{ selected: ['Acne POC'], other: null }])).body).toEqual({ state: 'answered', via: 'tool' });
    await h.untilResults(child.id, 1);
    const said =
      'User has answered your questions: "Which Q4 goal should get the most of your time between now and December?"="Acne POC". ' +
      "You can now continue with the user's answers in mind.";
    expect(h.texts(child.id, 'assistant_text').at(-1)).toBe(`ack: ASK_ONE plan the quarter | ${said}`);
    expect(h.thread(child.id).status).toBe('done');
    expect(await crew(conductor.id)).toEqual([]);
  });
});
