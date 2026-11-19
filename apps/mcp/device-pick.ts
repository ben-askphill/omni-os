// What a Conductor tool's device or to names: "here", a synced machine's id, or its name in any case. This machine's
// own name means here (list_devices lists only the others), and a part of a name works when one machine has it, so
// "MacBook Pro" finds "Ben's MacBook Pro".
import { call } from './api.ts';
import type { MachinesView } from '@omni/shared/machines.ts';

export interface Machine {
  id: string;
  name: string;
}

/** The machine `asked` names among `others`, with id "here" for this machine (`self`, its name or null). Throws why it names none. */
export function pickDevice(asked: string, others: Machine[], self: string | null): Machine {
  const want = asked.trim();
  const low = want.toLowerCase();
  if (low === 'here' || (self && self.toLowerCase() === low)) return { id: 'here', name: self ?? 'here' };
  const byId = others.find((d) => d.id === want);
  if (byId) return byId;
  const all = [...others, ...(self ? [{ id: 'here', name: self }] : [])];
  const exact = all.filter((d) => d.name.toLowerCase() === low);
  const part = exact.length ? exact : all.filter((d) => d.name.toLowerCase().includes(low));
  if (part.length === 1) return part[0];
  const list = others.map((d) => `${d.name} (${d.id})`).join(', ');
  const here = self ? ` This machine, ${self}, is "here".` : '';
  if (part.length > 1) throw new Error(`${part.length} machines match "${want}": ${part.map((d) => (d.id === 'here' ? `${d.name} (here)` : `${d.name} (${d.id})`)).join(', ')}. Pass the id instead.`);
  throw new Error(`No synced machine is called "${want}". Machines: ${list || 'none, sync is off or no other machine has synced'}.${here}`);
}

/** pickDevice against /devices and this machine's name from /machines. */
export async function resolveDevice(asked: string): Promise<Machine> {
  const [others, view] = await Promise.all([call('/devices') as Promise<Machine[]>, (call('/machines') as Promise<MachinesView>).catch(() => null)]);
  return pickDevice(asked, others, view?.machines.find((m) => m.here)?.name ?? null);
}
