// Ben's changes to messages that are accepted but not sent: edit, remove, reorder and steer now. A message is editable while
// the runner holds it (waiting for a slot, or held for after this turn) or a restart parked it. Every change is
// checked against where the message is at that moment, synchronously, so one the runner has started to send can
// no longer change: that edit is refused with a 409 and the client keeps Ben's text.
import { EDITABLE, messageRequests, PARKED, threads, type MessageRequest, type Thread } from '../db.ts';
import type { Attachment } from '../uploads.ts';
import { messageFor } from './api.ts';
import { emitThread, harnessSteers, lives, refusal, send, waiting, waitingMsgs, type Msg } from './state.ts';


/** Said when a message left the queue before Ben's change reached the server. */
export const ALREADY_SENT = 'This message has already been sent, so it can no longer be changed.';

/** Said when Ben steers a message that waits for a turn to start, not for this one to end. */
export const NOTHING_TO_STEER = 'No turn is running, so this message goes out as soon as the thread starts.';

/** Said when Ben steers on a harness that cannot take a message mid-turn. */
export const CANNOT_STEER = 'This harness cannot take a message mid-turn, so it runs after this turn.';

/** Said when Ben tries to edit a crew report or a team's go. */
export const OWN = 'Omni wrote this message, so it can be resumed or discarded but not edited.';

/** One of the runner's lists of unsent messages, read as it is and written back whole, so the controller stays its owner. */
interface Queue {
  kind: 'held' | 'waiting';
  items: readonly Msg[];
  replace(items: Msg[]): void;
}

/** The runner's lists that still hold unsent messages: held for after this turn, then waiting for a slot. */
function queues(threadId: string): Queue[] {
  const live = lives.get(threadId);
  const out: Queue[] = [];
  if (live) out.push({ kind: 'held', items: live.held, replace: (items) => live.replaceHeld(items) });
  const w = waitingMsgs.get(threadId);
  if (w) out.push({ kind: 'waiting', items: w, replace: (items) => waitingMsgs.set(threadId, items) });
  return out;
}

/** Where an unsent request is in the runner, if it is there. */
function locate(threadId: string, id: string): { queue: Queue; i: number } | null {
  for (const queue of queues(threadId)) {
    const i = queue.items.findIndex((m) => m.uuid === id);
    if (i >= 0) return { queue, i };
  }
  return null;
}

/** A request of this thread Ben can still change, or a refusal saying why not. */
function editable(threadId: string, id: string): { row: MessageRequest; at: { queue: Queue; i: number } | null } {
  const row = messageRequests.get(id);
  if (!row || row.thread_id !== threadId) throw refusal('No such message in this thread.', 404);
  if (PARKED.includes(row.state)) return { row, at: null };
  if (row.state === 'cancelled' || row.state === 'discarded') throw refusal('This message was removed, so it can no longer be changed.', 409);
  const at = EDITABLE.includes(row.state) ? locate(threadId, id) : null;
  // `accepted` is on its way to the runner, `sent` and later are past changing.
  if (!at) throw refusal(ALREADY_SENT, 409);
  return { row, at };
}

function thread(threadId: string): Thread {
  const t = threads.get(threadId);
  if (!t) throw refusal('thread not found', 404);
  return t;
}

/**
 * Save Ben's edit to an unsent request: new text, the files it keeps (by name) and files added. The same row and
 * queue position; a message the runner holds is rebuilt in place, so it goes out as edited. Refused with a 409 once
 * the runner has started to send it.
 */
export function editRequest(threadId: string, id: string, edit: { prompt: string; keep?: string[]; added?: Attachment[] }): MessageRequest {
  const t = thread(threadId);
  const { row, at } = editable(threadId, id);
  if (row.payload) throw refusal(OWN, 409);
  if (!edit.prompt && !row.context?.length) throw refusal('Write a message to send.', 400);
  const kept = (row.attachments ?? []).filter((a) => !edit.keep || edit.keep.includes(a.name));
  const attachments = [...kept, ...(edit.added ?? [])];
  if (!messageRequests.edit(id, { prompt: edit.prompt, attachments })) throw refusal(ALREADY_SENT, 409);
  if (at) {
    const was = at.queue.items[at.i];
    const next = messageFor(t, edit.prompt, {
      uuid: was.uuid, requestId: was.requestId, from: row.source as 'ben' | 'conductor', mode: was.mode, attachments, context: row.context ?? undefined,
    });
    const items = [...at.queue.items];
    items[at.i] = { ...next, ...(was.midTurn && { midTurn: true }) };
    at.queue.replace(items);
  }
  emitThread(threadId);
  return messageRequests.get(id)!;
}

/**
 * Take unsent requests out of the queue. Nothing reaches the transcript: the row, marked `cancelled`, is the record.
 * All or none: one already sent refuses the lot.
 */
export function cancelRequests(threadId: string, ids: string[]): Thread {
  thread(threadId);
  const found = [...new Set(ids)].map((id) => ({ id, ...editable(threadId, id) }));
  const gone = new Set(found.map((f) => f.id));
  for (const queue of queues(threadId)) queue.replace(queue.items.filter((m) => !gone.has(m.uuid)));
  for (const f of found) messageRequests.mark(f.id, 'cancelled');
  // Nothing left waiting for a slot: the thread is no longer queued.
  if (waitingMsgs.has(threadId) && !waitingMsgs.get(threadId)!.length) {
    waitingMsgs.delete(threadId);
    const w = waiting.indexOf(threadId);
    if (w >= 0) waiting.splice(w, 1);
    const t = threads.get(threadId)!;
    if (!lives.get(threadId)?.turn && t.status === 'queued') threads.update(threadId, { status: t.has_run ? 'done' : 'stopped' });
  }
  emitThread(threadId);
  return threads.get(threadId)!;
}

/**
 * Put a thread's unsent requests in a new order. `ids` names every one of them, as the client last saw the queue;
 * a queue that changed since (one sent, one added) is refused with a 409, so a stale order never applies. Held,
 * waiting and parked messages each keep their own group; within each the new order applies, and the saved queue
 * positions follow it, so a restart, and Resume after it, keep the order. Reordering never resumes anything. Crew
 * reports and a team's go are not Ben's to move: they are left out of `ids` and keep their places.
 */
export function reorderRequests(threadId: string, ids: string[]): Thread {
  thread(threadId);
  // Ben's own messages only: a crew report or a team's go keeps its place.
  const mine = (m: Msg) => !!m.requestId && !m.byOmni;
  const queued = queues(threadId).flatMap((q) => q.items.filter(mine).map((m) => m.uuid));
  const current = [...queued, ...messageRequests.parked(threadId).filter((r) => !r.payload).map((r) => r.id)];
  const same = ids.length === current.length && new Set(ids).size === ids.length && current.every((id) => ids.includes(id));
  if (!same) throw refusal('The queue changed while you were reordering it. Try again.', 409);
  const rank = new Map(ids.map((id, i) => [id, i]));
  // The saved order first: it refuses the lot if a row moved on in the meantime.
  const positions = current.map((id) => messageRequests.get(id)!.pos).sort((a, b) => a - b);
  messageRequests.reposition(ids.map((id, i) => ({ id, pos: positions[i] })));
  for (const queue of queues(threadId)) {
    const items = [...queue.items];
    const slots = items.flatMap((m, i) => (mine(m) ? [i] : []));
    const sorted = slots.map((i) => items[i]).sort((a, b) => rank.get(a.uuid)! - rank.get(b.uuid)!);
    slots.forEach((i, k) => (items[i] = sorted[k]));
    queue.replace(items);
  }
  emitThread(threadId);
  return threads.get(threadId)!;
}

/**
 * Send held requests now, as steers, instead of after this turn: the agent reads them at its next step. In the order
 * they were held, whatever order `ids` names them in. All or none: a message that is not held for this turn (sent,
 * waiting for a slot, parked) refuses the lot, and so does a harness that cannot steer.
 */
export function steerRequests(threadId: string, ids: string[]): Thread {
  thread(threadId);
  const live = lives.get(threadId);
  const found = [...new Set(ids)].map((id) => editable(threadId, id));
  if (!live?.turn || live.closing || found.some((f) => f.at?.queue.kind !== 'held')) throw refusal(NOTHING_TO_STEER, 409);
  if (!harnessSteers(threadId)) throw refusal(CANNOT_STEER, 409);
  const go = new Set(found.map((f) => f.row.id));
  for (const m of live.takeHeldWhere((m) => go.has(m.uuid))) {
    messageRequests.steer(m.uuid);
    m.mode = 'steer';
    m.midTurn = true;
    send(live, m);
  }
  emitThread(threadId);
  return threads.get(threadId)!;
}
