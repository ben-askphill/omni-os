import { describe, expect, it } from 'vitest';
import { ARTIFACT_FILTERS, matchesArtifactFilter, parseCsv } from '../artifacts.ts';

describe('artifact filters', () => {
  it('puts each kind under one type filter and every kind under All', () => {
    const kinds = ['html', 'svg', 'image', 'markdown', 'pdf', 'text', 'csv', 'json'];
    for (const kind of kinds) {
      const hits = ARTIFACT_FILTERS.filter((f) => f.id !== 'all' && matchesArtifactFilter(f.id, kind));
      expect(hits, kind).toHaveLength(1);
      expect(matchesArtifactFilter('all', kind)).toBe(true);
    }
    expect(matchesArtifactFilter('html', 'svg')).toBe(true);
    expect(matchesArtifactFilter('doc', 'pdf')).toBe(true);
    expect(matchesArtifactFilter('data', 'json')).toBe(true);
  });
});

describe('parseCsv', () => {
  it('reads quoted commas, quotes and newlines', () => {
    const { rows } = parseCsv('a,b\r\n"x, y","say ""hi"""\n"two\nlines",z');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });

  it('stops at the row limit and says so', () => {
    const { rows, truncated } = parseCsv('1\n2\n3\n4', 2);
    expect(rows).toEqual([['1'], ['2']]);
    expect(truncated).toBe(true);
    expect(parseCsv('1\n2', 2).truncated).toBe(false);
  });

  it('gives no rows for an empty file', () => {
    expect(parseCsv('').rows).toEqual([]);
  });
});
