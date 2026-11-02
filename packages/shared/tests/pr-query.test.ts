import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { describe, expect, it } from 'vitest';
import { facetOptions, filterCount, inScope, isNarrowed, parseSearch, pickedFilters, queryPRs, toggleFilter, DEFAULT_PR_QUERY, type ListedPR, type PRFacet, type PRQuery, type PRSearch } from '../pr-query.ts';

// The same cases run in apps/mac/OmniKit/Tests/OmniKitTests/PullRequestQueryTests.swift.
const corpus = JSON.parse(readFileSync(fixture('pr-query.json'), 'utf8')) as {
  prs: ListedPR[];
  queries: { case: string; viewer: string | null; query: PRQuery; expected: { group: string; numbers: number[] }[] }[];
  facets: { case: string; facet: PRFacet; repo: string | null; picked: string[]; expected: unknown }[];
  searches: { input: string; expected: PRSearch }[];
};

describe('queryPRs', () => {
  it.each(corpus.queries.map((c) => [c.case, c] as const))('%s', (_, c) => {
    const groups = queryPRs(corpus.prs, c.query, c.viewer).map((g) => ({ group: g.key, numbers: g.prs.map((p) => p.number) }));
    expect(groups).toEqual(c.expected);
  });

  it('leaves the list it was given in its order', () => {
    const before = corpus.prs.map((p) => p.number);
    queryPRs(corpus.prs, { ...DEFAULT_PR_QUERY, sort: 'title' }, 'ben');
    expect(corpus.prs.map((p) => p.number)).toEqual(before);
  });
});

describe('facetOptions', () => {
  it.each(corpus.facets.map((c) => [c.case, c] as const))('%s', (_, c) => {
    expect(facetOptions(inScope(corpus.prs, c.repo), c.facet, c.picked)).toEqual(c.expected);
  });
});

describe('parseSearch', () => {
  it.each(corpus.searches.map((c) => [c.input, c] as const))('%s', (_, c) => {
    expect(parseSearch(c.input)).toEqual(c.expected);
  });
});

describe('the filters', () => {
  it('toggle a value on and off, dropping an emptied facet', () => {
    const on = toggleFilter(toggleFilter({}, 'state', 'open'), 'label', 'bug');
    expect(on).toEqual({ state: ['open'], label: ['bug'] });
    expect(filterCount(on)).toBe(2);
    expect(toggleFilter(on, 'state', 'open')).toEqual({ label: ['bug'] });
  });

  it('read back as chips in facet order, with their labels', () => {
    expect(pickedFilters({ label: ['bug'], checks: ['pending'], state: ['merged'] })).toEqual([
      { facet: 'state', value: 'merged', label: 'Merged' },
      { facet: 'checks', value: 'pending', label: 'Running' },
      { facet: 'label', value: 'bug', label: 'bug' },
    ]);
  });

  it('narrow the list only with a search or a filter, not a sort or a repo', () => {
    expect(isNarrowed({ ...DEFAULT_PR_QUERY, sort: 'title', repo: 'acme/shop' })).toBe(false);
    expect(isNarrowed({ ...DEFAULT_PR_QUERY, search: ' x ' })).toBe(true);
    expect(isNarrowed({ ...DEFAULT_PR_QUERY, filters: { state: ['open'] } })).toBe(true);
  });
});
