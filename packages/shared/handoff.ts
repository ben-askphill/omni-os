// Handing a thread to another synced Mac, running or idle, and taking one over from another Mac. Server and web share
// these shapes; the Mac app mirrors them (OmniKit Handoff.swift) and the fixtures in apps/server/tests/mac-fixtures.test.ts
// hold both to the same JSON.
//
// Everything travels as synced kv, one key per writer, so the two Macs never write the same key:
//   devices.<machine id>     written by that Mac only: its name and its Tailscale node.
//   handoff.holder.<thread>  the Mac that holds the thread between turns, written by that Mac when it starts a turn or
//                            takes the thread, so only the Mac it moves to writes it.
//   handoff.request.<thread> written by the Mac that asks for the thread (Take over). The Mac holding it answers with an offer.
//   handoff.offer.<thread>   written by the Mac giving the thread away.
//   handoff.reply.<thread>   written by the Mac taking it, naming the offer it answers.

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
  /** The thread had no turn running: nothing is cut off, and the other Mac continues with Ben's next message. Absent on offers from older builds. */
  idle?: boolean;
  /** The Take over request this offer answers, when the taking Mac asked for the thread. */
  request?: string;
  /**
   * A new thread sent to the other machine to run there from its first message (apps/server/run-on.ts): nothing ran
   * here, so it is set up there (its worktree cut there) and `queued` holds the first prompt.
   */
  fresh?: boolean;
} & (
  | { state: 'preparing'; step: PrepareStep }
  | {
      state: 'offered';
      /** Messages that were queued behind the stopped turn, delivered on the new Mac after the continue prompt. */
      queued: string[];
      /** A fresh thread's first files, in Storage by sha (apps/server/sync/files.ts sendUploads). */
      files?: { name: string; sha: string; size: number; mime: string; image: boolean }[];
      /** Storage path of a git bundle with the worktree's commits and uncommitted changes, for a worktree thread. */
      bundle: { path: string; base: string; wip: string } | null;
      /** Uncommitted changes in a shared repo folder that cannot travel, e.g. "~/phillbert has uncommitted changes". */
      leftBehind: string | null;
    }
  | { state: 'cancelled' }
  | { state: 'failed'; error: string }
  /** A Take over request refused before anything stopped: the thread stays where it is. */
  | { state: 'declined'; error: string }
);

/**
 * Ben's Take over, from the Mac that wants the thread. Only that Mac writes it, so it alone ends one: Ben's Cancel, the
 * handoff that answered it being over, the hour running out, or the thread moving to another Mac meanwhile. The holding
 * Mac answers only a pending request.
 */
export interface HandoffRequest {
  id: string;
  thread: string;
  /** The Mac asking. It takes the thread. */
  by: { id: string; name: string };
  /** The Mac that holds the thread, asked to give it. */
  from: { id: string; name: string };
  /** When it was asked, by the asking Mac's clock. Ending a request keeps it. */
  at: string;
  /**
   * The thread's offer on record when it was asked, or null. An offer with another id that does not answer the request
   * came after it, which no comparison of two Macs' clocks can tell.
   */
  after: string | null;
  state: 'pending' | 'cancelled' | 'expired';
}

/**
 * How long a request waits for the Mac that holds the thread, so one that wakes the next morning does not give it away.
 * Both Macs hold it to the asking Mac's time: the asking Mac ends the request, and the holding Mac, by its own clock,
 * leaves one this old unanswered in case the asking Mac sleeps too. Two Macs' clocks differ by seconds, not an hour.
 */
export const REQUEST_TTL_MS = 60 * 60_000;

export type HandoffReply = { offer: string; at: string } & ({ state: 'accepted' } | { state: 'failed'; error: string });

/** How long an offer waits for the other Mac before the giving Mac says it has not picked it up. */
export const OFFER_PATIENCE_MS = 90_000;

/**
 * The handoff as both Macs show it, from the kv records. `stale` is an offer the other Mac has not answered within
 * OFFER_PATIENCE_MS: it may still take it, so it stays cancellable. `requested`, `declined` and `expired` are a Take over
 * the holding Mac has not started on: waiting for it, refused by it, or not answered within REQUEST_TTL_MS.
 */
export type HandoffPhase =
  | { phase: 'requested'; stale: boolean }
  | { phase: 'preparing'; step: PrepareStep }
  | { phase: 'offered'; stale: boolean }
  | { phase: 'accepted' }
  | { phase: 'declined'; error: string }
  | { phase: 'expired' }
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
  /** Handed off between turns, so nothing was running: it resumes with the next message, on whichever Mac it went to. */
  idle: boolean;
  /** Taken over: the taking Mac asked for it, rather than the giving Mac handing it off. */
  requested: boolean;
}

/**
 * GET /api/threads/:id `takeover`, and the thread stream event's: another Mac holds the thread, the one running it now
 * or, between turns, the one that ran it last or took it since. Absent when this Mac holds it, when no Mac is known to,
 * and while a handoff or a Take over is under way.
 */
export interface Takeover {
  /** The Mac that holds it. */
  from: { id: string; name: string };
  /** This Mac, which would take it. */
  to: { id: string; name: string };
  /** A turn runs there now. Otherwise it is idle there. */
  running: boolean;
  /** Why it cannot be taken over now, or null when it can. */
  refused: string | null;
}

/** The note over the reply box on a thread another Mac holds. */
export const takeoverNote = (t: Pick<Takeover, 'from' | 'running'>) =>
  t.running ? `This thread is running on ${t.from.name}.` : `Last ran on ${t.from.name}.`;

/** What Take over asks before it goes ahead: it cuts a turn on another Mac, which cannot be undone. */
export function takeoverConfirm(t: Pick<Takeover, 'from' | 'to' | 'running'>): { title: string; body: string } {
  return {
    title: `Take over from ${t.from.name}?`,
    body: t.running
      ? `${t.from.name} stops the current turn and hands the thread here. The agent continues on ${t.to.name} where it was cut off.`
      : `${t.from.name} sends its latest session and changes here. Your next message runs on ${t.to.name}.`,
  };
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
    case 'declined':
      return { phase: 'declined', error: offer.error };
    case 'offered':
      if (answer?.state === 'accepted') return { phase: 'accepted' };
      if (answer?.state === 'failed') return { phase: 'failed', error: answer.error, where: 'there' };
      return { phase: 'offered', stale: now - Date.parse(offer.at) > OFFER_PATIENCE_MS };
  }
}

/** A Take over no offer answers yet, as the asking Mac shows it. Past REQUEST_TTL_MS it is expired before the asking Mac writes so. */
export function requestPhase(request: HandoffRequest, now: number): HandoffPhase {
  if (request.state !== 'pending') return { phase: request.state };
  const waited = now - Date.parse(request.at);
  return waited > REQUEST_TTL_MS ? { phase: 'expired' } : { phase: 'requested', stale: waited > OFFER_PATIENCE_MS };
}

/** One line for the thread's handoff banner, from the reading Mac's side. */
export function handoffText(h: Pick<HandoffView, 'from' | 'to' | 'outgoing' | 'state'> & { idle?: boolean; requested?: boolean }): string {
  const s = h.state;
  const other = h.outgoing ? h.to.name : h.from.name;
  const error = (e: string) => e.replace(/\.?$/, '.');
  switch (s.phase) {
    case 'requested':
      return s.stale
        ? `${h.from.name} has not answered. It may be asleep; it hands the thread over when it wakes.`
        : `Asking ${h.from.name} to hand this thread over.`;
    case 'declined':
      return h.outgoing ? `${h.to.name} asked for this thread, and it stays here: ${error(s.error)}` : `${h.from.name} kept this thread: ${error(s.error)}`;
    case 'expired':
      return `${h.from.name} did not answer within an hour, so the request expired.`;
    case 'preparing':
      if (!h.outgoing) return `${other} is handing this thread to this Mac.`;
      return `Handing off to ${h.to.name}: ${{ stopping: 'stopping the turn here', uploading: 'uploading the session', packing: 'packing the worktree' }[s.step]}.`;
    case 'offered':
      if (!h.outgoing) return `Picking this thread up from ${other}.`;
      return s.stale ? `${other} has not picked this thread up yet. It may be asleep or not running Omni.` : `Waiting for ${other} to pick it up.`;
    case 'accepted':
      if (h.requested) {
        if (h.idle) return h.outgoing ? `${other} took this thread over. The next message runs there.` : `Taken over from ${other}. Your next message continues it here.`;
        return h.outgoing ? `${other} took this thread over. Running there.` : `Taken over from ${other}. Running on this Mac.`;
      }
      if (h.idle) return h.outgoing ? `Handed off to ${other}. Your next message continues it there.` : `Handed off from ${other}. Your next message continues it here.`;
      return h.outgoing ? `Running on ${other}. Handed off from this Mac.` : `Handed off from ${other}. Running on this Mac.`;
    case 'failed':
      if (h.outgoing) return `The handoff to ${h.to.name} failed: ${error(s.error)} The thread is stopped here; reply to continue it.`;
      return s.where === 'here'
        ? `${other} could not hand this thread over: ${error(s.error)} It stays there.`
        : `Could not pick this thread up from ${other}: ${error(s.error)} It stays there.`;
    case 'cancelled':
      return `The handoff to ${h.to.name} was cancelled.`;
  }
}
