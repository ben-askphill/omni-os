// /api/feed, /status, /tasks, /recent, /needs-you, /search: the global views across threads.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { about } from './about.ts';
import { bus, publishFeed } from './bus.ts';
import { config } from './config.ts';
import { needsYou, resultReads, search, threads } from './db.ts';
import { activeMods, activeTasks, queuedCount, runningCount, slotsByHarness } from './runner.ts';
import { usageByHarness } from './usage.ts';

export const feedApi = new Hono();

feedApi.get('/feed', (c) =>
  streamSSE(c, async (stream) => {
    const onFeed = (e: unknown) => void stream.writeSSE({ data: JSON.stringify(e) });
    bus.on('feed', onFeed);
    stream.onAbort(() => {
      bus.off('feed', onFeed);
    });
    for (const [harness, usage] of Object.entries(usageByHarness())) {
      if (usage) await stream.writeSSE({ data: JSON.stringify({ type: 'usage', harness, usage }) });
    }
    while (!stream.aborted) {
      await stream.sleep(20_000);
      await stream.writeSSE({ event: 'ping', data: '' });
    }
  }),
);

feedApi.get('/status', (c) =>
  c.json({
    usage: usageByHarness(),
    slots: slotsByHarness(),
    running: runningCount(),
    queued: queuedCount(),
    maxConcurrent: config.maxConcurrent,
    maxUploadMb: config.maxUploadMb,
    server: about,
  }),
);

/** Sub-agents, background shells and workflows still running, across every thread. */
feedApi.get('/tasks', (c) => c.json(activeTasks()));

/** Mod status lines pinned now, across every thread. Cleared when a thread's process ends. */
feedApi.get('/mods', (c) => c.json(activeMods()));

feedApi.get('/recent', (c) => c.json(threads.recent(Number(c.req.query('limit') ?? 60))));
feedApi.get('/search', (c) => c.json(search(c.req.query('q') ?? '')));

/**
 * Needs you: unread results and blockers across every thread that is not archived, newest first. `channel` keeps
 * one channel's, `thread` one thread's.
 */
feedApi.get('/needs-you', (c) => c.json(needsYou(c.req.query('channel') || undefined, c.req.query('thread') || undefined)));

/**
 * Ben saw a result: `{ uid }`, the result's uid as Needs you sent it. Only that result and older ones count as read,
 * so a turn that ended after the client showed it stays unread. Answers with the thread's item as it is now, null
 * when nothing about it needs Ben.
 */
feedApi.post('/needs-you/read', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { uid?: unknown } | null;
  if (typeof body?.uid !== 'string' || !body.uid) return c.json({ error: 'uid is required' }, 400);
  const read = resultReads.read(body.uid);
  if (!read) return c.json({ error: 'No such result' }, 404);
  publishFeed({ type: 'needs_you', thread_id: read.thread_id });
  return c.json({ thread_id: read.thread_id, item: needsYou(undefined, read.thread_id).items[0] ?? null });
});
