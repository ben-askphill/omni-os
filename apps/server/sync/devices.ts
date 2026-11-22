import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import type { Device, DeviceRecord } from '@omni/shared/handoff.ts';
import { kv, outbox } from '../db.ts';
import { reachabilityOf, tailnet } from '../tailscale.ts';
import { onSynced } from './worker.ts';
import { currentRecords, deviceRecord, deviceRecords, PREFIX } from './device-records.ts';

export { currentRecords, deviceRecord, deviceRecords };

// The synced Macs, as each describes itself in kv `devices.<sync id>`: its name and its Tailscale node. Each Mac writes
// only its own key, after a sync, and only when something in it changed, since the relay keeps every write.

/** How often a Mac looks at its own name and node again. Syncs come every few seconds while a thread runs. */
const ANNOUNCE_EVERY_MS = 60_000;

const options: { name?: string } = {};
/** For tests: this Mac's name, so two Macs in one process tell themselves apart. */
export function configureDevices(o: { name?: string }) {
  Object.assign(options, o);
}

/** This Mac's ComputerName ("Ben's MacBook Pro"), else its host name. OMNI_DEVICE_NAME names a QA server on a shared Mac (scripts/qa-handoff-stack.sh). */
export function computerName(): Promise<string> {
  if (options.name) return Promise.resolve(options.name);
  const named = process.env.OMNI_DEVICE_NAME?.trim();
  if (named) return Promise.resolve(named);
  return new Promise((resolve) =>
    execFile('scutil', ['--get', 'ComputerName'], { timeout: 3_000 }, (err, out) => resolve((!err && out.trim()) || hostname())),
  );
}

const sameCaps = (a: Record<string, number> | undefined, b: Record<string, number>) =>
  !!a && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([h, n]) => a[h] === n);

/** The name a synced Mac gave itself, or null before it has synced since this build. */
export const deviceName = (id: string): string | null => deviceRecord(id)?.name ?? null;

/** This machine's name for a handoff or a refusal: as it announced itself, else its host name. Never "this Mac". */
export const ownName = (id: string): string => deviceName(id) ?? hostname();

const refused = (message: string, status: number) => Object.assign(new Error(message), { status });

/** A synced machine by id or by name (any case). Refuses one this machine does not know, or a name two share. */
export function machineFor(asked: string): { id: string; name: string } {
  const all = currentRecords(deviceRecords());
  const byId = all.find((d) => d.id === asked);
  if (byId) return { id: byId.id, name: byId.name };
  const named = all.filter((d) => d.name.toLowerCase() === asked.trim().toLowerCase());
  if (named.length === 1) return { id: named[0].id, name: named[0].name };
  const known = all.map((d) => `${d.name} (${d.id})`).join(', ') || 'none yet';
  if (named.length > 1) throw refused(`More than one synced machine is called ${asked}. Pass its id: ${known}.`, 400);
  throw refused(`No synced machine is called ${asked}. Synced machines: ${known}.`, 404);
}

let announcedAt = 0;

/** This machine's public key for sealed secrets, or undefined when its secret store cannot be reached now. */
async function ownSealKey(): Promise<string | undefined> {
  try {
    return await (await import('../secret-drop.ts')).sealPublicKey();
  } catch (err) {
    console.error('[sync] no key for secrets sent here:', (err as Error).message);
    return undefined;
  }
}

/** This machine's public key for the sync changes it signs, or undefined when its secret store cannot be reached now. */
async function ownSignKey(): Promise<string | undefined> {
  try {
    return await (await import('./sign-key.ts')).signPublicKey();
  } catch (err) {
    console.error('[sync] no key to sign changes with:', (err as Error).message);
    return undefined;
  }
}

/** Write this Mac's record when its name, node, keys or slot caps changed. A no-op while sync is off. */
export async function announceDevice(now = Date.now()): Promise<void> {
  const self = outbox.machineId();
  const had = self ? deviceRecord(self) : null;
  if (!self || kv.get<boolean>('sync.enabled') === false || (!had?.syncPaused && now - announcedAt < ANNOUNCE_EVERY_MS)) return;
  announcedAt = now;
  const [name, net, sealKey, signKey] = await Promise.all([computerName(), tailnet(), ownSealKey(), ownSignKey()]);
  if (kv.get<boolean>('sync.enabled') === false) return;
  const tailscale = net ? net.self : null;
  const same = had && had.name === name && had.tailscale?.nodeId === tailscale?.nodeId && had.tailscale?.dnsName === tailscale?.dnsName;
  const caps = (await import('../runner/state.ts')).slotCaps();
  if (same && !had.syncPaused && had.sealKey === (sealKey ?? had.sealKey) && had.signKey === (signKey ?? had.signKey) && sameCaps(had.caps, caps)) return;
  const seal = sealKey ?? had?.sealKey;
  const sign = signKey ?? had?.signKey;
  kv.set(PREFIX + self, { id: self, name, tailscale, ...(seal && { sealKey: seal }), ...(sign && { signKey: sign }), caps, at: new Date(now).toISOString() } satisfies DeviceRecord);
}

/** Tell peers before stopping sync so they can refuse new work for this machine. */
export function announceSyncPaused(machine: string) {
  const had = deviceRecord(machine);
  if (had) kv.set(PREFIX + machine, { ...had, syncPaused: true, at: new Date().toISOString() } satisfies DeviceRecord);
}

/** The other synced Macs, never this one, with whether this Mac's Tailscale sees each up. Empty while sync is off. */
export async function listDevices(): Promise<Device[]> {
  const self = outbox.machineId();
  const others = self ? currentRecords(deviceRecords()).filter((d) => d.id !== self) : [];
  if (!others.length) return [];
  const net = await tailnet();
  return others
    .map((d) => ({ id: d.id, name: d.name, ...reachabilityOf(net, d) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

onSynced(() => void announceDevice().catch((err) => console.error('[sync] could not describe this machine:', (err as Error).message)));
