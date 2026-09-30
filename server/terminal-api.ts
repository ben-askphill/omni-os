// /api/threads/:id/terminal: the thread's shell, for the Terminal tab. Its own app so tests can call it without starting the server.
//
// GET    /:id/terminal          whether a shell is open, and where
// POST   /:id/terminal          open one (or a fresh one after it exited), { cols, rows }
// GET    /:id/terminal/stream   SSE: a snapshot of recent output, then output and exit. Opens a shell if none was ever opened
// POST   /:id/terminal/input    { data }: keystrokes
// POST   /:id/terminal/resize   { cols, rows }
// DELETE /:id/terminal          hang up
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { threads } from './db.ts';
import { closeTerminal, getTerminal, openTerminal, resizeTerminal, snapshot, writeTerminal, type Terminal, type TerminalMessage } from './terminal.ts';

export const terminalApi = new Hono();

// The same answers as the main app's handler, for tests that call this app on its own.
terminalApi.onError((err, c) => {
  const status = err instanceof z.ZodError ? 400 : ((err as { status?: number }).status ?? 500);
  return c.json({ error: err.message }, status as 400);
});

const sizeSchema = z.object({ cols: z.coerce.number().int().min(2).max(500), rows: z.coerce.number().int().min(2).max(200) });
const inputSchema = z.object({ data: z.string().max(64 * 1024) });

const info = (t: Terminal | undefined) =>
  t ? { open: true, running: t.running, code: t.code, cwd: t.cwd, pid: t.pid, cols: t.cols, rows: t.rows } : { open: false, running: false, code: null };

const threadOr404 = (c: Context) => threads.get(c.req.param('id')!);

terminalApi.get('/:id/terminal', (c) => {
  if (!threadOr404(c)) return c.json({ error: 'not found' }, 404);
  return c.json(info(getTerminal(c.req.param('id'))));
});

terminalApi.post('/:id/terminal', async (c) => {
  const t = threadOr404(c);
  if (!t) return c.json({ error: 'not found' }, 404);
  const size = sizeSchema.partial().parse(await c.req.json().catch(() => ({})));
  return c.json(info(openTerminal(t.id, t.cwd, size)));
});

terminalApi.delete('/:id/terminal', (c) => {
  if (!threadOr404(c)) return c.json({ error: 'not found' }, 404);
  closeTerminal(c.req.param('id'));
  return c.json(info(undefined));
});

terminalApi.post('/:id/terminal/input', async (c) => {
  if (!threadOr404(c)) return c.json({ error: 'not found' }, 404);
  const { data } = inputSchema.parse(await c.req.json());
  if (!writeTerminal(c.req.param('id'), data)) return c.json({ error: 'no shell running' }, 409);
  return c.json({ ok: true });
});

terminalApi.post('/:id/terminal/resize', async (c) => {
  if (!threadOr404(c)) return c.json({ error: 'not found' }, 404);
  const { cols, rows } = sizeSchema.parse(await c.req.json());
  if (!resizeTerminal(c.req.param('id'), cols, rows)) return c.json({ error: 'no shell running' }, 409);
  return c.json({ ok: true });
});

terminalApi.get('/:id/terminal/stream', (c) => {
  const thread = threadOr404(c);
  if (!thread) return c.json({ error: 'not found' }, 404);
  // An exited shell stays exited until Ben restarts it, so a reconnect never starts one behind his back.
  const size = sizeSchema.safeParse(c.req.query());
  let term = getTerminal(thread.id);
  if (!term) term = openTerminal(thread.id, thread.cwd, size.success ? size.data : {});
  // Reflow to this client's size before the snapshot, so it fits.
  else if (size.success) resizeTerminal(thread.id, size.data.cols, size.data.rows);
  const t = term;
  return streamSSE(c, async (stream) => {
    // Subscribe before the snapshot is taken, in the same tick, so no output falls between them.
    const queue: TerminalMessage[] = [{ kind: 'snapshot', data: snapshot(t), running: t.running, code: t.code }];
    let wake: (() => void) | null = null;
    const onMessage = (m: TerminalMessage) => {
      // Coalesce a burst of output into one SSE message.
      const last = queue.at(-1);
      if (m.kind === 'data' && last?.kind === 'data') last.data += m.data;
      else queue.push(m);
      wake?.();
    };
    t.events.on('message', onMessage);
    stream.onAbort(() => {
      t.events.off('message', onMessage);
      wake?.();
    });
    while (!stream.aborted) {
      if (!queue.length) {
        await Promise.race([new Promise<void>((r) => (wake = r)), stream.sleep(20_000)]);
        wake = null;
        if (!queue.length) await stream.writeSSE({ event: 'ping', data: '' });
        continue;
      }
      await stream.writeSSE({ data: JSON.stringify(queue.shift()) });
    }
  });
});
