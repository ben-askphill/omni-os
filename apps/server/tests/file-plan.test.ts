// planFiles: what to do with each synced thread file (PRD #667, F1, F3, F2, F4). Pure: three views of each file in,
// actions out.
import { describe, expect, it } from 'vitest';
import { planFiles, type PlanInput } from '../sync/file-plan.ts';

const v = (sha: string) => ({ sha });
const plan = (p: Partial<PlanInput>) => planFiles({ local: {}, base: {}, remote: {}, deleted: {}, ...p });
const F = 'artifacts/report.html';

describe('planFiles', () => {
  const table: [string, Partial<PlanInput>, unknown][] = [
    ['new here: upload', { local: { [F]: v('a') } }, [{ kind: 'upload', rel: F }]],
    ['new there: download', { remote: { [F]: v('a') } }, [{ kind: 'download', rel: F, sha: 'a' }]],
    ['same on both, no base yet: agree', { local: { [F]: v('a') }, remote: { [F]: v('a') } }, [{ kind: 'agree', rel: F, sha: 'a' }]],
    ['in step: nothing', { local: { [F]: v('a') }, base: { [F]: v('a') }, remote: { [F]: v('a') } }, []],
    ['changed here only: upload', { local: { [F]: v('b') }, base: { [F]: v('a') }, remote: { [F]: v('a') } }, [{ kind: 'upload', rel: F }]],
    ['changed there only: download, the stale copy here never goes up (F1, F2)', { local: { [F]: v('a') }, base: { [F]: v('a') }, remote: { [F]: v('b') } }, [{ kind: 'download', rel: F, sha: 'b' }]],
    ['changed on both: conflict', { local: { [F]: v('b') }, base: { [F]: v('a') }, remote: { [F]: v('c') } }, [{ kind: 'conflict', rel: F, local: 'b', remote: 'c' }]],
    ['new on both with different content: conflict', { local: { [F]: v('b') }, remote: { [F]: v('c') } }, [{ kind: 'conflict', rel: F, local: 'b', remote: 'c' }]],
    ['changed on both to the same content: agree', { local: { [F]: v('b') }, base: { [F]: v('a') }, remote: { [F]: v('b') } }, [{ kind: 'agree', rel: F, sha: 'b' }]],
    ['deleted here, unchanged there: tombstone (F4)', { base: { [F]: v('a') }, remote: { [F]: v('a') } }, [{ kind: 'tombstone', rel: F, sha: 'a' }]],
    ['deleted there, unchanged here: delete here (F4)', { local: { [F]: v('a') }, base: { [F]: v('a') }, deleted: { [F]: v('a') } }, [{ kind: 'delete-local', rel: F }]],
    ['deleted here, edited there: the edit comes down', { base: { [F]: v('a') }, remote: { [F]: v('b') } }, [{ kind: 'download', rel: F, sha: 'b' }]],
    ['edited here, deleted there: the edit goes up', { local: { [F]: v('b') }, base: { [F]: v('a') }, deleted: { [F]: v('a') } }, [{ kind: 'upload', rel: F }]],
    ['deleted on both: forget the base', { base: { [F]: v('a') }, deleted: { [F]: v('a') } }, [{ kind: 'forget', rel: F }]],
    ['a tombstone for a file never here: nothing', { deleted: { [F]: v('a') } }, []],
    ['the relay lost a synced entry (F3): put it back', { local: { [F]: v('a') }, base: { [F]: v('a') } }, [{ kind: 'upload', rel: F }]],
  ];
  it.each(table)('%s', (_name, input, want) => expect(plan(input)).toEqual(want));

  it('plans every file, in path order', () => {
    const p = plan({ local: { 'uploads/b.png': v('1'), 'artifacts/a.md': v('2') }, remote: { 'browser/c.png': v('3') } });
    expect(p.map((a) => a.rel)).toEqual(['artifacts/a.md', 'browser/c.png', 'uploads/b.png']);
  });
});
