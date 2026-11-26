import { describe, expect, it } from 'vitest';
import { compactRow, compactRows, text } from '../compact.ts';

describe('text()', () => {
  it('serializes objects and arrays as compact JSON with no pretty-print whitespace', () => {
    const out = text({ id: 'omni-os', items: [{ a: 1, b: 'two' }] });
    expect(out).toEqual({
      content: [{ type: 'text', text: '{"id":"omni-os","items":[{"a":1,"b":"two"}]}' }],
    });
    expect(out.content[0].text).not.toContain('\n');
  });

  it('passes plain strings through unchanged', () => {
    expect(text('plain text')).toEqual({
      content: [{ type: 'text', text: 'plain text' }],
    });
  });
});

describe('compactRow()', () => {
  it('drops null, false, undefined and empty-array keys while keeping 0, empty string, true and non-empty values', () => {
    const input = {
      id: 'c1',
      name: 'Acme',
      running: 0,
      snippet: '',
      active: true,
      store: null,
      repo: null,
      delegating: false,
      hidden: false,
      folders: [],
      tags: ['bug'],
      missing: undefined,
      meta: { connected: false },
    };
    const out = compactRow(input);
    expect(out).toEqual({
      id: 'c1',
      name: 'Acme',
      running: 0,
      snippet: '',
      active: true,
      tags: ['bug'],
      meta: { connected: false },
    });
    // Does not mutate input.
    expect(input.store).toBeNull();
    expect(input.delegating).toBe(false);
    expect(input.folders).toEqual([]);
  });

  it('keeps keys listed in keep even when their value is false, null or an empty array', () => {
    const out = compactRow(
      { id: 'pr-fix', enabled: false, available: false, channel: null, error: null, last_runs: [], kept_empty: [] },
      ['enabled', 'available', 'channel', 'kept_empty'],
    );
    expect(out).toEqual({
      id: 'pr-fix',
      enabled: false,
      available: false,
      channel: null,
      kept_empty: [],
    });
  });
});

describe('compactRows()', () => {
  it('compacts every row in a list with the same keep list', () => {
    const rows = [
      { id: 'a', enabled: true, next: null, last_runs: [] },
      { id: 'b', enabled: false, next: '2026-11-27T08:00:00Z', last_runs: [{ id: 1 }] },
    ];
    expect(compactRows(rows, ['enabled'])).toEqual([
      { id: 'a', enabled: true },
      { id: 'b', enabled: false, next: '2026-11-27T08:00:00Z', last_runs: [{ id: 1 }] },
    ]);
  });
});
