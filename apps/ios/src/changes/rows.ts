import type { ChangeFileView, ChangeGroupView } from '@omni/shared/changes-view.ts';
import { MAX_LINES, startsOpen, type DiffLine } from '@omni/shared/diff.ts';
import type { LinePick } from '@omni/shared/diff-pick.ts';
import { clampToHunk } from '@omni/shared/message-context-diff.ts';
import { placeNotes, type NotePlace, type ReviewNote } from '@omni/shared/review-notes.ts';

export type ChangeRow =
  | { type: 'group'; id: string; title: string; count: number }
  | { type: 'truncated'; id: string }
  | { type: 'file'; id: string; file: ChangeFileView; open: boolean }
  | { type: 'line'; id: string; fileKey: string; index: number; line: DiffLine; width: number; noted?: true }
  | { type: 'reviewNote'; id: string; note: ReviewNote; place: NotePlace }
  | { type: 'note'; id: string; text: string }
  | { type: 'more'; id: string; fileKey: string; hidden: number };

export interface RowsState {
  open: Readonly<Record<string, boolean>>;
  all: Readonly<Record<string, boolean>>;
}

export const FRESH_ROWS: RowsState = { open: {}, all: {} };

/** `noted`: a review note sits on the file, which then starts open. */
export const isOpen = (state: RowsState, f: ChangeFileView, total: number, noted = false) => state.open[f.key] ?? (startsOpen(f.diff, total) || noted);

export function toggleFile(state: RowsState, f: ChangeFileView, total: number, noted = false): RowsState {
  return { ...state, open: { ...state.open, [f.key]: !isOpen(state, f, total, noted) } };
}

export function showAll(state: RowsState, fileKey: string): RowsState {
  return { ...state, all: { ...state.all, [fileKey]: true } };
}

const numberWidth = (lines: readonly DiffLine[]) => {
  let top = 0;
  for (const l of lines) top = Math.max(top, l.old ?? 0, l.new ?? 0);
  return Math.max(String(top).length, 1);
};

/** Unresolved review notes on the files on screen, per file: the lines they mark and the notes under each note's last line. */
export interface FileNotes {
  marks: Set<number>;
  after: Map<number, { note: ReviewNote; place: NotePlace }[]>;
}

/** Places the unresolved notes on `groups` (packages/shared/review-notes.ts placeNote). A note missing from `placed` is outdated here. */
export function notesOnScreen(notes: readonly ReviewNote[], groups: readonly ChangeGroupView[]) {
  const live = notes.filter((n) => !n.resolved_at);
  const placed = placeNotes(live, groups.flatMap((g) => g.files.map((f) => ({ key: f.key, path: f.diff.path, old_path: f.file.old_path, lines: f.diff.lines }))));
  const byFile = new Map<string, FileNotes>();
  for (const n of live) {
    const p = placed.get(n.id);
    if (!p) continue;
    const f = byFile.get(p.file) ?? { marks: new Set<number>(), after: new Map() };
    for (let i = p.from; i <= p.to; i++) f.marks.add(i);
    f.after.set(p.to, [...(f.after.get(p.to) ?? []), { note: n, place: p }]);
    byFile.set(p.file, f);
  }
  return { placed, byFile };
}

/** The rows on screen. A file with notes on it starts open and shows every line, so no note is hidden. */
export function changeRows(groups: readonly ChangeGroupView[], total: number, state: RowsState, notes: ReadonlyMap<string, FileNotes> = new Map()): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (const g of groups) {
    rows.push({ type: 'group', id: `group:${g.kind}`, title: g.title, count: g.files.length });
    for (const f of g.files) {
      const fileNotes = notes.get(f.key);
      const open = isOpen(state, f, total, !!fileNotes);
      rows.push({ type: 'file', id: `file:${f.key}`, file: f, open });
      if (!open) continue;
      const lines = f.diff.lines;
      if (!lines.length) {
        rows.push({ type: 'note', id: `note:${f.key}`, text: f.notice ?? (f.diff.binary ? 'Binary file, not shown.' : 'No changed lines to show.') });
        continue;
      }
      const shown = state.all[f.key] || [...(fileNotes?.after.keys() ?? [])].some((i) => i >= MAX_LINES) ? lines.length : Math.min(lines.length, MAX_LINES);
      const width = numberWidth(lines);
      for (let i = 0; i < shown; i++) {
        rows.push({ type: 'line', id: `line:${f.key}:${i}`, fileKey: f.key, index: i, line: lines[i], width, ...(fileNotes?.marks.has(i) && { noted: true as const }) });
        for (const n of fileNotes?.after.get(i) ?? []) rows.push({ type: 'reviewNote', id: `review-note:${n.note.id}`, note: n.note, place: n.place });
      }
      if (shown < lines.length) rows.push({ type: 'more', id: `more:${f.key}`, fileKey: f.key, hidden: lines.length - shown });
    }
    if (g.truncated) rows.push({ type: 'truncated', id: `truncated:${g.kind}` });
  }
  return rows;
}

/** The lines the pick highlights in `fileKey`, held inside its hunk. Null when the pick is in another file. */
export function pickedRange(pick: LinePick | null, fileKey: string, lines: readonly DiffLine[]): { from: number; to: number } | null {
  if (pick?.file !== fileKey) return null;
  const c = clampToHunk(lines, pick.from, pick.to);
  return { from: Math.min(c.from, c.to), to: Math.max(c.from, c.to) };
}

export const pickable = (line: DiffLine) => line.kind !== 'hunk' && line.kind !== 'note';
