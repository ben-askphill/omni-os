import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TRUSTED_TYPES_POLICIES } from '@omni/server/web-headers.ts';
import { POLICY_NAMES } from '../src/trusted-html.ts';
import { executablePath, startFixture, type Browser, type Page } from './chromium.ts';

// Trusted Types in a real Chromium, enforced (audit L4): Markdown, Mermaid diagrams of each common kind, a search
// snippet and xterm render with no CSP violation, and a plain string written to innerHTML is refused, so the zero
// means something. The page is tests/fixtures/trusted-types-page, under the shell's two Trusted Types directives.

it("allows the shell's CSP exactly the policies the Web UI creates, plus DOMPurify's own", () => {
  expect([...TRUSTED_TYPES_POLICIES].sort()).toEqual([...POLICY_NAMES, 'dompurify'].sort());
});

describe.skipIf(!executablePath)('Trusted Types in Chromium', () => {
  let fixture: Awaited<ReturnType<typeof startFixture>>;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    fixture = await startFixture('trusted-types-page');
    browser = fixture.browser;
    page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.goto(fixture.url);
    // Every diagram drawn, or the first violation: enforced, a write without a policy throws and its diagram stays source.
    await page.waitForFunction(
      () => window.violations.length > 0 || (document.querySelectorAll('.mermaid-diagram [role="img"] svg').length === 7 && !!document.querySelector('#terminal .xterm')),
      undefined,
      { timeout: 60_000 },
    );
  }, 120_000);

  afterAll(async () => {
    await page?.close();
    await fixture?.stop();
  });

  it('renders Markdown, every diagram, the snippet and the terminal with no violation', async () => {
    const got = await page.evaluate(() => ({
      violations: window.violations,
      sources: document.querySelectorAll('.mermaid-diagram pre').length,
      labels: [...document.querySelectorAll('.mermaid-diagram svg')].map((svg) => svg.textContent ?? '').join(' '),
      styled: [...document.querySelectorAll('.mermaid-diagram svg > style')].every((style) => (style.textContent ?? '').includes('omni-mermaid-')),
      heading: document.querySelector('h1')?.textContent,
      prose: document.querySelector('h1 + p')?.textContent,
      marks: [...document.querySelectorAll('#snippet mark')].map((m) => m.textContent),
      snippet: document.querySelector('#snippet')?.textContent,
      images: document.querySelectorAll('#snippet img').length,
      pwned: 'pwned' in window,
    }));
    expect(got.violations).toEqual([]);
    expect(got.sources).toBe(0);
    for (const label of ['Air bold', 'Relay?', 'pair', 'Thread', 'Running', 'THREAD', 'W17', 'Search']) expect(got.labels).toContain(label);
    expect(got.styled).toBe(true);
    expect(got.heading).toBe('Trusted Types');
    expect(got.prose).toBe('Some Markdown with code, a link, © 2026 & co, \u00a0∉ and &notit; &bogus;.');
    expect(got.marks).toEqual(['match', 'two']);
    expect(got.snippet).toContain('<img src=x onerror="window.pwned=1">');
    expect(got.images).toBe(0);
    expect(got.pwned).toBe(false);
  });

  it("refuses a plain string outside Mermaid's render, even one that starts as a character reference, and reports it", async () => {
    for (const html of ['<b>plain string</b>', '&amp;<img src=x>', '&amp;']) {
      expect(await page.evaluate((h) => window.stray(h), html), html).toBe(html === '&amp;' ? 'written' : 'refused');
    }
    expect(await page.evaluate(() => window.violations)).toEqual([
      'require-trusted-types-for: Element innerHTML|<b>plain string</b>',
      'require-trusted-types-for: Element innerHTML|&amp;<img src=x>',
    ]);
  });
});
