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

// Loaded once the lock is held: db.ts opens the database as it loads.
const { app } = await import('./app.ts');
const { messageRequests, outbox, threads, turnSnapshots } = await import('./db.ts');
const { shutdownAll, startLimits } = await import('./runner.ts');
const { closeAllBrowsers } = await import('./browser.ts');
const { closeAllTerminals } = await import('./terminal.ts');
const { startArtifactWatcher } = await import('./artifacts.ts');
const { backfillPublished } = await import('./published.ts');
const { startScheduler } = await import('./automations.ts');
const { startCatalogRefresh } = await import('./harness/catalog-service.ts');
const { startSync } = await import('./sync/worker.ts');

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
  // Messages a killed server still held wait for Resume; one it had written to a harness is marked uncertain.
  const parked = messageRequests.recover(outbox.machineId());
  if (parked) console.log(`[omni] kept ${parked} undelivered message(s) for Resume`);
  // A turn whose checkout a killed server was still saving: its This turn diff says so instead of waiting forever.
  const unsaved = turnSnapshots.failUnsettled("Omni stopped before this turn's snapshots were saved.");
  if (unsaved) console.log(`[omni] ${unsaved} turn snapshot(s) were not saved`);
  // Continuations Ben scheduled for a usage limit's reset: one that came due while Omni was down runs now, once.
  startLimits();
  startArtifactWatcher();
  backfillPublished();
  startScheduler();
  startCatalogRefresh();
  // Off unless the sync credentials are in the Keychain; then it runs alongside, and a failure only logs.
  startSync().catch((err) => console.error('[sync] could not start:', (err as Error).message));
  if (!isLoopback(config.host)) {
    console.warn(`[omni] ${config.host} is not loopback. Anyone who can open the port can read threads, write Keychain entries via POST /api/secrets, merge PRs, and type into a thread shell.`);
  }
  console.log(`[omni] listening on http://${config.host}:${info.port}  brain=${config.brainDir}`);
});
server.once('error', onBindError);

// The inbound port serves /api/inbound only, on loopback, so a tunnel to it reaches nothing else of Omni.
if (config.inboundPort) {
  const { inboundApp } = await import('./inbound-api.ts');
  const inbound = serve({ fetch: inboundApp.fetch, port: config.inboundPort, hostname: '127.0.0.1' }, (info) =>
    console.log(`[omni] inbound only on http://127.0.0.1:${info.port}/api/inbound/:name`),
  );
  inbound.once('error', (err) => console.error(`[omni] inbound port ${config.inboundPort}:`, (err as Error).message));
}

// Close warm claude processes so none outlive the server. A second signal exits at once.
let exiting = false;
const shutdown = (sig: string) => {
  if (exiting) process.exit(1);
  exiting = true;
  console.log(`[omni] ${sig}, closing live sessions`);
  server.close();
  closeAllTerminals();
  setTimeout(() => process.exit(0), 6000).unref();
  void shutdownAll().finally(() => {
    closeAllBrowsers();
    process.exit(0);
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
