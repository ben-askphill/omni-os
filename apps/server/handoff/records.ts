import {
  handoffPhase,
  handoffText,
  requestPhase,
  REQUEST_TTL_MS,
  type HandoffOffer,
  type HandoffPhase,
  type HandoffReply,
  type HandoffRequest,
  type HandoffView,
} from '@omni/shared/handoff.ts';
import { publishFeed } from '../bus.ts';
import { kv, outbox, threads, type Thread } from '../db.ts';
import { safeSegment } from '../sync/paths.ts';

// A thread on its way between Macs, as synced kv records, each with one writer so no key ever has two at once:
// `handoff.offer.<thread>` from the Mac giving it away, `handoff.reply.<thread>` from the Mac taking it, and
// `handoff.request.<thread>` from the Mac asking for it (Take over). The Mac that holds it between turns is a fourth,
// `handoff.holder.<thread>` (db/repos/threads.ts). What both Macs show, and whether a turn may start, is read from
// them (packages/shared/handoff.ts handoffPhase and requestPhase).

const OFFER = 'handoff.offer.';
const REPLY = 'handoff.reply.';
const REQUEST = 'handoff.request.';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
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
const isTime = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

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
    declined: () => typeof o.error === 'string',
  }[o.state as HandoffOffer['state']];
  return ok?.() && (o.idle === undefined || typeof o.idle === 'boolean') && (o.request === undefined || isId(o.request)) ? (o as HandoffOffer) : null;
}

/** A Take over as the asking Mac wrote it, if it is one: it may come from the relay. */
function parseRequest(threadId: string, v: unknown): HandoffRequest | null {
  const r = v as any;
  if (!safeSegment(threadId) || !isId(r?.id) || r.thread !== threadId || !isParty(r.by) || !isParty(r.from) || !isTime(r.at)) return null;
  if (r.after !== null && !isId(r.after)) return null;
  return r.state === 'pending' || r.state === 'cancelled' || r.state === 'expired' ? (r as HandoffRequest) : null;
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
export const requestOf = (threadId: string) => parseRequest(threadId, kv.get<unknown>(REQUEST + threadId));
/** Every thread's latest Take over request. */
export const requests = (): HandoffRequest[] => kv.list<unknown>(REQUEST).flatMap(([key, v]) => parseRequest(key.slice(REQUEST.length), v) ?? []);

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

export function writeRequest(request: HandoffRequest) {
  kv.set(REQUEST + request.thread, request);
  changed(request.thread);
}

/** A handoff's phase while it is under way: the offer is being prepared or waits to be picked up. */
export const moving = (p: HandoffPhase['phase'] | undefined) => p === 'preparing' || p === 'offered';

/**
 * A handoff or a Take over under way, whichever Mac started it: an offer being prepared or waiting to be picked up, or
 * a request that no offer answers yet and that has not run out.
 */
export function inFlight(threadId: string, now = Date.now()): boolean {
  if (moving(phaseOf(threadId, now)?.phase)) return true;
  const r = requestOf(threadId);
  return !!r && offerOf(threadId)?.request !== r.id && requestPhase(r, now).phase === 'requested';
}

/**
 * This Mac's Take over, while it is the latest word on the thread: no offer answers it, none is under way or came after
 * it, and the thread has not come here meanwhile. A cancelled one never shows, an expired one for an hour.
 */
function asking(threadId: string, offer: HandoffOffer | null, self: string, now: number): HandoffRequest | null {
  const r = requestOf(threadId);
  if (!r || r.by.id !== self || r.state === 'cancelled' || offer?.request === r.id) return null;
  if (offer && (moving(phaseOf(threadId, now)?.phase) || offer.id !== r.after)) return null;
  if (threads.holder(threadId) === self) return null;
  return now - Date.parse(r.at) < REQUEST_TTL_MS + HOUR ? r : null;
}

/**
 * The handoff as this Mac shows it on the thread, or null. This Mac's own Take over shows while it waits (asking). One in
 * flight shows until it is answered or cancelled. An accepted one shows while the run it started goes on, a failed one
 * until the thread runs again, a declined one for REQUEST_TTL_MS, a cancelled one for a minute, and none of them past a
 * day.
 */
export function handoffView(t: Pick<Thread, 'id' | 'status' | 'updated_at'>, now = Date.now()): HandoffView | null {
  const self = outbox.machineId();
  if (!self) return null;
  const offer = offerOf(t.id);
  const busy = t.status === 'running' || t.status === 'queued';
  const r = asking(t.id, offer, self, now);
  if (r) return { id: r.id, from: r.from, to: r.by, outgoing: false, at: r.at, state: requestPhase(r, now), leftBehind: null, idle: !busy, requested: true };
  if (!offer || (offer.from.id !== self && offer.to.id !== self)) return null;
  const reply = replyOf(t.id);
  const state = handoffPhase(offer, reply, now);
  const since = now - Math.max(Date.parse(offer.at), reply?.offer === offer.id ? Date.parse(reply.at) : 0);
  const idle = !!offer.idle;
  // A thread handed off between turns shows its handoff until a turn has run since.
  const settled = idle ? since < DAY && !busy && Date.parse(t.updated_at) <= Date.parse(reply?.at ?? '') : busy && since < DAY;
  const shown: Record<HandoffPhase['phase'], boolean> = {
    preparing: true,
    offered: true,
    accepted: settled,
    failed: !busy && since < DAY,
    declined: since < REQUEST_TTL_MS,
    cancelled: since < MINUTE,
    // A request's own phases, which asking shows.
    requested: false,
    expired: false,
  };
  if (!shown[state.phase]) return null;
  return {
    id: offer.id,
    from: offer.from,
    to: offer.to,
    outgoing: offer.from.id === self,
    at: offer.at,
    state,
    leftBehind: offer.state === 'offered' ? offer.leftBehind : null,
    idle,
    requested: !!offer.request,
  };
}

/**
 * Why no turn may start on this Mac while the thread is on its way, or null. The giving Mac holds it from the first
 * step, and the taking Mac until it answers, or from its Take over until the request is answered or runs out.
 * `taking`: the taking Mac's own pickup, which is what ends the wait.
 */
export function handoffBlock(t: Pick<Thread, 'id' | 'status' | 'updated_at'>, taking = false, now = Date.now()): string | null {
  const v = handoffView(t, now);
  if (!v) return null;
  const { phase } = v.state;
  const preparing = phase === 'preparing' && (v.outgoing || now - Date.parse(v.at) < STEP_PATIENCE_MS);
  const waits = phase === 'requested' || preparing || (phase === 'offered' && !(taking && !v.outgoing));
  return waits ? handoffText(v) : null;
}
