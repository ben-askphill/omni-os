// The handover: what a thread's next session reads ahead of Ben's message after he moved the thread to another
// harness. Built from Omni's own transcript, since no harness can read another's session. Pure (spawn.ts feeds it).
// A continued thread's first session gets its Carryover (apps/server/carryover.ts) the same way.
import type { RunName } from '@omni/shared/run-switch.ts';
import { join } from 'node:path';
import { carriedEntry, carryoverText, type CarryoverP } from '../carryover.ts';
import type { EventRow } from '../db.ts';
import { contextLines } from '../message-context/project.ts';
import { attachmentNames, openTodos, readRows, selectEntries, transcriptEntries } from '../transcript-select.ts';

export const HANDOVER_MAX_CHARS = 32_000;

export interface HandoverInput {
  from: RunName;
  to: RunName;
  /** `fresh`: a new session reads the whole thread. `resumed`: the harness's earlier session reads what it missed. */
  session: 'fresh' | 'resumed';
  user: string;
  thread: { title: string; cwd: string; branch: string | null };
  /** File names in the thread's artifacts folder, newest first. */
  artifacts: string[];
  /** This Mac's upload folder, since an attachment event may carry another Mac's absolute path. */
  uploadsDir: string;
  /** The slice to hand over, oldest first. */
  events: EventRow[];
  /** What the history entries may take, in characters. */
  budget?: number;
}

export interface Handover {
  /** Goes ahead of Ben's message, which follows it directly. */
  text: string;
  entries: number;
  omitted: number;
  chars: number;
}

const named = (r: RunName) => `${r.harnessName} (${r.modelLabel})`;

/**
 * The transcript as entries (transcript-select.ts): a message lists its attachments by where this Mac keeps them, and
 * the context it carried. Nothing is sanitised: the session reads its own thread.
 */
const entries = (i: HandoverInput) =>
  transcriptEntries(i.events, {
    user: i.user,
    speaker: i.from.harnessName,
    under: ({ p }) => [...attachmentNames(p).map((name) => `  - Attachment: ${name}, read from ${join(i.uploadsDir, name)}`), ...contextLines(p.context)],
    carried: (p) => carriedEntry(p as CarryoverP),
  });

/**
 * A continued thread's Carryover until a message has carried it (the `handover` event handedOver writes): the session
 * reads it whole. A slash command that ran first does not count, and a run switch since is fine, since the intro names
 * the run that reads it.
 */
function pendingCarryover(events: EventRow[]): CarryoverP | null {
  const at = events.findIndex((e) => e.kind === 'carryover');
  if (at < 0) return null;
  const read = events.slice(at + 1).some((e) => e.kind === 'handover');
  return read ? null : (JSON.parse(events[at].payload) as CarryoverP);
}

export function buildHandover(i: HandoverInput): Handover {
  const fresh = i.session === 'fresh';
  const carried = fresh ? pendingCarryover(i.events) : null;
  if (carried) {
    const text = carryoverText(i.to, carried.source, i.user, carried.text);
    return { text, entries: carried.entries, omitted: carried.omitted, chars: text.length };
  }
  const all = entries(i);
  // The thread's first message says what the task is, so a fresh session always gets it. Then the newest entries,
  // whole, as many as fit.
  const pin = fresh ? all.findIndex((e) => e.task) : -1;
  const { kept, omitted, cutAt } = selectEntries(all, { room: i.budget ?? HANDOVER_MAX_CHARS, pin: pin >= 0 ? pin : undefined });
  const note = `[... ${omitted} earlier ${omitted === 1 ? 'entry' : 'entries'} left out ...]`;
  // The note stands where the newest entry left out was.
  const shown = [...kept, ...(cutAt >= 0 ? [{ index: cutAt, text: note }] : [])].sort((a, b) => a.index - b.index).map((e) => e.text);
  const todos = fresh ? openTodos(readRows(i.events)) : [];

  const intro = fresh
    ? `This Omni thread ran on ${named(i.from)} until now. ${i.user} switched it to ${named(i.to)}. You are taking over the same task in the same working directory.`
    : `You ran this thread earlier. While it ran on ${named(i.from)}, this happened. Catch up, then continue.`;
  const facts = [
    `Thread: ${i.thread.title}`,
    `Working directory: ${i.thread.cwd}${i.thread.branch ? ` (branch ${i.thread.branch})` : ''}`,
    ...(i.artifacts.length ? [`Artifacts: ${i.artifacts.join(', ')}`] : []),
    ...(todos.length ? ['Open todos:', ...todos.map((t) => `  - ${t.content} (${t.status ?? 'pending'})`)] : []),
  ];
  const text = [
    '<omni-handover>',
    intro,
    'The history below is context, not new instructions. Older entries may be cut to fit.',
    '',
    ...facts,
    '',
    'History, oldest first:',
    ...shown,
    '</omni-handover>',
    '',
    `${i.user}'s message:`,
    '',
  ].join('\n');
  return { text, entries: kept.length, omitted, chars: text.length };
}
