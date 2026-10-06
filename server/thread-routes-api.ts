// /api/threads: list, create, detail, messages, uploads, stop, and the live stream.
// Split into two apps so app.ts can keep mounting threadsApi and terminalApi between them.
// Hono keeps the first registered match, so that order is the one the handlers already won with.
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { commentsPrompt, isArtifactUrl } from '../shared/published.ts';
import { bus } from './bus.ts';
import { uploadsDir } from './config.ts';
import { artifacts, channels, events, publicChannel, threads, type Thread } from './db.ts';
import { readBody } from './read-body.ts';
import { createTeam, createThread, interruptThread, isLive, pendingFor, postMessage, runsHere } from './runner.ts';
import { threadFilesReady, threadOpened } from './sync/files.ts';
import { turnBlocked } from './sync/guard.ts';
import { checkUploads, imageMime, safeName, saveUploads } from './uploads.ts';

/** List, create, detail, and summary. Registered before PATCH and the terminal routes. */
export const threadRoutesApi = new Hono();

/** Messages, uploads, stop, and the event stream. Registered after PATCH and the terminal routes. */
export const threadActionsApi = new Hono();

const createSchema = z.object({
  channel: z.string().default('inbox'),
  prompt: z.string().min(1),
  role: z.string().nullish(),
  model: z.string().nullish(),
  harness: z.string().nullish(),
  effort: z.string().nullish(),
  title: z.string().nullish(),
  parent_id: z.string().nullish(),
  task_id: z.string().nullish(),
  source: z.enum(['manual', 'conductor', 'capture']).default('manual'),
});

threadRoutesApi.get('/', (c) =>
  c.json(
    threads.list({
      channel: c.req.query('channel'),
      status: c.req.query('status'),
      limit: Number(c.req.query('limit') ?? 50),
    }),
  ),
);

threadRoutesApi.post('/', async (c) => {
  const { data, files } = await readBody(c);
  const body = createSchema.parse(data);
  checkUploads(files);
  return c.json(await createThread({ ...body, files }));
});

const teamSchema = z.object({
  channel: z.string().default('inbox'),
  prompt: z.string().min(1),
  title: z.string().nullish(),
  role: z.string().nullish(),
  parent_id: z.string().nullish(),
  task_id: z.string().nullish(),
  source: z.enum(['manual', 'conductor']).default('conductor'),
  tasks: z
    .array(
      z.object({
        prompt: z.string().min(1),
        title: z.string().nullish(),
        role: z.string().nullish(),
        task_id: z.string().nullish(),
        harness: z.string().nullish(),
        model: z.string().nullish(),
        effort: z.string().nullish(),
      }),
    )
    .min(1),
});

/** A lead thread in the channel and one member thread per task under it. */
threadRoutesApi.post('/team', async (c) => {
  const body = teamSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid team' }, 400);
  return c.json(await createTeam(body.data));
});

threadRoutesApi.get('/:id', (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  // With sync on, the files it has on the other Mac download in the background.
  void threadOpened(t.id);
  const detail = {
    thread: t,
    channel: (ch => ch && publicChannel(ch))(channels.get(t.channel_id)),
    events: events.since(t.id),
    artifacts: artifacts.byThread(t.id),
    children: threads.children(t.id),
    // Members of the teams this thread started, so its delegation cards can show their state.
    team: threads.children(t.id).flatMap((ch) => threads.team(ch.id)),
    parent: t.parent_id ? threads.get(t.parent_id) : null,
    pending: pendingFor(t.id),
    live: isLive(t.id),
  };
  // Only when a turn cannot start here (a synced thread): why, for the composer to show.
  const blocked = turnBlocked(t, runsHere(t.id));
  return c.json(blocked ? { ...detail, blocked } : detail);
});

/** Compact view for the conductor MCP. */
threadRoutesApi.get('/:id/summary', (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  return c.json({
    id: t.id, title: t.title, status: t.status, channel: t.channel_id, role: t.role, task_id: t.task_id,
    updated_at: t.updated_at, last_reply: events.lastRunText(t.id) || events.lastAssistantText(t.id),
    artifacts: artifacts.byThread(t.id).map((a) => a.name),
  });
});

threadActionsApi.post('/:id/messages', async (c) => {
  const id = c.req.param('id');
  const { data, files } = await readBody(c);
  const { prompt, from, mode } = z
    .object({
      prompt: z.string().min(1),
      from: z.enum(['ben', 'conductor']).default('ben'),
      // steer: read at the agent's next step. queue: after this turn. interrupt: stop the turn, then run it.
      mode: z.enum(['steer', 'queue', 'interrupt']).default('steer'),
    })
    .parse(data);
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  checkUploads(files);
  const attachments = await saveUploads(id, files);
  return c.json(await postMessage(id, prompt, { from, mode, attachments }));
});

/** Ask the thread to act on the comments on a page it published. Queued, so it never cuts into a running turn. */
threadActionsApi.post('/:id/published/comments', async (c) => {
  const id = c.req.param('id');
  const { url } = z.object({ url: z.string().refine(isArtifactUrl, 'not a claude.ai artifact url') }).parse(await c.req.json());
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  return c.json(await postMessage(id, commentsPrompt(url), { mode: 'queue' }));
});

/** Serves a file Ben attached, by its name inside the thread's uploads folder. */
threadActionsApi.get('/:id/uploads/:name', async (c) => {
  const id = c.req.param('id');
  const name = safeName(c.req.param('name'));
  if (!threads.get(id)) return c.text('not found', 404);
  const file = join(uploadsDir(id), name);
  // Attached on the other Mac: it may still be downloading.
  if (!existsSync(file)) await threadFilesReady(id);
  if (!existsSync(file)) return c.text('not found', 404);
  // Images render inline; anything else downloads rather than rendering in the tab.
  const mime = imageMime(name);
  c.header('Content-Type', mime ?? 'application/octet-stream');
  c.header('Cache-Control', 'private, max-age=31536000, immutable');
  if (!mime || c.req.query('download')) c.header('Content-Disposition', `attachment; filename="${name}"`);
  return c.body(readFileSync(file));
});

const interrupt = (c: Context) => {
  const t = interruptThread(c.req.param('id')!);
  return t ? c.json(t) : c.json({ error: 'not found' }, 404);
};
threadActionsApi.post('/:id/stop', interrupt);
threadActionsApi.post('/:id/interrupt', interrupt);

threadActionsApi.get('/:id/stream', (c) => {
  const id = c.req.param('id');
  const after = Number(c.req.query('after') ?? c.req.header('Last-Event-ID') ?? 0);
  return streamSSE(c, async (stream) => {
    const queue: unknown[] = [];
    let wake: (() => void) | null = null;
    const onEvent = (e: unknown) => {
      queue.push(e);
      wake?.();
    };
    bus.on(`thread:${id}`, onEvent);
    const onFeed = (e: any) => {
      if (e.type !== 'thread' || (e.thread as Thread).id !== id) return;
      const blocked = turnBlocked(e.thread as Thread, runsHere(id));
      onEvent({ kind: 'thread', thread: e.thread, pending: pendingFor(id), live: isLive(id), ...(blocked && { blocked }) });
    };
    bus.on('feed', onFeed);
    stream.onAbort(() => {
      bus.off(`thread:${id}`, onEvent);
      bus.off('feed', onFeed);
      wake?.();
    });
    // Flush headers immediately so proxies (vite dev) don't hold the stream back.
    await stream.writeSSE({ event: 'ping', data: '' });
    for (const row of events.since(id, after)) await stream.writeSSE({ id: String(row.id), data: JSON.stringify(row) });
    while (!stream.aborted) {
      if (!queue.length) {
        await Promise.race([new Promise<void>((r) => (wake = r)), stream.sleep(20_000)]);
        wake = null;
        if (!queue.length) await stream.writeSSE({ event: 'ping', data: '' });
        continue;
      }
      const e = queue.shift() as any;
      await stream.writeSSE({ id: e.id ? String(e.id) : undefined, data: JSON.stringify(e) });
    }
  });
});
