import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BranchChanges, TurnChanges, TurnView } from '../src/api.ts';
import { baseLabel, changesView, headMove, shortSha, turnChangesView, turnStateNote, turnTitle } from '../src/changes.ts';
import { parseDiff, startsOpen } from '../src/diff.ts';

// The Web UI's Changes panel model (apps/web/src/changes.ts, apps/web/src/diff.ts) on the recorded server answers the Mac app's
// Swift tests decode too (apps/server/tests/mac-fixtures.test.ts records them).

const FIXTURES = join(resolve(import.meta.dirname, '../..'), 'mac', 'OmniKit', 'Tests', 'OmniKitTests', 'Fixtures');
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

  it("shows a saved turn's files, the turns to pick from, and HEAD moving during it", () => {
    const answer = fixture<TurnChanges>('turns.json');
    const view = turnChangesView(answer)!;
    expect(answer.turns.map(turnTitle)).toEqual(['Turn 2', 'Turn 1']);
    expect(view.turn.id).toBe(answer.turns[0].id);
    expect(view.groups.map((g) => [g.title, g.files.map((f) => [f.file.status, f.label])])).toEqual([
      ['Changed in this turn', [['modified', 'src/cart.ts'], ['added', 'todo.md']]],
    ]);
    expect([view.files, view.additions, view.deletions]).toEqual([2, 2, 0]);
    expect(turnStateNote(view.turn)).toBeNull();
    expect(headMove(view.turn)).toBe('ccccccc → ccccccc');
    expect(headMove(answer.turns[1])).toBe('ccccccc → ccccccc');
  });

  it('says why a turn has no files yet, or none can be saved', () => {
    const turn = fixture<TurnChanges>('turns.json').turns[0];
    const as = (state: TurnView['state'], error: string | null = null) => turnStateNote({ ...turn, state, error });
    expect(as('running')).toBe('This turn is still running. Its changes show once it ends.');
    expect(as('capturing')).toBe('Saving the worktree after this turn.');
    expect(as('failed', 'Could not save the checkout after this turn: boom')).toBe('Could not save the checkout after this turn: boom');
    expect(headMove({ ...turn, after: { ...turn.after!, head: turn.before!.head } })).toBeNull();
    expect(turnChangesView(fixture<TurnChanges>('turns-unavailable.json'))).toBeNull();
  });
});
