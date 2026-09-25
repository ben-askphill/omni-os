import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { readFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';
import { z } from 'zod';
import { config, paths } from './config.ts';
import { channels, threads, events, artifacts, search, type Thread } from './db.ts';
import { bus } from './bus.ts';
import { createThread, sendMessage, interruptThread, getUsage, runningCount, queuedCount, pendingFor, isLive, shutdownAll } from './runner.ts';
import { listCrew } from './crew.ts';
import { listSecrets, setSecret, deleteSecret } from './secrets.ts';
import { startArtifactWatcher, mimeFor } from './artifacts.ts';
import { detectRepo, listPRs, getPR, mergePR } from './github.ts';
import { loadAutomations, runAutomation, setEnabled, lastRuns, startScheduler } from './automations.ts';

const app = new Hono();
const api = new Hono();

app.onError((err, c) => {
  console.error('[api]', err);
  return c.json({ error: err.message }, err instanceof z.ZodError ? 400 : 500);
});

// ---------- channels ----------

const channelSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/, 'lowercase letters, digits and dashes'),
  name: z.string().min(1),
  kind: z.enum(['client', 'internal', 'personal']).optional(),
  repo_path: z.string().nullish(),
  github_repo: z.string().nullish(),
  use_worktree: z.coerce.number().int().min(0).max(1).optional(),
  base_dir: z.string().nullish(),
  store_domain: z.string().nullish(),
  portal_slug: z.string().nullish(),
  browser_headless: z.coerce.number().int().min(0).max(1).optional(),
  notes: z.string().nullish(),
});

api.get('/channels', (c) => {
  const list = channels.list(c.req.query('archived') === '1').map((ch) => ({
    ...ch,
    running: threads.running().filter((t) => t.channel_id === ch.id).length,
  }));
  return c.json(list);
});

api.get('/channels/:id', (c) => {
  const ch = channels.get(c.req.param('id'));
  if (!ch) return c.json({ error: 'not found' }, 404);
  return c.json({ ...ch, running: threads.running().filter((t) => t.channel_id === ch.id).length });
});

api.post('/channels', async (c) => {
  const body = channelSchema.parse(await c.req.json());
  if (channels.get(body.id)) return c.json({ error: 'channel exists' }, 409);
  if (body.repo_path && !existsSync(body.repo_path)) return c.json({ error: `repo path not found: ${body.repo_path}` }, 400);
  if (body.repo_path && !body.github_repo) body.github_repo = await detectRepo(body.repo_path);
  return c.json(channels.create(body as any));
});

api.patch('/channels/:id', async (c) => {
  const id = c.req.param('id');
  if (!channels.get(id)) return c.json({ error: 'not found' }, 404);
  const body = channelSchema.partial().extend({ archived: z.coerce.number().optional() }).parse(await c.req.json());
  delete (body as any).id;
  if (body.repo_path && !body.github_repo && !channels.get(id)!.github_repo) body.github_repo = await detectRepo(body.repo_path);
  return c.json(channels.update(id, body as any));
});

api.get('/channels/:id/threads', (c) => c.json(threads.byChannel(c.req.param('id'))));

// ---------- threads ----------

const createSchema = z.object({
  channel: z.string().default('inbox'),
  prompt: z.string().min(1),
  role: z.string().nullish(),
  model: z.string().nullish(),
  title: z.string().nullish(),
  parent_id: z.string().nullish(),
  task_id: z.string().nullish(),
  source: z.enum(['manual', 'conductor', 'capture']).default('manual'),
});

api.get('/threads', (c) =>
  c.json(
    threads.list({
      channel: c.req.query('channel'),
      status: c.req.query('status'),
      limit: Number(c.req.query('limit') ?? 50),
    }),
  ),
);

api.post('/threads', async (c) => {
  const body = createSchema.parse(await c.req.json());
  return c.json(await createThread(body));
});

api.get('/threads/:id', (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  return c.json({
    thread: t,
    channel: channels.get(t.channel_id),
    events: events.since(t.id),
    artifacts: artifacts.byThread(t.id),
    children: threads.children(t.id),
    parent: t.parent_id ? threads.get(t.parent_id) : null,
    pending: pendingFor(t.id),
    live: isLive(t.id),
  });
});

/** Compact view for the conductor MCP. */
api.get('/threads/:id/summary', (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  return c.json({
    id: t.id, title: t.title, status: t.status, channel: t.channel_id, role: t.role, task_id: t.task_id,
    updated_at: t.updated_at, last_reply: events.lastRunText(t.id) || events.lastAssistantText(t.id),
    artifacts: artifacts.byThread(t.id).map((a) => a.name),
  });
});

api.post('/threads/:id/messages', async (c) => {
  const { prompt, from, mode } = z
    .object({
      prompt: z.string().min(1),
      from: z.enum(['ben', 'conductor']).default('ben'),
      // steer: read at the agent's next step. queue: after this turn. interrupt: stop the turn, then run it.
      mode: z.enum(['steer', 'queue', 'interrupt']).default('steer'),
    })
    .parse(await c.req.json());
  return c.json(sendMessage(c.req.param('id'), prompt, { from, mode }));
});

const interrupt = (c: Context) => {
  const t = interruptThread(c.req.param('id')!);
  return t ? c.json(t) : c.json({ error: 'not found' }, 404);
};
api.post('/threads/:id/stop', interrupt);
api.post('/threads/:id/interrupt', interrupt);

api.get('/threads/:id/stream', (c) => {
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
    const onFeed = (e: any) =>
      e.type === 'thread' && (e.thread as Thread).id === id && onEvent({ kind: 'thread', thread: e.thread, pending: pendingFor(id), live: isLive(id) });
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

// ---------- global feed ----------

api.get('/feed', (c) =>
  streamSSE(c, async (stream) => {
    const onFeed = (e: unknown) => void stream.writeSSE({ data: JSON.stringify(e) });
    bus.on('feed', onFeed);
    stream.onAbort(() => {
      bus.off('feed', onFeed);
    });
    await stream.writeSSE({ data: JSON.stringify({ type: 'usage', usage: getUsage() }) });
    while (!stream.aborted) {
      await stream.sleep(20_000);
      await stream.writeSSE({ event: 'ping', data: '' });
    }
  }),
);

api.get('/status', (c) =>
  c.json({ usage: getUsage(), running: runningCount(), queued: queuedCount(), maxConcurrent: config.maxConcurrent }),
);

api.get('/recent', (c) => c.json(threads.recent(Number(c.req.query('limit') ?? 60))));
api.get('/search', (c) => c.json(search(c.req.query('q') ?? '')));

// ---------- artifacts ----------

api.get('/artifacts', (c) => c.json(artifacts.recent()));
api.get('/artifacts/:id/raw', (c) => {
  const a = artifacts.get(Number(c.req.param('id')));
  if (!a || !existsSync(a.path) || relative(paths.threads, a.path).startsWith('..')) return c.text('not found', 404);
  c.header('Content-Type', mimeFor(a.path, a.kind));
  c.header('Cache-Control', 'no-store');
  if (c.req.query('download')) c.header('Content-Disposition', `attachment; filename="${a.name}"`);
  return c.body(readFileSync(a.path));
});

// ---------- github ----------

const repoOf = (channelId: string) => {
  const ch = channels.get(channelId);
  if (!ch?.github_repo) throw new Error('channel has no GitHub repo set');
  return ch.github_repo;
};

api.get('/channels/:id/prs', async (c) => c.json(await listPRs(repoOf(c.req.param('id')), c.req.query('state') ?? 'open')));
api.get('/channels/:id/prs/:n', async (c) => c.json(await getPR(repoOf(c.req.param('id')), Number(c.req.param('n')))));
api.post('/channels/:id/prs/:n/merge', async (c) => {
  const { method, delete_branch, confirm } = z
    .object({ method: z.enum(['squash', 'merge', 'rebase']).default('squash'), delete_branch: z.boolean().default(true), confirm: z.literal(true) })
    .parse(await c.req.json());
  void confirm;
  const out = await mergePR(repoOf(c.req.param('id')), Number(c.req.param('n')), method, delete_branch);
  return c.json({ ok: true, output: out });
});

// ---------- crew, secrets, automations ----------

api.get('/crew', (c) => c.json(listCrew()));

api.get('/secrets', (c) => c.json(listSecrets()));
api.post('/secrets', async (c) => {
  const { scope, name, value } = z.object({ scope: z.string(), name: z.string(), value: z.string() }).parse(await c.req.json());
  await setSecret(scope, name, value);
  return c.json({ ok: true });
});
api.delete('/secrets', async (c) => {
  const { scope, name } = z.object({ scope: z.string(), name: z.string() }).parse(await c.req.json());
  await deleteSecret(scope, name);
  return c.json({ ok: true });
});

api.get('/automations', (c) => c.json(loadAutomations().map((a) => ({ ...a, runs: lastRuns(a.id, 5) }))));
api.post('/automations/:id/run', async (c) => {
  const a = loadAutomations().find((x) => x.id === c.req.param('id'));
  if (!a) return c.json({ error: 'not found' }, 404);
  if (a.error) return c.json({ error: a.error }, 400);
  return c.json(await runAutomation(a, 'manual'));
});
api.post('/automations/:id/enabled', async (c) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
  setEnabled(c.req.param('id'), enabled);
  return c.json({ ok: true });
});

app.route('/api', api);

// ---------- web ----------

if (existsSync(paths.webDist)) {
  app.use('/*', serveStatic({ root: relative(process.cwd(), paths.webDist) }));
  app.get('*', (c) => c.html(readFileSync(`${paths.webDist}/index.html`, 'utf8')));
}

const interrupted = threads.failInterrupted();
if (interrupted) console.log(`[omni] marked ${interrupted} interrupted thread(s) as failed`);
startArtifactWatcher();
startScheduler();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[omni] listening on http://${config.host}:${info.port}  brain=${config.brainDir}`);
});

// Close warm claude processes so none outlive the server. A second signal exits at once.
let exiting = false;
const shutdown = (sig: string) => {
  if (exiting) process.exit(1);
  exiting = true;
  console.log(`[omni] ${sig}, closing live sessions`);
  server.close();
  setTimeout(() => process.exit(0), 6000).unref();
  void shutdownAll().finally(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
