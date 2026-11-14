// /api/feed, /status, /machines, /tasks, /recent, /needs-you, /search, /insights: the global views across threads.
import { Hono } from 'hono';
import { sessionSSE } from './sse.ts';
import { about } from './about.ts';
import { bus, publishFeed, type FeedEvent } from './bus.ts';
import { config } from './config.ts';
import { diskView, refreshDisk } from './disk-space.ts';
import { needsYou, resultReads, search, threads, type Thread } from './db.ts';
import { allWithDelegating, withDelegating } from './delegating.ts';
import { handoffView } from './handoff/records.ts';
import { grokBotConfigured } from './grokbot.ts';
import { fromThisMac } from './request-guard.ts';
import { getProfile } from './profile.ts';
import { activeMods, activeTasks, queuedCount, runningCount, slotsByHarness } from './runner.ts';
import { usageByHarness } from './usage.ts';
import { getInsights, validTimeZone } from './insights.ts';
import { machinesView } from './machines.ts';
import { isInsightRange } from '@omni/shared/insights.ts';

export const feedApi = new Hono();

feedApi.get('/feed', (c) =>
  sessionSSE(c, async (stream) => {
    // A thread carries its handoff and `delegating` on every update, as its own stream and GET do.
    const onFeed = (e: FeedEvent) =>
      void stream.writeSSE({
        data: JSON.stringify(e.type === 'thread' ? { ...e, thread: withDelegating(e.thread as Thread), handoff: handoffView(e.thread as Thread) } : e),
      });
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

// The Inbox dashboard for one range. `tz` is the viewer's IANA zone, which decides where each day starts.
feedApi.get('/insights', async (c) => {
  const range = c.req.query('range') ?? '30d';
  if (!isInsightRange(range)) return c.json({ error: 'range must be today, 7d or 30d' }, 400);
  const tz = c.req.query('tz') || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!validTimeZone(tz)) return c.json({ error: 'unknown time zone' }, 400);
  return c.json(await getInsights(range, tz));
});

feedApi.get('/status', (c) =>
  c.json({
    usage: usageByHarness(),
    slots: slotsByHarness(),
    running: runningCount(),
    queued: queuedCount(),
    maxConcurrent: config.maxConcurrent,
    maxUploadMb: config.maxUploadMb,
    profile: getProfile(),
    server: about,
    device: { name: about.name, here: fromThisMac(c) },
    /** A Grok Bot webhook URL is set, so the clients offer Send to Grok Bot. */
    grokBot: grokBotConfigured(),
  }),
);

/**
 * What each machine under this account runs now: this one, then every synced one with whether Tailscale sees it up,
 * and each one's CPU and memory. Clients ask again on the feed's thread and tasks events, which a synced machine's runs
 * raise here too; samples arrive as machine_stats events. `?stats=1` samples this machine even when it is the only one.
 */
feedApi.get('/machines', async (c) => c.json(await machinesView({ stats: c.req.query('stats') === '1' })));

/** Free space on the disk with Omni's data and the temp folder, as last checked (every 10 minutes); checks now before the first. */
feedApi.get('/disk', async (c) => c.json(diskView().checkedAt ? diskView() : await refreshDisk()));

/** Sub-agents, background shells and workflows still running, across every thread. */
feedApi.get('/tasks', (c) => c.json(activeTasks()));

/** Mod status lines pinned now, across every thread. Cleared when a thread's process ends. */
feedApi.get('/mods', (c) => c.json(activeMods()));

feedApi.get('/recent', (c) => c.json(allWithDelegating(threads.recent(Number(c.req.query('limit') ?? 60)))));
/** The sidebar's Pinned section: pinned threads in every channel, the latest pin first. Archived ones drop out. */
feedApi.get('/pinned', (c) => c.json(allWithDelegating(threads.pinned())));
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
