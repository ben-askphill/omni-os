import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executablePath, startFixture, type Browser, type Page } from './chromium.ts';

// The Modal in a real Chromium, for what happy-dom does not model: showModal() keeps Tab inside, makes the page
// behind inert, and sends Escape to the top dialog only. The page is tests/fixtures/modal-page.

describe.skipIf(!executablePath)('a modal in Chromium', () => {
  let fixture: Awaited<ReturnType<typeof startFixture>>;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    fixture = await startFixture('modal-page');
    browser = fixture.browser;
  }, 60_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  const open = async (button: string, path = '', opens = 'dialog[open]') => {
    page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.goto(fixture.url + path);
    await page.click(button);
    await page.waitForSelector(opens);
  };
  const events = () => page.evaluate(() => window.events);
  const focusedId = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent || '');
  /** Where the focus is: in the top dialog, out of the page (the browser's own UI, after the last control), or behind. */
  const focusPlace = () =>
    page.evaluate(() => {
      const top = [...document.querySelectorAll('dialog')].filter((d) => d.matches(':modal')).at(-1);
      const el = document.activeElement;
      return top?.contains(el) ? 'dialog' : !el || el === document.body ? 'browser' : `behind:${el.id || el.tagName}`;
    });
  const focusInsideTopDialog = async () => (await focusPlace()) === 'dialog';

  // Past the last control Chromium hands the focus to its own UI (the address bar), as for any page, and the next
  // Tab comes back to the first control. It never reaches the page behind.
  it('keeps Tab and Shift+Tab off the page behind', async () => {
    await open('#open-plain');
    expect(await focusInsideTopDialog()).toBe(true);
    const places: string[] = [];
    for (const key of [...Array(8).fill('Tab'), ...Array(8).fill('Shift+Tab')]) {
      await page.keyboard.press(key);
      places.push(await focusPlace());
    }
    expect(places.filter((p) => p !== 'dialog' && p !== 'browser')).toEqual([]);
    expect(places.filter((p) => p === 'dialog').length).toBeGreaterThan(places.length / 2);
    await page.close();
  }, 30_000);

  it('makes the page behind inert: no focus, no clicks', async () => {
    await open('#open-plain');
    expect(await page.evaluate(() => document.querySelector('dialog')!.matches(':modal'))).toBe(true);
    await page.evaluate(() => document.getElementById('behind')!.focus());
    expect(await focusedId()).not.toBe('behind');
    // A press over the button lands on the backdrop: it closes the modal, and the button never hears it.
    const box = (await page.locator('#behind').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await events()).toEqual(['plain closed']);
    await page.close();
  }, 30_000);

  it('closes only the top dialog on Escape, and gives the focus back to what opened each', async () => {
    await open('#open-plain');
    await page.click('#open-confirm');
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 2);
    expect(await focusedId()).toBe('Cancel');
    await page.keyboard.press('Escape');
    expect(await events()).toEqual(['confirm cancelled']);
    // Once its exit has played.
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 1);
    expect(await focusedId()).toBe('open-confirm');
    await page.keyboard.press('Escape');
    expect(await events()).toEqual(['confirm cancelled', 'plain closed']);
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
    expect(await focusedId()).toBe('open-plain');
    await page.close();
  }, 30_000);

  it('closes a clean form on Escape straight away', async () => {
    await open('#open-form');
    expect(await focusedId()).toBe('form-text');
    await page.keyboard.press('Escape');
    expect(await events()).toEqual(['form closed']);
    await page.close();
  }, 30_000);

  it('asks before Escape or a backdrop press throws away a form edit, and keeps the text on Keep editing', async () => {
    await open('#open-form');
    await page.keyboard.type('half a thought');
    await page.keyboard.press('Escape');
    await page.waitForSelector('text=Discard your changes?');
    expect(await events()).toEqual([]);
    expect(await focusedId()).toBe('Keep editing');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 1);
    expect(await page.inputValue('#form-text')).toBe('half a thought');

    await page.mouse.click(5, 5);
    await page.waitForSelector('text=Discard your changes?');
    expect(await events()).toEqual([]);
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0);
    expect(await events()).toEqual(['form closed']);
    // Both dialogs went in one render: the focus still finds its way back to what opened the form.
    expect(await focusedId()).toBe('open-form');
    await page.close();
  }, 30_000);

  it('does not close on a press inside the dialog or a drag that ends outside it', async () => {
    await open('#open-plain');
    await page.click('#plain-a');
    const box = (await page.locator('dialog').boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + box.height - 20);
    await page.mouse.down();
    await page.mouse.move(5, 5);
    await page.mouse.up();
    expect(await events()).toEqual([]);
    expect(await page.locator('dialog[open]').count()).toBe(1);
    await page.close();
  }, 30_000);

  // ---- what sits over a modal: toasts (Toaster.tsx) and the phone's sheets (MoSheet), on fixtures/modal-page/overlays.html

  /** Whether a press at the middle of the selector's element lands on it: drawn on top, not under a backdrop. */
  const onTop = (selector: string) =>
    page.evaluate((sel: string) => {
      const el = document.querySelector(sel)!;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && el.contains(hit);
    }, selector);

  it('shows a toast fired over a modal above its backdrop, and takes a click and the focus', async () => {
    await open('#open-modal', 'overlays.html');
    await page.click('#modal-toast');
    await page.waitForSelector('.toast');
    expect(await page.evaluate(() => !!document.querySelector('.toast')!.closest('dialog') && document.querySelector('section[popover]')!.matches(':popover-open'))).toBe(true);
    expect(await onTop('.toast [aria-label="Dismiss"]')).toBe(true);
    // The focus reaches it from inside the modal, and stays while it is held there.
    await page.focus('.toast a');
    expect(await focusedId()).toBe('Open');
    await page.locator('.toast [aria-label="Dismiss"]').click();
    await page.waitForFunction(() => !document.querySelector('.toast'));
    expect(await page.locator('dialog[open]').count()).toBe(1);
    await page.close();
  }, 30_000);

  it('moves a toast back to the page when the modal closes', async () => {
    await open('#open-modal', 'overlays.html');
    await page.click('#modal-toast');
    await page.waitForSelector('dialog .toast');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog[open]') && !!document.querySelector('body > section[popover] .toast'));
    expect(await onTop('.toast [aria-label="Dismiss"]')).toBe(true);
    await page.close();
  }, 30_000);

  it('holds a toast while the focus is in it, and hands the focus back when it is dismissed', async () => {
    page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.goto(fixture.url + 'overlays.html');
    await page.focus('#toast-now');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.toast');
    await page.focus('.toast a');
    await page.waitForTimeout(900);
    expect(await page.locator('.toast').count()).toBe(1);
    await page.focus('.toast [aria-label="Dismiss"]');
    await page.keyboard.press('Enter');
    expect(await focusedId()).toBe('toast-now');
    await page.waitForFunction(() => !document.querySelector('.toast'), undefined, { timeout: 5000 });
    // Unheld, a toast goes on its own.
    await page.click('#toast-now');
    await page.waitForSelector('.toast');
    await page.waitForFunction(() => !document.querySelector('.toast'), undefined, { timeout: 5000 });
    await page.close();
  }, 30_000);

  const inert = (id: string) => page.evaluate((el: string) => document.getElementById(el)!.inert, id);
  const sheetOf = () => page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute('aria-label') ?? null);

  it('makes the screens and the tab bar inert under a phone sheet, and a lower sheet under the top one', async () => {
    await open('#open-sheet', 'overlays.html', '[role="dialog"]');
    expect([await inert('screens'), await inert('tabs')]).toEqual([true, true]);
    expect(await sheetOf()).toBe('Outer');
    await page.evaluate(() => document.getElementById('tab-button')!.focus());
    expect(await focusedId()).not.toBe('tab-button');

    await page.click('#open-inner');
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 2);
    expect(await focusedId()).toBe('inner-field');
    expect(await page.evaluate(() => (document.querySelector('[aria-label="Outer"]') as HTMLElement).inert)).toBe(true);

    // One Escape closes one sheet, and each hands the focus back to what opened it.
    await page.keyboard.press('Escape');
    expect(await events()).toEqual(['inner closed']);
    expect(await focusedId()).toBe('open-inner');
    await page.keyboard.press('Escape');
    expect(await events()).toEqual(['inner closed', 'outer closed']);
    expect(await focusedId()).toBe('open-sheet');
    expect([await inert('screens'), await inert('tabs')]).toEqual([false, false]);
    await page.close();
  }, 30_000);

  it('shows a toast fired from a phone sheet over it, and takes a click', async () => {
    page = await browser.newPage({ viewport: { width: 390, height: 700 } });
    await page.goto(fixture.url + 'overlays.html');
    await page.click('#open-sheet');
    await page.click('#sheet-toast');
    await page.waitForSelector('.toast');
    expect(await onTop('.toast [aria-label="Dismiss"]')).toBe(true);
    // The browser fits a popover to its content: the region still spans the phone, less its 16px gutters.
    expect(await page.evaluate(() => (document.querySelector('.toast') as HTMLElement).offsetWidth)).toBe(358);
    await page.locator('.toast [aria-label="Dismiss"]').click();
    await page.waitForFunction(() => !document.querySelector('.toast'));
    expect(await events()).toEqual([]);
    await page.close();
  }, 30_000);
});
