import { kv, outbox } from '../db.ts';

// Which Mac runs the scheduled (cron) automations once sync is on, so a nightly job does not run on both.
// kv `automations.owner` holds that Mac's sync id. It is not a sync.* key, so it syncs, last writer wins,
// and both Macs agree. Manual runs are never gated. With sync never set up here, every automation runs here.

export const OWNER_KEY = 'automations.owner';

export interface AutomationsOwner {
  /** The sync id of the Mac that runs them, or null before any Mac claimed them. */
  owner: string | null;
  /** Cron automations fire on this Mac: sync is not set up, no Mac claimed them yet, or this one did. */
  isThisMac: boolean;
}

export function automationsOwner(): AutomationsOwner {
  const owner = kv.get<string>(OWNER_KEY) ?? null;
  const self = outbox.machineId();
  return { owner, isThisMac: !self || !owner || owner === self };
}

export const runsAutomationsHere = () => automationsOwner().isThisMac;

/** Make this Mac the one that runs them. Needs sync set up here; returns false when it is not. */
export function claimAutomations(): boolean {
  const self = outbox.machineId();
  if (!self) return false;
  if (kv.get<string>(OWNER_KEY) !== self) kv.set(OWNER_KEY, self);
  return true;
}

/**
 * After a sync that pulled everything: claim them when no Mac has. The worker calls it then, not at arm, so a
 * Mac joining later first gets the owner the relay already has. Two first syncs at once both claim, and the
 * later claim wins on both Macs. True when it claimed them.
 */
export function claimIfUnowned(): boolean {
  return kv.get<string>(OWNER_KEY) === undefined && claimAutomations();
}
