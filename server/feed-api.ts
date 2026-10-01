// /api/feed, /status, /tasks, /recent, /search: the global views across threads.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { about } from './about.ts';
import { bus } from './bus.ts';
import { config } from './config.ts';
import { search, threads } from './db.ts';
import { activeTasks, queuedCount, runningCount, slotsByHarness } from './runner.ts';
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

feedApi.get('/recent', (c) => c.json(threads.recent(Number(c.req.query('limit') ?? 60))));
feedApi.get('/search', (c) => c.json(search(c.req.query('q') ?? '')));
