import { canTake, handoffText, machineLabel, type Device, type HandoffView, type Takeover } from './handoff.ts';
import { relTime } from './format.ts';

// What a client shows for handing a running thread to another synced Mac, for taking one over from the Mac that holds
// it, and for choosing where a thread runs (apps/server/run-on.ts). packages/shared/handoff.ts owns the shapes and the
// text. The Web UI's desktop header, right-click menu, Machine chip, phone sheets and Settings read these, and so does
// the iOS app. A pick is a device id, or HERE.

/** The part of GET /api/sync/status that says whether sync can carry an offer. */
export interface SyncFlags {
  configured: boolean;
  enabled: boolean;
  signedOut: boolean;
}

/** Sync can carry an offer: signed in and not paused. */
export const syncCarries = (s: SyncFlags | null | undefined) => !!s && s.configured && s.enabled && !s.signedOut;

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
    sync: SyncFlags | null | undefined;
    /** GET /api/devices, undefined while it loads. */
    devices: Device[] | null | undefined;
  },
): HandoffTargets {
  if (!mayHandOff(v)) return { state: 'none', reason: 'Another machine holds this thread, or it is being handed off already.' };
  if (!v.sync) return { state: 'loading' };
  if (!syncCarries(v.sync)) {
    return { state: 'none', reason: v.sync.configured && !v.sync.signedOut ? 'Sync is paused. Turn it back on to hand threads off.' : 'Sign in to sync on both machines to hand threads between them.' };
  }
  if (!v.devices) return { state: 'loading' };
  if (!v.devices.length) return { state: 'none', reason: 'No other synced machine yet.' };
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

/** This machine, as POST /api/threads takes it. */
export const HERE = 'here';

/** This machine's row label: its name from GET /api/status `device`, never "This Mac" or "This machine". */
export const hereLabel = (name: string | null | undefined) => machineLabel(name);

/** One machine in the Run on list. `disabled` for a machine Tailscale sees offline. */
export interface RunOnRow {
  value: string;
  label: string;
  sub: string;
  disabled: boolean;
}

/**
 * This machine first, under its own name (`hereName`), then the other synced machines as GET /api/devices lists them. The composer disables an offline one,
 * since the server refuses it; Settings (`asDefault`) does not, as a default may name a machine that sleeps for now.
 */
export function runOnRows(
  devices: Device[],
  { now = Date.now(), asDefault = false, hereName }: { now?: number; asDefault?: boolean; hereName?: string | null } = {},
): RunOnRow[] {
  return [
    { value: HERE, label: hereLabel(hereName), sub: 'The machine you talk to', disabled: false },
    ...devices.map((d) => {
      const row = deviceRow(d, now);
      return { value: d.id, label: d.name, sub: row.label, disabled: !asDefault && !row.pickable };
    }),
  ];
}

/** Keep a listed machine selected while it is offline, so sending reports the server's refusal. */
const listed = (id: string | null | undefined, devices: Device[]) => (id && devices.some((d) => d.id === id) ? id : HERE);

/**
 * What a new thread starts on: Settings' default (`runOn.device`, '' for this machine), or this machine when that one
 * is gone. An offline default stays selected and the server refuses the send.
 */
export const runOnDefault = (setting: string | null | undefined, devices: Device[]) => listed(setting, devices);

/** The composer's pick while it still holds, else the default. */
export const runOnPick = (picked: string | null, setting: string | null | undefined, devices: Device[]) =>
  picked && listed(picked, devices) === picked ? picked : runOnDefault(setting, devices);

/** Whether there is anything to pick: another synced machine. Sync off or no peers hides the picker. */
export const offersRunOn = (devices: Device[] | null | undefined): devices is Device[] => !!devices?.length;

/** The `device` field of POST /api/threads: only when the picker shows, so a hidden one leaves Settings' default. */
export const runOnRequest = (pick: string, devices: Device[] | null | undefined) => (offersRunOn(devices) ? { device: pick } : {});

/** Settings' value for a pick: '' for this machine. */
export const runOnSetting = (pick: string) => (pick === HERE ? '' : pick);

/** Settings' saved default as a pick: a machine that is no longer synced shows as this one, where the server runs it. */
export const settingPick = (setting: string | null | undefined, devices: Device[]) => (setting && devices.some((d) => d.id === setting) ? setting : HERE);

/**
 * The Machine chip on an existing thread, in the same rows as a new thread's. `holds`: this machine has the thread,
 * and picking another hands it off. `held`: another machine has it (`takeover`), listed first and selected, and picking
 * this machine takes it over, or is disabled with why. Null when there is nothing to pick: one machine, the targets still
 * loading, or a handoff under way (the handoff card says so).
 */
export type ThreadMachine = { kind: 'holds'; rows: RunOnRow[]; value: string } | { kind: 'held'; rows: RunOnRow[]; value: string; takeover: Takeover };

export function threadMachine(
  v: { targets: HandoffTargets; takeover: Takeover | null | undefined; handoff: HandoffView | null | undefined; running: boolean; hereName?: string | null },
  now = Date.now(),
): ThreadMachine | null {
  const t = takeoverShown(v.takeover, v.handoff);
  if (t) {
    const can = mayTakeOver(t, v.handoff);
    return {
      kind: 'held',
      value: t.from.id,
      takeover: t,
      rows: [
        { value: t.from.id, label: t.from.name, sub: t.running ? 'Running there now' : 'Last ran there', disabled: false },
        { value: HERE, label: hereLabel(t.to.name || v.hereName), sub: t.refused ?? (t.running ? 'Take over: stops there, continues here' : 'Take over: next message runs here'), disabled: !can },
      ],
    };
  }
  if (v.targets.state !== 'ready') return null;
  const rows = runOnRows(v.targets.devices, { now, hereName: v.hereName });
  rows[0] = { ...rows[0]!, sub: v.running ? 'Running here now' : 'Runs here' };
  for (const r of rows.slice(1)) if (!r.disabled) r.sub = `Hand off: ${r.sub}`;
  return { kind: 'holds', value: HERE, rows };
}
