import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { executablePath, startFixture, type Browser, type Page } from './chromium.ts';

// The composer's text box (components/composer/MessageEditor.tsx) in a real Chromium, on
// tests/fixtures/message-editor-page: ui-sdk's Token Input with the `@` and `/` Trigger Menu, typed with real keys.

type State = { text: string; records: { kind: string; body: { machine?: string; agent?: string; name: string; reachability?: string } }[]; keys: string[]; errors: string[]; menu: boolean };

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
  const tabs = () => page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => (t.getAttribute('aria-selected') === 'true' ? `[${t.textContent}]` : t.textContent)));
  const chips = () => page.evaluate(() => [...document.querySelectorAll('[data-slot="token-input-editor"] .mention-pill')].map((c) => c.textContent));

  it('@ opens the picker on Agents, the arrows and Enter put the machine in as one chip with its record', async () => {
    await load();
    await page.keyboard.type('@');
    // Tabs Machines | Agents | Files, opening on Agents (Q11). Typing searches them all, and the tab with hits shows.
    await until(async () => (await tabs()).length === 3);
    expect(await tabs()).toEqual(['Machines', '[Agents]', 'Files']);
    expect((await options()).map((o) => o.text)).toEqual([expect.stringContaining('Reviewer')]);
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
    await until(async () => (await tabs()).length === 3);
    // A press on a tab keeps the caret in the box.
    await page.click('[role="tab"]:has-text("Machines")');
    await until(async () => (await options()).length === 2);
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
    // Cmd+Z on a Mac, Ctrl+Z elsewhere, as the Token Input reads it.
    await page.keyboard.press('ControlOrMeta+z');
    await until(async () => (await state()).text === '@omarchy');
    expect((await state()).records).toHaveLength(1);
    expect(await chips()).toEqual(['omarchy']);
  });

  it('an agent goes in as a chip with its record, anywhere in the message; a file as plain text', async () => {
    await load();
    await page.keyboard.type('ask @rev');
    await until(async () => (await options()).length === 1);
    await page.keyboard.press('Enter');
    await until(async () => (await state()).text === 'ask @Reviewer ');
    expect((await state()).records).toEqual([expect.objectContaining({ kind: 'agent_mention', body: { agent: 'reviewer', name: 'Reviewer' } })]);
    expect(await chips()).toEqual([expect.stringContaining('Reviewer')]);
    await page.keyboard.type('to look at @main');
    await until(async () => (await options()).length === 1);
    await page.keyboard.press('Enter');
    await until(async () => (await state()).text === 'ask @Reviewer to look at @apps/web/src/main.tsx ');
    expect((await state()).records).toHaveLength(1);
  });

  it('stays open while the search for the typed word runs, after a search that found no files', async () => {
    // Picking an agent leaves the last search (`rev`) with no file rows. A word no agent matches then had nothing to
    // show until its own search answered, so the menu closed and opened again on every key, and stayed shut when the
    // word ended on a closing key: typed quickly or on a busy machine, `@main` never offered the file.
    await load('?slow=400');
    await page.keyboard.type('ask @rev');
    await until(async () => (await options()).length === 1);
    // The search for `rev` answers, with no files.
    await page.waitForTimeout(600);
    await page.keyboard.press('Enter');
    await until(async () => (await state()).text === 'ask @Reviewer ');
    await page.keyboard.type('to look at @');
    await until(menuOpen);
    // Each key lands before the search for the word so far answers.
    const open: boolean[] = [];
    for (const key of 'main') {
      await page.keyboard.type(key);
      await page.waitForTimeout(120);
      open.push(await menuOpen());
    }
    expect(open).toEqual([true, true, true, true]);
    await until(async () => (await options()).map((o) => o.text).join() === 'main.tsxapps/web/src');
    await page.keyboard.press('Enter');
    await until(async () => (await state()).text === 'ask @Reviewer to look at @apps/web/src/main.tsx ');
  });

  // A chip stacked on each of three lines, the tightest case: in the reply box, and at the phone composer's 16px on a
  // 1.35 line.
  for (const [box, query] of [
    ['the reply box', ''],
    ["the phone composer's tight lines", '?tight'],
  ] as const) {
    it(`chips sit on the words' baseline, keep a gap to the chips above and below, and keep the line height, in ${box}`, async () => {
      await load(query);
      // The records a pick from the `@` menu adds, then the text with a chip at the start of each line. The menu is not
      // what this checks, and under load it can close again while a query is typed.
      await page.evaluate(() => {
        window.mention('agent', 'reviewer', 'Reviewer');
        window.mention('machine', 'dev-omarchy', 'omarchy');
        window.mention('machine', 'dev-mbp', 'MacBook-Pro');
      });
      await until(async () => (await state()).records.length === 3);
      await page.evaluate(() => window.setText('@Reviewer reviews it\n@omarchy runs it\n@MacBook-Pro ships it'));
      await until(async () => (await chips()).length === 3 && (await state()).text.endsWith('ships it'));
      const m = await page.evaluate(() => {
        const box = document.querySelector('[data-slot="token-input-editor"]')!;
        const blank = (s: string) => !s.replace(/[\s\u200b]/g, '');
        const letter = (node: Node, at: number) => {
          const r = document.createRange();
          r.setStart(node, at);
          r.setEnd(node, at + 1);
          return r.getBoundingClientRect();
        };
        const words: Text[] = [];
        const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        for (let n; (n = walk.nextNode() as Text | null); ) if (!blank(n.data) && !n.parentElement!.closest('.mention-pill') && getComputedStyle(n.parentElement!).position !== 'absolute') words.push(n);
        const pills = [...box.querySelectorAll('.mention-pill')];
        const boxes = pills.map((p) => p.getBoundingClientRect());
        const style = getComputedStyle(box);
        const line = parseFloat(style.lineHeight);
        return {
          // The name's first letter against the first plain letter after the chip, on its line: the same font puts
          // every letter's box the same distance under the baseline.
          baselines: pills.map((p) => {
            const name = [...p.childNodes].reverse().find((n) => n.nodeType === Node.TEXT_NODE && !blank(n.textContent!))!;
            const after = words.find((n) => p.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)!;
            return Math.round(letter(name, 0).bottom - letter(after, after.data.search(/[^\s\u200b]/)).bottom) || 0;
          }),
          gaps: boxes.slice(1).map((b, i) => +(b.top - boxes[i].bottom).toFixed(2)),
          // How far three lines with a chip each outgrow three plain lines.
          growth: Math.round(box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 3 * line) || 0,
        };
      });
      expect(m.baselines).toEqual([0, 0, 0]);
      expect(m.gaps).toHaveLength(2);
      for (const gap of m.gaps) expect(gap).toBeGreaterThan(1.5);
      expect(m.growth).toBe(0);
    }, 30_000);
  }

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
    // The chip from the pick already counts as one, so wait for the box itself to show the new text.
    await until(async () => (await chips()).length === 1 && (await page.evaluate(() => !!document.querySelector('[data-slot="token-input-editor"]')!.textContent?.startsWith('then'))));
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
