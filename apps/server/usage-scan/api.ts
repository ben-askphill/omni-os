// POST /api/usage-scan { channel? }: start a usage scan (scan.ts). Answers once its lead thread exists, with the thread
// and what went into it. 409 when another scan is starting, the channel opted out, or nothing repeats enough.
import { Hono } from 'hono';
import { z } from 'zod';
import { automationRefusal, callerOf } from '../automation-guard.ts';
import { startUsageScan } from './scan.ts';

export const usageScanApi = new Hono();

usageScanApi.post('/', async (c) => {
  const parsed = z
    .object({ channel: z.string().trim().max(100).nullish() })
    .strict()
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid scan' }, 400);
  const no = automationRefusal(callerOf(c), 'scan');
  if (no) return c.json({ error: no }, 403);
  try {
    return c.json(await startUsageScan({ channel: parsed.data.channel }), 201);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404 || status === 409) return c.json({ error: (err as Error).message }, status);
    throw err;
  }
});
