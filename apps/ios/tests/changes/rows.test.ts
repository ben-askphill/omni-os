import type { BranchChanges, ChangedFile } from '@omni/shared/changes.ts';
import { changesView } from '@omni/shared/changes-view.ts';
import { MAX_LINES } from '@omni/shared/diff.ts';
import { holdPress, noPick } from '@omni/shared/diff-pick.ts';
import { describe, expect, it } from 'vitest';

import { changeRows, FRESH_ROWS, pickable, pickedRange, showAll, toggleFile } from '../../src/changes/rows';

const diffOf = (path: string, adds: number) =>
  [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`, `@@ -1,1 +1,${adds} @@`, ' keep', ...Array.from({ length: adds - 1 }, (_, i) => `+line ${i}`)].join('\n') + '\n';

const file = (path: string, adds: number, over: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  old_path: null,
  status: 'modified',
  additions: adds,
  deletions: 0,
  binary: false,
  omitted: null,
  diff: diffOf(path, adds),
  ...over,
});

function view(groups: { kind: 'committed' | 'unstaged'; files: ChangedFile[]; truncated?: boolean }[]) {
  const changes: BranchChanges = {
    available: true,
    cwd: '/w',
    branch: 'b',
    head: 'h',
    base: { sha: 's', ref: 'main', how: 'thread-start', recorded_at: '' },
    groups: groups.map((g) => ({ truncated: false, ...g })),
  };
  return changesView(changes)!;
}

describe('changeRows', () => {
  it('lists a group header, each file and its lines in order', () => {
    const v = view([{ kind: 'committed', files: [file('a.ts', 3)] }, { kind: 'unstaged', files: [file('b.ts', 2)] }]);
    const rows = changeRows(v.groups, v.files, FRESH_ROWS);
    expect(rows.map((r) => r.type)).toEqual(['group', 'file', ...Array(4).fill('line'), 'group', 'file', ...Array(3).fill('line')]);
    expect(rows[0]).toMatchObject({ title: 'Committed', count: 1 });
  });

  it('starts a long file closed in a big diff and opens it on a tap', () => {
    const many = Array.from({ length: 13 }, (_, i) => file(`f${i}.ts`, i === 0 ? 300 : 2));
    const v = view([{ kind: 'committed', files: many }]);
    const closed = changeRows(v.groups, v.files, FRESH_ROWS);
    expect(closed.find((r) => r.type === 'file' && r.file.file.path === 'f0.ts')).toMatchObject({ open: false });
    expect(closed.filter((r) => r.type === 'line').every((r) => r.type === 'line' && r.fileKey !== 'committed:f0.ts')).toBe(true);
    const opened = changeRows(v.groups, v.files, toggleFile(FRESH_ROWS, v.groups[0].files[0], v.files));
    expect(opened.filter((r) => r.type === 'line' && r.fileKey === 'committed:f0.ts').length).toBeGreaterThan(0);
  });

  it('collapses an open file by tap, and the rows leave the list', () => {
    const v = view([{ kind: 'committed', files: [file('a.ts', 5)] }]);
    const f = v.groups[0].files[0];
    const rows = changeRows(v.groups, v.files, toggleFile(FRESH_ROWS, f, v.files));
    expect(rows.map((r) => r.type)).toEqual(['group', 'file']);
  });

  it('cuts a file at the line cap and shows the rest on request', () => {
    const v = view([{ kind: 'committed', files: [file('big.ts', MAX_LINES + 500)] }]);
    const f = v.groups[0].files[0];
    const capped = changeRows(v.groups, 1, FRESH_ROWS);
    expect(capped.filter((r) => r.type === 'line')).toHaveLength(MAX_LINES);
    const more = capped.at(-1);
    expect(more).toMatchObject({ type: 'more', hidden: f.diff.lines.length - MAX_LINES });
    const full = changeRows(v.groups, 1, showAll(FRESH_ROWS, f.key));
    expect(full.filter((r) => r.type === 'line')).toHaveLength(f.diff.lines.length);
    expect(full.some((r) => r.type === 'more')).toBe(false);
  });

  it('says why a file has no lines', () => {
    const v = view([{ kind: 'committed', files: [file('logo.png', 0, { binary: true, omitted: 'binary', diff: '', additions: null, deletions: null }), file('empty.txt', 0, { diff: '' })] }]);
    const notes = changeRows(v.groups, v.files, FRESH_ROWS).filter((r) => r.type === 'note');
    expect(notes.map((n) => n.type === 'note' && n.text)).toEqual(['Binary file, not shown.', 'No changed lines to show.']);
  });

  it('keeps ids unique, since the list keys rows by them', () => {
    const v = view([{ kind: 'committed', files: [file('a.ts', 4)] }, { kind: 'unstaged', files: [file('a.ts', 4)] }]);
    const ids = changeRows(v.groups, v.files, FRESH_ROWS).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('flags a group with more files than listed', () => {
    const v = view([{ kind: 'committed', files: [file('a.ts', 2)], truncated: true }]);
    expect(changeRows(v.groups, v.files, FRESH_ROWS).at(-1)).toMatchObject({ type: 'truncated' });
  });
});

describe('picking lines', () => {
  const v = view([{ kind: 'committed', files: [file('a.ts', 6)] }]);
  const f = v.groups[0].files[0];

  it('starts a pick on a tap, extends it on the next tap in the hunk, and clears on a tap of the only line', () => {
    let held = holdPress(noPick('base'), 'base', f, 2, true);
    expect(pickedRange(held.pick, f.key, f.diff.lines)).toEqual({ from: 2, to: 2 });
    held = holdPress(held, 'base', f, 4, true);
    expect(pickedRange(held.pick, f.key, f.diff.lines)).toEqual({ from: 2, to: 4 });
    held = holdPress(noPick('base'), 'base', f, 3, true);
    held = holdPress(held, 'base', f, 3, true);
    expect(held.pick).toBeNull();
  });

  it('drops the pick when the scope changes', () => {
    const held = holdPress(noPick('base'), 'base', f, 2, true);
    expect(holdPress(held, 'turn-1', f, 3, true).pick).toEqual({ file: f.key, from: 3, to: 3 });
  });

  it('highlights nothing in another file, and orders a backwards pick', () => {
    const held = holdPress(holdPress(noPick('base'), 'base', f, 4, true), 'base', f, 2, true);
    expect(pickedRange(held.pick, 'other', f.diff.lines)).toBeNull();
    expect(pickedRange(held.pick, f.key, f.diff.lines)).toEqual({ from: 2, to: 4 });
  });

  it('does not offer the hunk header', () => {
    expect(pickable(f.diff.lines[0])).toBe(false);
    expect(pickable(f.diff.lines[1])).toBe(true);
  });
});
