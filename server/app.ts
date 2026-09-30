import { Hono, type Context } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { config, paths, uploadsDir } from './config.ts';
import { channels, threads, events, artifacts, search, type Channel, type Thread } from './db.ts';
import { bus } from './bus.ts';
import { parseChannelIcon } from '../shared/channel-icon.ts';
import { createThread, postMessage, interruptThread, runningCount, activeTasks, runningByHarness, slotsByHarness, queuedCount, pendingFor, isLive, runsHere } from './runner.ts';
import { freshCatalog, getCatalog } from './harness/catalog-service.ts';
import { validateDefaults } from './harness/resolve.ts';
import { usageByHarness } from './usage.ts';
import { listCrew } from './crew.ts';
import { listSecrets, setSecret, deleteSecret } from './secrets.ts';
import { mimeFor } from './artifacts.ts';
import { checkUploads, imageMime, safeName, saveUploads } from './uploads.ts';
import { detectRepo, listPRs, branchPRs, getPR, mergePR } from './github.ts';
import { loadAutomations, runAutomation, setEnabled, lastRuns } from './automations.ts';
import { commandsApi } from './commands-api.ts';
import { threadsApi } from './threads-api.ts';
import { syncApi } from './sync-api.ts';
import { turnBlocked } from './sync/guard.ts';
import { threadFilesReady, threadOpened } from './sync/files.ts';
import { about } from './about.ts';
import { channelBrowser, existingBrowser, normalizeUrl, type BrowserEvent, type BrowserInput } from './browser.ts';

// Every /api route, and the Web UI. server/index.ts boots it.
export const app = new Hono();
const api = new Hono();

app.onError((err, c) => {
  console.error('[api]', err);
  const status = err instanceof z.ZodError ? 400 : ((err as { status?: number }).status ?? 500);
  return c.json({ error: err.message }, status as 400);
});

/**
 * Message bodies arrive as JSON, or as multipart when the composer has attachments:
 * a `payload` field with the same JSON plus one `files` entry per attachment.
 */
async function readBody(c: Context): Promise<{ data: unknown; files: File[] }> {
  if (!(c.req.header('content-type') ?? '').includes('multipart/form-data')) return { data: await c.req.json(), files: [] };
  const form = await c.req.parseBody({ all: true });
  const raw = form.payload;
  const entry = form.files;
  return {
    data: typeof raw === 'string' ? JSON.parse(raw) : {},
    files: (Array.isArray(entry) ? entry : entry ? [entry] : []).filter((f): f is File => f instanceof File),
  };
}

// ---------- channels ----------

/** One emoji or character, or `icon:<name>` for a design system icon. Blank clears it. */
const channelIcon = z
  .string()
  .trim()
  .max(32)
  .refine((s) => !s || parseChannelIcon(s), 'one emoji or character, or icon:<name> from the design system')
  .transform((s) => s || null)
  .nullish();

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
  icon: channelIcon,
});

/** A channel's latest threads of any status, so the sidebar can keep finished ones findable. */
const RECENT_PER_CHANNEL = 5;

const stub = ({ id, channel_id, title, status, created_at }: Thread) => ({ id, channel_id, title, status, created_at });

/** A channel plus its running and queued threads, and its latest ones, so the sidebar can list them under the name. */
const withActive = (ch: Channel, busy: Thread[], recent: Thread[]) => {
  const mine = busy.filter((t) => t.channel_id === ch.id);
  return {
    ...ch,
    running: mine.length,
    active: mine.map(stub),
    recent: recent.filter((t) => t.channel_id === ch.id).map(stub),
  };
};

api.get('/channels', (c) => {
  const busy = threads.running();
  const recent = threads.recentPerChannel(RECENT_PER_CHANNEL);
  return c.json(channels.list(c.req.query('archived') === '1').map((ch) => withActive(ch, busy, recent)));
});

api.get('/channels/:id', (c) => {
  const ch = channels.get(c.req.param('id'));
  if (!ch) return c.json({ error: 'not found' }, 404);
  return c.json(withActive(ch, threads.running(), threads.byChannel(ch.id, RECENT_PER_CHANNEL)));
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

// ---------- channel browser ----------

/** The channel's live browser, starting it on the way. 404 for an unknown channel, 409 with the browser off. */
function browserFor(c: Context) {
  const ch = channels.get(c.req.param('id')!);
  if (!ch) throw Object.assign(new Error('not found'), { status: 404 });
  if (!config.browser || !config.browserLive) throw Object.assign(new Error('The live browser is off (OMNI_BROWSER or OMNI_BROWSER_LIVE is 0)'), { status: 409 });
  return channelBrowser(ch.id, !!ch.browser_headless);
}

api.get('/channels/:id/browser', (c) => {
  const b = existingBrowser(c.req.param('id'));
  return c.json(b?.state() ?? { running: false, url: '', title: '', loading: false, canBack: false, canForward: false, tabs: [], active: null });
});

/** Live view: `state` messages, and `frame` messages with a JPEG. A slow client skips frames rather than queueing them. */
api.get('/channels/:id/browser/stream', (c) => {
  const b = browserFor(c);
  return streamSSE(c, async (stream) => {
    const states: BrowserEvent[] = [];
    let frame: BrowserEvent | null = null;
    let wake: (() => void) | null = null;
    let stop = () => {};
    stream.onAbort(() => {
      stop();
      wake?.();
    });
    await stream.writeSSE({ event: 'ping', data: '' });
    try {
      await b.start();
    } catch (err) {
      await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: (err as Error).message }) });
      return;
    }
    stop = b.watch((e) => {
      if (e.type === 'frame') frame = e;
      else states.push(e);
      wake?.();
    });
    while (!stream.aborted) {
      if (!states.length && !frame) {
        await Promise.race([new Promise<void>((r) => (wake = r)), stream.sleep(20_000)]);
        wake = null;
        if (!states.length && !frame) await stream.writeSSE({ event: 'ping', data: '' });
        continue;
      }
      const next: BrowserEvent = states.shift() ?? frame!;
      if (next === frame) frame = null;
      await stream.writeSSE({ data: JSON.stringify(next) });
    }
    stop();
  });
});

const mods = z.number().int().min(0).max(15).optional();
const browserInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mouse'), event: z.enum(['mousePressed', 'mouseReleased', 'mouseMoved']), x: z.number(), y: z.number(), button: z.enum(['left', 'middle', 'right', 'none']).optional(), buttons: z.number().int().optional(), clickCount: z.number().int().min(0).max(3).optional(), modifiers: mods }),
  z.object({ type: z.literal('wheel'), x: z.number(), y: z.number(), deltaX: z.number(), deltaY: z.number(), modifiers: mods }),
  z.object({ type: z.literal('key'), event: z.enum(['keyDown', 'keyUp']), key: z.string().max(40), code: z.string().max(40), text: z.string().max(4).optional(), keyCode: z.number().int(), modifiers: mods }),
  z.object({ type: z.literal('text'), text: z.string().max(10_000) }),
]);

api.post('/channels/:id/browser/input', async (c) => {
  const b = browserFor(c);
  if (!b.running) return c.json({ error: 'The browser is not running' }, 409);
  await b.input(browserInput.parse(await c.req.json()) as BrowserInput);
  return c.json({ ok: true });
});

api.post('/channels/:id/browser/action', async (c) => {
  const b = browserFor(c);
  const body = z
    .discriminatedUnion('action', [
      z.object({ action: z.literal('navigate'), url: z.string().max(4000) }),
      z.object({ action: z.enum(['back', 'forward', 'reload', 'stop', 'start', 'restart']) }),
      z.object({ action: z.literal('newTab'), url: z.string().max(4000).optional() }),
      z.object({ action: z.enum(['tab', 'closeTab']), id: z.string().max(100) }),
    ])
    .parse(await c.req.json());
  if (body.action === 'restart') b.close();
  await b.start();
  switch (body.action) {
    case 'navigate': {
      const url = normalizeUrl(body.url);
      if (!url) return c.json({ error: 'Only http and https pages open here' }, 400);
      await b.navigate(url);
      break;
    }
    case 'newTab': {
      const url = body.url ? normalizeUrl(body.url) : 'about:blank';
      if (!url) return c.json({ error: 'Only http and https pages open here' }, 400);
      await b.newTab(url);
      break;
    }
    case 'back':
      await b.history(-1);
      break;
    case 'forward':
      await b.history(1);
      break;
    case 'reload':
      await b.reload();
      break;
    case 'stop':
      await b.stopLoading();
      break;
    case 'tab':
      await b.attach(body.id);
      break;
    case 'closeTab':
      await b.closeTab(body.id);
      break;
  }
  return c.json(b.state());
});

// ---------- threads ----------

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
  const { data, files } = await readBody(c);
  const body = createSchema.parse(data);
  checkUploads(files);
  return c.json(await createThread({ ...body, files }));
});

api.get('/threads/:id', (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  // With sync on, the files it has on the other Mac download in the background.
  void threadOpened(t.id);
  const detail = {
    thread: t,
    channel: channels.get(t.channel_id),
    events: events.since(t.id),
    artifacts: artifacts.byThread(t.id),
    children: threads.children(t.id),
    parent: t.parent_id ? threads.get(t.parent_id) : null,
    pending: pendingFor(t.id),
    live: isLive(t.id),
  };
  // Only when a turn cannot start here (a synced thread): why, for the composer to show.
  const blocked = turnBlocked(t, runsHere(t.id));
  return c.json(blocked ? { ...detail, blocked } : detail);
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

api.route('/threads', threadsApi);

api.post('/threads/:id/messages', async (c) => {
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

/** Serves a file Ben attached, by its name inside the thread's uploads folder. */
api.get('/threads/:id/uploads/:name', async (c) => {
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

// ---------- global feed ----------

api.get('/feed', (c) =>
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

api.get('/status', (c) =>
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
api.get('/tasks', (c) => c.json(activeTasks()));

api.get('/recent', (c) => c.json(threads.recent(Number(c.req.query('limit') ?? 60))));
api.get('/search', (c) => c.json(search(c.req.query('q') ?? '')));

// ---------- artifacts ----------

api.get('/artifacts', (c) => c.json(artifacts.recent()));
api.get('/artifacts/:id/raw', async (c) => {
  const a = artifacts.get(Number(c.req.param('id')));
  if (a && !existsSync(a.path)) await threadFilesReady(a.thread_id);
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
// The PRs opened from a thread's branch, newest first, and `pr`, the one to show: the open one,
// else the newest. null and [] when there is none or no repo to ask.
api.get('/threads/:id/pr', async (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  const repo = channels.get(t.channel_id)?.github_repo;
  if (!t.branch || !repo) return c.json({ pr: null, prs: [] });
  return c.json(await branchPRs(repo, t.branch));
});
api.post('/channels/:id/prs/:n/merge', async (c) => {
  const { method, delete_branch, confirm } = z
    .object({ method: z.enum(['squash', 'merge', 'rebase']).default('squash'), delete_branch: z.boolean().default(true), confirm: z.literal(true) })
    .parse(await c.req.json());
  void confirm;
  const out = await mergePR(repoOf(c.req.param('id')), Number(c.req.param('n')), method, delete_branch);
  return c.json({ ok: true, output: out });
});

// ---------- crew, secrets, automations ----------

api.get('/crew', (c) => {
  const cat = getCatalog();
  return c.json(
    listCrew().map((r) => ({
      ...r,
      error: r.error ?? validateDefaults({ harness: r.harness, model: r.model, effort: r.effort }, cat),
    })),
  );
});

// The harnesses with their availability, fix command, models, efforts, cap and running count.
// A harness that is down is probed again first, so a login shows up when the picker opens.
api.get('/harnesses', async (c) => {
  const cat = await freshCatalog();
  const running = runningByHarness();
  return c.json(cat.harnesses.map((h) => ({ ...h, running: running[h.id] ?? 0 })));
});

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

api.get('/automations', (c) => {
  const cat = getCatalog();
  return c.json(
    loadAutomations().map((a) => ({
      ...a,
      error: a.error ?? validateDefaults({ harness: a.harness, model: a.model, effort: a.effort }, cat),
      runs: lastRuns(a.id, 5),
    })),
  );
});
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

api.route('/commands', commandsApi);
api.route('/sync', syncApi);

// Last, so only a request no route above takes lands here, and never on the Web UI's index.html.
api.all('*', (c) => c.json({ error: 'Not found' }, 404));

app.route('/api', api);

// ---------- web ----------

if (existsSync(paths.webDist)) {
  app.use('/*', serveStatic({ root: paths.webDist }));
  app.get('*', (c) => c.html(readFileSync(`${paths.webDist}/index.html`, 'utf8')));
}
