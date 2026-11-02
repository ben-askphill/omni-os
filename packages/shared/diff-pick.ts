// How a press on a diff line becomes a pick, for every client that lets lines be picked to send to the agent: the Web UI's
// Changes panel (apps/web/src/components/thread/panel/LineSelection.tsx) and the iOS Changes screen (apps/ios/src/changes).
import type { ChangeKind } from './changes.ts';
import type { ChangeFileView, ChangeGroupView } from './changes-view.ts';
import { clampToHunk, type DiffFileLike, type DiffLineLike } from './message-context-diff.ts';

/** Lines `from`..`to` of one file, as indexes into its lines. `to` may be above `from`. */
export interface LinePick {
  file: string;
  from: number;
  to: number;
}

/**
 * The pick after a press on line `i` of `file`. Extending moves `to`, within the hunk `from` is in; a press past
 * that hunk, in another file, or without `extend` starts a new pick. Pressing the only picked line clears it.
 */
export function pressLine(pick: LinePick | null, file: string, lines: readonly DiffLineLike[], i: number, extend: boolean): LinePick | null {
  const mine = pick?.file === file ? pick : null;
  if (mine && mine.from === i && mine.to === i) return null;
  if (extend && mine && clampToHunk(lines, mine.from, i).to === i) return { file, from: mine.from, to: i };
  return { file, from: i, to: i };
}

/** The picked file, ready for `selectRows`. */
export interface PickedLines {
  group: ChangeKind;
  file: DiffFileLike;
  from: number;
  to: number;
}

/**
 * The pick in the groups now on screen. `diff` is the picked file's diff text when it was picked. A reload that changed
 * it finds no match, since the pick's indexes would point at other lines.
 */
export function pickedLines(pick: LinePick | null, diff: string, groups: readonly ChangeGroupView[] | undefined): PickedLines | null {
  if (!pick) return null;
  for (const g of groups ?? []) {
    const f = g.files.find((x) => x.key === pick.file && x.file.diff === diff);
    if (f) return { group: g.kind, file: { path: f.diff.path, old_path: f.file.old_path, header: f.diff.header, lines: f.diff.lines }, from: pick.from, to: pick.to };
  }
  return null;
}

/**
 * A screen's pick. `scope` names what is on screen (a turn, or the whole branch): another scope has no pick. `diff` is the
 * picked file's diff text when it was picked, since a reload that changed it leaves the pick's indexes on other lines.
 */
export interface HeldPick {
  scope: string;
  pick: LinePick | null;
  diff: string;
}

export const noPick = (scope: string): HeldPick => ({ scope, pick: null, diff: '' });

export function holdPress(held: HeldPick, scope: string, f: Pick<ChangeFileView, 'key'> & { diff: Pick<ChangeFileView['diff'], 'lines'>; file: Pick<ChangeFileView['file'], 'diff'> }, i: number, extend: boolean): HeldPick {
  return { scope, pick: pressLine(held.scope === scope ? held.pick : null, f.key, f.diff.lines, i, extend), diff: f.file.diff };
}

export const heldPick = (held: HeldPick, scope: string): LinePick | null => (held.scope === scope ? held.pick : null);
