// /api/threads: list, create, detail, messages, uploads, stop, and the live stream.
// Split into two apps so app.ts can keep mounting threadsApi and terminalApi between them.
// Hono keeps the first registered match, so that order is the one the handlers already won with.
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { commentsPrompt, isArtifactUrl } from '@omni/shared/published.ts';
import { bus } from './bus.ts';
import { uploadsDir } from './config.ts';
import { artifacts, channels, events, fileDigests, messageRequests, publicChannel, requestFingerprint, threads, type Thread } from './db.ts';
import { readBody } from './read-body.ts';
import { compactBlocked, contextView } from './context.ts';
import {
  acceptedAgain,
  activeMods,
  cancelLimitResume,
  cancelRequests,
  createTeam,
  createThread,
  discardRequests,
  editRequest,
  interruptThread,
  isLive,
  pendingFor,
  postMessage,
  refreshContext,
  reorderRequests,
  resumeLimitNow,
  resumeRequests,
  retrySetup,
  scheduleLimitResume,
  runsHere,
  steerRequests,
  switchRun,
} from './runner.ts';
import { cancelHandoff, handOff } from './handoff.ts';
import { handoffView } from './handoff/records.ts';
import { headPage } from './history.ts';
import { liveMessage, openingMessages, parseAfter, type DetailOf } from './stream-catch-up.ts';
import { threadFilesReady, threadOpened } from './sync/files.ts';
import { turnBlocked } from './sync/guard.ts';
import { checkUploads, imageMime, removeUploads, safeName, saveUploads } from './uploads.ts';

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
  /** A sidebar folder of the channel, by id or name. A name no folder has makes one. */
  folder: z.string().max(200).nullish(),
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
  /** A sidebar folder of the channel for the lead, by id or name. A name no folder has makes one. */
  folder: z.string().max(200).nullish(),
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
  // ?history=recent: the newest page of events, older ones from GET /:id/history (apps/server/history.ts).
  return c.json(threadDetail(t, c.req.query('history') === 'recent' ? headPage(t.id) : { events: events.since(t.id) }));
});

/** The detail with `page`'s events: every event, the head and its `history`, or none (the stream's sync). */
function threadDetail(t: Thread, page: Parameters<DetailOf>[0]) {
  const detail = {
    thread: t,
    channel: (ch => ch && publicChannel(ch))(channels.get(t.channel_id)),
    events: page.events,
    ...(page.history && { history: page.history }),
    artifacts: artifacts.byThread(t.id),
    children: threads.children(t.id),
    // Members of the teams this thread started, so its delegation cards can show their state.
    team: threads.children(t.id).flatMap((ch) => threads.team(ch.id)),
    parent: t.parent_id ? threads.get(t.parent_id) : null,
    pending: pendingFor(t.id),
    live: isLive(t.id),
    // The status lines its mods pinned, while its process runs. The feed's mods event keeps them current.
    mods: activeMods().filter((m) => m.thread_id === t.id),
    // On its way to or from another Mac (apps/server/handoff.ts), null otherwise.
    handoff: handoffView(t),
  };
  // Only when a turn cannot start here (a synced thread): why, for the composer to show.
  const blocked = turnBlocked(t, runsHere(t.id));
  return blocked ? { ...detail, blocked } : detail;
}

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
  const { prompt, from, mode, request_id } = z
    .object({
      prompt: z.string().min(1),
      from: z.enum(['ben', 'conductor']).default('ben'),
      // steer: read at the agent's next step. queue: after this turn. interrupt: stop the turn, then run it.
      mode: z.enum(['steer', 'queue', 'interrupt']).default('steer'),
      // The client's id for this send, kept across its retries: a retry gets the first acceptance back.
      request_id: z.string().min(1).max(200).optional(),
    })
    .parse(data);
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  checkUploads(files);
  const fingerprint = requestFingerprint({ prompt, mode, source: from, files: await fileDigests(files) });
  // A retry: answered before its files are saved a second time.
  const again = request_id ? acceptedAgain(id, request_id, fingerprint) : null;
  if (again) return c.json(again);
  const attachments = await saveUploads(id, files);
  return c.json(await postMessage(id, prompt, { from, mode, attachments, requestId: request_id, fingerprint }));
});

const requestIds = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) });

/** The thread and its pending messages, after a resume, discard, edit, cancel, reorder or steer. */
const afterRecovery = (id: string) => ({ thread: threads.get(id), pending: pendingFor(id) });

/**
 * Resume messages a restart parked, in the order they came. No ids: every recovered one. An uncertain one (it may
 * have reached the harness before the restart) is only sent again when named.
 */
threadActionsApi.post('/:id/requests/resume', async (c) => {
  const id = c.req.param('id');
  const { ids } = z.object({ ids: z.array(z.string().min(1)).max(200).optional() }).parse(await c.req.json().catch(() => ({})));
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  await resumeRequests(id, ids);
  return c.json(afterRecovery(id));
});

/**
 * Retry a worktree that could not be prepared: the same thread, branch and session, and its first prompt once the
 * worktree is ready. Safe to send twice; a thread that is ready or already being prepared is left as it is.
 */
threadActionsApi.post('/:id/setup/retry', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  retrySetup(id);
  return c.json(afterRecovery(id));
});

/**
 * A turn the harness stopped at its usage limit (apps/server/runner/limits.ts). Schedule its one continuation for the
 * reset time the harness reported (a 409 when it reported none), cancel that, or send it now. Scheduling or
 * cancelling twice changes nothing; the continuation is sent at most once.
 */
threadActionsApi.post('/:id/limit/schedule', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  scheduleLimitResume(id);
  return c.json(afterRecovery(id));
});

threadActionsApi.post('/:id/limit/cancel', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  cancelLimitResume(id);
  return c.json(afterRecovery(id));
});

threadActionsApi.post('/:id/limit/resume', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  resumeLimitNow(id);
  return c.json(afterRecovery(id));
});

/**
 * Hand the running thread to another synced Mac: `{to}`, that Mac's id from GET /api/devices. Answered as soon as the
 * offer is written; the thread's `handoff` then follows it, here and on the other Mac. A 409 says why it cannot go.
 */
threadActionsApi.post('/:id/handoff', async (c) => {
  const { to } = z.object({ to: z.string().min(1).max(200) }).parse(await c.req.json().catch(() => ({})));
  return c.json(await handOff(c.req.param('id'), to));
});

/** Cancel a handoff from this Mac before the other one picks the thread up. Its queued messages wait here for Resume. */
threadActionsApi.post('/:id/handoff/cancel', (c) => c.json(cancelHandoff(c.req.param('id'))));

/** Drop messages a restart parked. Each stays in the transcript, marked as never sent. */
threadActionsApi.post('/:id/requests/discard', async (c) => {
  const id = c.req.param('id');
  const { ids } = requestIds.parse(await c.req.json().catch(() => ({})));
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  discardRequests(id, ids);
  return c.json(afterRecovery(id));
});

/**
 * Edit a message that is queued, held or parked and not sent yet: its text, the files it keeps (`keep`, by name;
 * left out keeps them all) and new files (multipart, as for /messages). The same request and queue position. A 409
 * once the runner has started sending it: the edit is not saved, and the client keeps Ben's text.
 */
threadActionsApi.patch('/:id/requests/:rid', async (c) => {
  const id = c.req.param('id');
  const { data, files } = await readBody(c);
  const { prompt, keep } = z.object({ prompt: z.string().min(1), keep: z.array(z.string()).max(100).optional() }).parse(data);
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  checkUploads(files);
  const added = await saveUploads(id, files);
  try {
    const request = editRequest(id, c.req.param('rid'), { prompt, keep, added });
    return c.json({ ...afterRecovery(id), request });
  } catch (err) {
    // Refused: the files this edit saved belong to nothing.
    removeUploads(added);
    throw err;
  }
});

/** Take unsent messages out of the queue. The transcript never shows them; GET /requests keeps the record. */
threadActionsApi.post('/:id/requests/cancel', async (c) => {
  const id = c.req.param('id');
  const { ids } = requestIds.parse(await c.req.json().catch(() => ({})));
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  cancelRequests(id, ids);
  return c.json(afterRecovery(id));
});

/** A new order for every unsent message, as the client saw them. A queue that changed since is a 409. Never resumes. */
threadActionsApi.post('/:id/requests/reorder', async (c) => {
  const id = c.req.param('id');
  const { ids } = requestIds.parse(await c.req.json().catch(() => ({})));
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  reorderRequests(id, ids);
  return c.json(afterRecovery(id));
});

/**
 * Send messages held for after this turn now, as steers: the agent reads them at its next step. A 409 when one is
 * not held for a running turn (sent already, waiting for a slot, parked) or the harness cannot steer.
 */
threadActionsApi.post('/:id/requests/steer', async (c) => {
  const id = c.req.param('id');
  const { ids } = requestIds.parse(await c.req.json().catch(() => ({})));
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  steerRequests(id, ids);
  return c.json(afterRecovery(id));
});

/** The thread's requests, newest first, with their delivery state: what was sent, dropped, discarded or cancelled. */
threadActionsApi.get('/:id/requests', (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  return c.json(messageRequests.forThread(id, Math.min(Number(c.req.query('limit') ?? 100) || 100, 500)));
});

/** Ask the thread to act on the comments on a page it published. Queued, so it never cuts into a running turn. */
threadActionsApi.post('/:id/published/comments', async (c) => {
  const id = c.req.param('id');
  const { url } = z.object({ url: z.string().refine(isArtifactUrl, 'not a claude.ai artifact url') }).parse(await c.req.json());
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  return c.json(await postMessage(id, commentsPrompt(url), { mode: 'queue' }));
});

/**
 * How full the thread's context window is and what fills it, for the meter. `refresh=1` first asks a warm
 * Claude process for a new split, and waits briefly for it.
 */
threadActionsApi.get('/:id/context', async (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  if (c.req.query('refresh') && refreshContext(t.id)) {
    await new Promise<void>((resolve) => {
      const done = (e: any) => {
        if (e?.kind !== 'context') return;
        clearTimeout(timer);
        bus.off(`thread:${t.id}`, done);
        resolve();
      };
      const timer = setTimeout(() => (bus.off(`thread:${t.id}`, done), resolve()), 3000);
      bus.on(`thread:${t.id}`, done);
    });
  }
  return c.json(contextView(threads.get(t.id) ?? t));
});

/**
 * Compact the thread's context: its harness's own /compact, as a message, so the transcript shows it.
 * Claude Code takes `focus` as what to keep; Codex compacts without instructions.
 */
threadActionsApi.post('/:id/compact', async (c) => {
  const id = c.req.param('id');
  const { focus } = z.object({ focus: z.string().max(2000).optional() }).parse(await c.req.json().catch(() => ({})));
  const t = threads.get(id);
  if (!t) return c.json({ error: 'not found' }, 404);
  const blocked = compactBlocked(t);
  if (blocked) return c.json({ error: blocked }, 409);
  const extra = t.harness === 'claude-code' ? focus?.replace(/\s+/g, ' ').trim() : '';
  return c.json(await postMessage(id, extra ? `/compact ${extra}` : '/compact', { mode: 'queue' }));
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

const runSchema = z.object({
  harness: z.string().min(1),
  model: z.string().nullish().transform((v) => v ?? ''),
  effort: z.string().nullish().transform((v) => v ?? ''),
});

/**
 * Move the thread to another harness, model or effort between turns (runner/switch.ts). A 409 while a turn runs or
 * messages wait, a 400 for a run the catalog does not offer. The same run again changes nothing.
 */
threadActionsApi.post('/:id/run', async (c) => {
  const body = runSchema.parse(await c.req.json().catch(() => ({})));
  return c.json(await switchRun(c.req.param('id'), body));
});

const interrupt = (c: Context) => {
  const t = interruptThread(c.req.param('id')!);
  return t ? c.json(t) : c.json({ error: 'not found' }, 404);
};
threadActionsApi.post('/:id/stop', interrupt);
threadActionsApi.post('/:id/interrupt', interrupt);

threadActionsApi.get('/:id/stream', (c) => {
  const id = c.req.param('id');
  const after = parseAfter(c.req.query('after') ?? c.req.header('Last-Event-ID') ?? '0');
  return streamSSE(c, async (stream) => {
    const queue: unknown[] = [];
    // Rows the opening messages carried, so the bus's copies are not sent twice (apps/server/stream-catch-up.ts).
    const sent = new Set<number>();
    let wake: (() => void) | null = null;
    const onEvent = (e: unknown) => {
      queue.push(e);
      wake?.();
    };
    bus.on(`thread:${id}`, onEvent);
    const onFeed = (e: any) => {
      if (e.type !== 'thread' || (e.thread as Thread).id !== id) return;
      const blocked = turnBlocked(e.thread as Thread, runsHere(id));
      onEvent({ kind: 'thread', thread: e.thread, pending: pendingFor(id), live: isLive(id), handoff: handoffView(e.thread as Thread), ...(blocked && { blocked }) });
    };
    bus.on('feed', onFeed);
    stream.onAbort(() => {
      bus.off(`thread:${id}`, onEvent);
      bus.off('feed', onFeed);
      wake?.();
    });
    // Flush headers immediately so proxies (vite dev) don't hold the stream back.
    await stream.writeSSE({ event: 'ping', data: '' });
    const detailOf: DetailOf = (page) => (t => (t ? threadDetail(t, page) : null))(threads.get(id));
    for (const m of openingMessages(id, after, detailOf, queue, sent)) await stream.writeSSE(m);
    while (!stream.aborted) {
      if (!queue.length) {
        await Promise.race([new Promise<void>((r) => (wake = r)), stream.sleep(20_000)]);
        wake = null;
        if (!queue.length) await stream.writeSSE({ event: 'ping', data: '' });
        continue;
      }
      const m = liveMessage(queue.shift(), sent);
      if (m) await stream.writeSSE(m);
    }
  });
});
