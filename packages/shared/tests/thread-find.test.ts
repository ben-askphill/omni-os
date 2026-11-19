import { describe, expect, it } from 'vitest';
import {
  FIND_CAP,
  findCount,
  findHits,
  findPattern,
  findTexts,
  likePattern,
  likeSafe,
  matchList,
  nearestMatch,
  rangesIn,
  stepMatch,
} from '../thread-find.ts';

const row = (id: number, kind: string, payload: unknown) => ({ id, kind, payload: JSON.stringify(payload) });

describe('findPattern', () => {
  it('matches case-insensitively and reads the query literally', () => {
    const re = findPattern('  a.b(c)  ')!;
    expect(rangesIn('A.B(C) and a.b(c), not axb(c)', re)).toEqual([
      [0, 6],
      [11, 17],
    ]);
    expect(rangesIn('Straße STRASSE', findPattern('straße')!)).toEqual([[0, 6]]);
    expect(rangesIn('ÄRGER ärger', findPattern('ärger')!)).toHaveLength(2);
  });

  it('finds nothing for a blank query', () => {
    expect(findPattern('   ')).toBeNull();
    expect(findHits([row(1, 'user', { text: 'anything' })], ' ')).toEqual({ hits: [], total: 0, capped: false });
  });

  it('counts every match in a message, without overlaps', () => {
    expect(rangesIn('aaaa', findPattern('aa')!)).toEqual([
      [0, 2],
      [2, 4],
    ]);
    const { hits, total } = findHits([row(5, 'assistant_text', { text: 'Deploy, deploy, DEPLOY.' })], 'deploy');
    expect(hits).toEqual([{ event: 5, count: 3 }]);
    expect(total).toBe(3);
  });
});

describe('findTexts', () => {
  it('reads what the transcript shows for each kind', () => {
    expect(findTexts('user', { text: 'hi', source: 'ben' })).toEqual(['hi']);
    expect(findTexts('crew_report', { title: 'Done', text: 'All green', thread_id: 't' })).toEqual(['Done', 'All green']);
    expect(findTexts('tool_use', { id: 'c1', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } })).toEqual(['npm test', 'Run tests']);
    expect(findTexts('tool_use', { id: 'c2', name: 'TodoWrite', input: { todos: [{ content: 'Ship it', status: 'pending' }] } })).toEqual(['Ship it', 'pending']);
    expect(findTexts('tool_result', { tool_use_id: 'c1', text: 'ok', is_error: false })).toEqual(['ok']);
    expect(findTexts('result', { ok: true })).toEqual([]);
    expect(findTexts('user', null)).toEqual([]);
  });

  it('matches values, not the keys of a call input', () => {
    expect(findHits([row(1, 'tool_use', { id: 'c', name: 'Grep', input: { pattern: 'needle' } })], 'pattern').total).toBe(0);
  });
});

describe('findHits', () => {
  it('lists events in id order and skips kinds a find does not read', () => {
    const rows = [row(1, 'user', { text: 'the albatross' }), row(2, 'status', { text: 'albatross' }), row(3, 'tool_result', { text: 'albatross albatross' }), row(4, 'init', { cwd: '/albatross' })];
    expect(findHits(rows, 'Albatross')).toEqual({
      hits: [
        { event: 1, count: 1 },
        { event: 3, count: 2 },
      ],
      total: 3,
      capped: false,
    });
  });

  it('stops at the cap and says so, keeping the matches that fit', () => {
    const rows = Array.from({ length: 4 }, (_, i) => row(i + 1, 'assistant_text', { text: 'x '.repeat(FIND_CAP / 2 - 1) }));
    const a = findHits(rows, 'x');
    expect(a.capped).toBe(true);
    expect(a.total).toBe(FIND_CAP);
    expect(a.hits.map((h) => h.count)).toEqual([FIND_CAP / 2 - 1, FIND_CAP / 2 - 1, 2]);
  });

  it('survives a payload that is not JSON', () => {
    expect(findHits([{ id: 1, kind: 'user', payload: '{nope' }], 'nope').total).toBe(0);
  });
});

describe('LIKE narrowing', () => {
  it('only narrows queries LIKE folds the way the pattern does', () => {
    expect(likeSafe('npm test')).toBe(true);
    expect(likeSafe('say "hi"')).toBe(false);
    expect(likeSafe('C:\\path')).toBe(false);
    expect(likeSafe('ärger')).toBe(false);
    expect(likeSafe('tab\there')).toBe(false);
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('stepping', () => {
  const matches = matchList([
    { event: 10, count: 2 },
    { event: 40, count: 1 },
  ]);

  it('flattens hits into matches, event by event', () => {
    expect(matches).toEqual([
      { event: 10, n: 0 },
      { event: 10, n: 1 },
      { event: 40, n: 0 },
    ]);
  });

  it('wraps at either end', () => {
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(-1, 3, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });

  it('starts at the first match from where Ben reads, else the newest', () => {
    expect(nearestMatch(matches, 5)).toBe(0);
    expect(nearestMatch(matches, 20)).toBe(2);
    expect(nearestMatch(matches, 99)).toBe(2);
    expect(nearestMatch(matches, null)).toBe(2);
    expect(nearestMatch([], 5)).toBe(-1);
  });

  it('counts for the bar', () => {
    expect(findCount(0, 3, false)).toBe('1 of 3');
    expect(findCount(4, FIND_CAP, true)).toBe(`5 of ${FIND_CAP}+`);
    expect(findCount(-1, 0, false)).toBe('No results');
  });
});
