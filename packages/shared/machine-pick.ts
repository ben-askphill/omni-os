import type { Reachability } from './handoff.ts';

// Which machine a delegated or continued thread runs on, when the Conductor names one: "here", a machine's sync id,
// or its name. This machine counts by its own name too, so "run it on omarchy" from omarchy runs here.
// apps/server/machine-pick.ts gathers the machines; GET /api/devices/pick answers with what this picks.

/** A machine as pickMachine weighs it: this one included. */
export interface PickCandidate {
  /** Null for this machine while sync is not set up. */
  id: string | null;
  name: string;
  here: boolean;
  reachability: Reachability;
  lastSeen: string | null;
}

/** GET /api/devices/pick: the machine asked for. */
export interface MachinePick {
  /** As POST /threads and the continue routes take it: "here" or the machine's sync id. */
  device: string;
  id: string | null;
  name: string;
  here: boolean;
  /** How the ask named it. */
  via: 'here' | 'id' | 'name';
}

export type PickResult = { ok: true; pick: MachinePick } | { ok: false; status: 400 | 404; error: string };

const pickOf = (c: PickCandidate, via: MachinePick['via']): MachinePick => ({
  device: c.here ? 'here' : c.id!,
  id: c.id,
  name: c.name,
  here: c.here,
  via: c.here && via !== 'id' ? 'here' : via,
});

/** The machines for a refusal: `omarchy (box-1), Ben's MacBook Pro (mac-1, this machine)`. */
const machinesLine = (candidates: readonly PickCandidate[]) =>
  candidates.map((c) => `${c.name} (${[c.id, c.here && 'this machine'].filter(Boolean).join(', ')})`).join(', ');

/**
 * The machine `asked` names: "here", a machine's id, or its name (any case, this machine's own included). A name two
 * machines share, or one no machine has, is refused with the machines there are. Whether the machine can take a
 * thread now is POST /threads' to say (run-on.ts targetFor): it refuses one Tailscale sees offline.
 */
export function pickMachine(asked: string, candidates: readonly PickCandidate[]): PickResult {
  const want = asked.trim();
  const here = candidates.find((c) => c.here);
  if (!want || want.toLowerCase() === 'here') return here ? { ok: true, pick: pickOf(here, 'here') } : { ok: false, status: 404, error: 'This machine is not known yet.' };
  const byId = candidates.find((c) => c.id === want);
  if (byId) return { ok: true, pick: pickOf(byId, 'id') };
  const named = candidates.filter((c) => c.name.trim().toLowerCase() === want.toLowerCase());
  if (named.length === 1) return { ok: true, pick: pickOf(named[0], 'name') };
  if (named.length > 1) return { ok: false, status: 400, error: `${named.length} machines are called "${want}". Pass the id instead: ${named.map((c) => c.id ?? 'here').join(', ')}.` };
  return { ok: false, status: 404, error: `No synced machine has the id or name "${want}". Machines: ${machinesLine(candidates) || 'none, sync is off'}.` };
}
