// The machine_mention kind of message context: a synced machine Ben picked from the composer's `@` menu, so the
// agent knows which machine a task he wrote next to it should run on. The text keeps `@<name>`; the record holds the
// machine's sync id, which is what delegate and continue_thread take as `device`. The server stamps the name and how
// this machine's Tailscale sees it when the message is sent (apps/server/message-context/machine-mention.ts), and
// refuses a machine it does not know.
import type { Reachability } from './handoff.ts';
import { ID_MAX, cutLabel, type MessageContext, type MessageContextKind, type Parsed } from './message-context.ts';
import { cleanLine } from './message-context-thread.ts';
import { plain } from './message-context-terminal.ts';

export interface MachineMention {
  /** The machine's sync id. */
  machine: string;
  /** Its name when the message was sent. One plain line. */
  name: string;
  /** Whether the sending machine's Tailscale saw it up, asleep or could not tell, when the message was sent. */
  reachability: Reachability;
  /** Tailscale's last-seen time for an offline machine, else null. */
  last_seen: string | null;
  /** When the message was sent, as `Date.toISOString` writes it. The pick sets it first; the route stamps it again. */
  captured_at: string;
}

export const MACHINE_NAME_MAX = 100;
export const UNNAMED_MACHINE = 'Unnamed machine';
const REACH: readonly Reachability[] = ['online', 'offline', 'unknown'];
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const validTime = (v: unknown): v is string => typeof v === 'string' && ISO_TIME.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const machineMention: MessageContextKind<MachineMention> = {
  kind: 'machine_mention',
  v: 1,
  parse(body, v): Parsed<MachineMention> {
    if (v !== 1) return { ok: false, error: `machine_mention has no version ${v}` };
    if (!isObj(body)) return { ok: false, error: 'not an object' };
    const machine = plain(body.machine, 'machine', ID_MAX);
    if (!machine.ok) return machine;
    const name = plain(body.name, 'name', MACHINE_NAME_MAX);
    if (!name.ok) return name;
    if (!REACH.includes(body.reachability as Reachability)) return { ok: false, error: 'reachability must be online, offline or unknown' };
    if (body.last_seen !== null && !validTime(body.last_seen)) return { ok: false, error: 'last_seen must be null or a time like 2026-10-24T09:30:00.000Z' };
    if (!validTime(body.captured_at)) return { ok: false, error: 'captured_at must be a time like 2026-10-24T09:30:00.000Z' };
    return {
      ok: true,
      value: { machine: machine.value, name: name.value, reachability: body.reachability as Reachability, last_seen: body.last_seen, captured_at: body.captured_at },
    };
  },
  label: (b) => cutLabel(`@${b.name}`),
};

/** What the `@` menu and the route know of a machine: the fields a record is made from. */
export interface MachineIdentity {
  id: string;
  name: string;
  reachability: Reachability;
  lastSeen: string | null;
}

/** The record body for `m` as Ben picked it. */
export function mentionBody(m: MachineIdentity, at: Date): MachineMention {
  return {
    machine: m.id,
    name: cleanLine(m.name, MACHINE_NAME_MAX, UNNAMED_MACHINE),
    reachability: m.reachability,
    last_seen: m.reachability === 'offline' ? m.lastSeen : null,
    captured_at: at.toISOString(),
  };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `text` still says `@<name>` as a word of its own, as picking the machine from the menu wrote it. */
export const mentions = (text: string, name: string) => new RegExp(`(?<![\\w@])@${escape(name)}(?![\\w'])`, 'i').test(text);

const asMention = (r: MessageContext): MachineMention | null => (r.kind === machineMention.kind && isObj(r.body) && typeof r.body.name === 'string' ? (r.body as unknown as MachineMention) : null);

/** The machine records whose `@<name>` is no longer in `text`: Ben deleted the mention, so its chip goes too. */
export function droppedMentions(text: string, records: readonly MessageContext[]): string[] {
  return records.flatMap((r) => {
    const m = asMention(r);
    return m && !mentions(text, m.name) ? [r.id] : [];
  });
}

/** Whether `records` already mention the machine `id`, so a second pick of it adds no second chip. */
export const mentionsMachine = (records: readonly MessageContext[], id: string) => records.some((r) => asMention(r)?.machine === id);
