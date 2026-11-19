import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { executablePath, startFixture, type Browser, type Page } from './chromium.ts';

// The dismiss stack (components/ui/dismiss-stack.ts) in a real Chromium: overlays stacked on each other, and each
// Escape or press outside closes only the top one (audit M2, L7, L16). The page is tests/fixtures/layers-page.

describe.skipIf(!executablePath)('stacked layers in Chromium', () => {
  let fixture: Awaited<ReturnType<typeof startFixture>>;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    fixture = await startFixture('layers-page');
    browser = fixture.browser;
  }, 60_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  afterEach(async () => {
    await page?.close();
  });

  const load = async (reducedMotion: 'reduce' | 'no-preference' = 'no-preference') => {
    page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.emulateMedia({ reducedMotion });
    await page.goto(fixture.url);
    await page.waitForSelector('#open-fork');
  };
  const events = () => page.evaluate(() => window.events);
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.id || document.activeElement?.textContent?.trim() || '');
  const gone = (selector: string) => page.waitForSelector(selector, { state: 'detached' });
  const dialogs = () => page.locator('dialog[open]').count();
  const openFork = async () => {
    await page.click('#open-fork');
    await page.waitForSelector('dialog[open] button[aria-haspopup="listbox"]');
  };

  it("closes Fork's model list on Escape and leaves the Fork modal open, then the next Escape closes the modal", async () => {
    await load();
    await openFork();
    await page.click('dialog[open] button[aria-label^="Model:"]');
    await page.waitForSelector('.pik-card[popover]');
    expect(await focused()).toBe('Find a model');
    await page.keyboard.press('Escape');
    await gone('.pik-card');
    expect(await dialogs()).toBe(1);
    expect(await events()).toEqual([]);
    expect(await focused()).toMatch(/^Model: Opus/);
    await page.keyboard.press('Escape');
    expect(await events()).toEqual(['fork closed']);
  }, 30_000);

  it('closes a picker list over a modal on a backdrop press, and only the next press closes the modal', async () => {
    await load();
    await openFork();
    await page.click('dialog[open] button[aria-label^="Machine"]');
    await page.waitForSelector('.pik-card[popover]');
    await page.mouse.click(8, 8);
    await gone('.pik-card');
    expect(await dialogs()).toBe(1);
    expect(await events()).toEqual([]);
    await page.mouse.click(8, 8);
    expect(await events()).toEqual(['fork closed']);
  }, 30_000);

  it('closes an inline confirm inside a modal on Escape and leaves the modal open', async () => {
    await load();
    await openFork();
    await page.click('dialog[open] .say-btn');
    // Asking: Cancel and the confirm, split by a seam.
    await page.waitForSelector('dialog[open] .say-seam');
    expect(await focused()).toBe('Cancel');
    await page.keyboard.press('Escape');
    await gone('dialog[open] .say-seam');
    expect(await dialogs()).toBe(1);
    expect(await events()).toEqual([]);
  }, 30_000);

  it('walks a drawing toolbar popup by arrow keys, and Escape closes only the popup, not the annotation view', async () => {
    await load();
    await page.click('#open-annotate');
    await page.getByRole('button', { name: 'Shapes' }).click();
    await page.waitForSelector('[role="menu"][aria-label="Shapes"]');
    // It opens on the checked shape.
    expect(await focused()).toBe('Rectangle');
    await page.keyboard.press('ArrowRight');
    expect(await focused()).toBe('Ellipse');
    await page.keyboard.press('End');
    expect(await focused()).toBe('Line');
    await page.keyboard.press('ArrowDown');
    expect(await focused()).toBe('Rectangle');
    await page.keyboard.press('Escape');
    await gone('[role="menu"][aria-label="Shapes"]');
    expect(await events()).toEqual([]);
    expect(await focused()).toBe('Shapes');
    await page.keyboard.press('Escape');
    expect(await events()).toEqual(['annotate closed']);
  }, 30_000);

  it('opens the send menu on its first item, gives the focus back on Escape, and closes on a press outside', async () => {
    await load();
    await page.click('button[aria-label="More ways to send"]');
    await page.waitForSelector('[role="menu"][aria-label="Send options"]');
    // The names read plain unless Show technical details is on.
    expect(await focused()).toMatch(/^Add to this/);
    await page.keyboard.press('ArrowDown');
    expect(await focused()).toMatch(/^Send when it finishes/);
    await page.keyboard.press('Escape');
    await gone('[role="menu"][aria-label="Send options"]');
    expect(await focused()).toBe('More ways to send');
    await page.click('button[aria-label="More ways to send"]');
    await page.waitForSelector('[role="menu"][aria-label="Send options"]');
    await page.click('#behind');
    await gone('[role="menu"][aria-label="Send options"]');
    expect(await events()).toEqual(['behind']);
  }, 30_000);

  it('plays an exit before a menu, a list or a modal goes, and none with Reduce motion on', async () => {
    const closingAfterEscape = async () => {
      await page.keyboard.press('Escape');
      return page.evaluate(() => document.querySelectorAll('[data-closing]').length);
    };
    await load();
    await page.click('button[aria-label="More ways to send"]');
    await page.waitForSelector('[role="menu"][aria-label="Send options"]');
    expect(await closingAfterEscape()).toBe(1);
    await gone('[data-closing]');
    await openFork();
    expect(await closingAfterEscape()).toBe(1);
    await gone('dialog');
    await page.close();

    await load('reduce');
    await page.click('button[aria-label="More ways to send"]');
    await page.waitForSelector('[role="menu"][aria-label="Send options"]');
    expect(await closingAfterEscape()).toBe(0);
    expect(await page.locator('[role="menu"]').count()).toBe(0);
    await openFork();
    expect(await closingAfterEscape()).toBe(0);
    expect(await page.locator('dialog').count()).toBe(0);
  }, 30_000);
});
