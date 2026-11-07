// Tool calls that wait on Ben: ask_user_question (questions.ts) and request_secret (secret-requests.ts), both in
// apps/mcp/ask.ts, poll their request until he acts. The thread's events hold the requests, so they persist, stream
// and sync like any event. Only which requests a call still polls for lives here, in memory: after a restart none
// does, and what Ben did goes to the thread as a message instead.
import { bus } from '../bus.ts';
import type { MessageRequest, Thread } from '../db.ts';
import { remoteHolder } from '../ownership.ts';
import { runningElsewhere, turnBlocked } from '../sync/guard.ts';
import { runnerPorts } from './ports.ts';
import { saveOwn, wake } from './queue.ts';
import { lives, refusal, runsHere } from './state.ts';

/** The longest one poll waits, in seconds. */
export const WAIT_MAX_SEC = 30;
/** A call that polled this recently still waits. Longer than one poll, so a poll in flight always counts. */
const WAITER_FRESH_MS = 35_000;

/** When a tool call last polled each request, by request id. */
const polled = new Map<string, number>();

/** A call polled the request: it waits. */
export const polling = (id: string) => void polled.set(id, Date.now());

/** The request is settled: no call polls for it any more. */
export const unpolled = (id: string) => void polled.delete(id);

/** A tool call still waits on the request: its thread's turn runs here and the call polled lately. */
export const waitedOn = (threadId: string, id: string) => !!lives.get(threadId)?.turn && Date.now() - (polled.get(id) ?? 0) < WAITER_FRESH_MS;

/**
 * Resolves as soon as an event of `kind` about the request lands in the thread (written here or, by sync, on the
 * other Mac), when `signal` aborts, or after `waitSec`, whichever comes first.
 */
export function untilSettled(threadId: string, kind: string, id: string, waitSec: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      bus.off(`thread:${threadId}`, onEvent);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const onEvent = (e: { kind?: string; payload?: unknown }) => {
      if (e?.kind === kind && typeof e.payload === 'string' && (JSON.parse(e.payload) as { id?: string }).id === id) done();
    };
    const timer = setTimeout(done, Math.min(waitSec, WAIT_MAX_SEC) * 1000);
    bus.on(`thread:${threadId}`, onEvent);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** How the agent hears what Ben did: the waiting call returns it, or a message carries it (the call had ended). */
export type Via = 'tool' | 'message';

/**
 * Ben acted on a request. The waiting call returns it (via `tool`); when no call waits any more (a restart, Stop, the
 * harness's own timeout) `text` reaches the thread as a message instead (via `message`), saved under `key` before the
 * thread is woken, once. A thread that runs on another machine (run-on.ts) has its call there: while a turn runs
 * there, the event `record` writes syncs to it and that call returns; between turns, the text goes to it as a
 * forwarded message. `record` writes the outcome event once the route is settled, so a refused message records nothing.
 */
export async function settle(thread: Thread, id: string, key: string, text: string, record: (via: Via) => void): Promise<Via> {
  const holder = remoteHolder(thread);
  const via: Via = waitedOn(thread.id, id) || (holder && runningElsewhere(thread)) ? 'tool' : 'message';
  if (via === 'message' && holder) {
    await runnerPorts().routing.forwardMessage(thread, text, { mode: 'steer', from: 'ben' });
  } else if (via === 'message') {
    const blocked = turnBlocked(thread, runsHere(thread.id));
    if (blocked) throw refusal(blocked, 409);
  }
  record(via);
  unpolled(id);
  if (via === 'message' && !holder) wakeWith(thread.id, key, text, 'steer');
  return via;
}

/** A message of Omni's own, saved under `key` and woken once: a second call with the same key sends nothing. */
export function wakeWith(threadId: string, key: string, prompt: string, mode: 'steer' | 'queue', source: MessageRequest['source'] = 'ben') {
  const row = saveOwn(threadId, key, { prompt, kind: 'user', source, payload: null, mode });
  if (row) wake(row);
}
