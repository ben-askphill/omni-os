import { db, kv, outbox } from '../db.ts';
import { currentRecords, deviceRecords } from './device-records.ts';
import { keyring } from './keyring.ts';

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
 * later claim wins on both Macs. A claim held for Ben's Trust (sync/verify.ts) counts as an owner: a new Mac does not
 * claim them while the other Mac's claim waits. True when it claimed them.
 */
export function claimIfUnowned(): boolean {
  if (kv.get<string>(OWNER_KEY) !== undefined) return false;
  const held = db
    .prepare(`SELECT 1 FROM sync_deferred WHERE json_extract(change, '$.entity') = 'kv' AND json_extract(change, '$.entity_id') = ?`)
    .get(OWNER_KEY);
  return !held && claimAutomations();
}

/**
 * A synced machine named by an automation's `machine:`: its sync id, matched by id first, then by name (any case) when
 * one machine has it. This machine and the machines trusted with their signing key (sync/keyring.ts) are asked first,
 * so a device record nobody vouched for cannot take a trusted machine's name. Null when no synced machine matches, or
 * two share the name.
 */
export function resolveMachine(asked: string): string | null {
  const want = asked.trim();
  if (!want) return null;
  const all = currentRecords(deviceRecords());
  if (all.some((d) => d.id === want)) return want;
  const self = outbox.machineId();
  const named = all.filter((d) => d.name.toLowerCase() === want.toLowerCase());
  const vouched = named.filter((d) => d.id === self || keyring.trusted(d.id));
  const pick = vouched.length ? vouched : named;
  return pick.length === 1 ? pick[0].id : null;
}

/**
 * Where one automation runs. Its own `machine:` wins over the shared choice above; one that names no synced machine
 * runs nowhere until that machine syncs, so a typo never makes it run twice. Without sync every automation runs here.
 */
export function ownerOf(a: { machine?: string } | undefined): AutomationsOwner {
  const self = outbox.machineId();
  if (!a?.machine || !self) return automationsOwner();
  const id = resolveMachine(a.machine) ?? a.machine;
  return { owner: id, isThisMac: id === self };
}

/** One automation fires here: see ownerOf. */
export const runsHere = (a: { machine?: string } | undefined) => ownerOf(a).isThisMac;
