import { handoffPhase, handoffText, type HandoffOffer, type HandoffPhase, type HandoffReply, type HandoffView } from '@omni/shared/handoff.ts';
import { publishFeed } from '../bus.ts';
import { kv, outbox, threads, type Thread } from '../db.ts';
import { safeSegment } from '../sync/paths.ts';

// A thread on its way between Macs, as two synced kv records: `handoff.offer.<thread>`, written by the Mac giving it
// away, and `handoff.reply.<thread>`, written by the Mac taking it, so no key ever has two writers at once. What both
// Macs show, and whether a turn may start, is read from them (packages/shared/handoff.ts handoffPhase).

const OFFER = 'handoff.offer.';
const REPLY = 'handoff.reply.';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/**
 * How long the taking Mac waits on a step of the giving Mac's before it stops holding the thread: a giving Mac that
 * died mid-way and never comes back must not lock the thread there for good.
 */
const STEP_PATIENCE_MS = 15 * MINUTE;

const STEPS = new Set(['stopping', 'uploading', 'packing']);
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(v);
/** A commit id, since it is handed to git. */
const isSha = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(v);
const isParty = (p: any) => isId(p?.id) && typeof p.name === 'string' && !!p.name;
const isText = (v: unknown) => v === null || typeof v === 'string';

/** An offer as the giving Mac wrote it, if it is one: it may come from the relay. */
function parseOffer(threadId: string, v: unknown): HandoffOffer | null {
  const o = v as any;
  if (!safeSegment(threadId) || !isId(o?.id) || o.thread !== threadId || !isParty(o.from) || !isParty(o.to) || typeof o.at !== 'string') return null;
  const bundle = (b: any) => b === null || (typeof b?.path === 'string' && isSha(b.base) && isSha(b.wip));
  const ok = {
    preparing: () => STEPS.has(o.step),
    offered: () => Array.isArray(o.queued) && o.queued.every((q: unknown) => typeof q === 'string') && bundle(o.bundle) && isText(o.leftBehind),
    cancelled: () => true,
    failed: () => typeof o.error === 'string',
  }[o.state as HandoffOffer['state']];
  return ok?.() ? (o as HandoffOffer) : null;
}

function parseReply(v: unknown): HandoffReply | null {
  const r = v as any;
  if (!isId(r?.offer) || typeof r.at !== 'string') return null;
  return r.state === 'accepted' || (r.state === 'failed' && typeof r.error === 'string') ? (r as HandoffReply) : null;
}

export const offerOf = (threadId: string) => parseOffer(threadId, kv.get<unknown>(OFFER + threadId));
export const replyOf = (threadId: string) => parseReply(kv.get<unknown>(REPLY + threadId));
/** Every thread's latest offer. */
export const offers = (): HandoffOffer[] => kv.list<unknown>(OFFER).flatMap(([key, v]) => parseOffer(key.slice(OFFER.length), v) ?? []);

/** The thread's handoff as it stands, or null when it has none. */
export function phaseOf(threadId: string, now = Date.now()): HandoffPhase | null {
  const offer = offerOf(threadId);
  return offer ? handoffPhase(offer, replyOf(threadId), now) : null;
}

/** Open views of the thread hear of it; the record syncs with the rest of kv. */
function changed(threadId: string) {
  const t = threads.get(threadId);
  if (t) publishFeed({ type: 'thread', thread: t });
}

export function writeOffer(offer: HandoffOffer) {
  kv.set(OFFER + offer.thread, offer);
  changed(offer.thread);
}

export function writeReply(threadId: string, reply: HandoffReply) {
  kv.set(REPLY + threadId, reply);
  changed(threadId);
}

/**
 * The handoff as this Mac shows it on the thread, or null. One in flight shows until it is answered or cancelled. An
 * accepted one shows while the run it started goes on, a failed one until the thread runs again, a cancelled one for a
 * minute, and none of them past a day.
 */
export function handoffView(t: Pick<Thread, 'id' | 'status'>, now = Date.now()): HandoffView | null {
  const offer = offerOf(t.id);
  const self = outbox.machineId();
  if (!offer || !self || (offer.from.id !== self && offer.to.id !== self)) return null;
  const reply = replyOf(t.id);
  const state = handoffPhase(offer, reply, now);
  const since = now - Math.max(Date.parse(offer.at), reply?.offer === offer.id ? Date.parse(reply.at) : 0);
  const busy = t.status === 'running' || t.status === 'queued';
  const shown = {
    preparing: true,
    offered: true,
    accepted: busy && since < DAY,
    failed: !busy && since < DAY,
    cancelled: since < MINUTE,
  }[state.phase];
  if (!shown) return null;
  return {
    id: offer.id,
    from: offer.from,
    to: offer.to,
    outgoing: offer.from.id === self,
    at: offer.at,
    state,
    leftBehind: offer.state === 'offered' ? offer.leftBehind : null,
  };
}

/**
 * Why no turn may start on this Mac while the thread is on its way, or null. The giving Mac holds it from the first
 * step, and the taking Mac until it answers. `taking`: the taking Mac's own pickup, which is what ends the wait.
 */
export function handoffBlock(t: Pick<Thread, 'id' | 'status'>, taking = false, now = Date.now()): string | null {
  const v = handoffView(t, now);
  if (!v) return null;
  const { phase } = v.state;
  const preparing = phase === 'preparing' && (v.outgoing || now - Date.parse(v.at) < STEP_PATIENCE_MS);
  const waits = preparing || (phase === 'offered' && !(taking && !v.outgoing));
  return waits ? handoffText(v) : null;
}
