// Secrets an agent asks Ben for with request_secret (apps/mcp/ask.ts): asked, waited on, saved, cancelled or dismissed
// (packages/shared/secret-request.ts). The value goes from the card to the secret store and nowhere else: nothing
// here keeps it, logs it or puts it in an event. A saved secret reaches the agent in its next process, since a harness
// reads its env once at spawn (runner/spawn.ts secretsEnv): the live process is marked env-stale (session.ts staleEnv)
// and a queued message starts that turn. Which calls still wait, and how an outcome reaches the agent, is waiters.ts.
import { randomUUID } from 'node:crypto';
import {
  parseSecretAsk,
  SECRET_ANSWER_EVENT,
  SECRET_REQUEST_EVENT,
  secretRequestsIn,
  secretResultText,
  secretSavedMessage,
  secretScopeKey,
  valueProblem,
  type CrewSecretRequest,
  type SecretAnswerPayload,
  type SecretRequestPayload,
  type SecretRequestState,
  type ThreadSecretRequest,
} from '@omni/shared/secret-request.ts';
import { publishFeed } from '../bus.ts';
import { events, threads } from '../db.ts';
import { STRIPPED_VARS } from '../harness/env-guard.ts';
import type { HarnessId } from '../harness/types.ts';
import { ownedElsewhere } from '../ownership.ts';
import { notifyNeedsInput } from '../push-sender.ts';
import { hasSecret, secretReachesThread, setSecret } from '../secrets.ts';
import { machineName } from '../sync/guard.ts';
import { staleEnv } from './session.ts';
import { addEvent, cliLabel, lives, refusal } from './state.ts';
import { polling, settle, unpolled, untilSettled, waitedOn, wakeWith, type Via } from './waiters.ts';

function find(threadId: string, id: string): ThreadSecretRequest {
  if (!threads.get(threadId)) throw refusal('thread not found', 404);
  const r = secretRequestsIn(events.secretRequests(threadId, id))[0];
  if (!r) throw refusal('secret request not found', 404);
  return r;
}

/** What the waiting call returns to the agent. Names only. */
const reply = (r: ThreadSecretRequest) => ({ state: r.state, text: secretResultText(r.ask, r.state) });

const settled = (threadId: string) => publishFeed({ type: 'needs_you', thread_id: threadId });

/**
 * The agent asks: a card in the thread, and a blocker in Needs you until Ben acts, like a question (questions.ts
 * askQuestion). Refused with what to fix: a name the shared parser rejects, one of Omni's own secrets, which no thread
 * gets (secrets.ts secretReachesThread), or one this harness strips from its env (harness/env-guard.ts), since the
 * thread would never see the value either way.
 */
export function askSecret(threadId: string, raw: unknown): { id: string } {
  const thread = threads.get(threadId);
  if (!thread) throw refusal('thread not found', 404);
  const parsed = parseSecretAsk(raw);
  if (!parsed.ok) throw refusal(parsed.error, 400);
  const ask = parsed.value;
  const scope = secretScopeKey(ask.scope, thread.channel_id);
  if (!secretReachesThread(scope, ask.name)) {
    throw refusal(`${ask.name} is one of Omni's own secrets, which no thread gets: pick a name for the service, like STRIPE_TEST_KEY`, 400);
  }
  if ((STRIPPED_VARS[thread.harness as HarnessId] ?? []).includes(ask.name)) {
    const cli = cliLabel(thread.harness);
    throw refusal(`${ask.name} would put ${cli} on API billing, so Omni keeps it out of every ${cli} thread: pick another name`, 400);
  }
  const id = randomUUID();
  addEvent(threadId, SECRET_REQUEST_EVENT, { id, ask, exists: hasSecret(scope, ask.name) } satisfies SecretRequestPayload);
  const home = threads.root(threadId);
  if (home !== threadId) threads.setDone(home, false);
  settled(threadId);
  notifyNeedsInput(threadId);
  return { id };
}

/** The secrets waiting on Ben in the threads delegated from this one, at any depth, in the order they were asked. */
export function crewSecretRequests(threadId: string): CrewSecretRequest[] {
  if (!threads.get(threadId)) throw refusal('thread not found', 404);
  return threads
    .descendants(threadId)
    .filter((t) => !t.archived)
    .flatMap((t) =>
      secretRequestsIn(events.secretRequests(t.id))
        .filter((r) => r.state === 'pending')
        .map((request) => ({ thread_id: t.id, thread_title: t.title, task_id: t.task_id, channel_id: t.channel_id, request })),
    )
    .sort((a, b) => a.request.event_id - b.request.event_id);
}

/** A waiting call's poll, as questions.ts awaitAnswer: the request's state, at once or as soon as Ben acts. */
export async function awaitSecret(threadId: string, id: string, waitSec: number, signal?: AbortSignal) {
  const r = find(threadId, id);
  polling(id);
  if (r.state !== 'pending' || waitSec <= 0) return reply(r);
  await untilSettled(threadId, SECRET_ANSWER_EVENT, id, waitSec, signal);
  return reply(find(threadId, id));
}

export type Submitted = { state: 'saved'; replaced: boolean; via: Via } | { conflict: SecretRequestState } | { exists: true };

/** Requests whose value is being written now, so a second submit from another window cannot write over the first. */
const saving = new Set<string>();

/**
 * Ben entered the value. It goes to the secret store, and only there: not into the event, the message that goes on,
 * a log or an error. A secret of that name already in the scope is kept unless `replace` says to overwrite it. The
 * thread must be this machine's: a value never leaves the machine that saves it, so one owned by the other Mac is
 * refused with its name. Then the waiting call returns `saved`, which tells the agent to end its turn, and a queued
 * message starts the next one in a fresh process whose env has the secret (session.ts staleEnv, records.ts onResult).
 * With no call waiting, the queued message alone carries it.
 */
export async function submitSecret(threadId: string, id: string, value: string, replace: boolean): Promise<Submitted> {
  const r = find(threadId, id);
  if (r.state !== 'pending') return { conflict: r.state };
  if (saving.has(id)) throw refusal('This secret is being saved from another window.', 409);
  const thread = threads.get(threadId)!;
  const owner = ownedElsewhere(thread);
  if (owner) {
    throw refusal(`This thread is on ${machineName(owner.machine)}. Enter the secret there, or take the thread over first: a value never leaves the machine that saves it.`, 409);
  }
  const problem = valueProblem(value);
  if (problem) throw refusal(problem, 400);
  const scope = secretScopeKey(r.ask.scope, thread.channel_id);
  const exists = hasSecret(scope, r.ask.name);
  if (exists && !replace) return { exists: true };
  saving.add(id);
  try {
    await setSecret(scope, r.ask.name, value);
  } catch (err) {
    saving.delete(id);
    // The store's own message, with the value cut from it (secret-store.ts piped). Never the value, never the body.
    console.error(`[secrets] the secret store refused ${r.ask.name}: ${(err as Error).message}`);
    throw refusal('Omni could not write the secret to its store. Check the server log.', 500);
  }
  const via: Via = waitedOn(threadId, id) ? 'tool' : 'message';
  addEvent(threadId, SECRET_ANSWER_EVENT, { id, state: 'saved', replaced: exists, via } satisfies SecretAnswerPayload);
  saving.delete(id);
  unpolled(id);
  const live = lives.get(threadId);
  if (live) staleEnv(live);
  wakeWith(threadId, `secret:${id}`, secretSavedMessage(r.ask), 'queue', 'secret');
  settled(threadId);
  return { state: 'saved', replaced: exists, via };
}

export type Cancelled = { state: 'cancelled'; via: Via } | { conflict: SecretRequestState };

/** Ben said no. Nothing is stored; the agent hears it as the waiting call's result, or as a message when no call waits (waiters.ts settle). */
export async function cancelSecret(threadId: string, id: string): Promise<Cancelled> {
  const r = find(threadId, id);
  if (r.state !== 'pending') return { conflict: r.state };
  const via = await settle(threads.get(threadId)!, id, `secret:${id}`, secretResultText(r.ask, 'cancelled'), (via) =>
    addEvent(threadId, SECRET_ANSWER_EVENT, { id, state: 'cancelled', replaced: false, via } satisfies SecretAnswerPayload),
  );
  settled(threadId);
  return { state: 'cancelled', via };
}

/** Ben wrote in the thread instead of entering it: each pending request is dismissed, so its call returns and the agent reads the message. */
export function dismissSecretRequests(threadId: string) {
  const open = secretRequestsIn(events.secretRequests(threadId)).filter((r) => r.state === 'pending');
  for (const r of open) {
    addEvent(threadId, SECRET_ANSWER_EVENT, { id: r.id, state: 'dismissed', replaced: false, via: 'tool' } satisfies SecretAnswerPayload);
    unpolled(r.id);
  }
  if (open.length) settled(threadId);
}
