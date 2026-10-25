// A channel's named actions and their runs in a thread (actions.ts). Its own app, mounted at /api, so tests can call it
// without starting the server.
//
// GET    /channels/:id/actions                  the channel's actions
// POST   /channels/:id/actions                  add one: { name, command, secrets, port, setup }
// PATCH  /channels/:id/actions/:action          change one, same body
// DELETE /channels/:id/actions/:action          remove one; its past runs stay
// GET    /threads/:id/actions                   ThreadActions: the actions, the thread's runs, why none can run now
// POST   /threads/:id/actions/:action/run       start one in the thread's checkout
// POST   /threads/:id/action-runs/:run/stop     stop a run
// POST   /threads/:id/action-runs/:run/retry    run its action again
import { Hono } from 'hono';
import { z } from 'zod';
import type { ChannelActionInput } from '@omni/shared/channel-actions.ts';
import { blockedReason, forbiddenSecret, retryRun, startRun, stopRun, threadActions } from './actions.ts';
import { actionRuns, channelActions, channels, threads } from './db.ts';
import { NAME_RE } from './secrets.ts';

export const actionsApi = new Hono();

actionsApi.onError((err, c) => {
  if (err instanceof z.ZodError) return c.json({ error: err.issues[0]?.message ?? 'invalid request' }, 400);
  return c.json({ error: err.message }, ((err as { status?: number }).status ?? 500) as 400);
});

/** A port the command names outright, like `--port 9292`. */
const LITERAL_PORT = /--port[= ](\d+)/;

const actionInput = z
  .object({
    name: z.string().trim().min(1, 'Give the action a name.').max(60),
    command: z.string().trim().min(1, 'Give the action a command.').max(4000),
    secrets: z
      .array(z.string().trim().regex(NAME_RE, 'Secret names are UPPER_SNAKE_CASE, like SHOPIFY_CLI_THEME_TOKEN.'))
      .max(20)
      .default([])
      .transform((names) => [...new Set(names)]),
    port: z.number().int().min(0).max(65535).nullable().default(null),
    setup: z.enum(['blocking', 'background']).nullable().default(null),
  })
  .superRefine((a, ctx) => {
    for (const name of a.secrets) {
      if (forbiddenSecret(name)) ctx.addIssue({ code: 'custom', message: `${name} is a billing, sync or server key. Actions never get it.` });
    }
    if (a.port !== null && a.port > 0 && a.port < 1024) ctx.addIssue({ code: 'custom', message: 'Use a port above 1023, or 0 for a free one per run.' });
    const named = LITERAL_PORT.exec(a.command)?.[1];
    if (named && a.port !== Number(named)) {
      ctx.addIssue({
        code: 'custom',
        message: `The command names port ${named}. Use --port $OMNI_PORT with a free port per run, or set the action's port to ${named}, so Omni can tell when two runs would share it.`,
      });
    }
  }) satisfies z.ZodType<Required<ChannelActionInput>, unknown>;

const taken = (name: string) => Object.assign(new Error(`This channel already has an action called "${name}".`), { status: 409 });

actionsApi.get('/channels/:id/actions', (c) => {
  const channel = channels.get(c.req.param('id'));
  return channel ? c.json(channelActions.list(channel.id)) : c.json({ error: 'not found' }, 404);
});

actionsApi.post('/channels/:id/actions', async (c) => {
  const channel = channels.get(c.req.param('id'));
  if (!channel) return c.json({ error: 'not found' }, 404);
  const input = actionInput.parse(await c.req.json());
  if (channelActions.byName(channel.id, input.name)) throw taken(input.name);
  return c.json(channelActions.create(channel.id, input), 201);
});

actionsApi.patch('/channels/:id/actions/:action', async (c) => {
  const action = channelActions.get(c.req.param('action'));
  if (!action || action.channel_id !== c.req.param('id')) return c.json({ error: 'not found' }, 404);
  const input = actionInput.parse(await c.req.json());
  const other = channelActions.byName(action.channel_id, input.name);
  if (other && other.id !== action.id) throw taken(input.name);
  return c.json(channelActions.update(action.id, input));
});

actionsApi.delete('/channels/:id/actions/:action', (c) => {
  const action = channelActions.get(c.req.param('action'));
  if (!action || action.channel_id !== c.req.param('id')) return c.json({ error: 'not found' }, 404);
  channelActions.delete(action.id);
  return c.json({ ok: true });
});

actionsApi.get('/threads/:id/actions', (c) => {
  const t = threads.get(c.req.param('id'));
  return t ? c.json(threadActions(t)) : c.json({ error: 'not found' }, 404);
});

actionsApi.post('/threads/:id/actions/:action/run', async (c) => {
  const t = threads.get(c.req.param('id'));
  const action = channelActions.get(c.req.param('action'));
  if (!t || !action || action.channel_id !== t.channel_id) return c.json({ error: 'not found' }, 404);
  const blocked = blockedReason(t);
  if (blocked) return c.json({ error: blocked }, 409);
  return c.json((await startRun(t, action)).run, 201);
});

actionsApi.post('/threads/:id/action-runs/:run/stop', async (c) => {
  const run = actionRuns.get(c.req.param('run'));
  if (!run || run.thread_id !== c.req.param('id')) return c.json({ error: 'not found' }, 404);
  return c.json(await stopRun(run.id));
});

actionsApi.post('/threads/:id/action-runs/:run/retry', async (c) => {
  const t = threads.get(c.req.param('id'));
  if (!t) return c.json({ error: 'not found' }, 404);
  const blocked = blockedReason(t);
  if (blocked) return c.json({ error: blocked }, 409);
  return c.json((await retryRun(t, c.req.param('run'))).run, 201);
});
