import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ViteDevServer } from 'vite';

// The Modal in a real Chromium, for what happy-dom does not model: showModal() keeps Tab inside, makes the page
// behind inert, and sends Escape to the top dialog only. The page is tests/fixtures/modal-page, served by Vite.
// Skips where no Chromium or Chrome is installed; OMNI_TEST_CHROMIUM names one.

// Loaded by a name TypeScript does not follow: playwright's types bring Electron's globals, which clash with the
// web app's own WebviewTag (NativeBrowser.tsx). The handful of calls here need no more than this.
type Locator = { boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>; count(): Promise<number>; click(): Promise<void> };
type Page = {
  goto(url: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  waitForSelector(selector: string): Promise<unknown>;
  waitForFunction(fn: () => boolean): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  locator(selector: string): Locator;
  getByRole(role: string, options: { name: string }): Locator;
  inputValue(selector: string): Promise<string>;
  keyboard: { press(key: string): Promise<void>; type(text: string): Promise<void> };
  mouse: { click(x: number, y: number): Promise<void>; move(x: number, y: number): Promise<void>; down(): Promise<void>; up(): Promise<void> };
  close(): Promise<void>;
};
type Browser = { newPage(options: { viewport: { width: number; height: number } }): Promise<Page>; close(): Promise<void> };
type Chromium = { executablePath(): string; launch(options: { executablePath: string }): Promise<Browser> };
const PLAYWRIGHT: string = 'playwright';
const loadChromium = async (): Promise<Chromium> => ((await import(PLAYWRIGHT)) as { chromium: Chromium }).chromium;

async function findChromium(): Promise<string | null> {
  const chromium = await loadChromium();
  const candidates = [
    process.env.OMNI_TEST_CHROMIUM,
    chromium.executablePath(),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
}

const executablePath = await findChromium();

describe.skipIf(!executablePath)('a modal in Chromium', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const { createServer } = await import('vite');
    const { default: react } = await import('@vitejs/plugin-react');
    const { default: tailwindcss } = await import('@tailwindcss/vite');
    server = await createServer({
      configFile: false,
      root: join(import.meta.dirname, 'fixtures/modal-page'),
      plugins: [react(), tailwindcss()],
      server: { host: '127.0.0.1', port: 0 },
      logLevel: 'error',
    });
    await server.listen();
    const chromium = await loadChromium();
    browser = await chromium.launch({ executablePath: executablePath! });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  const open = async (button: string) => {
    page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.goto(server.resolvedUrls!.local[0]!);
    await page.click(button);
    await page.waitForSelector('dialog[open]');
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
    expect(await page.locator('dialog[open]').count()).toBe(1);
    expect(await focusedId()).toBe('open-confirm');
    await page.keyboard.press('Escape');
    expect(await events()).toEqual(['confirm cancelled', 'plain closed']);
    expect(await page.locator('dialog[open]').count()).toBe(0);
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
});
