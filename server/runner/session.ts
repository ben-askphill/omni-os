// Interrupt, kill, idle, close, and shutdown.
import { randomUUID } from 'node:crypto';
import { resolveDelivery } from '../delivery.ts';
import { config } from '../config.ts';
import { events, threads, type ThreadStatus } from '../db.ts';
import { detachThread } from '../browser.ts';
import { turnFinished } from '../sync/files.ts';
import { suggestReply } from './aux.ts';
import {
  alive,
  browserHolder,
  clearMods,
  deliveryPhase,
  drop,
  emitThread,
  endTasks,
  harnessSteers,
  isShuttingDown,
  lives,
  pump,
  reportToParent,
  setShuttingDown,
  waiting,
  waitingMsgs,
  writeLine,
  hasBackground,
  type Live,
} from './state.ts';

export function requestInterrupt(live: Live) {
  if (live.interrupt || !live.child) return;
  const id = `omni_int_${randomUUID().slice(0, 8)}`;
  live.interrupt = { id, acked: false };
  if (!writeLine(live, { type: 'control_request', request_id: id, request: { subtype: 'interrupt' } })) return hardKill(live);
  // The CLI normally winds the turn down within a second. If not, fall back to killing it.
  live.interruptTimer = setTimeout(() => live.turn && live.interrupt?.id === id && hardKill(live), config.interruptGraceMs);
}

export function clearInterrupt(live: Live) {
  clearTimeout(live.interruptTimer);
  live.interrupt = null;
}

/**
 * The old stop path. The CLI can take seconds to shut down after SIGINT, so from here on new messages wait
 * for a fresh process, and so do the ones held for after this turn. Undelivered steers are dropped on exit.
 */
export function hardKill(live: Live) {
  const child = live.child;
  if (!child || live.closing) return;
  live.closing = true;
  clearTimeout(live.idleTimer);
  const id = live.threadId;
  if (live.held.length) {
    waitingMsgs.set(id, [...live.held.splice(0), ...(waitingMsgs.get(id) ?? [])]);
    if (!waiting.includes(id)) waiting.push(id);
  }
  if (alive(child)) {
    live.hardStop = true;
    child.kill('SIGINT');
    setTimeout(() => alive(child) && child.kill('SIGKILL'), 5000);
  }
  emitThread(id);
}

/** Nothing to wind down yet (MCP servers can take 13s to connect): drop what is held and kill it. */
export function stopStartup(live: Live) {
  drop(live.threadId, live.held);
  live.held = [];
  if (live.child) hardKill(live);
  else abortStart(live, 'stopped');
}

/** End stdin; the CLI exits on its own. */
export function closeLive(live: Live) {
  if (live.closing || !live.child) return;
  live.closing = true;
  clearTimeout(live.idleTimer);
  live.child.stdin?.end();
  const child = live.child;
  setTimeout(() => alive(child) && child.kill('SIGTERM'), 10_000).unref();
  emitThread(live.threadId);
}

export function armIdle(live: Live) {
  if (isShuttingDown()) return;
  clearTimeout(live.idleTimer);
  // Closing stdin now would end the background agents with the process. Wait for them, within a bound.
  if (hasBackground(live)) {
    live.idleTimer = setTimeout(() => closeLive(live), config.taskKeepAliveSeconds * 1000);
    return;
  }
  if (config.keepAliveSeconds <= 0) return closeLive(live);
  live.idleTimer = setTimeout(() => closeLive(live), config.keepAliveSeconds * 1000);
}

/** Forget the process: timers, browser profile, live state. */
export function teardown(live: Live) {
  clearTimeout(live.idleTimer);
  endTasks(live);
  clearMods(live);
  clearInterrupt(live);
  if (live.browser && browserHolder.get(live.channelId) === live.threadId) {
    browserHolder.delete(live.channelId);
    detachThread(live.channelId, live.threadId);
  }
  if (lives.get(live.threadId) === live) lives.delete(live.threadId);
  live.turn = false;
  live.inflight = [];
  live.held = [];
  live.done();
}

/** Interrupted or shut down before the process was spawned. */
export function abortStart(live: Live, status: ThreadStatus) {
  drop(live.threadId, [...live.inflight, ...live.held]);
  teardown(live);
  threads.update(live.threadId, { status });
  emitThread(live.threadId);
  pump();
}

export function endTurn(live: Live, status: ThreadStatus) {
  const id = live.threadId;
  live.turn = false;
  clearInterrupt(live);
  const runText = events.lastRunText(id, live.turnFrom);
  live.turnFrom = 0;
  const t = threads.update(id, {
    status,
    has_run: 1,
    last_text: runText ? runText.slice(0, 600) : threads.get(id)?.last_text ?? null,
  });
  emitThread(id);
  if (t?.parent_id && !isShuttingDown()) reportToParent(id, status, runText);
  if (status === 'done' && !t?.parent_id && runText && !isShuttingDown()) suggestReply(id, runText);
  void turnFinished(id);
  armIdle(live);
  pump();
}

/**
 * Waiting for a slot: drop its messages. Mid-turn: drop held messages and ask the CLI to stop the turn;
 * the process stays warm and steers already sent still run next. Hard kill if it does not stop in time,
 * or right away if the process has not started its first turn yet.
 */
export function interruptThread(threadId: string) {
  const live = lives.get(threadId);
  const w = waiting.indexOf(threadId);
  // A lead still waiting on its team has no process: stopping it stops the members it waits for.
  const lead = threads.get(threadId);
  if (lead && !lead.has_run && !live && w < 0 && lead.status === 'running') {
    threads.update(threadId, { status: 'stopped' });
    for (const m of threads.team(threadId)) if (m.status === 'running' || m.status === 'queued') interruptThread(m.id);
    emitThread(threadId);
    return;
  }
  if (w >= 0) {
    waiting.splice(w, 1);
    drop(threadId, waitingMsgs.get(threadId) ?? []);
    waitingMsgs.delete(threadId);
    if (!live?.turn) threads.update(threadId, { status: 'stopped' });
  }
  // A process already being stopped needs nothing more; what waited for its successor was dropped above.
  if (live?.turn && !live.closing) {
    const action = resolveDelivery('interrupt', { steer: harnessSteers(threadId) }, deliveryPhase(live));
    switch (action) {
      case 'stop-startup':
        // Still starting up (MCP servers can take 13s): no turn to wind down, and a queued message would run anyway.
        stopStartup(live);
        break;
      case 'kill':
        // No graceful interrupt: end the process. The next message resumes the session.
        drop(threadId, live.held);
        live.held = [];
        hardKill(live);
        break;
      case 'interrupt':
        drop(threadId, live.held);
        live.held = [];
        requestInterrupt(live);
        break;
      default: {
        const unreachable: never = action;
        throw new Error(unreachable);
      }
    }
  } else if (w < 0 && !live) {
    // Nothing runs it, so a busy status is stale.
    const t = threads.get(threadId);
    if (t && (t.status === 'running' || t.status === 'queued')) threads.update(threadId, { status: 'stopped' });
  }
  emitThread(threadId);
  return threads.get(threadId);
}

export const stopThread = interruptThread;

/** Close every live process (end stdin, SIGTERM after 3s) and resolve once all have exited. */
export async function shutdownAll() {
  setShuttingDown(true);
  try {
    for (const id of waiting.splice(0)) {
      drop(id, waitingMsgs.get(id) ?? []);
      waitingMsgs.delete(id);
      if (!lives.get(id)?.turn) threads.update(id, { status: 'stopped' });
      emitThread(id);
    }
    const all = [...lives.values()];
    for (const live of all) {
      clearTimeout(live.idleTimer);
      clearInterrupt(live);
      const child = live.child;
      if (!child) {
        abortStart(live, 'stopped');
        continue;
      }
      live.shutdown = true;
      drop(live.threadId, live.held);
      live.held = [];
      live.closing = true;
      child.stdin?.end();
      const term = setTimeout(() => alive(child) && child.kill('SIGTERM'), 3000);
      const kill = setTimeout(() => alive(child) && child.kill('SIGKILL'), 5000);
      void live.exited.then(() => (clearTimeout(term), clearTimeout(kill)));
    }
    await Promise.all(all.map((l) => l.exited));
  } finally {
    setShuttingDown(false);
  }
}
