import { canTake, handoffText, type Device, type HandoffView } from '@omni/shared/handoff.ts';
import type { SyncStatus } from './api.ts';
import { relTime } from './format.ts';

// What the Web UI shows for handing a running thread to another synced Mac (packages/shared/handoff.ts owns the shapes
// and the banner text). The desktop header, the right-click menu and the phone's thread sheet all read these.

type Sync = Pick<SyncStatus, 'configured' | 'enabled' | 'signedOut'>;

/** Sync can carry an offer: signed in and not paused. */
export const syncCarries = (s: Sync | null | undefined) => !!s && s.configured && s.enabled && !s.signedOut;

/** A handoff that is still under way, so the thread is not this Mac's to give away again. */
const inFlight = (h: HandoffView | null | undefined) => !!h && (h.state.phase === 'preparing' || h.state.phase === 'offered');

/**
 * Whether the thread is this Mac's to give away: not running on another Mac or blocked (`blocked` says so), and not
 * already handing off. A running turn is stopped and continued there; an idle thread goes between turns, and the next
 * message runs on the other Mac.
 */
export const mayHandOff = (status: string | undefined, blocked: string | null | undefined, handoff: HandoffView | null | undefined) =>
  !!status && !blocked && !inFlight(handoff);

/** Where the picker stands. "Hand off to…" shows only when it is `ready`: there is a Mac to pick. */
export type HandoffTargets = { state: 'loading' } | { state: 'none'; reason: string } | { state: 'ready'; devices: Device[] };

export function handoffTargets(v: {
  status: string | undefined;
  blocked: string | null | undefined;
  handoff: HandoffView | null | undefined;
  /** GET /api/sync/status, undefined while it loads. */
  sync: Sync | null | undefined;
  /** GET /api/devices, undefined while it loads. */
  devices: Device[] | null | undefined;
}): HandoffTargets {
  if (!mayHandOff(v.status, v.blocked, v.handoff)) return { state: 'none', reason: 'This thread is running on another Mac or being handed off already.' };
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

/** Online Macs first, then the ones Tailscale cannot vouch for, then the asleep ones; by name within each. */
export function deviceRows(devices: Device[], now = Date.now()): DeviceRow[] {
  const rank = { online: 0, unknown: 1, offline: 2 } as const;
  return [...devices].sort((a, b) => rank[a.reachability] - rank[b.reachability] || a.name.localeCompare(b.name)).map((d) => deviceRow(d, now));
}

/**
 * The thread's handoff banner. A card while it is under way or went wrong, with Cancel on the giving Mac while the
 * other Mac has not taken it; one quiet line once it settled. Null once there is nothing to say: no handoff, or a
 * failed one the thread has since moved past (Ben replied and it runs again).
 */
export type HandoffBanner =
  | { size: 'card'; tone: 'working' | 'waiting' | 'alert'; text: string; cancel: boolean }
  | { size: 'line'; tone: 'done' | 'cancelled'; text: string };

export function handoffBanner(h: HandoffView | null | undefined, status: string | undefined): HandoffBanner | null {
  if (!h) return null;
  const text = handoffText(h);
  const s = h.state;
  switch (s.phase) {
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

/** The "can't take a turn" note over the composer, or null when the handoff card already says the same thing. */
export function blockedNote(blocked: string | null | undefined, h: HandoffView | null | undefined, status: string | undefined): string | null {
  if (!blocked) return null;
  const banner = handoffBanner(h, status);
  return banner?.size === 'card' && banner.text === blocked ? null : blocked;
}
