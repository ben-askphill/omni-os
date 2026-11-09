import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WIRE_FIXTURES } from '@omni/test-fixtures';
import type { ClaudeArtifactsResponse, ClaudeArtifactsState } from '@omni/shared/claude-artifacts.ts';
import { describe, expect, it } from 'vitest';
import { ArtifactTypeBadge, ClaudeArtifactCard, ClaudeArtifactRow, FreshnessLine } from '../src/components/ClaudeArtifacts.tsx';
import { href, pageTitle, parseHash } from '../src/router.ts';

// The claude.ai list on the Artifacts page and the phone Library (components/ClaudeArtifacts.tsx), drawn from the
// server's recorded response (packages/test-fixtures/wire/claude-artifacts.json).

const wire = JSON.parse(readFileSync(join(WIRE_FIXTURES, 'claude-artifacts.json'), 'utf8')) as ClaudeArtifactsResponse;
const now = Date.parse('2026-11-09T12:00:00Z');

describe('the claude.ai artifacts route', () => {
  it('is the Artifacts page with its claude.ai source', () => {
    expect(href.claudeArtifacts()).toBe('#/artifacts/claude');
    expect(parseHash('#/artifacts/claude')).toEqual({ name: 'artifacts', source: 'claude' });
    expect(parseHash('#/artifacts')).toEqual({ name: 'artifacts' });
    expect(parseHash('#/artifacts/other').name).toBe('notfound');
    expect(pageTitle(parseHash('#/artifacts/claude'), () => undefined)).toBe('Artifacts');
  });
});

describe('a row', () => {
  const row = (i: number) => renderToStaticMarkup(createElement('ul', null, createElement(ClaudeArtifactRow, { a: wire.items[i], now })));

  it('opens the page on claude.ai in a new tab, with its type, owner and date', () => {
    const html = row(0);
    expect(html).toContain(`href="${wire.items[0].url}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Slides');
    expect(html).toContain('Mine');
    expect(html).toContain('Updated 8 Nov');
  });

  it('shows no date for a shared page, and links the thread that published one', () => {
    const shared = wire.items.find((a) => a.scope === 'shared')!;
    const html = renderToStaticMarkup(createElement('ul', null, createElement(ClaudeArtifactRow, { a: { ...shared, local: { artifact_id: 7, thread_id: 't1', thread_title: 'Made it', channel_id: 'omni' } }, now })));
    expect(html).toContain('Shared');
    expect(html).not.toContain('Updated');
    expect(html).toContain(`href="${href.thread('t1', 7)}"`);
    expect(html).toContain('From thread: Made it');
  });

  it('draws no badge before the type pass has seen a page', () => {
    expect(renderToStaticMarkup(createElement(ArtifactTypeBadge, { type: null }))).toBe('');
    expect(renderToStaticMarkup(createElement(ArtifactTypeBadge, { type: 'design-system' }))).toContain('Design system');
  });
});

describe('the freshness line', () => {
  const base: ClaudeArtifactsState = { ...wire.state, refreshing: false };
  const line = (s: Partial<ClaudeArtifactsState>) => renderToStaticMarkup(createElement(FreshnessLine, { state: { ...base, ...s }, onRefresh: () => {} }));

  it('says when the list was fetched and how many there are', () => {
    expect(line({ last_success_at: new Date(Date.now() - 5 * 60_000).toISOString(), total: 142 })).toMatch(/Fetched 5m ago · 142 artifacts/);
  });

  it('warns once the list is a day old, and says so while refreshing', () => {
    expect(line({ last_success_at: '2026-01-01T00:00:00.000Z' })).toContain('over a day ago');
    expect(line({ refreshing: true })).toContain('Refreshing from claude.ai');
    expect(line({ last_success_at: null })).toContain('Not fetched yet');
  });
});

describe('hover and the grid card', () => {
  const card = (a: ClaudeArtifactsResponse['items'][number]) =>
    renderToStaticMarkup(createElement('ul', null, createElement(ClaudeArtifactCard, { a, now })));

  it('hovers a row to surface-3, never elev (the page white, where a hovered row looked gone)', () => {
    const html = renderToStaticMarkup(createElement('ul', null, createElement(ClaudeArtifactRow, { a: wire.items[0], now })));
    expect(html).toContain('hover:bg-surface-3');
    expect(html).toContain('has-[a:focus-visible]:bg-surface-3');
    expect(html).not.toContain('hover:bg-elev');
  });

  it('opens a card on claude.ai like a row, with the same hover', () => {
    const html = card(wire.items[0]);
    expect(html).toContain(`href="${wire.items[0].url}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('hover:bg-surface-3');
    expect(html).toContain('Slides');
  });

  it("previews a thread's local copy from Omni's server, else draws the type and loads nothing", () => {
    const local = {
      ...wire.items[0],
      local: { artifact_id: 42, thread_id: 't1', thread_title: 'Made it', channel_id: 'c1', kind: 'html', updated_at: '2026-11-09T10:00:00.000Z' },
    };
    const withCopy = card(local);
    expect(withCopy).toContain('<iframe src="/api/artifacts/42/raw?v=2026-11-09T10%3A00%3A00.000Z"');
    expect(withCopy).toContain('From thread: Made it');
    const without = card({ ...wire.items[0], local: null });
    expect(without).not.toContain('<iframe');
    expect(without).not.toContain('<img');
    expect(without).not.toMatch(/src="https?:/);
  });
});
