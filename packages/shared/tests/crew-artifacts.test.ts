import { describe, expect, it } from 'vitest';
import { CREW_ARTIFACTS_MAX, crewFrom, crewShown, isCrewArtifact, newestList, phoneArtifacts, withCrewArtifact, type CrewArtifactRow } from '../crew-artifacts.ts';

const row = (id: number, over: Partial<CrewArtifactRow> = {}): CrewArtifactRow => ({
  id,
  thread_id: 'child',
  kind: 'html',
  url: null,
  updated_at: `2026-11-04T10:00:${String(id % 60).padStart(2, '0')}.000Z`,
  ...over,
});

describe('crewShown', () => {
  it('splits files from screenshots, newest first', () => {
    const { files, shots } = crewShown([], [row(1), row(2, { kind: 'screenshot' }), row(3, { kind: 'markdown' }), row(4, { kind: 'screenshot' })]);
    expect(files.map((a) => a.id)).toEqual([3, 1]);
    expect(shots.map((a) => a.id)).toEqual([4, 2]);
  });

  it('leaves out what the thread lists itself, by row or by published page', () => {
    const own = [{ id: 1, url: null }, { id: 9, url: 'https://claude.ai/artifact/a' }];
    const { files } = crewShown(own, [row(1), row(2, { url: 'https://claude.ai/artifact/a' }), row(3)]);
    expect(files.map((a) => a.id)).toEqual([3]);
  });

  it('shows a page two delegated threads published once, under the newer', () => {
    const url = 'https://claude.ai/artifact/b';
    const { files } = crewShown([], [row(1, { url, thread_id: 'lead' }), row(5, { url, thread_id: 'member' })]);
    expect(files.map((a) => [a.id, a.thread_id])).toEqual([[5, 'member']]);
  });
});

describe('withCrewArtifact', () => {
  it('adds a new one at the top and replaces an updated one in place', () => {
    let list = withCrewArtifact([], row(1));
    list = withCrewArtifact(list, row(2));
    expect(list.map((a) => a.id)).toEqual([2, 1]);
    list = withCrewArtifact(list, row(1, { updated_at: '2026-11-04T11:00:00.000Z', url: 'https://claude.ai/artifact/c' }));
    expect(list.map((a) => [a.id, a.url])).toEqual([
      [1, 'https://claude.ai/artifact/c'],
      [2, null],
    ]);
  });

  it('keeps the newest CREW_ARTIFACTS_MAX', () => {
    let list: CrewArtifactRow[] = [];
    for (let i = 1; i <= CREW_ARTIFACTS_MAX + 5; i++) list = withCrewArtifact(list, row(i, { updated_at: new Date(Date.UTC(2026, 10, 4, 0, 0, i)).toISOString() }));
    expect(list).toHaveLength(CREW_ARTIFACTS_MAX);
    expect(list[0].id).toBe(CREW_ARTIFACTS_MAX + 5);
    expect(list.some((a) => a.id <= 5)).toBe(false);
  });
});

describe('phoneArtifacts', () => {
  const at = (id: number, updated_at: string, over: Partial<CrewArtifactRow> = {}): CrewArtifactRow => row(id, { updated_at, ...over });

  it('lists the thread\'s own files and screenshots newest first', () => {
    const list = phoneArtifacts([at(1, '2026-11-20T10:00:00Z', { thread_id: 'p' }), at(2, '2026-11-20T12:00:00Z', { thread_id: 'p', kind: 'screenshot' }), at(3, '2026-11-20T11:00:00Z', { thread_id: 'p' })], []);
    expect(list.own.map((a) => a.id)).toEqual([2, 3, 1]);
    expect(list.crew).toEqual([]);
  });

  it('lists the crew\'s files and screenshots together, newest first, less what the thread lists itself', () => {
    const list = phoneArtifacts(
      [at(1, '2026-11-20T10:00:00Z', { thread_id: 'p', url: 'https://claude.ai/artifact/x' })],
      [
        at(1, '2026-11-20T10:00:00Z'),
        at(4, '2026-11-20T09:00:00Z', { kind: 'screenshot' }),
        at(5, '2026-11-20T13:00:00Z'),
        at(6, '2026-11-20T14:00:00Z', { url: 'https://claude.ai/artifact/x' }),
      ],
    );
    expect(list.own.map((a) => a.id)).toEqual([1]);
    expect(list.crew.map((a) => a.id)).toEqual([5, 4]);
  });

  it('is empty for a thread with nothing', () => {
    expect(phoneArtifacts([], [])).toEqual({ own: [], crew: [] });
  });

  it('puts lists together newest first, the later row first at the same time', () => {
    expect(newestList([row(1), row(3)], [row(2)]).map((a) => a.id)).toEqual([3, 2, 1]);
    expect(newestList([at(1, '2026-11-20T10:00:00Z'), at(2, '2026-11-20T10:00:00Z')]).map((a) => a.id)).toEqual([2, 1]);
  });
});

describe('crew artifact rows', () => {
  it('names the thread a crew artifact came from', () => {
    expect([crewFrom({ thread_title: 'Fix checkout' }), crewFrom({ thread_title: '' }), crewFrom({})]).toEqual(['Fix checkout', 'Untitled', 'Untitled']);
  });

  it('takes a crew artifact off the stream only with the fields the merge reads', () => {
    expect(isCrewArtifact(row(1))).toBe(true);
    for (const v of [null, [], { id: '1', thread_id: 'c', updated_at: 'x' }, { id: 1, updated_at: 'x' }, { id: 1, thread_id: 'c' }]) expect(isCrewArtifact(v)).toBe(false);
  });
});
