// The machine_mention kind of message context: a synced machine Ben picked from the composer's `@` menu, so the
// agent knows which machine a task he wrote next to it should run on. The text keeps `@<name>`; the record holds the
// machine's sync id, which is what delegate and continue_thread take as `device`. The server stamps the name and how
// this machine's Tailscale sees it when the message is sent (apps/server/message-context/machine-mention.ts), and
// refuses a machine it does not know.
import type { Reachability } from './handoff.ts';
import { ID_MAX, cutLabel, type MessageContext, type MessageContextKind, type Parsed } from './message-context.ts';
import { cleanLine } from './message-context-thread.ts';
import { plain } from './message-context-terminal.ts';
import { agentMention, type AgentMention } from './message-context-agent.ts';

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

const asMention = (r: MessageContext): MachineMention | null => (r.kind === machineMention.kind && isObj(r.body) && typeof r.body.name === 'string' ? (r.body as unknown as MachineMention) : null);

/** Whether `records` already mention the machine `id`, so a second pick of it adds no second chip. */
export const mentionsMachine = (records: readonly MessageContext[], id: string) => records.some((r) => asMention(r)?.machine === id);

// ----- the mention as an inline pill -----
// A sent message draws each `@<name>` it carries a record for as a pill inside the text, instead of as a chip over the
// bubble, and a composer rebuilds its chips from them. The text and the records stay as they are: this only finds where
// in the text each mention sits. Machine mentions and agent mentions (message-context-agent.ts) both draw this way.

/** Where one mention sits in a message's text: `text.slice(start, end)` is its `@<name>`. */
export type MentionSpan = { start: number; end: number; /** The record's id. */ id: string } & (
  | { kind: 'machine'; mention: MachineMention }
  | { kind: 'agent'; agent: AgentMention }
);

type Read = { id: string; name: string } & ({ kind: 'machine'; mention: MachineMention } | { kind: 'agent'; agent: AgentMention });

const readMention = (r: unknown): Read | null => {
  if (!isObj(r) || typeof r.id !== 'string' || !isObj(r.body) || typeof r.body.name !== 'string' || !r.body.name) return null;
  if (r.kind === machineMention.kind && typeof r.body.machine === 'string') return { id: r.id, name: r.body.name, kind: 'machine', mention: r.body as unknown as MachineMention };
  if (r.kind === agentMention.kind && typeof r.body.agent === 'string') return { id: r.id, name: r.body.name, kind: 'agent', agent: r.body as unknown as AgentMention };
  return null;
};

/**
 * Every `@<name>` in `text` that one of `records` (read leniently: anything not a list holds none) is the mention of,
 * in text order. Where two names overlap ("@Mac" and "@Mac mini"), the longer one wins.
 */
export function mentionSpans(text: string, records: unknown): MentionSpan[] {
  if (!text.includes('@') || !Array.isArray(records)) return [];
  const found: MentionSpan[] = [];
  for (const r of records) {
    const m = readMention(r);
    if (!m) continue;
    const re = new RegExp(`(?<![\\w@])@${escape(m.name)}(?![\\w'])`, 'gi');
    const { name: _name, ...span } = m;
    for (const hit of text.matchAll(re)) found.push({ start: hit.index, end: hit.index + hit[0].length, ...span });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: MentionSpan[] = [];
  for (const s of found) if (!out.length || s.start >= out[out.length - 1].end) out.push(s);
  return out;
}

/** `text` cut into plain runs and mention spans, in order, for a bubble or a composer to draw. */
export function mentionPieces(text: string, records: unknown): { text: string; span?: MentionSpan }[] {
  const pieces: { text: string; span?: MentionSpan }[] = [];
  let at = 0;
  for (const s of mentionSpans(text, records)) {
    if (s.start > at) pieces.push({ text: text.slice(at, s.start) });
    pieces.push({ text: text.slice(s.start, s.end), span: s });
    at = s.end;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });
  return pieces;
}

/** `records` (read leniently, as ContextChips does) without the mentions `text` shows inline: what still shows as chips over it. */
export function chipRecords<T>(text: string, records: readonly T[]): T[];
export function chipRecords(text: string, records: unknown): unknown[];
export function chipRecords(text: string, records: unknown): unknown[] {
  if (!Array.isArray(records) || !records.length) return [];
  const inline = new Set(mentionSpans(text, records).map((s) => s.id));
  return inline.size ? records.filter((r) => !(isObj(r) && typeof r.id === 'string' && inline.has(r.id))) : [...records];
}
