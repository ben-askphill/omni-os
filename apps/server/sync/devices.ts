import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import type { Device, DeviceRecord } from '@omni/shared/handoff.ts';
import { kv, outbox } from '../db.ts';
import { reachabilityOf, tailnet } from '../tailscale.ts';
import { onSynced } from './worker.ts';

// The synced Macs, as each describes itself in kv `devices.<sync id>`: its name and its Tailscale node. Each Mac writes
// only its own key, after a sync, and only when something in it changed, since the relay keeps every write.

const PREFIX = 'devices.';
/** How often a Mac looks at its own name and node again. Syncs come every few seconds while a thread runs. */
const ANNOUNCE_EVERY_MS = 60_000;

const options: { name?: string } = {};
/** For tests: this Mac's name, so two Macs in one process tell themselves apart. */
export function configureDevices(o: { name?: string }) {
  Object.assign(options, o);
}

/** This Mac's ComputerName ("Ben's MacBook Pro"), else its host name. */
export function computerName(): Promise<string> {
  if (options.name) return Promise.resolve(options.name);
  return new Promise((resolve) =>
    execFile('scutil', ['--get', 'ComputerName'], { timeout: 3_000 }, (err, out) => resolve((!err && out.trim()) || hostname())),
  );
}

/** A record as the other Mac wrote it, if it is one. Its id is the key's, whatever the value says. */
function parse(key: string, v: unknown): DeviceRecord | null {
  const r = v as Partial<DeviceRecord> | null;
  const ts = r?.tailscale;
  const node = ts === null || (typeof ts?.nodeId === 'string' && typeof ts.dnsName === 'string');
  if (typeof r?.name !== 'string' || !r.name || !node || typeof r.at !== 'string') return null;
  return { id: key.slice(PREFIX.length), name: r.name, tailscale: ts ? { nodeId: ts.nodeId, dnsName: ts.dnsName } : null, at: r.at };
}

export const deviceRecords = (): DeviceRecord[] =>
  kv.list<unknown>(PREFIX).flatMap(([key, v]) => parse(key, v) ?? []);

export const deviceRecord = (id: string): DeviceRecord | null => parse(PREFIX + id, kv.get<unknown>(PREFIX + id));

/** The name a synced Mac gave itself, or null before it has synced since this build. */
export const deviceName = (id: string): string | null => deviceRecord(id)?.name ?? null;

let announcedAt = 0;

/** Write this Mac's record when its name or node changed. A no-op while sync is off. */
export async function announceDevice(now = Date.now()): Promise<void> {
  const self = outbox.machineId();
  if (!self || now - announcedAt < ANNOUNCE_EVERY_MS) return;
  announcedAt = now;
  const [name, net] = await Promise.all([computerName(), tailnet()]);
  const tailscale = net ? net.self : null;
  const had = deviceRecord(self);
  if (had && had.name === name && had.tailscale?.nodeId === tailscale?.nodeId && had.tailscale?.dnsName === tailscale?.dnsName) return;
  kv.set(PREFIX + self, { id: self, name, tailscale, at: new Date(now).toISOString() } satisfies DeviceRecord);
}

/** The other synced Macs, never this one, with whether this Mac's Tailscale sees each up. Empty while sync is off. */
export async function listDevices(): Promise<Device[]> {
  const self = outbox.machineId();
  const others = self ? deviceRecords().filter((d) => d.id !== self) : [];
  if (!others.length) return [];
  const net = await tailnet();
  return others
    .map((d) => ({ id: d.id, name: d.name, ...reachabilityOf(net, d) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

onSynced(() => void announceDevice().catch((err) => console.error('[sync] could not describe this Mac:', (err as Error).message)));
