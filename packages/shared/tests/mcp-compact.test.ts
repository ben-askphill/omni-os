import { describe, expect, it } from 'vitest';
import { compactJson, compactRow, compactRows } from '../mcp-compact.ts';

describe('compactRow', () => {
  it('drops undefined, null, false and empty arrays while keeping meaningful values', () => {
    const input = {
      id: 'ch-1',
      name: 'Inbox',
      count: 0,
      emptyStr: '',
      active: true,
      tags: ['a'],
      nested: {},
      missing: undefined,
      repo: null,
      delegating: false,
      folders: [],
    };
    expect(compactRow(input)).toEqual({
      id: 'ch-1',
      name: 'Inbox',
      count: 0,
      emptyStr: '',
      active: true,
      tags: ['a'],
      nested: {},
    });
    // Does not mutate the source object.
    expect(input).toHaveProperty('repo', null);
    expect(input).toHaveProperty('delegating', false);
    expect(input).toHaveProperty('folders', []);
  });

  it('keeps fields named in keep even when null, false or empty array, while still dropping undefined', () => {
    const row = { id: 'auto-1', enabled: false, channel: null, items: [], omitted: undefined, note: null, hidden: false, empty: [] };
    expect(compactRow(row, ['enabled', 'channel', 'items', 'omitted'])).toEqual({
      id: 'auto-1',
      enabled: false,
      channel: null,
      items: [],
    });
    expect(compactRow(row, new Set(['enabled', 'channel']))).toEqual({
      id: 'auto-1',
      enabled: false,
      channel: null,
    });
  });
});

describe('compactRows', () => {
  it('compacts every row in a list with the same keep set', () => {
    const rows = [
      { id: 'a', enabled: true, error: null, runs: [] },
      { id: 'b', enabled: false, error: 'boom', runs: ['r1'] },
    ];
    expect(compactRows(rows, ['enabled'])).toEqual([
      { id: 'a', enabled: true },
      { id: 'b', enabled: false, error: 'boom', runs: ['r1'] },
    ]);
  });
});

describe('compactJson', () => {
  it('passes strings through and serializes values without pretty-print whitespace', () => {
    expect(compactJson('plain text')).toBe('plain text');
    expect(compactJson({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
  });
});
