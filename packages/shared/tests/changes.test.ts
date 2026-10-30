import { describe, expect, it } from 'vitest';
import { changesProblems, turnChangesProblems } from '../changes.ts';

const file = { path: 'a.ts', old_path: null, status: 'modified', additions: 1, deletions: 0, binary: false, omitted: null, diff: '' };
const changes = {
  available: true,
  cwd: '/x',
  branch: 'omni/1',
  head: 'abc',
  base: { sha: 'def', ref: 'main', how: 'thread-start', recorded_at: '2026-01-01T00:00:00Z' },
  groups: [{ kind: 'committed', files: [file], truncated: false }],
};

describe('changes contract', () => {
  it('takes both forms of BranchChanges', () => {
    expect(changesProblems(changes)).toEqual([]);
    expect(changesProblems({ available: false, reason: 'no repo' })).toEqual([]);
  });

  it('names a missing key, an unknown key and a value outside its list', () => {
    const { diff: _, ...noDiff } = file;
    const bad = { ...changes, extra: 1, groups: [{ kind: 'moved', files: [{ ...noDiff, status: 'gone' }], truncated: false }] };
    expect(changesProblems(bad)).toEqual([
      '$.groups[0].kind: expected one of committed, staged, unstaged, untracked, turn',
      '$.groups[0].files[0].status: expected one of added, modified, deleted, renamed, copied, type_changed, unmerged',
      '$.groups[0].files[0].diff: missing',
      '$.extra: not in @omni/shared/changes.ts',
    ]);
  });

  it('checks a turns answer', () => {
    expect(turnChangesProblems({ available: false, reason: 'no worktree', turns: [], turn: null, groups: [] })).toEqual([]);
    expect(turnChangesProblems({ available: true, reason: null, turns: [{ id: 't' }], turn: null, groups: [] })[0]).toBe('$.turns[0].n: missing');
  });
});
