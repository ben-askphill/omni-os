import type { Fetch, SSEConnection, SSESink, SSETransport, UploadInit, UploadTransport } from '@omni/client-core';
import { newContext } from '@omni/shared/message-context.ts';
import { diffSelection } from '@omni/shared/message-context-diff.ts';
import { describe, expect, it, vi } from 'vitest';

import type { Staged } from '../src/attachments/model';
import { addDraftContext, draftContext } from '../src/context/draft';
import { createLiveHub } from '../src/live/hub';
import type { OmniSession } from '../src/live/session';
import { composerPlaceholder, sendLabel, sendModeFor } from '../src/send/rules';

const BASE = 'http://omni.test';

interface Sent {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

type Reply = { status?: number; body?: unknown } | 'drop';

/** Answers by `METHOD path`. A reply of 'drop' fails the way a lost connection does. */
function server(replies: (req: Sent) => Reply | undefined | Promise<Reply | undefined>) {
  const sent: Sent[] = [];
  const fetch: Fetch = async (url, init) => {
    const { pathname } = new URL(url);
    const req: Sent = { method: init.method, path: pathname, body: init.body ? JSON.parse(init.body) : null };
    sent.push(req);
    const reply = (await replies(req)) ?? { body: {} };
    if (reply === 'drop') throw new TypeError('Network request failed');
    return {
      status: reply.status ?? 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => JSON.stringify(reply.body ?? {}),
    };
  };
  return { fetch, sent, posts: () => sent.filter((s) => s.method === 'POST') };
}

const transport: SSETransport = (): SSEConnection => ({ close() {} });

/** A transport the test drives: the thread stream's sink, to deliver rows the way the server's stream does. */
function streams() {
  const sinks: SSESink[] = [];
  const t: SSETransport = (request, sink): SSEConnection => {
    if (new URL(request.url).pathname === '/api/threads/t1/stream') sinks.push(sink);
    return { close() {} };
  };
  const frame = (value: unknown) => ({ event: 'message', data: JSON.stringify(value) });
  return {
    transport: t,
    /** A row the stream delivers for the thread. */
    row(id: number, kind = 'user', text = 'hi') {
      const sink = sinks.at(-1)!;
      sink.open();
      sink.message(frame({ id, thread_id: 't1', kind, payload: JSON.stringify({ text }), created_at: '' }));
    },
    /** A thread update carrying the pending list. */
    pending(list: unknown[]) {
      const sink = sinks.at(-1)!;
      sink.open();
      sink.message(frame({ kind: 'thread', thread: thread({ status: 'running' }), pending: list, live: true }));
    },
  };
}

const thread = (over: Record<string, unknown> = {}) => ({ id: 't1', channel_id: 'c', title: 'Fix build', status: 'idle', harness: 'claude-code', queued_harness: null, setup: null, updated_at: '', created_at: '', ...over });
const detail = (t = thread(), pending: unknown[] = []) => ({
  thread: t,
  channel: { id: 'c', name: 'Client' },
  events: [],
  history: { from: 1, to: null, results_below: 0 },
  artifacts: [],
  children: [],
  parent: null,
  pending,
  live: false,
});
const accepted = (id: string, t = thread({ status: 'running' })) => ({ ...t, request: { id: 'm1', request_id: id, state: 'accepted', accepted_at: '' } });
const harnesses = [
  { id: 'claude-code', capabilities: { steer: true } },
  { id: 'cursor', capabilities: { steer: false } },
];

function open(replies: (req: Sent) => Reply | undefined | Promise<Reply | undefined>, over: Partial<OmniSession> = {}, via: SSETransport = transport) {
  const s = server((req) => {
    if (req.method === 'GET' && req.path === '/api/threads/t1/requests') return replies(req) ?? { body: [] };
    if (req.method === 'GET' && req.path === '/api/harnesses') return { body: harnesses };
    if (req.method === 'GET' && req.path === '/api/threads/t1') return { body: detail() };
    if (req.method === 'GET') return { body: [] };
    return replies(req);
  });
  const session: OmniSession = { serverUrl: BASE, token: async () => 'token', refreshAuth: async () => false, ...over };
  const hub = createLiveHub({ session, transport: via, fetch: s.fetch });
  return { ...s, hub };
}

async function opened(replies: (req: Sent) => Reply | undefined | Promise<Reply | undefined>, over: Partial<OmniSession> = {}, via?: SSETransport) {
  const o = open(replies, over, via);
  const live = o.hub.openThread('t1');
  await vi.waitFor(() => expect(live.view.get().status).toBe('ready'));
  await vi.waitFor(() => expect(live.catalog.get()).not.toBeNull());
  return { ...o, live };
}

const pickRecord = (id: string) =>
  newContext(
    diffSelection,
    {
      path: 'a.ts',
      old_path: null,
      side: 'new',
      start: 1,
      end: 1,
      rows: [{ kind: 'add', text: 'x', old: null, new: 1 }],
      source: { group: 'unstaged', from: 'a1', to: 'b2', turn: null, blob_old: null, blob_new: null },
    },
    '',
    { id: () => id },
  );

describe('sending to an idle thread', () => {
  it('posts the trimmed text with a request id and no mode, and shows the thread it answers with', async () => {
    const { live, posts, hub } = await opened(() => ({ body: accepted('whatever') }));
    await live.send.submit(live.view.get().thread!, '  run the tests  ');
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toMatchObject({ path: '/api/threads/t1/messages' });
    expect(posts()[0].body).toEqual({ prompt: 'run the tests', request_id: expect.any(String) });
    expect(live.send.state.get().outbox.item).toBeNull();
    expect(live.view.get().thread?.status).toBe('running');
    hub.close();
  });

  it('sends picked context with no text, and drops it from the draft once the server has it', async () => {
    const { live, posts, hub } = await opened(() => ({ body: accepted('whatever') }));
    addDraftContext('t1', pickRecord('ctx1'));
    await live.send.submit(live.view.get().thread!, '  ', [], draftContext('t1'));
    expect(posts()[0].body).toMatchObject({ prompt: '', context: [{ id: 'ctx1', kind: 'diff_selection' }] });
    expect(draftContext('t1')).toEqual([]);
    hub.close();
  });

  it('keeps picked context in the draft when the send fails, so Edit and Retry still have it', async () => {
    const { live, hub } = await opened(() => 'drop');
    addDraftContext('t1', pickRecord('ctx2'));
    await live.send.submit(live.view.get().thread!, 'look', [], draftContext('t1'));
    expect(live.send.state.get().outbox.item).toMatchObject({ phase: 'failed', context: [{ id: 'ctx2' }] });
    expect(draftContext('t1').map((r) => r.id)).toEqual(['ctx2']);
    hub.close();
  });

  it('does nothing for an empty box', async () => {
    const { live, posts, hub } = await opened(() => ({ body: accepted('x') }));
    expect(await live.send.submit(live.view.get().thread!, '   ')).toBeNull();
    expect(posts()).toHaveLength(0);
    hub.close();
  });

  it('sends a double tap once', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { live, posts, hub } = await opened(async (req) => {
      if (req.method !== 'POST') return undefined;
      await gate;
      return { body: accepted('x') };
    });
    const t = live.view.get().thread!;
    const first = live.send.submit(t, 'once');
    const second = live.send.submit(t, 'once');
    release();
    await Promise.all([first, second]);
    expect(posts()).toHaveLength(1);
    hub.close();
  });
});

describe('steer or queue while a turn runs', () => {
  it('steers a running thread on a harness that can', async () => {
    const { live, posts, hub } = await opened((req) => (req.method === 'POST' ? { body: accepted('x') } : undefined));
    await live.send.submit(thread({ status: 'running' }) as never, 'also check lint');
    expect(posts()[0].body).toMatchObject({ prompt: 'also check lint', mode: 'steer' });
    hub.close();
  });

  it('queues on a harness that cannot steer, and when a run switch waits behind the turn', async () => {
    const { live, posts, hub } = await opened((req) => (req.method === 'POST' ? { body: accepted('x') } : undefined));
    await live.send.submit(thread({ status: 'running', harness: 'cursor' }) as never, 'one');
    await live.send.submit(thread({ status: 'queued', queued_harness: 'codex' }) as never, 'two');
    expect(posts().map((p) => p.body?.mode)).toEqual(['queue', 'queue']);
    hub.close();
  });

  it('decides from what the harness catalog says, not only the harness name', () => {
    const t = thread({ status: 'running', harness: 'cursor' }) as never;
    expect(sendModeFor(t, null)).toBe('queue');
    expect(sendModeFor(t, [{ id: 'cursor', capabilities: { steer: true } }] as never)).toBe('steer');
    expect(sendModeFor(thread({ status: 'done' }) as never, null)).toBeUndefined();
  });

  it('words the composer for what Send will do', () => {
    const running = thread({ status: 'running' }) as never;
    const cursor = thread({ status: 'running', harness: 'cursor' }) as never;
    expect(composerPlaceholder(thread() as never, null)).toBe('Follow up');
    expect(composerPlaceholder(running, null)).toBe('Steer the agent');
    expect(composerPlaceholder(cursor, null)).toBe('Queue for after this turn');
    expect(sendLabel(running, null)).toBe('Send to the running turn');
    expect(sendLabel(cursor, null)).toBe('Send after this turn');
  });
});

describe('a dropped connection', () => {
  it('keeps the message, retries under the same request id and sends it once', async () => {
    let drops = 2;
    const { live, posts, hub } = await opened((req) => {
      if (req.method !== 'POST') return undefined;
      return drops-- > 0 ? 'drop' : { body: { ...accepted('x'), request: { ...accepted('x').request, duplicate: true } } };
    });
    const t = live.view.get().thread!;
    expect(await live.send.submit(t, 'deploy it')).toBeNull();
    expect(live.send.state.get().outbox.item).toMatchObject({ phase: 'failed', text: 'deploy it', failure: { kind: 'offline' } });

    expect(await live.send.retry()).toBeNull();
    expect(live.send.state.get().outbox.item?.phase).toBe('failed');

    expect(await live.send.retry()).not.toBeNull();
    expect(live.send.state.get().outbox.item).toBeNull();

    const ids = posts().map((p) => p.body?.request_id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
    expect(posts().map((p) => p.body?.prompt)).toEqual(['deploy it', 'deploy it', 'deploy it']);
    hub.close();
  });

  it('keeps the mode through the retry even when the thread went idle meanwhile', async () => {
    let drop = true;
    const { live, posts, hub } = await opened((req) => {
      if (req.method !== 'POST') return undefined;
      if (drop) {
        drop = false;
        return 'drop';
      }
      return { body: accepted('x') };
    });
    await live.send.submit(thread({ status: 'running' }) as never, 'steer me');
    await live.send.retry();
    expect(posts().map((p) => p.body?.mode)).toEqual(['steer', 'steer']);
    hub.close();
  });

  it('holds a second message back until the failed one is retried or taken out', async () => {
    const { live, posts, hub } = await opened((req) => (req.method === 'POST' ? 'drop' : undefined));
    const t = live.view.get().thread!;
    await live.send.submit(t, 'first');
    expect(await live.send.submit(t, 'second')).toBeNull();
    expect(posts()).toHaveLength(1);
    expect(live.send.edit()).toEqual({ text: 'first', files: [] });
    expect(live.send.state.get().outbox.item).toBeNull();
    hub.close();
  });
});

describe('errors', () => {
  it("shows the server's own words for a refused send, and a retry is allowed", async () => {
    const { live, hub } = await opened((req) => (req.method === 'POST' ? { status: 409, body: { error: 'This thread runs on your other Mac.' } } : undefined));
    await live.send.submit(live.view.get().thread!, 'hi');
    expect(live.send.state.get().outbox.item).toMatchObject({ phase: 'failed', failure: { kind: 'refused', message: 'This thread runs on your other Mac.' } });
    hub.close();
  });

  it('reports a server error as one', async () => {
    const { live, hub } = await opened((req) => (req.method === 'POST' ? { status: 500, body: { error: 'database is locked' } } : undefined));
    await live.send.submit(live.view.get().thread!, 'hi');
    expect(live.send.state.get().outbox.item).toMatchObject({ failure: { kind: 'server', message: 'database is locked', ambiguous: true } });
    hub.close();
  });

  it('asks the session about a 401 and, when it says the phone was revoked, ends in signed-out with nothing to retry', async () => {
    const refreshAuth = vi.fn(async () => false);
    const { live, posts, hub } = await opened((req) => (req.method === 'POST' ? { status: 401, body: { error: 'unauthorized' } } : undefined), { refreshAuth });
    await live.send.submit(live.view.get().thread!, 'hi');
    expect(refreshAuth).toHaveBeenCalled();
    expect(live.send.state.get().outbox.item).toMatchObject({ failure: { kind: 'signed-out' } });
    expect(await live.send.retry()).toBeNull();
    expect(posts()).toHaveLength(1);
    hub.close();
  });

  it('sends again with fresh credentials when the session refreshed after a 401', async () => {
    const refreshAuth = vi.fn(async () => true);
    let first = true;
    const { live, posts, hub } = await opened(
      (req) => {
        if (req.method !== 'POST') return undefined;
        if (first) {
          first = false;
          return { status: 401, body: { error: 'expired' } };
        }
        return { body: accepted('x') };
      },
      { refreshAuth },
    );
    await live.send.submit(live.view.get().thread!, 'hi');
    expect(posts().map((p) => p.body?.request_id)).toHaveLength(2);
    expect(new Set(posts().map((p) => p.body?.request_id)).size).toBe(1);
    expect(live.send.state.get().outbox.item).toBeNull();
    hub.close();
  });
});

describe('stop', () => {
  it('stops the running turn and shows the thread it answers with', async () => {
    const { live, posts, hub } = await opened((req) => (req.path.endsWith('/stop') ? { body: thread({ status: 'idle' }) } : undefined));
    await live.send.stop();
    expect(posts()[0]).toMatchObject({ path: '/api/threads/t1/stop' });
    expect(live.view.get().thread?.status).toBe('idle');
    expect(live.send.state.get()).toMatchObject({ stopping: false, notice: null });
    hub.close();
  });

  it('says why a stop failed and lets Ben try again', async () => {
    const { live, hub } = await opened((req) => (req.path.endsWith('/stop') ? 'drop' : undefined));
    await live.send.stop();
    expect(live.send.state.get()).toMatchObject({ stopping: false, notice: expect.stringMatching(/Cannot reach/) });
    hub.close();
  });
});

describe('a message that landed while its answer was lost', () => {
  const ledger = (requestId: string) => ({ body: [{ id: 'm1', request_id: requestId, state: 'delivered' }] });
  const asked = (sent: Sent[]) => sent.filter((s) => s.path === '/api/threads/t1/requests');

  async function lost(ledgerReply: (req: Sent) => Reply | undefined) {
    const feed = streams();
    const o = await opened((req) => (req.method === 'POST' ? 'drop' : ledgerReply(req)), {}, feed.transport);
    await o.live.send.submit(o.live.view.get().thread!, 'ship it');
    const item = o.live.send.state.get().outbox.item;
    expect(item).toMatchObject({ phase: 'failed', failure: { ambiguous: true } });
    return { ...o, feed, requestId: item!.requestId };
  }

  it("drops the failed row once the stream delivers the user row the server's list accounts for", async () => {
    let requestId = '';
    const { live, feed, sent, hub, requestId: id } = await lost(() => (requestId ? ledger(requestId) : undefined));
    requestId = id;
    feed.row(5);
    await vi.waitFor(() => expect(live.send.state.get().outbox.item).toBeNull());
    expect(asked(sent)).toHaveLength(1);
    hub.close();
  });

  it('keeps the row for a user row that is not this one, and drops it at the next that is', async () => {
    let requestId = '';
    let has = false;
    const { live, feed, sent, hub, requestId: id } = await lost(() => (has ? ledger(requestId) : undefined));
    requestId = id;
    feed.row(5, 'user', 'someone else');
    await vi.waitFor(() => expect(asked(sent)).toHaveLength(1));
    expect(live.send.state.get().outbox.item?.phase).toBe('failed');
    has = true;
    feed.row(6);
    await vi.waitFor(() => expect(live.send.state.get().outbox.item).toBeNull());
    hub.close();
  });

  it('asks once per user row, not once per update', async () => {
    const { live, feed, sent, hub } = await lost(() => undefined);
    feed.row(5);
    await vi.waitFor(() => expect(asked(sent)).toHaveLength(1));
    feed.row(6, 'assistant_text');
    feed.pending([]);
    feed.row(7, 'tool_use');
    await new Promise((r) => setTimeout(r, 20));
    expect(asked(sent)).toHaveLength(1);
    expect(live.send.state.get().outbox.item?.phase).toBe('failed');
    hub.close();
  });

  it('drops the row when the pending list already carries its request id, without asking the server', async () => {
    const { live, feed, sent, hub, requestId } = await lost(() => undefined);
    feed.pending([{ uuid: 'm1', kind: 'user', text: 'ship it', mode: 'steer', state: 'sent', request_id: requestId, delivery: 'sent' }]);
    await vi.waitFor(() => expect(live.send.state.get().outbox.item).toBeNull());
    expect(asked(sent)).toHaveLength(0);
    hub.close();
  });

  it('asks again at the next user row after the list could not be fetched', async () => {
    let requestId = '';
    let calls = 0;
    const { live, feed, hub, requestId: id } = await lost(() => (++calls === 1 ? { status: 500, body: { error: 'down' } } : ledger(requestId)));
    requestId = id;
    feed.row(5);
    await vi.waitFor(() => expect(calls).toBe(1));
    expect(live.send.state.get().outbox.item?.phase).toBe('failed');
    feed.row(6);
    await vi.waitFor(() => expect(live.send.state.get().outbox.item).toBeNull());
    hub.close();
  });

  it('leaves a refused message alone: it never reached the server', async () => {
    const feed = streams();
    const { live, sent, hub } = await opened((req) => (req.method === 'POST' ? { status: 409, body: { error: 'No' } } : undefined), {}, feed.transport);
    await live.send.submit(live.view.get().thread!, 'nope');
    expect(live.send.state.get().outbox.item).toMatchObject({ phase: 'failed', failure: { kind: 'refused' } });
    feed.row(5);
    await new Promise((r) => setTimeout(r, 20));
    expect(asked(sent)).toHaveLength(0);
    expect(live.send.state.get().outbox.item?.phase).toBe('failed');
    hub.close();
  });

  it('drops a message still sending when the stream already shows it, and ignores the late answer', async () => {
    const feed = streams();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let requestId = '';
    const { live, sent, hub } = await opened(async (req) => {
      if (req.method !== 'POST') return requestId ? ledger(requestId) : undefined;
      requestId = String(req.body?.request_id);
      await gate;
      return 'drop';
    }, {}, feed.transport);
    const sending = live.send.submit(live.view.get().thread!, 'slow one');
    await vi.waitFor(() => expect(requestId).not.toBe(''));
    feed.row(5);
    await vi.waitFor(() => expect(live.send.state.get().outbox.item).toBeNull());
    release();
    await sending;
    expect(live.send.state.get().outbox.item).toBeNull();
    expect(asked(sent)).toHaveLength(1);
    hub.close();
  });
});

const photo: Staged = { id: 'p1', uri: 'file:///cache/a.jpg', name: 'a.jpg', type: 'image/jpeg', size: 1000, image: true, source: 'library' };
const doc: Staged = { id: 'd1', uri: 'file:///cache/b.pdf', name: 'b.pdf', type: 'application/pdf', size: 2000, image: false, source: 'files' };

type UploadReply = { status?: number; body?: unknown } | 'drop' | 'wait';

/** A thread whose files go through an upload transport the test drives, as the phone's XMLHttpRequest one does. */
async function withUpload(reply: (init: UploadInit, call: number) => UploadReply) {
  const uploads: { url: string; init: UploadInit }[] = [];
  const upload: UploadTransport = (url, init) => {
    uploads.push({ url, init });
    const r = reply(init, uploads.length);
    if (r === 'drop') return Promise.reject(new TypeError('Network request failed'));
    if (r === 'wait') {
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))));
    }
    return Promise.resolve({
      status: r.status ?? 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => JSON.stringify(r.body ?? {}),
    });
  };
  const s = server((req) => {
    if (req.method === 'GET' && req.path === '/api/threads/t1/requests') return { body: [] };
    if (req.method === 'GET' && req.path === '/api/harnesses') return { body: harnesses };
    if (req.method === 'GET' && req.path === '/api/threads/t1') return { body: detail() };
    if (req.method === 'GET') return { body: [] };
    return undefined;
  });
  const session: OmniSession = { serverUrl: BASE, token: async () => 'token', refreshAuth: async () => false };
  const hub = createLiveHub({ session, transport, fetch: s.fetch, upload });
  const live = hub.openThread('t1');
  await vi.waitFor(() => expect(live.view.get().status).toBe('ready'));
  await vi.waitFor(() => expect(live.catalog.get()).not.toBeNull());
  return { live, hub, uploads, posts: s.posts };
}

describe('sending files', () => {
  it('uploads the files with the message as one multipart request, and sends no separate JSON post', async () => {
    const { live, hub, uploads, posts } = await withUpload(() => ({ body: accepted('x') }));
    const out = await live.send.submit(live.view.get().thread!, 'look at these', [photo, doc]);
    expect(out).not.toBeNull();
    expect(posts()).toHaveLength(0);
    expect(uploads).toHaveLength(1);
    expect(new URL(uploads[0].url).pathname).toBe('/api/threads/t1/messages');
    expect(uploads[0].init.headers).toMatchObject({ authorization: 'Bearer token' });
    expect(uploads[0].init.files).toEqual([
      { uri: photo.uri, name: 'a.jpg', type: 'image/jpeg' },
      { uri: doc.uri, name: 'b.pdf', type: 'application/pdf' },
    ]);
    expect(JSON.parse(uploads[0].init.payload)).toEqual({ prompt: 'look at these', request_id: expect.any(String) });
    expect(live.send.state.get().outbox.item).toBeNull();
    hub.close();
  });

  it('carries picked diff context in the same multipart request as the files, and clears it from the draft once it lands', async () => {
    const { live, hub, uploads, posts } = await withUpload(() => ({ body: accepted('x') }));
    addDraftContext('t1', pickRecord('ctx3'));
    const out = await live.send.submit(live.view.get().thread!, 'both', [photo], draftContext('t1').filter((r) => r.id === 'ctx3'));
    expect(out).not.toBeNull();
    expect(posts()).toHaveLength(0);
    expect(uploads).toHaveLength(1);
    expect(JSON.parse(uploads[0].init.payload)).toMatchObject({ prompt: 'both', context: [{ id: 'ctx3', kind: 'diff_selection' }] });
    expect(uploads[0].init.files).toHaveLength(1);
    expect(draftContext('t1').map((r) => r.id)).not.toContain('ctx3');
    hub.close();
  });

  it('shows the share of the body sent, in whole percents, and clears it when the send ends', async () => {
    const seen: (number | null)[] = [];
    const { live, hub } = await withUpload((init) => {
      for (const sent of [10, 11, 50, 100]) init.onProgress?.({ sent, total: 100 });
      return { body: accepted('x') };
    });
    live.send.state.subscribe(() => seen.push(live.send.state.get().progress));
    await live.send.submit(live.view.get().thread!, 'hi', [photo]);
    expect(seen.filter((p, i) => p !== null && p !== seen[i - 1])).toEqual([0.1, 0.11, 0.5, 1]);
    expect(live.send.state.get().progress).toBeNull();
    hub.close();
  });

  it('sends text alone as plain JSON, with no upload', async () => {
    const { live, hub, uploads } = await withUpload(() => ({ body: accepted('x') }));
    await live.send.submit(live.view.get().thread!, 'no files');
    expect(uploads).toHaveLength(0);
    hub.close();
  });

  it('keeps the text and files when offline, and retries them under the same request id', async () => {
    const { live, hub, uploads } = await withUpload((_, call) => (call === 1 ? 'drop' : { body: accepted('x') }));
    const t = live.view.get().thread!;
    await live.send.submit(t, 'look', [photo]);
    expect(live.send.state.get().outbox.item).toMatchObject({ phase: 'failed', text: 'look', files: [photo], failure: { kind: 'offline' } });

    expect(await live.send.retry()).not.toBeNull();
    expect(uploads).toHaveLength(2);
    expect(uploads[1].init.files).toEqual(uploads[0].init.files);
    expect(JSON.parse(uploads[1].init.payload).request_id).toBe(JSON.parse(uploads[0].init.payload).request_id);
    expect(live.send.state.get().outbox.item).toBeNull();
    hub.close();
  });

  it('cancels an upload in flight, and keeps the message and its files to retry or edit', async () => {
    const { live, hub, uploads } = await withUpload(() => 'wait');
    const sending = live.send.submit(live.view.get().thread!, 'big one', [doc]);
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    live.send.cancelUpload();
    expect(await sending).toBeNull();
    expect(live.send.state.get().outbox.item).toMatchObject({ phase: 'failed', files: [doc], failure: { kind: 'cancelled' } });
    expect(live.send.state.get().progress).toBeNull();
    expect(live.send.edit()).toEqual({ text: 'big one', files: [doc] });
    hub.close();
  });

  it('tells Ben a file is too large in the server’s words, and keeps the files', async () => {
    const { live, hub } = await withUpload(() => ({ status: 400, body: { error: '"clip.mov" is 31.0 MB, over the 25 MB limit' } }));
    await live.send.submit(live.view.get().thread!, 'hi', [doc]);
    expect(live.send.state.get().outbox.item).toMatchObject({ phase: 'failed', files: [doc], failure: { kind: 'refused', message: '"clip.mov" is 31.0 MB, over the 25 MB limit' } });
    hub.close();
  });

  it('ends in signed-out for a revoked phone, with nothing to retry', async () => {
    const { live, hub, uploads } = await withUpload(() => ({ status: 401, body: { error: 'unauthorized' } }));
    await live.send.submit(live.view.get().thread!, 'hi', [photo]);
    expect(live.send.state.get().outbox.item).toMatchObject({ failure: { kind: 'signed-out' }, files: [photo] });
    expect(await live.send.retry()).toBeNull();
    expect(uploads).toHaveLength(1);
    hub.close();
  });

  it('is a different message when the same words go with other files', async () => {
    const { live, hub, uploads } = await withUpload((_, call) => (call === 1 ? 'drop' : { body: accepted('x') }));
    const t = live.view.get().thread!;
    await live.send.submit(t, 'look', [photo]);
    const taken = live.send.edit()!;
    await live.send.submit(t, taken.text, [photo, doc]);
    expect(JSON.parse(uploads[1].init.payload).request_id).not.toBe(JSON.parse(uploads[0].init.payload).request_id);
    hub.close();
  });
});
