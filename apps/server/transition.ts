// The transition service: the one way a thread changes how or where it runs (docs/internals/transitions.md). Three
// kinds, four operations. `reconfigure` is a run switch (runner/switch.ts), `relocate` a handoff or Take over
// (handoff.ts), `fork` a Continue (continue.ts); each of those modules keeps its own planning and its own records,
// and this service is the front door they share: preview, create, read, cancel. The four routes in
// transitions-api.ts call it, and so do the six older routes (continue-api.ts, thread-routes-api.ts), which answer
// in the shapes clients and machines on an older build expect.
//
// Each transition has an id a client reads and cancels it by: a reconfigure's own, a relocate's handoff record (the
// offer for a handoff, the request for a Take over), a fork's new thread. This machine keeps them in `transitions`
// (db/repos/transitions.ts), its local ledger; a transition's state comes from the records that own it, so the ledger
// never disagrees with what the thread shows.
import { randomUUID } from 'node:crypto';
import { handoffPhase, requestPhase, type HandoffPhase } from '@omni/shared/handoff.ts';
import { sameRun, type Run } from '@omni/shared/run-switch.ts';
import type { Party, Transition, TransitionPreview, TransitionPreviewRequest, TransitionRequest, TransitionState } from '@omni/shared/transition.ts';
import { outbox, threads, transitions, type Thread, type TransitionRow } from './db.ts';
import { previewContinue, startContinue } from './continue.ts';
import { cancelHandoff, handOff, handOffCheck, requestTakeover, takeoverCheck, takeoverOf, type HandoffResult } from './handoff.ts';
import { handoffView, offerOf, replyOf, requestOf } from './handoff/records.ts';
import { refusal } from './runner/state.ts';
import { cancelQueued, previewSwitch, queuedRun, runName, switchRun } from './runner/switch.ts';
import { deviceName, deviceRecord } from './sync/devices.ts';

export type ThreadTransition = Transition<Thread>;

const mustExist = (threadId: string): Thread => {
  const t = threads.get(threadId);
  if (!t) throw refusal('thread not found', 404);
  return t;
};

/** A check's refusal as a preview's `blocked` rather than a throw. A missing thread still throws. */
async function blockedBy(check: () => Promise<unknown>): Promise<string | null> {
  try {
    await check();
    return null;
  } catch (err) {
    if ((err as { status?: number }).status === 404) throw err;
    return (err as Error).message;
  }
}

/** What the transition would do now, and what keeps the thread from it. Nothing is written. */
export async function previewTransition(threadId: string, req: TransitionPreviewRequest): Promise<TransitionPreview> {
  mustExist(threadId);
  switch (req.kind) {
    case 'reconfigure':
      return { kind: 'reconfigure', ...(await previewSwitch(threadId, req.run)) };
    case 'relocate':
      return previewRelocate(threadId, req.to);
    case 'fork':
      return { kind: 'fork', ...(await previewContinue(threadId, req.run, req.attachments ?? [])) };
  }
}

async function previewRelocate(threadId: string, to: string): Promise<TransitionPreview> {
  const t = mustExist(threadId);
  const running = t.status === 'running' || t.status === 'queued';
  if (to === 'here') {
    const take = takeoverOf(t);
    const blocked = await blockedBy(() => takeoverCheck(threadId));
    return { kind: 'relocate', from: take?.from ?? null, to: take?.to ?? null, blocked, running: take?.running ?? running, takeover: true };
  }
  const checked = await handOffCheck(threadId, to).then(
    (ready) => ({ ready, blocked: null as string | null }),
    (err: Error & { status?: number }) => {
      if (err.status === 404) throw err;
      return { ready: null, blocked: err.message };
    },
  );
  const self = outbox.machineId();
  const target = deviceRecord(to);
  const from: Party | null = checked.ready?.from ?? (self ? { id: self, name: deviceName(self) ?? 'this Mac' } : null);
  const dest: Party | null = checked.ready?.to ?? (target && { id: target.id, name: target.name });
  return { kind: 'relocate', from, to: dest, blocked: checked.blocked, running, takeover: false };
}

/**
 * Start the transition. A reconfigure applies at once or queues behind the turn; a relocate writes its handoff record
 * and goes on in the background; a fork makes the new thread. Refusals throw with a status: a 409 while the thread is
 * busy or on its way, with Continue's `busy`, `changed` and `request_reused` bodies (ContinueRefused), a 400 for a run
 * the catalog does not offer.
 */
export async function createTransition(threadId: string, req: TransitionRequest): Promise<ThreadTransition> {
  mustExist(threadId);
  switch (req.kind) {
    case 'reconfigure': {
      const thread = await switchRun(threadId, req.run);
      const q = queuedRun(thread);
      const state: TransitionState = q && sameRun(q, req.run) ? 'queued' : 'applied';
      const row = transitions.add({ id: randomUUID(), thread_id: threadId, kind: 'reconfigure', state, request: { run: req.run } });
      return view(row, thread);
    }
    case 'relocate':
      return recordRelocation(threadId, req.to, req.to === 'here' ? await requestTakeover(threadId) : await handOff(threadId, req.to));
    case 'fork': {
      const { thread, duplicate } = await startContinue(threadId, {
        ...req.run,
        attachments: req.attachments,
        text: req.text,
        request_id: req.request_id,
        revision: req.revision,
      });
      const row = transitions.add({
        id: thread.id,
        thread_id: threadId,
        kind: 'fork',
        state: 'started',
        request: { run: req.run, request_id: req.request_id },
        result: { thread_id: thread.id },
      });
      return { ...view(row, mustExist(threadId)), fork: { thread, duplicate } };
    }
  }
}

/** The handoff record the move wrote names the transition: the request for a Take over, the offer for a handoff. */
function recordRelocation(threadId: string, to: string, r: HandoffResult): ThreadTransition {
  const h = r.handoff;
  const row = transitions.add({
    id: h?.id ?? randomUUID(),
    thread_id: threadId,
    kind: 'relocate',
    state: h?.state.phase ?? (to === 'here' ? 'requested' : 'preparing'),
    request: { to },
    result: h ? { from: h.from, to: h.to } : {},
  });
  return view(row, r.thread);
}

/** The transition as it stands, or null when the thread has none by that id. */
export function readTransition(threadId: string, id: string): ThreadTransition | null {
  const thread = mustExist(threadId);
  const row = transitions.get(id);
  return row && row.thread_id === threadId ? view(row, thread) : null;
}

/**
 * Cancel the transition: a queued run switch is dropped, a handoff or Take over under way is cancelled as
 * handoff.ts cancels it. A 409 for one that is over, and for a fork: the continued thread is a thread of its own.
 */
export async function cancelTransition(threadId: string, id: string): Promise<ThreadTransition> {
  const thread = mustExist(threadId);
  const row = transitions.get(id);
  if (!row || row.thread_id !== threadId) throw refusal('transition not found', 404);
  switch (row.kind) {
    case 'reconfigure': {
      if (row.state === 'applied') throw refusal('This run switch has applied already. Switch the run back instead.', 409);
      if (row.state === 'queued') cancelQueued(threadId);
      break;
    }
    case 'relocate': {
      if (!currentRelocation(threadId, id)) throw refusal('This move is over; there is nothing to cancel.', 409);
      cancelHandoff(threadId);
      break;
    }
    case 'fork':
      throw refusal('A continued thread is a thread of its own. Stop, archive or delete it instead.', 409);
  }
  return view(transitions.get(id)!, threads.get(threadId) ?? thread);
}

/**
 * Ben's cancel of whatever move the thread is in, as POST /:id/handoff/cancel has always done it: cancelHandoff
 * decides what that is, and the ledger follows.
 */
export function cancelRelocation(threadId: string): HandoffResult {
  const r = cancelHandoff(threadId);
  const row = transitions.latest(threadId, 'relocate');
  if (row) relocateState(row, r.thread);
  return r;
}

/** Whether the handoff records still name this transition: the thread's offer, its request, or the offer that answered the request. */
function currentRelocation(threadId: string, id: string): boolean {
  const offer = offerOf(threadId);
  const asked = requestOf(threadId);
  return offer?.id === id || asked?.id === id || (!!asked && offer?.request === asked.id && asked.id === id);
}

/** A relocate's phase from the handoff records that own it, or null once they no longer name it. */
function relocatePhase(threadId: string, id: string, now = Date.now()): HandoffPhase | null {
  const offer = offerOf(threadId);
  if (offer?.id === id) return handoffPhase(offer, replyOf(threadId), now);
  const asked = requestOf(threadId);
  if (asked?.id !== id) return null;
  // Answered: the offer's phase is the request's from then on.
  if (offer?.request === asked.id) return handoffPhase(offer, replyOf(threadId), now);
  return requestPhase(asked, now);
}

/** A relocate's state from the handoff records, kept in the ledger; the ledger's own once the records no longer name it. */
function relocateState(row: TransitionRow, thread: Thread): { state: TransitionState; error: string | null } {
  const phase = relocatePhase(thread.id, row.id);
  if (!phase) return { state: row.state, error: row.error };
  const error = 'error' in phase ? phase.error : null;
  transitions.settle(row.id, phase.phase, error);
  return { state: phase.phase, error };
}

/** The transition as a client reads it. */
function view(row: TransitionRow, thread: Thread): ThreadTransition {
  const base = { id: row.id, kind: row.kind, thread_id: row.thread_id, created_at: row.created_at, updated_at: row.updated_at, thread };
  switch (row.kind) {
    case 'reconfigure':
      return { ...base, state: row.state, error: row.error, run: runName(row.request.run as Run) };
    case 'relocate': {
      const { state, error } = relocateState(row, thread);
      const from = row.result.from as Party | undefined;
      const to = row.result.to as Party | undefined;
      return { ...base, updated_at: transitions.get(row.id)!.updated_at, state, error, ...(from && { from }), ...(to && { to }), handoff: handoffView(thread) };
    }
    case 'fork': {
      const made = threads.get(row.result.thread_id as string);
      return { ...base, state: 'started', error: null, run: runName(row.request.run as Run), ...(made && { fork: { thread: made } }) };
    }
  }
}
