// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CsvTable, csvColumns } from '../src/components/ArtifactViewer.tsx';
import { Markdown } from '../src/components/Markdown.tsx';
import { COMPOSER_CLEARS_CARD, QUICK_CARD_SLOT, THREAD_COLUMN } from '../src/components/thread/quick-card-layout.ts';
import { PageHeader } from '../src/components/ui/feedback.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The CSS layout fixes of the modern web audit (W13: M9, M21, M22, M25, L19, L20).
const SRC = join(import.meta.dirname, '../src');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');
const css = read('index.css');

/** The at-rules (`@layer components`, `@media ...`) a position in index.css sits inside, outermost first. */
function enclosing(at: number) {
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < at; i++) {
    const ch = css[i];
    if (ch === '{') {
      stack.push(css.slice(start, i).trim().split('\n').pop()!.trim());
      start = i + 1;
    } else if (ch === '}') {
      stack.pop();
      start = i + 1;
    } else if (ch === ';') start = i + 1;
    else if (ch === '/' && css[i + 1] === '*') {
      i = css.indexOf('*/', i) + 1;
      start = i + 1;
    }
  }
  return stack;
}

describe('M9: Markdown CSS sits under the utilities', () => {
  it('puts every .md rule in a layer, the styling ones in components, so a class passed with it wins', () => {
    const rules = [...css.matchAll(/^\s*\.md[\s.>:,{[]/gm)];
    expect(rules.length).toBeGreaterThan(30);
    // Text selection in replies is a base rule; the rest style the reply.
    for (const m of rules) expect(enclosing(m.index!)[0], css.slice(m.index!, m.index! + 40)).toMatch(/^@layer (base|components)$/);
    expect(rules.filter((m) => enclosing(m.index!)[0] === '@layer components').length).toBeGreaterThan(30);
  });

  it('keeps the helper classes there too, and reduced motion outside any layer', () => {
    for (const helper of ['.pulse {', '.fade-in {', '.pop-in {', '.flash {', '.shimmer-text {', '.link-mark {']) {
      expect(enclosing(css.indexOf(`  ${helper}`))[0], helper).toBe('@layer components');
    }
    // The main reduced motion block overrides keyframes and helpers that sit in layers, so it stays unlayered. (The
    // transition-utility one sits in @layer utilities on purpose: reduced-motion-css.test.ts.)
    expect(enclosing(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('/* ---- reduced motion ----')))).toEqual([]);
  });

  it('lets the phone reply set its own size and leading', () => {
    expect(read('mobile/ThreadCards.tsx')).toContain('<Markdown text={text} className="text-[15px] leading-[1.6] text-pretty" />');
  });
});

describe('M21: the diff file header sticks', () => {
  it('clips the card without making it a scroll container', () => {
    const viewer = read('components/DiffViewer.tsx');
    expect(viewer).toContain('<div className="overflow-clip rounded-[18px]');
    expect(viewer).not.toMatch(/overflow-hidden rounded-\[18px\]/);
    expect(viewer).toContain('className="sticky top-0');
  });
});

describe('M22: tables and wide code scroll in named, focusable regions', () => {
  const wide = '| Store | Market | Orders |\n|---|---|---|\n| volero-nl | Netherlands | 18,204 |';

  it('wraps a Markdown table in a region named by its headings, the table still a table', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: wide }));
    expect(html).toMatch(/<div class="md-scroll" role="region" aria-label="Table: Store, Market, Orders" tabindex="0"><table><thead>/);
    expect(css).not.toMatch(/\.md table \{[^}]*display: block/);
    expect(css).toMatch(/\.md \.md-scroll \{[^}]*overflow-x: auto/);
  });

  it('keeps the tab stop only while the table is wider than its column', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let inner = 900;
    const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => inner);
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 600);
    act(() => root.render(createElement(Markdown, { text: wide })));
    const region = () => host.querySelector('[role="region"]')!;
    expect(region().getAttribute('tabindex')).toBe('0');
    inner = 400;
    act(() => root.render(createElement(Markdown, { text: `${wide}\n| x | y | 1 |` })));
    expect(region().hasAttribute('tabindex')).toBe(false);
    act(() => root.unmount());
    sw.mockRestore();
    cw.mockRestore();
    host.remove();
  });

  it('names a code block and gives it a tab stop while it scrolls', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: '```ts\nconst n = 1\n```' }));
    expect(html).toContain('<pre role="region" aria-label="Code" tabindex="0"><code class="language-ts">');
  });

  it('lays a CSV out fixed, so a long cell truncates to its column and opens whole on focus', () => {
    const long = 'x'.repeat(200);
    expect(csvColumns([['sku', 'description'], ['SKU-1', long]])).toEqual([5, 60]);
    const html = renderToStaticMarkup(createElement(CsvTable, { text: `sku,description\nSKU-1,${long}` }));
    expect(html).toMatch(/<table class="min-w-full table-fixed [^"]*" style="width:calc\(78ch \+ 3rem\)">/);
    expect(html).toContain('<col style="width:calc(72ch + 1.5rem)"/>');
    expect(html).toMatch(new RegExp(`<td tabindex="0" class="[^"]*truncate[^"]*focus:whitespace-pre-wrap" title="${long}">`));
    // A short cell is no tab stop.
    expect(html).toMatch(/<td class="truncate [^"]*" title="SKU-1">/);
  });

  it('gives the usage breakdown and the charter diff a region, and the charter diff no table roles', () => {
    expect(read('components/dashboard/UsageSection.tsx')).toMatch(/shadow-\[inset_0_0_0_1px_var\(--line\)\]" \{\.\.\.region\}>/);
    const crew = read('pages/SettingsCrew.tsx');
    expect(crew).not.toMatch(/role="(table|row)"/);
    expect(crew).toContain("useScrollRegion<HTMLDivElement>('Built-in and your charter, line by line', 'both')");
    expect(crew).toContain('Only in yours: ');
  });
});

describe('M25: the quick card docks by the thread width', () => {
  it('queries the thread column, not the window', () => {
    expect(THREAD_COLUMN).toMatch(/^@container\/thread /);
    for (const cls of [QUICK_CARD_SLOT, COMPOSER_CLEARS_CARD]) expect(cls).not.toMatch(/(^|\s)(sm|md|lg|xl):/);
    expect(QUICK_CARD_SLOT).toContain('@3xl/thread:static');
    expect(QUICK_CARD_SLOT).toContain('@3xl/thread:w-72');
    expect(COMPOSER_CLEARS_CARD).toBe('@3xl/thread:pr-[19.5rem]');
    const thread = read('pages/Thread.tsx');
    expect(thread).toContain('<div className={THREAD_COLUMN}>');
    expect(thread).toContain('<div className={QUICK_CARD_SLOT}>');
    expect(thread).toMatch(/ref=\{contentRef\} className="@container /);
  });

  it('widens the reply bubbles by the transcript width', () => {
    const transcript = read('components/Transcript.tsx');
    expect(transcript).not.toContain('sm:max-w-[80%]');
    expect(transcript.match(/@lg:max-w-\[80%\]/g)).toHaveLength(2);
  });
});

describe('L19: headings wrap instead of truncating', () => {
  it('balances a page title over as many lines as it needs', () => {
    const html = renderToStaticMarkup(createElement(PageHeader, { title: 'A title long enough to wrap' }));
    const h1 = /<h1 class="([^"]+)"/.exec(html)![1];
    expect(h1).toContain('text-balance');
    expect(h1).not.toContain('truncate');
  });

  it('gives the thread title and the list panel title two balanced lines', () => {
    expect(read('components/thread/ThreadHeader.tsx')).toMatch(/<h1 className="mt-0\.5 line-clamp-2 [^"]*text-balance" title=\{thread\.title\}>/);
    expect(read('components/rail/ListPanel.tsx')).toMatch(/<h2 className=\{`line-clamp-2 [^`]*text-balance/);
  });
});

describe('L20: viewport units and safe areas', () => {
  it('sizes the overlays the phone shows by the visible viewport', () => {
    expect(css).toMatch(/dialog\.modal \{[^}]*max-height: 92dvh;/);
    expect(css).not.toMatch(/\b\d+v[hw]\b/);
    expect(read('components/ContextMenu.tsx')).toContain('max-h-[calc(100dvh-1rem)] w-[min(23rem,calc(100%-1rem))]');
    expect(read('mobile/ThreadViews.tsx')).toContain('max-h-[60dvh]');
  });

  it('pads the bottom inset with one utility, and the sides on the desktop shell', () => {
    expect(css).toMatch(/@utility safe-b-\* \{\s*padding-bottom: max\(calc\(var\(--spacing\) \* --value\(integer\)\), env\(safe-area-inset-bottom\)\);/);
    expect(css).toMatch(/@utility safe-x \{\s*padding-left: env\(safe-area-inset-left\);\s*padding-right: env\(safe-area-inset-right\);/);
    for (const file of ['mobile/ThreadViews.tsx', 'mobile/ActionsScreen.tsx', 'mobile/registry.tsx', 'mobile/ChannelsScreen.tsx', 'pages/Thread.tsx']) {
      expect(read(file), file).not.toMatch(/max\(\d+(px|rem), ?env\(safe-area-inset-bottom\)\)|paddingBottom: 'env\(safe-area-inset-bottom\)'/);
    }
    const app = read('App.tsx');
    expect(app).toContain('desktop-shell rail-shell safe-x ');
    expect(app).toContain('desktop-shell safe-x ');
  });
});
