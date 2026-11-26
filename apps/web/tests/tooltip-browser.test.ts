import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { executablePath, startFixture, type Browser, type Page } from './chromium.ts';

// The shared Tooltip (components/ui/tooltip.tsx, audit M29) in a real Chromium, on tests/fixtures/tooltip-page: with
// the browser's own interest invokers, and with the fallback Safari and Firefox get (`?mode=fallback`, and
// `?mode=placed` without anchor positioning as on iOS Safari 18).

describe.skipIf(!executablePath)('Tooltip in Chromium', () => {
  let fixture: Awaited<ReturnType<typeof startFixture>>;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    fixture = await startFixture('tooltip-page');
    browser = fixture.browser;
  }, 60_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  afterEach(async () => {
    await page?.close();
  });

  const load = async (mode?: 'fallback' | 'placed') => {
    page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    await page.goto(`${fixture.url}${mode ? `?mode=${mode}` : ''}`);
    await page.waitForSelector('#link');
  };
  const tipOf = (trigger: string) =>
    page.evaluate((sel) => {
      const t = document.querySelector(sel)!;
      const tip = t.nextElementSibling as HTMLElement;
      return { mode: tip.dataset.mode, open: tip.matches(':popover-open'), describedby: t.getAttribute('aria-describedby'), id: tip.id, role: tip.getAttribute('role') };
    }, trigger);
  /** Waits up to 3 s for the trigger's tip to open, or to close. */
  const expectOpen = async (trigger: string, open = true) => {
    for (let i = 0; i < 60; i++) {
      if ((await tipOf(trigger)).open === open) return;
      await page.waitForTimeout(50);
    }
    expect((await tipOf(trigger)).open).toBe(open);
  };
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const hover = async (sel: string) => {
    const b = await box(sel);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  };
  /** Tab from the button before the link, so the focus is the keyboard's (`:focus-visible`). */
  const tabTo = async (from: string) => {
    await page.focus(from);
    await page.keyboard.press('Tab');
  };

  for (const mode of [undefined, 'fallback', 'placed'] as const) {
    const name = mode ?? 'native';

    it(`${name}: shows on hover beside its trigger and closes when the pointer leaves`, async () => {
      await load(mode);
      expect((await tipOf('#link')).mode).toBe(mode === 'fallback' ? 'anchored' : mode === 'placed' ? 'placed' : 'interest');
      await hover('#link');
      await expectOpen('#link');
      const link = await box('#link');
      const tip = await box('#link + .tip');
      // Above the link, centred on it.
      expect(tip.y + tip.height).toBeLessThanOrEqual(link.y + 1);
      expect(Math.abs(tip.x + tip.width / 2 - (link.x + link.width / 2))).toBeLessThan(2);
      await page.mouse.move(5, 5);
      await expectOpen('#link', false);
    }, 30_000);

    it(`${name}: shows on keyboard focus, and Escape closes the tip alone`, async () => {
      await load(mode);
      await page.click('#open-menu');
      await page.waitForSelector('#menu');
      await tabTo('#open-menu');
      await expectOpen('#link');
      await page.keyboard.press('Escape');
      await expectOpen('#link', false);
      // Neither the menu under it nor the page's own Escape heard it.
      expect(await page.evaluate(() => window.events)).toEqual([]);
      expect(await page.locator('#menu').count()).toBe(1);
      // It stays shut while the focus stays, and the next Escape is the menu's.
      await page.waitForTimeout(700);
      expect((await tipOf('#link')).open).toBe(false);
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => window.events)).toEqual(['menu closed']);
    }, 30_000);

    it(`${name}: describes its trigger, unless it only repeats the trigger's name`, async () => {
      await load(mode);
      const link = await tipOf('#link');
      expect(link.describedby).toBe(link.id);
      expect(link.role).toBe('tooltip');
      const disc = await tipOf('#disc');
      expect(disc.describedby).toBeNull();
      expect(disc.role).toBeNull();
      // A rail disc's tip sits to its right.
      await tabTo('#link');
      await expectOpen('#disc');
      const d = await box('#disc');
      const t = await box('#disc + .tip');
      expect(t.x).toBeGreaterThanOrEqual(d.x + d.width);
    }, 30_000);
  }

  it('fallback: a pointer moving onto the tip keeps it open, and a press closes it', async () => {
    await load('fallback');
    await hover('#link');
    await expectOpen('#link');
    const tip = await box('#link + .tip');
    await page.mouse.move(tip.x + tip.width / 2, tip.y + tip.height / 2);
    await page.waitForTimeout(400);
    expect((await tipOf('#link')).open).toBe(true);
    await page.mouse.down();
    await expectOpen('#link', false);
  }, 30_000);

  for (const mode of [undefined, 'fallback', 'placed'] as const) {
    const name = mode ?? 'native';

    it(`${name}: the card variant opens on hover and keyboard focus, 8px right of its row, 250px wide`, async () => {
      await load(mode);
      await hover('#row-a');
      await expectOpen('#row-a');
      const row = await box('#row-a');
      const card = await box('#row-a + .tip-card');
      expect(card.width).toBeCloseTo(250, 0);
      expect(card.x - (row.x + row.width)).toBeGreaterThanOrEqual(7);
      expect(card.x - (row.x + row.width)).toBeLessThanOrEqual(10);
      await page.mouse.move(5, 5);
      await expectOpen('#row-a', false);
      await tabTo('#other');
      await expectOpen('#row-a');
    }, 30_000);

    it(`${name}: Escape closes the card alone with a menu open under it`, async () => {
      await load(mode);
      await page.click('#open-menu');
      await page.waitForSelector('#menu');
      await hover('#row-a');
      await expectOpen('#row-a');
      await page.keyboard.press('Escape');
      await expectOpen('#row-a', false);
      expect(await page.locator('#menu').count()).toBe(1);
    }, 30_000);
  }

  it('fallback: moving from one card row to the next swaps the card without the open delay', async () => {
    await load('fallback');
    await hover('#row-a');
    await expectOpen('#row-a');
    await hover('#row-b');
    // Well under the 500 ms open delay: the first card closed as the next one opened.
    await page.waitForTimeout(150);
    expect((await tipOf('#row-b')).open).toBe(true);
    expect((await tipOf('#row-a')).open).toBe(false);
  }, 30_000);
});
