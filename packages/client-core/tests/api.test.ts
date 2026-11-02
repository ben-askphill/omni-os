import { describe, expect, it } from 'vitest';
import type { CreateThreadRequest, SendMessageRequest } from '../src/api/index.ts';
import { OmniHttpError } from '../src/http.ts';
import { api, at } from './api-helpers.ts';

describe('omni api', () => {
  it('lists channels, archived ones, and one channel', async () => {
    const { sent, api: a } = api();
    await a.channels();
    await a.channels({ archived: true });
    await a.channel('client-x');
    expect(sent).toEqual([
      { method: 'GET', url: at('/channels') },
      { method: 'GET', url: at('/channels?archived=1') },
      { method: 'GET', url: at('/channels/client-x') },
    ]);
  });

  it("lists a channel's threads, folders, and threads by channel, status and limit", async () => {
    const { sent, api: a } = api();
    await a.channelThreads('a/b', { archived: true });
    await a.folders();
    await a.folders('inbox');
    await a.threads();
    await a.threads({ channel: 'inbox', status: 'running', limit: 20 });
    expect(sent.map((s) => s.url)).toEqual([
      at('/channels/a%2Fb/threads?archived=1'),
      at('/folders'),
      at('/folders?channel=inbox'),
      at('/threads'),
      at('/threads?channel=inbox&status=running&limit=20'),
    ]);
  });

  it("opens a thread with its newest page, and resolves with the server's reply", async () => {
    const detail = { thread: { id: 't1' }, events: [{ id: 9, kind: 'user' }], history: { from: 9, to: null, results_below: 2 } };
    const { sent, api: a } = api({ json: detail });
    expect(await a.thread('t 1')).toEqual(detail);
    expect(sent).toEqual([{ method: 'GET', url: at('/threads/t%201?history=recent') }]);
  });

  it('pages history by cursor and reads one whole event', async () => {
    const { sent, api: a } = api();
    await a.history('t1', { take: 'newest', before: 30 });
    await a.history('t1', { take: 'oldest', after: 10, before: 30 });
    await a.history('t1', { at: 20 });
    await a.event('t1', 42);
    expect(sent.map((s) => s.url)).toEqual([
      at('/threads/t1/history?before=30'),
      at('/threads/t1/history?take=oldest&after=10&before=30'),
      at('/threads/t1/history?at=20'),
      at('/threads/t1/events/42'),
    ]);
  });

  it('creates a thread with only the fields given, and resolves with the new thread', async () => {
    const { sent, api: a } = api({ json: { id: 'new', status: 'queued' } });
    expect(await a.createThread({ prompt: 'fix the build' })).toEqual({ id: 'new', status: 'queued' });
    await a.createThread({ channel: 'client-x', prompt: 'p', title: 'T', harness: 'codex', model: 'gpt-5', effort: 'high', folder: 'Bugs', base: { kind: 'ref', ref: 'main' }, device: 'here' });
    expect(sent).toEqual([
      { method: 'POST', url: at('/threads'), body: { prompt: 'fix the build' } },
      {
        method: 'POST',
        url: at('/threads'),
        body: { channel: 'client-x', prompt: 'p', title: 'T', harness: 'codex', model: 'gpt-5', effort: 'high', folder: 'Bugs', base: { kind: 'ref', ref: 'main' }, device: 'here' },
      },
    ]);
  });

  it('sends the id the client chose, so a retry starts the thread once', async () => {
    const { sent, api: a } = api({ json: { id: 'abc' } });
    await a.createThread({ id: 'f7d0b1c4-3b0e-4a43-9a43-0c1f6d2f6a10', channel: 'inbox', prompt: 'hi' });
    expect(sent).toEqual([{ method: 'POST', url: at('/threads'), body: { id: 'f7d0b1c4-3b0e-4a43-9a43-0c1f6d2f6a10', channel: 'inbox', prompt: 'hi' } }]);
  });

  it('lists the crew roles', async () => {
    const { sent, api: a } = api({ json: [{ id: 'conductor' }] });
    expect(await a.crew()).toEqual([{ id: 'conductor' }]);
    expect(sent).toEqual([{ method: 'GET', url: at('/crew') }]);
  });

  it('sends a message with its mode, request id and context as JSON', async () => {
    const { sent, api: a } = api();
    const context = [{ kind: 'note', v: 1, id: 'c1', label: 'Note', note: '', body: { text: 'x' } }];
    await a.sendMessage('t1', { prompt: 'hi' });
    await a.sendMessage('t1', { prompt: 'now', mode: 'interrupt', request_id: 'r-1', context });
    expect(sent).toEqual([
      { method: 'POST', url: at('/threads/t1/messages'), body: { prompt: 'hi' } },
      { method: 'POST', url: at('/threads/t1/messages'), body: { prompt: 'now', mode: 'interrupt', request_id: 'r-1', context } },
    ]);
  });

  it("lists a thread's accepted requests", async () => {
    const rows = [{ id: 'm1', request_id: 'r-1', state: 'delivered' }];
    const { sent, api: a } = api({ json: rows });
    expect(await a.requests('t 1')).toEqual(rows);
    expect(sent).toEqual([{ method: 'GET', url: at('/threads/t%201/requests') }]);
  });

  it('switches the run, marks done and not done, and stops', async () => {
    const { sent, api: a } = api();
    await a.switchRun('t1', { harness: 'codex', model: '', effort: 'high' });
    await a.setDone('t1', true);
    await a.setDone('t1', false);
    await a.stop('t1');
    expect(sent).toEqual([
      { method: 'POST', url: at('/threads/t1/run'), body: { harness: 'codex', model: '', effort: 'high' } },
      { method: 'PATCH', url: at('/threads/t1'), body: { done: true } },
      { method: 'PATCH', url: at('/threads/t1'), body: { done: false } },
      { method: 'POST', url: at('/threads/t1/stop') },
    ]);
  });

  it('answers a question, one answer per question with null for a skipped one', async () => {
    const { sent, api: a } = api({ json: { state: 'answered', via: 'tool' } });
    const answers = [{ selected: ['Yes'], other: null }, null];
    expect(await a.answerQuestion('t1', 'q 1', answers)).toEqual({ state: 'answered', via: 'tool' });
    expect(sent).toEqual([{ method: 'POST', url: at('/threads/t1/questions/q%201/answer'), body: { answers } }]);
  });

  it('rejects an answer to settled questions with the state the first answer left', async () => {
    const { api: a } = api({ status: 409, json: { error: 'These questions were already answered.', state: 'skipped' } });
    const err = await a.answerQuestion('t1', 'q1', [null]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OmniHttpError);
    expect((err as OmniHttpError).failure).toMatchObject({ kind: 'http', status: 409, body: { state: 'skipped' } });
  });

  it('refuses request shapes the server would reject, at compile time', () => {
    // @ts-expect-error a mode the server does not take
    const badMode: SendMessageRequest = { prompt: 'x', mode: 'later' };
    // @ts-expect-error the prompt is required, even if empty
    const noPrompt: SendMessageRequest = { mode: 'queue' };
    // @ts-expect-error a ref pick names its ref
    const noRef: CreateThreadRequest = { prompt: 'x', base: { kind: 'ref' } };
    expect([badMode, noPrompt, noRef]).toHaveLength(3);
  });
});
