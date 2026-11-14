import { machineLabel } from '@omni/shared/handoff.ts';
import type { MachineStop, RanOn, RanOnFields } from '@omni/shared/ran-on.ts';
import { about } from './about.ts';
import { assignments, db, outbox, threads } from './db.ts';
import { deviceRecords } from './sync/devices.ts';

// Where a thread runs or last ran, and when its running turn started, for the Inbox rows (@omni/shared/ran-on.ts).
// Read from what sync already carries, on each read, never stored on the thread: the machine running a running or
// queued thread is its run_machine tag (db/repos/threads.ts); otherwise the machine that holds it, its assignment
// (db/repos/assignments.ts), whose trail lists the machines before. Names come from each machine's devices.<id>
// record. The run's start is Ben's last message, as the thinking line counts it (@omni/shared/status-line.ts turnStart).

/** A machine's name by its sync id: its own record, this machine's host name, else a neutral label. */
export type MachineNames = (id: string) => string;

export function machineNames(): MachineNames {
  const self = outbox.machineId();
  const byId = new Map(deviceRecords().map((d) => [d.id, d.name]));
  return (id) => machineLabel(byId.get(id) ?? (id === self ? about.name : null));
}

const stop = (machine: string, at: string | null, names: MachineNames): MachineStop => ({ id: machine, name: names(machine), at: at || null });

/** Where the thread runs now or last ran, with the machines before it. Null when no machine is known. */
export function ranOn(t: { id: string; status?: string }, names: MachineNames = machineNames()): RanOn | null {
  const busy = t.status === 'running' || t.status === 'queued';
  const runner = busy ? threads.runMachine(t.id) : null;
  const held = assignments.get(t.id);
  const id = runner ?? held?.machine ?? null;
  if (!id) return null;
  // The runner and the holder agree but for the moment a move takes: then the holder is the stop before.
  const trail = held ? (held.machine === id ? held.trail : [...held.trail, { machine: held.machine, at: held.at }]) : [];
  const before = trail.filter((s, i) => !(i === trail.length - 1 && s.machine === id)).map((s) => stop(s.machine, s.at, names));
  return { ...stop(id, held?.machine === id ? held.at : null, names), before };
}

/** When the thread's running turn started: Ben's last message. Null while it waits, is idle or has no message. */
export function runStartedAt(t: { id: string; status?: string }, delegating = false): string | null {
  if (t.status !== 'running' && !delegating) return null;
  const row = db.prepare(`SELECT created_at FROM events WHERE thread_id = ? AND kind = 'user' ORDER BY id DESC LIMIT 1`).get(t.id) as { created_at: string } | undefined;
  return row?.created_at ?? null;
}

/** The fields a client thread carries for its Inbox row. */
export const ranOnFields = (t: { id: string; status?: string }, delegating: boolean, names: MachineNames): Required<RanOnFields> => ({
  ran_on: ranOn(t, names),
  run_started_at: runStartedAt(t, delegating),
});
