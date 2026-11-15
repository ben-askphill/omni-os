// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { NeedsYouItem } from '../src/api.ts';

vi.mock('@omni/server/db.ts', () => {
  throw new Error('db.ts must not be imported by dashboard tests');
});

import { needsBreakdown } from '../src/components/dashboard/Cards.tsx';

// Overview's Needs you tile (apps/web/src/components/dashboard/Cards.tsx): the line under the count names what holds
// each item up, in words, never a blocker's raw kind.

const item = (kind: NeedsYouItem['blockers'][number]['kind'] | null): NeedsYouItem =>
  ({ thread: { id: kind ?? 'r' }, result: null, blockers: kind ? [{ kind, detail: null, count: 1 }] : [], at: '2026-11-15T20:00:00.000Z' }) as unknown as NeedsYouItem;

describe('the Needs you breakdown', () => {
  it('says a failed delegated thread in words', () => {
    expect(needsBreakdown([item('child_failed')])).toBe('1 failed delegated thread');
    expect(needsBreakdown([item('child_failed'), item('child_failed'), item('question')])).toBe('2 failed delegated threads · 1 question set');
  });

  it('renders no raw kind on the tile line', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement('p', null, needsBreakdown([item('child_failed'), item('setup')]))));
    expect(host.textContent).toBe('1 failed delegated thread · 1 setup failure');
    expect(host.textContent).not.toContain('child_failed');
    act(() => root.unmount());
  });
});
