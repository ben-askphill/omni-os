import { canTake, handoffText, type Device, type HandoffView, type Takeover } from '@omni/shared/handoff.ts';
import type { SyncStatus } from './api.ts';
import { relTime } from './format.ts';

// What the Web UI shows for handing a running thread to another synced Mac, and for taking one over from the Mac that
// holds it (packages/shared/handoff.ts owns the shapes and the text). The desktop header, the right-click menu, the
// note over the reply box and the phone's thread sheet all read these.

type Sync = Pick<SyncStatus, 'configured' | 'enabled' | 'signedOut'>;

/** Sync can carry an offer: signed in and not paused. */
export const syncCarries = (s: Sync | null | undefined) => !!s && s.configured && s.enabled && !s.signedOut;

/** A handoff or a Take over that is still under way, so the thread is not this Mac's to give away or ask for again. */
const inFlight = (h: HandoffView | null | undefined) => !!h && (h.state.phase === 'requested' || h.state.phase === 'preparing' || h.state.phase === 'offered');

/** The thread's state that decides whether it is this Mac's to give away. */
export interface Holding {
  status: string | undefined;
  blocked: string | null | undefined;
  handoff: HandoffView | null | undefined;
  takeover: Takeover | null | undefined;
}

/**
 * Whether the thread is this Mac's to give away: not blocked (`blocked` says why, such as running on another Mac),
 * not held by another Mac (`takeover`: only that Mac may hand it off, this one can take it over), and not already
 * handing off. A running turn is stopped and continued there; an idle thread goes between turns, and the next
 * message runs on the other Mac.
 */
export const mayHandOff = (v: Holding) => !!v.status && !v.blocked && !v.takeover && !inFlight(v.handoff);

/** Where the picker stands. "Hand off to…" shows only when it is `ready`: there is a Mac to pick. */
export type HandoffTargets = { state: 'loading' } | { state: 'none'; reason: string } | { state: 'ready'; devices: Device[] };

export function handoffTargets(
  v: Holding & {
    /** GET /api/sync/status, undefined while it loads. */
    sync: Sync | null | undefined;
    /** GET /api/devices, undefined while it loads. */
    devices: Device[] | null | undefined;
  },
): HandoffTargets {
  if (!mayHandOff(v)) return { state: 'none', reason: 'Another Mac holds this thread, or it is being handed off already.' };
  if (!v.sync) return { state: 'loading' };
  if (!syncCarries(v.sync)) {
    return { state: 'none', reason: v.sync.configured && !v.sync.signedOut ? 'Sync is paused. Turn it back on to hand threads off.' : 'Sign in to sync on both Macs to hand threads between them.' };
  }
  if (!v.devices) return { state: 'loading' };
  if (!v.devices.length) return { state: 'none', reason: 'No other synced Mac yet.' };
  return { state: 'ready', devices: v.devices };
}

/** One Mac in the picker. `dot` is a StatusDot glyph. */
export interface DeviceRow {
  id: string;
  name: string;
  pickable: boolean;
  dot: 'done' | 'idle' | 'settled';
  label: string;
}

export function deviceRow(d: Device, now = Date.now()): DeviceRow {
  const base = { id: d.id, name: d.name, pickable: canTake(d) };
  switch (d.reachability) {
    case 'online':
      return { ...base, dot: 'done', label: 'Online on Tailscale' };
    case 'offline': {
      const seen = d.lastSeen ? relTime(d.lastSeen, now) : '';
      return { ...base, dot: 'idle', label: seen ? `Asleep or offline, last seen ${seen}` : 'Asleep or offline' };
    }
    case 'unknown':
      return { ...base, dot: 'settled', label: "Can't check Tailscale" };
  }
}

/**
 * Online Macs first, then the ones Tailscale cannot vouch for, then the asleep ones; by name within each, numbers in
 * order ("Mac 2" before "Mac 10"), as the Mac app's `localizedStandardCompare` sorts them.
 */
export function deviceRows(devices: Device[], now = Date.now()): DeviceRow[] {
  const rank = { online: 0, unknown: 1, offline: 2 } as const;
  return [...devices]
    .sort((a, b) => rank[a.reachability] - rank[b.reachability] || a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((d) => deviceRow(d, now));
}

/**
 * The thread's handoff banner. A card while it is under way or went wrong, with Cancel on the giving Mac while the
 * other Mac has not taken it, and on the asking Mac while its Take over waits; one quiet line once it settled. Null
 * once there is nothing to say: no handoff, or a failed one the thread has since moved past (Ben replied and it runs
 * again).
 */
export type HandoffBanner =
  | { size: 'card'; tone: 'working' | 'waiting' | 'alert'; text: string; cancel: boolean }
  | { size: 'line'; tone: 'done' | 'cancelled'; text: string };

export function handoffBanner(h: HandoffView | null | undefined, status: string | undefined): HandoffBanner | null {
  if (!h) return null;
  const text = handoffText(h);
  const s = h.state;
  switch (s.phase) {
    case 'requested':
      return { size: 'card', tone: s.stale ? 'alert' : 'waiting', text, cancel: true };
    case 'declined':
    case 'expired':
      return { size: 'card', tone: 'alert', text, cancel: false };
    case 'preparing':
      return { size: 'card', tone: 'working', text, cancel: h.outgoing };
    case 'offered':
      if (!h.outgoing) return { size: 'card', tone: 'working', text, cancel: false };
      return { size: 'card', tone: s.stale ? 'alert' : 'waiting', text, cancel: true };
    case 'failed':
      return status === 'running' || status === 'queued' ? null : { size: 'card', tone: 'alert', text, cancel: false };
    case 'accepted':
      return { size: 'line', tone: 'done', text };
    case 'cancelled':
      return { size: 'line', tone: 'cancelled', text };
  }
}

/** The Take over note over the reply box: another Mac holds the thread and nothing is moving it yet. */
export const takeoverShown = (t: Takeover | null | undefined, h: HandoffView | null | undefined): Takeover | null => (t && !inFlight(h) ? t : null);

/** Whether Take over is on offer: the note shows, and the Mac holding the thread can be asked for it now. */
export const mayTakeOver = (t: Takeover | null | undefined, h: HandoffView | null | undefined) => !!t && !t.refused && !inFlight(h);

/**
 * The "can't take a turn" note over the composer, or null when something already says why: the handoff card while a
 * handoff or a Take over is under way (as the Mac app does), or the Take over note for a thread running on another Mac.
 */
export function blockedNote(
  blocked: string | null | undefined,
  h: HandoffView | null | undefined,
  status: string | undefined,
  takeover: Takeover | null | undefined,
): string | null {
  if (!blocked || inFlight(h) || takeoverShown(takeover, h)?.running) return null;
  const banner = handoffBanner(h, status);
  return banner?.size === 'card' && banner.text === blocked ? null : blocked;
}
