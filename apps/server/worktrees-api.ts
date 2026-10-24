import { Hono } from 'hono';
import { summarize } from '@omni/shared/worktree-inventory.ts';
import { cancelWorktreeScan, currentWorktreeScan, startWorktreeScan } from './worktree-inventory.ts';

// The worktree storage inventory (Settings > Storage in both clients). Read-only: it lists, never deletes.
// The scan runs in the background; clients poll GET while it runs.

export const worktreesApi = new Hono();

/** The scan as a client shows it: the scan itself and its totals, or `scan: null` before the first. */
const view = () => {
  const scan = currentWorktreeScan();
  return { scan, summary: scan ? summarize(scan.items) : null };
};

worktreesApi.get('/scan', (c) => c.json(view()));

/** Starts a scan, or returns the one already running. */
worktreesApi.post('/scan', (c) => {
  startWorktreeScan();
  return c.json(view(), 202);
});

/** Stops the running scan. `cancelled` is false when none was running. */
worktreesApi.post('/scan/cancel', (c) => {
  const cancelled = cancelWorktreeScan();
  return c.json({ cancelled, ...view() });
});
