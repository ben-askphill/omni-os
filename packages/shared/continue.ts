// Continuing an idle thread on another local harness: a new, linked thread with its own Session and worktree, whose
// first Session reads a Carryover ahead of Ben's first message. Server and web share these shapes; the Mac app mirrors
// them (OmniKit Continue.swift) and the fixtures in apps/server/tests/mac-fixtures.test.ts hold both to the same JSON.
// "Carryover" is the word #187 uses for the same packet when an imported transcript is continued.
import type { RunName } from './run-switch.ts';

/** What a Carryover may take, in characters. Ben's own message comes after it and is never cut. */
export const CARRYOVER_BUDGET = 24_000;

/** Why a thread cannot be continued right now. The preview still shows; starting waits until it is gone. */
export type ContinueBlockCode =
  | 'remote' // Hermes or Cursor Cloud: its files are not on this Mac
  | 'elsewhere' // it runs on the other Mac, or is on its way there
  | 'running' // a turn, background task or a run switch holds it
  | 'setup' // its worktree is being made, or failed
  | 'queued' // messages wait to run in it
  | 'limit' // a Limit stop is scheduled to resume
  | 'children' // a thread it delegated is still running and reports back
  | 'terminal' // its Terminal tab has a shell open: closing it (DELETE /api/threads/:id/terminal) clears this
  | 'empty' // nothing ran in it yet
  | 'checkout'; // its worktree is missing or not its own

export interface ContinueBlock {
  code: ContinueBlockCode;
  message: string;
}

/** One transcript entry as the Carryover gives it. `id` is the entry's last event, for retrieval references. */
export interface CarryoverEntry {
  id: number;
  who: 'user' | 'agent' | 'tool' | 'report' | 'omni' | 'error';
  text: string;
  /** Older entries are cut to their first line to fit the budget. */
  condensed: boolean;
}

export interface CarryoverFile {
  path: string;
  old_path: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type';
}

/** The source's checkout as the continued thread starts from it. */
export interface CarryoverFiles {
  /** The commit the source's changes count from, when it has one recorded. */
  base: string | null;
  /** The source's HEAD: the new branch starts here. */
  head: string;
  /** The snapshot's tree: HEAD plus every tracked change and untracked text file git does not ignore. */
  tree: string;
  /** Files that differ from `base` (or `head`), as many as the Carryover lists. */
  listed: CarryoverFile[];
  total: number;
}

/** A check the source ran (tests, lint, typecheck, build), newest last. */
export interface CarryoverCheck {
  id: number;
  command: string;
  ok: boolean;
  /** The end of its output. */
  output: string;
}

/** Something the Carryover left out, and where to read it when there is a place. */
export interface CarryoverOmission {
  what: 'history' | 'files' | 'untracked' | 'uncommitted' | 'messages' | 'attachments' | 'checks';
  count: number;
  note: string;
  /** A retrieval reference: an API path or a git command the new session can run. */
  ref: string | null;
}

/** Whether a file Ben attached in the source can go to the new thread. `missing`: its bytes are not on this Mac. */
export type AttachmentAvailability = 'available' | 'missing' | 'oversize' | 'unsupported';

/** A file Ben attached in the source, as the sheet lists it: what it is, whether its bytes can be copied, and whether he picked it. */
export interface CarryoverAttachment {
  /** The attachment's message (its event uid) and its place in it. The start names the files Ben picked by this. */
  id: string;
  name: string;
  event_id: number;
  mime: string;
  /** Bytes on this Mac when the file is there, else the size recorded when it was attached, else null. */
  size: number | null;
  image: boolean;
  availability: AttachmentAvailability;
  /** Why it cannot be carried, or null when it can. */
  reason: string | null;
  selected: boolean;
  /** Picked and available: its bytes are copied into the new thread's own uploads folder. */
  carried: boolean;
  /** How the picked harness reads it once copied: `inline` is an image in the message, `path` a note naming the file. Null when it cannot be copied. */
  as: 'inline' | 'path' | null;
}

export interface Carryover {
  source: { id: string; title: string; channel: string; run: RunName };
  to: RunName;
  /** The source's first message: what the task is. */
  goal: string;
  /** Standing facts the new session works under. */
  constraints: string[];
  /** Null when the source does no repo work. */
  files: CarryoverFiles | null;
  checks: CarryoverCheck[];
  /** History kept, oldest first. */
  recent: CarryoverEntry[];
  attachments: CarryoverAttachment[];
  omitted: CarryoverOmission[];
  budget: number;
  chars: number;
  /** Exactly what the new session reads ahead of Ben's message. */
  text: string;
}

/** POST /api/threads/:id/continue/preview. `revision` goes back with the start, which refuses it once stale. */
export interface ContinuePreview {
  carryover: Carryover;
  revision: string;
  /** `worktree`: a new worktree and branch from a snapshot of the source. `folder`: the channel's folder, as any new thread. */
  workspace: 'worktree' | 'folder';
  blocked: ContinueBlock | null;
}

/** POST /api/threads/:id/continue. */
export interface ContinueBody {
  harness: string;
  model: string;
  effort: string;
  /** The ids of the source's attachments Ben picked (`CarryoverAttachment.id`). None by default. */
  attachments?: string[];
  text: string;
  /** The client's id for this start, kept across retries: a retry gets the same thread back. */
  request_id: string;
  revision: string;
}

/** What the Carryover gave the new session, from the continued thread's `carryover` event. */
export interface CarriedStats {
  entries: number;
  condensed: number;
  omitted: number;
  chars: number;
  budget: number;
  files: number;
  /** Attachments copied into the new thread. Absent on a thread continued before attachments could be carried. */
  attachments?: number;
}

/** One end of a continuation link, as GET /api/threads/:id shows it (`continued_from`, `continued_in`). */
export interface ContinueLink {
  id: string;
  title: string;
  harness: string;
  model: string | null;
  status: string;
  created_at: string;
  carried: CarriedStats | null;
}

/** Why a harness cannot take a continued thread, or null when it can. */
export function continueRefusal(harness: string): string | null {
  if (harness === 'hermes') return "Hermes runs on its own server, so this thread's files cannot move there.";
  if (harness === 'cursor-cloud') return "Cursor Cloud works on its own clone of the repo, so it cannot start from this thread's checkout.";
  return null;
}

/** Why a thread on this harness cannot be continued, or null when it can. */
export function continueSourceRefusal(harness: string): string | null {
  if (harness === 'hermes') return 'This thread runs on the Hermes server, so its files are not on this Mac to continue from.';
  if (harness === 'cursor-cloud') return "This thread runs on Cursor's machines, so its files are not on this Mac to continue from.";
  return null;
}

/** Under the message box when it starts with a slash command, which runs first, as with a run switch's handover. */
export const CONTINUE_SLASH_HINT = 'A slash command runs first. The carryover goes with your next message.';

const kilo = (n: number) => (n < 1000 ? String(n) : `${Math.round(n / 100) / 10}k`);

/** "12.3k of 24k characters": how much of its budget a Carryover takes. */
export const carryoverSize = (c: { chars: number; budget: number }) => `${kilo(c.chars)} of ${kilo(c.budget)} characters`;

/**
 * A history entry as a preview row shows it, beside a label naming who it is from: without the speaker tag the
 * Carryover text gives it, and a tool call without its list dash. A crew report and an earlier Carryover keep theirs,
 * which say more than the label.
 */
export function entryText(e: Pick<CarryoverEntry, 'who' | 'text'>): string {
  if (e.who === 'tool') return e.text.replace(/^\s*- /, '').replace(/\n {4}/g, '\n');
  if (e.who === 'report' || (e.who === 'omni' && !e.text.startsWith('[Omni] '))) return e.text;
  return e.text.replace(/^\[[^\]\n]*\] /, '');
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The line under a "Continued from" link. */
export function carriedText(c: CarriedStats): string {
  const condensed = c.condensed ? ` (${c.condensed} shortened)` : '';
  const left = c.omitted ? `, ${c.omitted} older left out` : '';
  const files = c.files ? `, ${count(c.files, 'changed file', 'changed files')}` : '';
  const attached = c.attachments ? `, ${count(c.attachments, 'attachment', 'attachments')}` : '';
  return `Carried ${count(c.entries, 'entry', 'entries')}${condensed}${left}${files}${attached}.`;
}
