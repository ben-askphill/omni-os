// The machine_mention kind as harness text (project.ts) and at the message route: a synced machine Ben @mentioned for
// a task. The route stamps the machine's name and how this machine's Tailscale sees it as the message is sent; the
// text gives the agent the machine's id to pass as `device`, and says a task never moves to another machine on its own.
import { cutLabel, type MessageContext } from '@omni/shared/message-context.ts';
import { readContexts } from '@omni/shared/message-context-kinds.ts';
import { MACHINE_NAME_MAX, UNNAMED_MACHINE, machineMention, mentionBody, type MachineMention } from '@omni/shared/message-context-machine.ts';
import { cleanLine } from '@omni/shared/message-context-thread.ts';
import { outbox } from '../db.ts';
import { machineCandidates } from '../machine-pick.ts';
import { userName } from '../profile.ts';
import { defang } from './defang.ts';
import type { Projector } from './project.ts';

type Stamped = { ok: true; value: MessageContext[] } | { ok: false; error: string };

/**
 * The records with each machine mention stamped with that machine as it is now: its current name, and whether this
 * machine's Tailscale sees it up. A mention of a machine this machine does not know (never synced, or reset under a
 * new id) is refused, so Ben removes it before the agent reads an id that names nothing. An offline machine is not
 * refused here: the message may say to wait for it, and delegate refuses to start a thread there (run-on.ts targetFor).
 */
export async function stampMachineMentions(records: readonly MessageContext[], at: Date = new Date()): Promise<Stamped> {
  if (!records.some((r) => r.kind === machineMention.kind)) return { ok: true, value: [...records] };
  const machines = await machineCandidates();
  const out: MessageContext[] = [];
  for (const r of readContexts(records)) {
    if (r.as !== 'known' || r.kind !== 'machine_mention') {
      out.push(r.record);
      continue;
    }
    const m = machines.find((c) => c.id === r.body.machine);
    if (!m?.id) return { ok: false, error: `${r.record.label}: no synced machine has that id now. Remove the mention, then @mention the machine again.` };
    const body = mentionBody({ id: m.id, name: m.name, reachability: m.reachability, lastSeen: m.lastSeen }, at);
    out.push({ ...r.record, label: cutLabel(machineMention.label(body)), body });
  }
  return { ok: true, value: out };
}

const state = (b: MachineMention) =>
  b.reachability === 'online'
    ? 'Tailscale saw it online'
    : b.reachability === 'offline'
      ? `Tailscale saw it offline${b.last_seen ? `, last seen ${b.last_seen}` : ''}`
      : 'Tailscale could not tell whether it was up';

// The name is the machine's own (it named itself), so it is quoted as data and defanged like every projected string.
// Whether it is the machine the agent runs on is worked out here, where the text is written: a Conductor that runs
// on another machine than the one Ben wrote on gets the same id either way.
export const projectMachineMention: Projector<MachineMention> = (b) => {
  const name = defang(cleanLine(b.name, MACHINE_NAME_MAX, UNNAMED_MACHINE));
  const self = b.machine === outbox.machineId();
  return {
    title:
      `Machine mention: ${userName()} wrote @${name} for the machine "${name}" (device id ${defang(b.machine)})` +
      `${self ? ', the machine you run on' : ''}. When ${userName()} sent this message at ${b.captured_at}, ${state(b)}. ` +
      `Run the task ${userName()} wrote next to @${name} there: pass device "${defang(b.machine)}" to seat_agents in your own #conductor thread, or to delegate or continue_thread when using those tools. ` +
      `Without those tools, an agent ${userName()} named in #conductor next to this one machine has its seat pinned there: start the work with omni new in the client channel, and Omni runs it on that machine. ` +
      `If that machine cannot take it (offline, or sync is off), say so to ${userName()} and leave the task; never run it on another machine instead`,
  };
};
