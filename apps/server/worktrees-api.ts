import { Hono } from 'hono';
import { z } from 'zod';
import { summarize } from '@omni/shared/worktree-inventory.ts';
import { RETENTION_DAYS } from '@omni/shared/worktree-cleanup.ts';
import { cancelWorktreeScan, currentWorktreeScan, startWorktreeScan } from './worktree-inventory.ts';
import { SLIM_DAYS } from '@omni/shared/worktree-slim.ts';
import { cleanupRunning, cleanupState, setRetentionPolicy, startCleanup } from './worktree-cleanup.ts';
import { setSlimPolicy, slimRunning, slimState, startSlim } from './worktree-slim.ts';

// Settings > Worktrees in the Web UI: the worktree inventory, the cleanup that removes what it lists as eligible, and
// stripping caches from idle worktrees, which keeps them.
// The scan and a cleanup run in the background; clients poll GET /scan while either runs.

export const worktreesApi = new Hono();

/** All the page shows: the scan and its totals (`scan: null` before the first), the cleanup previews, policy and runs, and the same for stripping caches. */
const view = () => {
  const scan = currentWorktreeScan();
  return { scan, summary: scan ? summarize(scan.items) : null, cleanup: cleanupState(), slim: slimState() };
};

worktreesApi.get('/scan', (c) => c.json(view()));

/** Starts a scan, or returns the one already running. Not while a cleanup removes folders: it would list them half gone. */
worktreesApi.post('/scan', (c) => {
  if (cleanupRunning()) return c.json({ error: 'A cleanup is running. Scan again once it is done.' }, 409);
  if (slimRunning()) return c.json({ error: 'Caches are being stripped. Scan again once it is done.' }, 409);
  startWorktreeScan();
  return c.json(view(), 202);
});

/** Stops the running scan. `cancelled` is false when none was running. */
worktreesApi.post('/scan/cancel', (c) => {
  const cancelled = cancelWorktreeScan();
  return c.json({ cancelled, ...view() });
});

const cleanupInput = z.object({ ids: z.array(z.string().min(1)).min(1) });

/** Removes the reviewed worktrees, each checked again first. 409 while a scan or another cleanup runs, or when one is no longer listed. */
worktreesApi.post('/cleanup', async (c) => {
  const { ids } = cleanupInput.parse(await c.req.json());
  startCleanup(ids);
  return c.json(view(), 202);
});

const retentionInput = z.object({
  enabled: z.boolean().optional(),
  idleDays: z.number().int().min(RETENTION_DAYS.min).max(RETENTION_DAYS.max).optional(),
});

/** This Mac's retention policy. Saved on this Mac only. */
worktreesApi.put('/retention', async (c) => {
  setRetentionPolicy(retentionInput.parse(await c.req.json()));
  return c.json(view());
});

const slimInput = z.object({ ids: z.array(z.string().min(1)).min(1) });

/** Strips caches from the reviewed worktrees, each checked again first. 409 while a scan or another strip runs, or when one is no longer listed. */
worktreesApi.post('/slim', async (c) => {
  const { ids } = slimInput.parse(await c.req.json());
  startSlim(ids);
  return c.json(view(), 202);
});

const slimPolicyInput = z.object({
  enabled: z.boolean().optional(),
  idleDays: z.number().int().min(SLIM_DAYS.min).max(SLIM_DAYS.max).optional(),
});

/** This Mac's schedule for stripping caches, and the idle days a manual strip lists by. Saved on this Mac only. */
worktreesApi.put('/slim', async (c) => {
  setSlimPolicy(slimPolicyInput.parse(await c.req.json()));
  return c.json(view());
});
