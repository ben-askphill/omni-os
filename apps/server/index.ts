import { serve } from '@hono/node-server';
import { config, paths } from './config.ts';
import { releaseLock, takeLock } from './lock.ts';
import { about } from './about.ts';
import { isLoopback } from './loopback.ts';

// Boot order: the data dir's lock, then the database, then the port, and only then the threads.
// So a second server on the same data, or on the same port, exits having changed nothing.

const holder = takeLock(paths.lock);
if (holder) {
  console.error(`[omni] another Omni server (pid ${holder}) is running on ${paths.data}. Stop it first.`);
  process.exit(1);
}
process.on('exit', () => releaseLock(paths.lock));

// Made before the port opens, so the Mac app and scripts find it as soon as the server answers.
const { apiToken, tokenPath } = await import('./api-token.ts');
apiToken();

// Loaded once the lock is held: db.ts opens the database as it loads.
const { app } = await import('./app.ts');
const { auth, messageRequests, outbox, threads, turnSnapshots } = await import('./db.ts');
const { shutdownAll, startLimits } = await import('./runner.ts');
const { closeAllBrowsers } = await import('./browser.ts');
const { closeAllTerminals } = await import('./terminal.ts');
const { stopAllRuns } = await import('./actions.ts');
const { startArtifactWatcher } = await import('./artifacts.ts');
const { backfillPublished } = await import('./published.ts');
const { startScheduler } = await import('./automations.ts');
const { startEventWatch } = await import('./automation-watch.ts');
const { startTriggerDeliveries } = await import('./automation-triggers.ts');
const { startPRWatch } = await import('./pr-watch/worker.ts');
const { startCatalogRefresh } = await import('./harness/catalog-service.ts');
const { startSync } = await import('./sync/worker.ts');
const { recoverHandoffs } = await import('./handoff.ts');
const { startWorktreeRetention } = await import('./worktree-cleanup.ts');
const { migrateLegacyConfig } = await import('./config-migrate.ts');

// An install from before data/omni.config.json keeps its old settings and skips onboarding.
migrateLegacyConfig();

const onBindError = (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') console.error(`[omni] port ${config.port} on ${config.host} is in use. Stopped before touching any thread.`);
  else console.error('[omni] could not listen:', err);
  process.exit(1);
};

// The listening callback runs before any request is handled, so no thread is created before this marks
// the ones a previous server left running as failed.
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  server.off('error', onBindError);
  about.port = info.port;
  // A worktree the last server was still preparing never got checked, so nothing runs in it until Ben retries.
  const unprepared = threads.failPreparing("Omni stopped before this thread's worktree was ready.");
  if (unprepared) console.log(`[omni] ${unprepared} thread(s) were mid-setup: kept for Retry`);
  const interrupted = threads.failInterrupted();
  if (interrupted) console.log(`[omni] marked ${interrupted} interrupted thread(s) as failed`);
  // A handoff to another Mac the last server was still preparing never went out: its thread stays here.
  const handoffs = recoverHandoffs();
  if (handoffs) console.log(`[omni] ${handoffs} handoff(s) were mid-way: marked failed`);
  // Messages a killed server still held wait for Resume; one it had written to a harness is marked uncertain.
  const parked = messageRequests.recover(outbox.machineId());
  if (parked) console.log(`[omni] kept ${parked} undelivered message(s) for Resume`);
  // A turn whose checkout a killed server was still saving: its This turn diff says so instead of waiting forever.
  const unsaved = turnSnapshots.failUnsettled("Omni stopped before this turn's snapshots were saved.");
  if (unsaved) console.log(`[omni] ${unsaved} turn snapshot(s) were not saved`);
  // Signed-in devices revoked or expired a month ago leave the database, now and daily: a server can run for weeks.
  auth.prune();
  setInterval(() => auth.prune(), 86_400_000).unref();
  // Continuations Ben scheduled for a usage limit's reset: one that came due while Omni was down runs now, once.
  startLimits();
  startArtifactWatcher();
  backfillPublished();
  startScheduler();
  startEventWatch();
  startTriggerDeliveries();
  startPRWatch();
  startCatalogRefresh();
  // With this Mac's retention policy on (Settings > Storage), removes idle worktrees that hold nothing unsaved, now and daily.
  startWorktreeRetention();
  // Off unless the sync credentials are in the Keychain; then it runs alongside, and a failure only logs.
  startSync().catch((err) => console.error('[sync] could not start:', (err as Error).message));
  if (!isLoopback(config.host)) {
    console.warn(`[omni] ${config.host} is not loopback. Anyone who can open the port can try the token; it, and the bodies, cross the network in plain HTTP.`);
  }
  console.log(`[omni] listening on http://${config.host}:${info.port}  workspace=${config.brainDir}  token=${process.env.OMNI_TOKEN ? 'OMNI_TOKEN' : tokenPath()}`);
});
server.once('error', onBindError);

// Close warm claude processes so none outlive the server. A second signal exits at once.
let exiting = false;
const shutdown = (sig: string) => {
  if (exiting) process.exit(1);
  exiting = true;
  console.log(`[omni] ${sig}, closing live sessions`);
  server.close();
  closeAllTerminals();
  stopAllRuns();
  setTimeout(() => process.exit(0), 6000).unref();
  void shutdownAll().finally(() => {
    closeAllBrowsers();
    process.exit(0);
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
