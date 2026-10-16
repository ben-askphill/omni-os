import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BranchChanges } from '../web/src/api.ts';
import { baseLabel, changesView, shortSha } from '../web/src/changes.ts';
import { parseDiff, startsOpen } from '../web/src/diff.ts';

// The Web UI's Changes panel model (web/src/changes.ts, web/src/diff.ts) on the recorded server answers the Mac app's
// Swift tests decode too (tests/mac-fixtures.test.ts records them).

const FIXTURES = join(resolve(import.meta.dirname, '..'), 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');
const fixture = <T>(name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;

describe('changes panel', () => {
  it('groups the recorded changes with counts, labels and notices', () => {
    const view = changesView(fixture<BranchChanges>('changes.json'))!;
    expect(view.groups.map((g) => [g.title, g.files.map((f) => f.label)])).toEqual([
      ['Committed', ['README.md', 'legacy.txt', 'logo.png', 'src/cart.ts']],
      ['Staged', ['README.md → docs/README.md']],
      ['Unstaged', ['legacy.txt', 'src/cart.ts']],
      ['Untracked', ['notes.md']],
    ]);
    expect([view.files, view.additions, view.deletions]).toEqual([8, 7, 2]);
    const logo = view.groups[0].files[2];
    expect(logo).toMatchObject({ notice: 'Binary file, not shown.', diff: { binary: true, lines: [], add: 0, del: 0 } });
    expect(view.groups[1].files[0].diff.lines).toEqual([]);
    expect(`${shortSha(view.base.sha)}, ${baseLabel(view.base)}`).toBe('ccccccc, main when the thread started');
  });

  it('numbers each line in the old and the new file', () => {
    const view = changesView(fixture<BranchChanges>('changes.json'))!;
    const cart = view.groups[2].files[1].diff;
    expect(cart.lines.map((l) => [l.kind, l.old, l.new])).toEqual([
      ['hunk', null, null],
      ['context', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['context', 3, 3],
    ]);
    const gone = view.groups[2].files[0].diff;
    expect(gone.lines.map((l) => [l.kind, l.old, l.new])).toEqual([['hunk', null, null], ['del', 1, null]]);
  });

  it('has nothing to show when the server says why not', () => {
    expect(changesView(fixture<BranchChanges>('changes-unavailable.json'))).toBeNull();
  });

  it('keeps the PR diff rules: open rule, renames, notes and CRLF', () => {
    const [f] = parseDiff('diff --git a/a b/b\nsimilarity index 90%\nrename from a\nrename to b\n@@ -5,2 +5,2 @@\r\n x\r\n-y\r\n+z\r\n\\ No newline at end of file\n');
    expect(f.path).toBe('b');
    expect(f.lines.map((l) => [l.kind, l.text, l.old, l.new])).toEqual([
      ['hunk', '@@ -5,2 +5,2 @@\r', null, null],
      ['context', ' x\r', 5, 5],
      ['del', '-y\r', 6, null],
      ['add', '+z\r', null, 6],
      ['note', '\\ No newline at end of file', null, null],
    ]);
    expect(startsOpen({ ...f, add: 200, del: 0 }, 13)).toBe(false);
    expect(startsOpen({ ...f, add: 199, del: 0 }, 13)).toBe(true);
    expect(startsOpen({ ...f, add: 900 }, 12)).toBe(true);
  });
});
