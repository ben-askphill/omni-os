import type { ChannelWithRunning, SearchHit, Thread } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { hitRows, matchChannels, recentThreads, searchQuery, snippetParts } from '../src/search/search-model';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const channel = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, archived: 0, store_domain: null, github_repo: null, ...over }) as unknown as ChannelWithRunning;
const hit = (over: Partial<SearchHit> = {}): SearchHit => ({ thread_id: 't1', title: 'Fix checkout', channel_id: 'shop', status: 'done', updated_at: '2026-11-02T11:55:00Z', snippet: '', event_id: null, ...over });

describe('searchQuery', () => {
  it('trims and folds spaces, and leaves blank input empty', () => {
    expect(searchQuery('  fix   the build ')).toBe('fix the build');
    expect(searchQuery('   ')).toBe('');
  });
});

describe('snippetParts', () => {
  it('marks the words between mark tags and keeps the rest plain', () => {
    expect(snippetParts('use <mark>check</mark>out and <mark>pay</mark>')).toEqual([
      { text: 'use ', match: false },
      { text: 'check', match: true },
      { text: 'out and ', match: false },
      { text: 'pay', match: true },
    ]);
  });

  it('has no parts for a thread only its title matched', () => {
    expect(snippetParts('')).toEqual([]);
  });
});

describe('matchChannels', () => {
  const list = [channel('shop', { store_domain: 'shop.example.com' }), channel('old', { archived: 1 }), channel('conductor', { name: 'Conductor' })];

  it('finds live channels by name or id, case-insensitively', () => {
    expect(matchChannels(list, 'SHO')).toEqual([{ id: 'shop', label: '#shop', detail: 'shop.example.com' }]);
    expect(matchChannels(list, 'conduct')).toEqual([{ id: 'conductor', label: 'Conductor', detail: null }]);
  });

  it('skips archived channels and matches nothing for an empty query or before the list loads', () => {
    expect(matchChannels(list, 'old')).toEqual([]);
    expect(matchChannels(list, '')).toEqual([]);
    expect(matchChannels(null, 'shop')).toEqual([]);
  });
});

describe('hitRows', () => {
  it('names the channel, the age and a state worth naming, and falls back to the id and "Untitled"', () => {
    const rows = hitRows([hit({ status: 'running', snippet: 'a <mark>b</mark>' }), hit({ thread_id: 't2', title: '', channel_id: 'gone' })], [channel('shop', { name: 'Shop' })], NOW);
    expect(rows[0]).toMatchObject({ threadId: 't1', channel: 'Shop', statusLabel: 'Running', ago: '5m', snippet: [{ text: 'a ', match: false }, { text: 'b', match: true }] });
    expect(rows[1]).toMatchObject({ threadId: 't2', title: 'Untitled', channel: 'gone', statusLabel: null });
  });
});

describe('recentThreads', () => {
  const t = (id: string, over: Record<string, unknown> = {}) => ({ id, source: 'manual', archived: 0, ...over }) as unknown as Thread;

  it('drops team members and archived threads and stops at the limit', () => {
    const list = [t('a'), t('b', { source: 'team' }), t('c', { archived: 1 }), t('d'), t('e')];
    expect(recentThreads(list, 2).map((x) => x.id)).toEqual(['a', 'd']);
    expect(recentThreads(null)).toEqual([]);
  });
});
