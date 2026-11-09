import { readFileSync } from 'node:fs';
import { fixture } from '@omni/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  artifactKey,
  filterClaudeArtifacts,
  freshness,
  parseArtifactList,
  parseRows,
  parseTypeMembers,
  parseTypeNames,
  scheduleMs,
  STALE_MS,
  typeLabel,
  typeSlug,
  typesIn,
  updatedLabel,
} from '../claude-artifacts.ts';

const read = (name: string) => readFileSync(fixture('claude-artifacts', name), 'utf8');
const expected = JSON.parse(read('expected.json')) as { keys: Record<string, string>; urls: Record<string, string>; org_template: string };

describe('artifactKey', () => {
  it('reads the short id as the uuid in base58, checked against a real pair', () => {
    expect(artifactKey('https://claude.ai/artifact/XYTPbBk9xkJor7Xz1DtD2a')).toBe('f7567ad1-8b55-4689-b824-1a865c7fe003');
    expect(artifactKey('https://claude.ai/code/artifact/f7567ad1-8b55-4689-b824-1a865c7fe003')).toBe('f7567ad1-8b55-4689-b824-1a865c7fe003');
  });

  it('gives both link forms of one page the same key', () => {
    for (const [title, url] of Object.entries(expected.urls)) {
      expect(artifactKey(url)).toBe(expected.keys[title]);
      expect(artifactKey(`https://claude.ai/code/artifact/${expected.keys[title].toUpperCase()}`)).toBe(expected.keys[title]);
    }
  });

  it('keeps an id that is not base58 or is too long, and refuses what is not a link', () => {
    expect(artifactKey('https://claude.ai/artifact/not_base58-0')).toBe('not_base58-0');
    expect(artifactKey('https://claude.ai/artifact/zzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe('zzzzzzzzzzzzzzzzzzzzzzzzzzzz');
    expect(artifactKey('https://example.com/artifact/abc')).toBeNull();
  });
});

describe('parseArtifactList', () => {
  it('reads every row of a full listing, mine with dates, shared without', () => {
    const l = parseArtifactList(read('list-all.txt'));
    expect(l.ok).toBe(true);
    expect(l.total).toBe(6);
    expect(l.rows).toHaveLength(6);
    expect(l.rows.map((r) => r.title)).toEqual(Object.keys(expected.keys));
    expect(l.rows.map((r) => r.key)).toEqual(Object.values(expected.keys));
    expect(l.rows[0]).toEqual({ key: expected.keys['Quarterly roadmap deck'], url: expected.urls['Quarterly roadmap deck'], title: 'Quarterly roadmap deck', scope: 'mine', updated_on: '2026-11-08' });
    expect(l.rows.filter((r) => r.scope === 'shared').map((r) => r.updated_on)).toEqual([null, null]);
  });

  it('keeps a dash inside a title', () => {
    const l = parseArtifactList(read('list-all.txt'));
    expect(l.rows[1].title).toBe('Checkout audit — desktop and phone');
    expect(l.rows[4].title).toBe('Customer records — status');
  });

  it('takes a shorter page as complete for what it shows, with the total from its header', () => {
    const l = parseArtifactList(read('list-page.txt'));
    expect(l.ok).toBe(true);
    expect(l.rows).toHaveLength(3);
    expect(l.total).toBe(6);
  });

  it('refuses a listing whose rows do not match its own count', () => {
    const l = parseArtifactList(read('changed-format.txt'));
    expect(l.ok).toBe(false);
    expect(l.problem).toMatch(/said 6 artifacts but 0 rows/);
    const cut = read('list-all.txt').split('\n').filter((line) => !line.includes('Team design system')).join('\n');
    expect(parseArtifactList(cut).ok).toBe(false);
  });

  it('refuses text with no header, and accepts an account with none', () => {
    expect(parseArtifactList('Something went wrong.').ok).toBe(false);
    expect(parseArtifactList('').ok).toBe(false);
    expect(parseArtifactList(read('none.txt'))).toEqual({ ok: true, rows: [], total: 0, next_page_token: null });
  });

  it('reads a next page token when the tool prints one', () => {
    const text = `${read('list-page.txt')}Pass next_page_token "pg_AbC123xyz" to list the next page.`;
    expect(parseArtifactList(text).next_page_token).toBe('pg_AbC123xyz');
  });

  it('skips repeated rows and lines without a link', () => {
    const rows = parseRows('- (mine) A — https://claude.ai/artifact/QSdTnbQX1opbT77DCnKk1J\n- (mine) A again — https://claude.ai/artifact/QSdTnbQX1opbT77DCnKk1J\n- (mine) No link here');
    expect(rows).toHaveLength(1);
  });
});

describe('types', () => {
  it('reads the type names in order', () => {
    expect(parseTypeNames(read('types.txt'))).toEqual(['Dashboard', 'Design', 'Design System', 'Docs', 'Motion', 'Slides']);
  });

  it("reads a type's members, whatever the sharing label", () => {
    const m = parseTypeMembers(read('type-slides.txt'));
    expect(m.type).toBe('Slides');
    expect(m.keys).toEqual([expected.keys['Quarterly roadmap deck'], artifactKey(expected.org_template)]);
    expect(parseTypeMembers(read('type-empty.txt'))).toEqual({ type: 'Motion', keys: [] });
  });

  it('slugs and labels them', () => {
    expect(typeSlug('Design System')).toBe('design-system');
    expect(typeLabel('design-system')).toBe('Design system');
    expect(typeLabel('docs')).toBe('Doc');
    expect(typeLabel('new-thing')).toBe('New thing');
  });
});

describe('filters', () => {
  const items = [
    { title: 'Quarterly roadmap deck', scope: 'mine' as const, type: 'slides' },
    { title: 'Checkout audit', scope: 'mine' as const, type: 'page' },
    { title: 'Customer records', scope: 'shared' as const, type: null },
  ];

  it('filters by scope, type and every word of the search', () => {
    expect(filterClaudeArtifacts(items, { scope: 'shared' }).map((a) => a.title)).toEqual(['Customer records']);
    expect(filterClaudeArtifacts(items, { type: 'slides' })).toHaveLength(1);
    expect(filterClaudeArtifacts(items, { q: 'AUDIT check' }).map((a) => a.title)).toEqual(['Checkout audit']);
    expect(filterClaudeArtifacts(items, { q: 'audit deck' })).toHaveLength(0);
    expect(filterClaudeArtifacts(items, { scope: 'all', type: 'all', q: '  ' })).toHaveLength(3);
  });

  it('lists the types present, by label', () => {
    expect(typesIn(items)).toEqual(['page', 'slides']);
  });
});

describe('freshness and schedule', () => {
  it('is never, fresh or stale', () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    expect(freshness({ last_success_at: null }, now)).toBe('never');
    expect(freshness({ last_success_at: '2026-11-09T11:00:00Z' }, now)).toBe('fresh');
    expect(freshness({ last_success_at: new Date(now - STALE_MS - 1).toISOString() }, now)).toBe('stale');
  });

  it('waits 6 hours, a day, or never', () => {
    expect(scheduleMs('6h')).toBe(6 * 3600_000);
    expect(scheduleMs('daily')).toBe(24 * 3600_000);
    expect(scheduleMs('off')).toBeNull();
  });
});

describe('updatedLabel', () => {
  it('drops the year in the current one', () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    expect(updatedLabel('2026-11-08', now)).toBe('8 Nov');
    expect(updatedLabel('2025-03-01', now)).toBe('1 Mar 2025');
    expect(updatedLabel('soon', now)).toBe('soon');
  });
});
