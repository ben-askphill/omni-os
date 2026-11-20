import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { executablePath, startFixture, type Browser, type Page } from './chromium.ts';

// The composer's text box (components/composer/MessageEditor.tsx) in a real Chromium, on
// tests/fixtures/message-editor-page: ui-sdk's Token Input with the `@` and `/` Trigger Menu, typed with real keys.

type State = { text: string; records: { kind: string; body: { machine: string; name: string; reachability: string } }[]; keys: string[]; errors: string[]; menu: boolean };

describe.skipIf(!executablePath)('MessageEditor in Chromium', () => {
  let fixture: Awaited<ReturnType<typeof startFixture>>;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    fixture = await startFixture('message-editor-page');
    browser = fixture.browser;
  }, 60_000);

  afterAll(async () => {
    await fixture?.stop();
  });

  afterEach(async () => {
    await page?.close();
  });

  const load = async (query = '') => {
    page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    await page.goto(`${fixture.url}${query}`);
    await page.waitForSelector('[data-slot="token-input-editor"]');
    await page.focus('[data-slot="token-input-editor"]');
  };
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.state)) as State);
  const options = () => page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => ({ text: o.textContent, highlighted: o.hasAttribute('data-highlighted') })));
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 60 && !(await check()); i++) await page.waitForTimeout(50);
    expect(await check()).toBe(true);
  };
  const menuOpen = () => page.evaluate(() => !!document.querySelector('[data-slot="trigger-menu-content"][data-open]'));
  const chips = () => page.evaluate(() => [...document.querySelectorAll('[data-slot="token-input-editor"] .mention-pill')].map((c) => c.textContent));

  it('@ opens the picker, the arrows and Enter put the machine in as one chip with its record', async () => {
    await load();
    await page.keyboard.type('@');
    await until(async () => (await options()).length === 5);
    expect((await options()).map((o) => o.text)).toEqual(expect.arrayContaining([expect.stringContaining('Reviewer'), expect.stringContaining('omarchy'), expect.stringContaining('report.html')]));
    await page.keyboard.type('Mac');
    await until(async () => (await options()).length === 1);
    expect((await options())[0].text).toContain('MacBook-Pro');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('om');
    await until(async () => (await options()).map((o) => o.text).join() === 'omarchyOnline');
    await page.keyboard.press('Enter');
    await until(async () => !(await menuOpen()));
    const s = await state();
    expect(s.text).toBe('@omarchy ');
    expect(s.keys).not.toContain('Enter');
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ kind: 'machine_mention', body: { machine: 'dev-omarchy', name: 'omarchy', reachability: 'online' } });
    expect(await chips()).toEqual(['omarchy']);
    await page.keyboard.type('run the tests');
    expect((await state()).text).toBe('@omarchy run the tests');
  });

  it('ArrowDown moves the highlight and Escape closes the menu, keeping the text', async () => {
    await load();
    await page.keyboard.type('hi @');
    await until(async () => (await options()).length === 4);
    const first = await options();
    expect(first[0].highlighted).toBe(true);
    expect(first.map((o) => o.text).join()).not.toContain('Reviewer');
    await page.keyboard.press('ArrowDown');
    expect((await options())[1].highlighted).toBe(true);
    await page.keyboard.press('Enter');
    await until(async () => (await state()).text === 'hi @MacBook-Pro ');
    expect((await state()).records[0].body.machine).toBe('dev-mbp');
    await page.keyboard.type('@');
    await until(menuOpen);
    await page.keyboard.press('Escape');
    await until(async () => !(await menuOpen()));
    expect((await state()).text).toBe('hi @MacBook-Pro @');
  });

  it('Backspace takes the chip as one unit and drops its record; Undo brings both back', async () => {
    await load();
    await page.keyboard.type('@om');
    await until(async () => (await options()).length === 1);
    await page.keyboard.press('Tab');
    await until(async () => (await state()).records.length === 1);
    await page.keyboard.press('Backspace');
    expect((await state()).text).toBe('@omarchy');
    await page.keyboard.press('Backspace');
    await until(async () => (await state()).text === '');
    expect((await state()).records).toEqual([]);
    expect(await chips()).toEqual([]);
    await page.keyboard.press('Control+z');
    await until(async () => (await state()).text === '@omarchy');
    expect((await state()).records).toHaveLength(1);
    expect(await chips()).toEqual(['omarchy']);
  });

  it('a file and an agent go in as plain text', async () => {
    await load();
    await page.keyboard.type('@rev');
    await until(async () => (await options()).length === 1);
    await page.keyboard.press('Enter');
    await until(async () => (await state()).text === '@reviewer ');
    await page.keyboard.type('look at @main');
    await until(async () => (await options()).length === 1);
    await page.keyboard.press('Enter');
    await until(async () => (await state()).text === '@reviewer look at @apps/web/src/main.tsx ');
    expect((await state()).records).toEqual([]);
    expect(await chips()).toEqual([]);
  });

  it('/ at the start lists the commands and picks one', async () => {
    await load();
    await page.keyboard.type('/de');
    await until(menuOpen);
    // Ranked like the old menu: a name match first, then the commands whose description matches.
    expect((await options())[0].text).toContain('/deploy');
    await page.keyboard.press('Enter');
    await until(async () => (await state()).text === '/deploy ');
    expect((await state()).keys).not.toContain('Enter');
  });

  it("Enter with the menu closed is the composer's", async () => {
    await load();
    await page.keyboard.type('ship it');
    await page.keyboard.press('Enter');
    const s = await state();
    expect(s.keys).toContain('Enter');
    expect(s.text).toBe('ship it');
  });

  it('text set from outside shows its machine as a chip, and the caret goes to the end', async () => {
    await load();
    await page.keyboard.type('@om');
    await until(async () => (await options()).length === 1);
    await page.keyboard.press('Enter');
    await until(async () => (await state()).text === '@omarchy ');
    await page.evaluate(() => window.setText('then @omarchy deploys'));
    await until(async () => (await chips()).length === 1);
    await page.evaluate(() => window.editor!.focus('end'));
    await page.keyboard.type('!');
    expect((await state()).text).toBe('then @omarchy deploys!');
  });

  it('opens below the box when asked', async () => {
    await load('?below');
    await page.keyboard.type('@');
    await until(menuOpen);
    const where = await page.evaluate(() => {
      const menu = document.querySelector('[data-slot="trigger-menu-content"]')!.getBoundingClientRect();
      const box = document.querySelector('[data-slot="token-input-editor"]')!.parentElement!.getBoundingClientRect();
      return { menuTop: menu.top, boxBottom: box.bottom, menuWidth: menu.width, boxWidth: box.width };
    });
    expect(where.menuTop).toBeGreaterThanOrEqual(where.boxBottom);
    expect(Math.round(where.menuWidth)).toBe(Math.round(where.boxWidth));
  });
});
