// Review notes: what Ben writes about lines in a thread's Changes panel and keeps there, pinned to those lines, until
// he resolves or deletes it. The server stores them per thread (apps/server/db/repos/review-notes.ts) and syncs them;
// Send open notes puts every open one on one message, each as a diff_selection record with the note as its note, so
// the agent reads them as it reads lines Ben picked. Pure: the Web UI's Changes panel and the iOS Changes screen both
// place notes on the diff they show with `placeNote`.
import { CONTEXT_JSON_MAX, newContext, overLimit, type MessageContext, type Parsed } from './message-context.ts';
import { diffSelection, type DiffLineLike, type DiffRow, type DiffSelection } from './message-context-diff.ts';
import { parseContexts } from './message-context-kinds.ts';

export interface ReviewNote {
  id: string;
  thread_id: string;
  /**
   * The lines as Ben picked them: path, side, start..end, the rows he saw and where they came from (`source.from` is
   * the base commit for Since base, the snapshot before the turn for This turn). Never moved: placing is done on read.
   */
  anchor: DiffSelection;
  body: string;
  /** Resolved notes stay, collapsed, as history. */
  resolved_at: string | null;
  /** When Send open notes last carried it. Editing the body clears it, so the new words go with the next send. */
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /api/threads/:id/review-notes, oldest first. */
export interface ReviewNotesList {
  notes: ReviewNote[];
}

/** POST /api/threads/:id/review-notes/send. `target` is the thread it went to; `sent` the notes it carried. */
export interface ReviewNotesSent {
  target: string;
  sent: ReviewNote[];
}

export const NOTE_BODY_MAX = 4_000;
/** Notes one send may carry: more than a message Ben writes (CONTEXT_MAX), still within CONTEXT_JSON_MAX as JSON. */
export const SEND_NOTES_MAX = 40;
/** Notes a thread may keep, resolved ones included. */
export const THREAD_NOTES_MAX = 500;

export type NoteState = 'open' | 'sent' | 'resolved';

/** Open: not resolved and not sent since its last edit. Only open notes go with Send open notes. */
export const noteState = (n: Pick<ReviewNote, 'resolved_at' | 'sent_at'>): NoteState => (n.resolved_at ? 'resolved' : n.sent_at ? 'sent' : 'open');

export const openNotes = <N extends Pick<ReviewNote, 'resolved_at' | 'sent_at'>>(notes: readonly N[]): N[] => notes.filter((n) => noteState(n) === 'open');

/** A note's body as stored: trimmed, 1 to NOTE_BODY_MAX characters. */
export function parseNoteBody(v: unknown): Parsed<string> {
  const body = typeof v === 'string' ? v.trim() : '';
  if (!body) return { ok: false, error: 'Write the note first.' };
  if (overLimit(body, NOTE_BODY_MAX)) return { ok: false, error: `A note is at most ${NOTE_BODY_MAX} characters.` };
  return { ok: true, value: body };
}

/** The request body of POST /api/threads/:id/review-notes: the lines as a diff_selection body, and the note. */
export function parseNoteInput(raw: unknown): Parsed<{ anchor: DiffSelection; body: string }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not an object' };
  const r = raw as Record<string, unknown>;
  const anchor = diffSelection.parse(r.anchor, 1);
  if (!anchor.ok) return { ok: false, error: `anchor: ${anchor.error}` };
  const body = parseNoteBody(r.body);
  if (!body.ok) return body;
  return { ok: true, value: { anchor: anchor.value, body: body.value } };
}

/** "cart.ts:12-14", or with `(removed)` for removed lines. */
export const noteLabel = (n: Pick<ReviewNote, 'anchor'>) => diffSelection.label(n.anchor);

/** The message Send open notes posts: Ben's line, then one diff_selection record per note, the note as its note. */
export function sendRecords(notes: readonly Pick<ReviewNote, 'id' | 'anchor' | 'body'>[]): Parsed<{ prompt: string; context: MessageContext[] }> {
  if (!notes.length) return { ok: false, error: 'No open notes to send.' };
  if (notes.length > SEND_NOTES_MAX) return { ok: false, error: `One message carries at most ${SEND_NOTES_MAX} notes. Resolve or delete some, then send again.` };
  const raw = notes.map((n) => newContext(diffSelection, n.anchor, n.body, { id: () => n.id }));
  const checked = parseContexts(raw, { records: SEND_NOTES_MAX });
  if (!checked.ok) {
    if (JSON.stringify(raw).length > CONTEXT_JSON_MAX) return { ok: false, error: 'These notes quote too many lines for one message. Resolve or delete some, then send again.' };
    return checked;
  }
  const prompt = notes.length === 1 ? 'Address this review note on the diff.' : `Address these ${notes.length} review notes on the diff.`;
  return { ok: true, value: { prompt, context: checked.value } };
}

// ---------- placing a note on the diff on screen ----------

/** One file on screen, as the Changes panel has it: its key, paths and numbered lines. */
export interface PlaceFile {
  key: string;
  path: string;
  old_path: string | null;
  lines: readonly DiffLineLike[];
}

/**
 * Where a note sits in the diff on screen: indexes into one file's lines. `moved` when they are not where Ben picked
 * them (other numbers, or the file was renamed).
 */
export interface NotePlace {
  file: string;
  from: number;
  to: number;
  moved: boolean;
}

const rowText = (l: DiffLineLike) => l.text.slice(1).replace(/\r$/, '');
/** The same text, on the same side: a row in the new file matches an added or context line, a removed row a removed or context line. */
const same = (r: DiffRow, l: DiffLineLike) =>
  (r.new !== null ? l.new !== null : l.old !== null) && l.kind !== 'hunk' && l.kind !== 'note' && (r.cut ? rowText(l).startsWith(r.text) : rowText(l) === r.text);

/**
 * The note's lines in `files`: the run of lines whose text is the rows' text, in order, on the same side and within one
 * hunk, nearest the line number Ben picked them at. A file at the note's path is tried first, then one renamed to or
 * from it. Null when no file on screen has them: the lines changed, or the file is not in this diff. Added and context
 * lines are alike, so lines added since base still place on This turn, where they may show as context.
 */
export function placeNote(anchor: DiffSelection, files: readonly PlaceFile[]): NotePlace | null {
  const rows = anchor.rows;
  const candidates = [
    ...files.filter((f) => f.path === anchor.path),
    ...files.filter((f) => f.path !== anchor.path && (f.old_path === anchor.path || (anchor.old_path !== null && f.path === anchor.old_path))),
  ];
  for (const f of candidates) {
    let best: { i: number; d: number } | null = null;
    for (let i = 0; i + rows.length <= f.lines.length; i++) {
      if (!rows.every((r, k) => same(r, f.lines[i + k]))) continue;
      const first = f.lines[i];
      const n = (anchor.side === 'new' ? (first.new ?? first.old) : (first.old ?? first.new)) ?? 0;
      // The first row's own number on its side: a run that starts with a removed line before added ones is compared fairly.
      const want = anchor.side === 'new' ? (rows[0].new ?? rows[0].old ?? anchor.start) : (rows[0].old ?? anchor.start);
      const d = Math.abs(n - want);
      if (!best || d < best.d) best = { i, d };
      if (d === 0) break;
    }
    if (best) return { file: f.key, from: best.i, to: best.i + rows.length - 1, moved: best.d !== 0 || f.path !== anchor.path };
  }
  return null;
}

/** Every note placed on `files`, by id. A note missing here is outdated in this view. */
export function placeNotes(notes: readonly Pick<ReviewNote, 'id' | 'anchor'>[], files: readonly PlaceFile[]): Map<string, NotePlace> {
  const out = new Map<string, NotePlace>();
  for (const n of notes) {
    const p = placeNote(n.anchor, files);
    if (p) out.set(n.id, p);
  }
  return out;
}

// ---------- the wire ----------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isTime = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** What is wrong with a note as the server sent it; empty when nothing. The wire fixtures are checked with it. */
export function reviewNoteProblems(raw: unknown): string[] {
  if (!isObj(raw)) return ['not an object'];
  const out: string[] = [];
  if (typeof raw.id !== 'string' || !raw.id) out.push('id must be a string');
  if (typeof raw.thread_id !== 'string' || !raw.thread_id) out.push('thread_id must be a string');
  const anchor = diffSelection.parse(raw.anchor, 1);
  if (!anchor.ok) out.push(`anchor: ${anchor.error}`);
  if (!parseNoteBody(raw.body).ok) out.push('body must be a note');
  for (const k of ['resolved_at', 'sent_at'] as const) if (raw[k] !== null && !isTime(raw[k])) out.push(`${k} must be a time or null`);
  for (const k of ['created_at', 'updated_at'] as const) if (!isTime(raw[k])) out.push(`${k} must be a time`);
  return out;
}
