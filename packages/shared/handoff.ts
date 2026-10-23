// Handing a running thread to another synced Mac. Server and web share these shapes; the Mac app mirrors them
// (OmniKit Handoff.swift) and the fixtures in apps/server/tests/mac-fixtures.test.ts hold both to the same JSON.
//
// Everything travels as synced kv, one key per writer, so the two Macs never write the same key:
//   devices.<machine id>   written by that Mac only: its name and its Tailscale node.
//   handoff.offer.<thread> written by the Mac giving the thread away.
//   handoff.reply.<thread> written by the Mac taking it, naming the offer it answers.

/** A synced Mac as it describes itself in kv `devices.<id>`. */
export interface DeviceRecord {
  /** Its sync machine id. */
  id: string;
  /** Its ComputerName, e.g. "Ben's MacBook Pro". */
  name: string;
  /** Its own node, from `tailscale status --json` Self. Null when Tailscale is not running there. */
  tailscale: { nodeId: string; dnsName: string } | null;
  at: string;
}

/**
 * Whether a Mac can take a thread now, as this Mac's Tailscale sees it. `online`: its node is up on the tailnet.
 * `offline`: Tailscale knows the node and it is asleep or away. `unknown`: no Tailscale here or there to ask.
 */
export type Reachability = 'online' | 'offline' | 'unknown';

/** GET /api/devices: the other synced Macs, never this one. */
export interface Device {
  id: string;
  name: string;
  reachability: Reachability;
  /** Its MagicDNS name, without the trailing dot. */
  dnsName: string | null;
  /** Tailscale's last-seen time for an offline node. */
  lastSeen: string | null;
}

export const canTake = (d: Pick<Device, 'reachability'>) => d.reachability !== 'offline';

/** What the giving Mac does before the offer goes out, in order. Shown while it works. */
export type PrepareStep = 'stopping' | 'uploading' | 'packing';

export type HandoffOffer = {
  id: string;
  thread: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  at: string;
} & (
  | { state: 'preparing'; step: PrepareStep }
  | {
      state: 'offered';
      /** Messages that were queued behind the stopped turn, delivered on the new Mac after the continue prompt. */
      queued: string[];
      /** Storage path of a git bundle with the worktree's commits and uncommitted changes, for a worktree thread. */
      bundle: { path: string; base: string; wip: string } | null;
      /** Uncommitted changes in a shared repo folder that cannot travel, e.g. "~/phillbert has uncommitted changes". */
      leftBehind: string | null;
    }
  | { state: 'cancelled' }
  | { state: 'failed'; error: string }
);

export type HandoffReply = { offer: string; at: string } & ({ state: 'accepted' } | { state: 'failed'; error: string });

/** How long an offer waits for the other Mac before the giving Mac says it has not picked it up. */
export const OFFER_PATIENCE_MS = 90_000;

/**
 * The handoff as both Macs show it, from the two kv records. `stale` is an offer the other Mac has not answered
 * within OFFER_PATIENCE_MS: it may still take it, so it stays cancellable.
 */
export type HandoffPhase =
  | { phase: 'preparing'; step: PrepareStep }
  | { phase: 'offered'; stale: boolean }
  | { phase: 'accepted' }
  | { phase: 'failed'; error: string; where: 'here' | 'there' }
  | { phase: 'cancelled' };

/** GET /api/threads/:id `handoff`, and the thread feed event's. Null when the thread has no handoff in flight. */
export interface HandoffView {
  id: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  /** The Mac reading it is the one that gave the thread away. */
  outgoing: boolean;
  at: string;
  state: HandoffPhase;
  leftBehind: string | null;
}

export function handoffPhase(offer: HandoffOffer, reply: HandoffReply | null, now: number): HandoffPhase {
  const answer = reply?.offer === offer.id ? reply : null;
  switch (offer.state) {
    case 'preparing':
      return { phase: 'preparing', step: offer.step };
    case 'cancelled':
      return answer?.state === 'accepted' ? { phase: 'accepted' } : { phase: 'cancelled' };
    case 'failed':
      return { phase: 'failed', error: offer.error, where: 'here' };
    case 'offered':
      if (answer?.state === 'accepted') return { phase: 'accepted' };
      if (answer?.state === 'failed') return { phase: 'failed', error: answer.error, where: 'there' };
      return { phase: 'offered', stale: now - Date.parse(offer.at) > OFFER_PATIENCE_MS };
  }
}

/** One line for the thread's handoff banner, from the reading Mac's side. */
export function handoffText(h: Pick<HandoffView, 'from' | 'to' | 'outgoing' | 'state'>): string {
  const s = h.state;
  const other = h.outgoing ? h.to.name : h.from.name;
  switch (s.phase) {
    case 'preparing':
      return `Handing off to ${h.to.name}: ${{ stopping: 'stopping the turn here', uploading: 'uploading the session', packing: 'packing the worktree' }[s.step]}.`;
    case 'offered':
      if (!h.outgoing) return `Picking this thread up from ${other}.`;
      return s.stale ? `${other} has not picked this thread up yet. It may be asleep or not running Omni.` : `Waiting for ${other} to pick it up.`;
    case 'accepted':
      return h.outgoing ? `Running on ${other}. Handed off from this Mac.` : `Handed off from ${other}. Running on this Mac.`;
    case 'failed':
      return h.outgoing || s.where === 'here'
        ? `The handoff to ${h.to.name} failed: ${s.error.replace(/\.?$/, '.')} The thread is stopped here; reply to continue it.`
        : `Could not pick this thread up from ${other}: ${s.error.replace(/\.?$/, '.')}`;
    case 'cancelled':
      return `The handoff to ${h.to.name} was cancelled.`;
  }
}
