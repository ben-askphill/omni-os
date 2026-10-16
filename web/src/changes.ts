// What a thread's Changes panel shows (components/thread/panel/ChangesTab.tsx), from GET /api/threads/:id/changes
// (Since base) and GET /api/threads/:id/turns (This turn). Pure, so tests run it on the recorded answers the Mac app
// decodes too (mac/OmniKit's Changes.swift is the same).
import type { BranchChanges, ChangeBase, ChangeGroup, ChangeKind, ChangedFile, DiffOmitted, TurnChanges, TurnView } from './api.ts';
import { parseDiff, type FileDiff } from './diff.ts';

export const GROUP_TITLE: Record<ChangeKind, string> = {
  committed: 'Committed',
  staged: 'Staged',
  unstaged: 'Unstaged',
  untracked: 'Untracked',
  turn: 'Changed in this turn',
};

const OMITTED: Record<DiffOmitted, string> = {
  binary: 'Binary file, not shown.',
  too_large: 'Too large to show here.',
  limit: 'Not shown: too much changed to show every file.',
  symlink: 'Symbolic link, not followed.',
  unavailable: 'Git gave no diff for this file.',
};

/** One letter per status, as git prints it. */
export const STATUS_LETTER: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  type_changed: 'T',
  unmerged: 'U',
};

export interface ChangeFileView {
  key: string;
  file: ChangedFile;
  /** The file's lines, numbered. Its counts are the server's, which also has them for files it sent no text for. */
  diff: FileDiff;
  /** `old → new` for a rename or copy, else the path. */
  label: string;
  notice: string | null;
}

export interface ChangeGroupView {
  kind: ChangeKind;
  title: string;
  files: ChangeFileView[];
  truncated: boolean;
}

export interface ChangesView {
  base: ChangeBase;
  branch: string | null;
  groups: ChangeGroupView[];
  files: number;
  additions: number;
  deletions: number;
}

export const shortSha = (sha: string) => sha.slice(0, 7);

/** Where the base came from, in words: "main when the thread started", "merge base with origin/main". */
export function baseLabel(base: ChangeBase) {
  if (base.how === 'thread-start') return base.ref === 'HEAD' ? 'where the thread started' : `${base.ref} when the thread started`;
  return base.ref === 'HEAD' ? 'the current commit' : `merge base with ${base.ref}`;
}

function fileView(kind: ChangeKind, f: ChangedFile): ChangeFileView {
  const parsed = f.diff ? parseDiff(f.diff)[0] : undefined;
  const diff: FileDiff = {
    path: f.path,
    header: parsed?.header ?? [],
    lines: parsed?.lines ?? [],
    add: f.additions ?? parsed?.add ?? 0,
    del: f.deletions ?? parsed?.del ?? 0,
    binary: f.binary,
  };
  return {
    key: `${kind}:${f.path}`,
    file: f,
    diff,
    label: f.old_path ? `${f.old_path} → ${f.path}` : f.path,
    notice: f.omitted ? OMITTED[f.omitted] : null,
  };
}

/** The groups that have files, in the server's order, and totals across them. */
function groupsView(list: ChangeGroup[]) {
  const groups = list
    .filter((g) => g.files.length)
    .map((g) => ({ kind: g.kind, title: GROUP_TITLE[g.kind], truncated: g.truncated, files: g.files.map((f) => fileView(g.kind, f)) }));
  const all = groups.flatMap((g) => g.files);
  return { groups, files: all.length, additions: all.reduce((n, f) => n + f.diff.add, 0), deletions: all.reduce((n, f) => n + f.diff.del, 0) };
}

/** Null when the answer has no changes to read. */
export function changesView(c: BranchChanges): ChangesView | null {
  if (!c.available) return null;
  return { base: c.base, branch: c.branch, ...groupsView(c.groups) };
}

// ---------- This turn ----------

/** What the This turn diff is, said where it is shown: a snapshot, not authorship. */
export const TURN_NOTE =
  'The worktree saved before and after this turn. Commits, pulls and other git operations made during the turn are part of it; ignored files are not saved.';

export interface TurnChangesView {
  turn: TurnView;
  groups: ChangeGroupView[];
  files: number;
  additions: number;
  deletions: number;
}

/** The turn shown and its files. Null when no turn is saved, or none can be here. */
export function turnChangesView(c: TurnChanges): TurnChangesView | null {
  if (!c.available || !c.turn) return null;
  return { turn: c.turn, ...groupsView(c.groups) };
}

/** Why a turn has no files to show yet, or ever. Null once both snapshots are saved. */
export function turnStateNote(t: TurnView): string | null {
  switch (t.state) {
    case 'running':
      return 'This turn is still running. Its changes show once it ends.';
    case 'capturing':
      return 'Saving the worktree after this turn.';
    case 'failed':
      return t.error ?? 'This turn could not be saved.';
    default:
      return null;
  }
}

/** HEAD moved during the turn (a commit, a pull, a reset): `abc1234 → def5678`. Null when it stayed put. */
export function headMove(t: TurnView): string | null {
  if (!t.before || !t.after || t.before.head === t.after.head) return null;
  return `${shortSha(t.before.head)} → ${shortSha(t.after.head)}`;
}

/** "Turn 3", the picker's label for a turn. */
export const turnTitle = (t: TurnView) => `Turn ${t.n}`;
