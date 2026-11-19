import { pickMachine, type MachinePick, type PickCandidate } from '@omni/shared/machine-pick.ts';
import type { FileMention } from '@omni/shared/mention-menu.ts';
import { about } from './about.ts';
import { outbox } from './db.ts';
import { currentRecords, deviceRecords } from './sync/device-records.ts';
import { reachabilityOf, tailnet } from './tailscale.ts';

// The synced machines as the Conductor and the `@` menu name them. GET /api/devices/pick turns "here", an id or a
// name into the machine a delegated or continued thread runs on (@omni/shared/machine-pick.ts). GET /api/mentions
// lists them first in a thread that can delegate, so Ben can @mention the machine a task goes to.

const refused = (message: string, status: number) => Object.assign(new Error(message), { status });

/** Every machine, this one first then the others by name, with how this machine's Tailscale sees each. */
export async function machineCandidates(): Promise<PickCandidate[]> {
  const self = outbox.machineId();
  const records = self ? currentRecords(deviceRecords()) : [];
  const own = records.find((d) => d.id === self);
  const others = records.filter((d) => d.id !== self).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const net = others.length ? await tailnet() : null;
  const here: PickCandidate = { id: self, name: own?.name ?? about.name, here: true, reachability: 'online', lastSeen: null };
  return [
    here,
    ...others.map((d): PickCandidate => {
      const { reachability, lastSeen } = reachabilityOf(net, d);
      return { id: d.id, name: d.name, here: false, reachability, lastSeen };
    }),
  ];
}

/** The machine `asked` names (pickMachine). Throws its refusal with its status. */
export async function pickFor(asked: string): Promise<MachinePick> {
  const res = pickMachine(asked, await machineCandidates());
  if (!res.ok) throw refused(res.error, res.status);
  return res.pick;
}

const DETAIL = { online: 'Online', offline: 'Asleep or offline', unknown: "Can't check Tailscale" } as const;

/**
 * The machines the `@` menu lists for `query`: none while no other machine has synced with this one, since a mention
 * only matters when there is somewhere else to run. A machine matches when a word of its name starts with the query.
 */
export async function machineMentionRows(query: string): Promise<FileMention[]> {
  const all = await machineCandidates();
  if (all.length < 2) return [];
  const q = query.toLowerCase();
  const matches = (name: string) => !q || name.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith(q)) || name.toLowerCase().startsWith(q);
  return all
    .filter((m) => m.id && matches(m.name))
    .map((m) => ({
      insert: m.name,
      name: m.name,
      detail: m.here ? 'This machine' : DETAIL[m.reachability],
      kind: 'machine' as const,
      machine: { id: m.id!, here: m.here, reachability: m.reachability, lastSeen: m.lastSeen },
    }));
}
