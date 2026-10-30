// What a thread's transcript gives a session that did not write it: its entries, oldest first, and the newest of them
// that fit a character budget. Two readers, each with its own policy. A run switch's handover (runner/handover.ts)
// gives a native session what it missed, or a fresh one the whole thread, pinning the first message. A Carryover
// (carryover.ts) gives a continued thread's fork its source, with old paths sanitised, older entries condensed and
// what it left out listed. Pure.
import { basename } from 'node:path';
import { switchText, type SwitchP } from '@omni/shared/run-switch.ts';
import type { CarryoverEntry } from '@omni/shared/continue.ts';
import type { EventRow } from './db.ts';
import { toolLabel } from './tool-label.ts';

export const MESSAGE_MAX = 4_000;
const RESULT_MAX = 600;
/** The newest tool calls keep their results; older ones only when they failed. */
const RESULTS_KEPT = 8;
/** A condensed entry: its first line, at most this long. */
const CONDENSED_MAX = 200;

export const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)} (cut)` : s);
const firstLine = (s: string) => s.trim().split('\n', 1)[0];

/** A transcript event with its payload read. */
export interface Row {
  id: number;
  kind: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: any;
}
export const readRows = (events: EventRow[]): Row[] => events.map((e) => ({ id: e.id, kind: e.kind, p: JSON.parse(e.payload) }));

/** One transcript entry before the budget: its text whole (each kind capped). */
export interface TranscriptEntry {
  /** Its last event: a tool call's result when it has one. */
  id: number;
  who: CarryoverEntry['who'];
  text: string;
  /** Says what the task is: a message from Ben, or an earlier Carryover. */
  task: boolean;
}

/** How a reader renders the entries it differs on. Every other entry reads the same for both. */
export interface EntryPolicy {
  /** Ben's name, as his messages are tagged. */
  user: string;
  /** The harness the thread ran on last: the writer of entries before any run switch. */
  speaker: string;
  /** Every string taken from the transcript goes through this. */
  clean?: (s: string) => string;
  /** The lines under a message of Ben's: its attachments, and anything more the reader carries. */
  under: (row: Row) => string[];
  /** An earlier Carryover as one entry. */
  carried: (p: Row['p']) => string;
}

/** A message's attachments by file name, never their paths: a path may be another Mac's. */
export function attachmentNames(p: { attachments?: unknown }): string[] {
  return (Array.isArray(p.attachments) ? p.attachments : []).flatMap((a: { name?: unknown }) => {
    if (typeof a?.name !== 'string') return [];
    const name = basename(a.name.replace(/\\/g, '/'));
    return name && name !== '.' && name !== '..' ? [name] : [];
  });
}

/**
 * The transcript as entries, oldest first: messages, replies, top-level tool calls (with the result of a failed one or
 * one of the newest), crew reports, errors, run switches and earlier Carryovers. Dropped messages are left out.
 */
export function transcriptEntries(events: EventRow[], policy: EntryPolicy): TranscriptEntry[] {
  const clean = policy.clean ?? ((s: string) => s);
  const rows = readRows(events);
  const results = new Map<string, Row>();
  for (const r of rows) if (r.kind === 'tool_result') results.set(r.p.tool_use_id, r);
  const calls = rows.filter((r) => r.kind === 'tool_use' && !r.p.parent);
  const recent = new Set(calls.slice(-RESULTS_KEPT).map((r) => r.p.id));
  // Events carry no harness: the one that wrote them is the one the latest switch moved to.
  let who = (rows.find((r) => r.kind === 'switch')?.p as SwitchP | undefined)?.from.harnessName ?? policy.speaker;
  const out: TranscriptEntry[] = [];
  const add = (id: number, w: TranscriptEntry['who'], text: string, task = false) => out.push({ id, who: w, text, task });
  for (const row of rows) {
    const { id, kind, p } = row;
    if (p?.dropped) continue;
    if (kind === 'user') {
      add(id, 'user', [`[${policy.user}] ${clean(cut(p.text ?? '', MESSAGE_MAX))}`, ...policy.under(row)].join('\n'), true);
    } else if (kind === 'assistant_text') {
      add(id, 'agent', `[${who}] ${clean(cut(p.text ?? '', MESSAGE_MAX))}`);
    } else if (kind === 'crew_report') {
      add(id, 'report', `[Crew report: ${clean(p.title ?? p.task_id ?? 'task')}, ${p.status}] ${clean(cut(p.text ?? '', MESSAGE_MAX))}`);
    } else if (kind === 'error') {
      add(id, 'error', `[Error] ${clean(cut(p.text ?? '', MESSAGE_MAX))}`);
    } else if (kind === 'switch') {
      who = (p as SwitchP).to.harnessName;
      add(id, 'omni', `[Omni] ${switchText(p as SwitchP)}`);
    } else if (kind === 'carryover') {
      add(id, 'omni', clean(policy.carried(p)), true);
    } else if (kind === 'tool_use' && !p.parent) {
      const label = toolLabel(p.input);
      const r = results.get(p.id);
      const shown = r && (r.p.is_error || recent.has(p.id)) ? `\n    ${r.p.is_error ? 'Failed' : 'Result'}: ${clean(cut(r.p.text ?? '', RESULT_MAX))}` : '';
      add(r?.id ?? id, 'tool', `  - ${p.name}${label ? `: ${clean(label)}` : ''}${shown}`);
    }
  }
  return out;
}

export interface Todo {
  content?: string;
  status?: string;
}

/** The plan's open items: the last TodoWrite's todos that are not done. */
export function openTodos(rows: Row[]): Todo[] {
  const plan = rows.findLast((r) => r.kind === 'tool_use' && r.p.name === 'TodoWrite')?.p.input?.todos as Todo[] | undefined;
  return (plan ?? []).filter((t) => t.status !== 'completed' && t.content);
}

/** How the budget is spent. */
export interface SelectPolicy {
  /** Characters the entries may take, a newline each. */
  room: number;
  /** An entry always kept whole, whatever the room: a fresh session's first message. Its size comes off the room. */
  pin?: number;
  /** Once an entry does not fit whole, keep it and older ones cut to their first line while those fit. */
  condense?: boolean;
}

export interface Selected<E> {
  /** The entries kept, oldest first, each with where it was and whether it was cut to its first line. */
  kept: (E & { index: number; condensed: boolean })[];
  /** How many entries were left out. */
  omitted: number;
  /** The newest entry left out, where a note for them goes, or -1 when none was. */
  cutAt: number;
}

/** The newest entries whole while they fit, then (with `condense`) older ones by their first line while those fit. */
export function selectEntries<E extends { text: string }>(entries: E[], s: SelectPolicy): Selected<E> {
  const pin = s.pin ?? -1;
  const kept: Selected<E>['kept'] = [];
  let room = s.room;
  if (pin >= 0) {
    room -= entries[pin].text.length + 1;
    kept.push({ ...entries[pin], index: pin, condensed: false });
  }
  let cutAt = -1;
  let condensing = false;
  for (let j = entries.length - 1; j >= 0; j--) {
    if (j === pin) continue;
    const e = entries[j];
    if (!condensing && e.text.length + 1 <= room) {
      room -= e.text.length + 1;
      kept.push({ ...e, index: j, condensed: false });
      continue;
    }
    if (!s.condense) {
      cutAt = j;
      break;
    }
    condensing = true;
    const line = firstLine(e.text).slice(0, CONDENSED_MAX);
    const short = line === e.text ? line : `${line} …`;
    if (short.length + 1 > room) {
      cutAt = j;
      break;
    }
    room -= short.length + 1;
    kept.push({ ...e, text: short, index: j, condensed: short !== e.text });
  }
  kept.sort((a, b) => a.index - b.index);
  return { kept, omitted: entries.length - kept.length, cutAt };
}
