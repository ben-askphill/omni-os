import type { ChangeFileView, ChangeGroupView } from '@omni/shared/changes-view.ts';
import { MAX_LINES, startsOpen, type DiffLine } from '@omni/shared/diff.ts';
import type { LinePick } from '@omni/shared/diff-pick.ts';
import { clampToHunk } from '@omni/shared/message-context-diff.ts';

export type ChangeRow =
  | { type: 'group'; id: string; title: string; count: number }
  | { type: 'truncated'; id: string }
  | { type: 'file'; id: string; file: ChangeFileView; open: boolean }
  | { type: 'line'; id: string; fileKey: string; index: number; line: DiffLine; width: number }
  | { type: 'note'; id: string; text: string }
  | { type: 'more'; id: string; fileKey: string; hidden: number };

export interface RowsState {
  open: Readonly<Record<string, boolean>>;
  all: Readonly<Record<string, boolean>>;
}

export const FRESH_ROWS: RowsState = { open: {}, all: {} };

export const isOpen = (state: RowsState, f: ChangeFileView, total: number) => state.open[f.key] ?? startsOpen(f.diff, total);

export function toggleFile(state: RowsState, f: ChangeFileView, total: number): RowsState {
  return { ...state, open: { ...state.open, [f.key]: !isOpen(state, f, total) } };
}

export function showAll(state: RowsState, fileKey: string): RowsState {
  return { ...state, all: { ...state.all, [fileKey]: true } };
}

const numberWidth = (lines: readonly DiffLine[]) => {
  let top = 0;
  for (const l of lines) top = Math.max(top, l.old ?? 0, l.new ?? 0);
  return Math.max(String(top).length, 1);
};

export function changeRows(groups: readonly ChangeGroupView[], total: number, state: RowsState): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (const g of groups) {
    rows.push({ type: 'group', id: `group:${g.kind}`, title: g.title, count: g.files.length });
    for (const f of g.files) {
      const open = isOpen(state, f, total);
      rows.push({ type: 'file', id: `file:${f.key}`, file: f, open });
      if (!open) continue;
      const lines = f.diff.lines;
      if (!lines.length) {
        rows.push({ type: 'note', id: `note:${f.key}`, text: f.notice ?? (f.diff.binary ? 'Binary file, not shown.' : 'No changed lines to show.') });
        continue;
      }
      const shown = state.all[f.key] ? lines.length : Math.min(lines.length, MAX_LINES);
      const width = numberWidth(lines);
      for (let i = 0; i < shown; i++) rows.push({ type: 'line', id: `line:${f.key}:${i}`, fileKey: f.key, index: i, line: lines[i], width });
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
