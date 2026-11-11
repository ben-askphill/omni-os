// One step of a QA script, against an app the harness has already launched (qa.ts).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopBridge } from '@omni/shared/desktop-bridge.ts';
import type { ElectronApplication, Page } from 'playwright';
import { EVENT } from '../src/ipc.ts';
import { resolveMenuPath, withDeadline, type Appearance, type MenuNode, type QAStep, type WindowTarget } from './qa.ts';

/** The route step waits this long for the hash. The other steps carry their own timeout. */
const ROUTE_TIMEOUT_MS = 10_000;

export interface StepSession {
  app: ElectronApplication;
  page: Page | null;
  appearance: Appearance | null;
  out: string;
  style: (page: Page) => Promise<void>;
  pick: (target: WindowTarget, timeoutMs: number) => Promise<Page>;
  external: () => Promise<string[]>;
}

/** Run one step. Screenshot paths are pushed onto `files` before a failed capture throws, so the report keeps them. */
export async function runStep(step: QAStep, session: StepSession, files: string[]): Promise<void> {
  const page = session.page;
  if (!page || page.isClosed()) throw new Error('the current window is closed; pick another with a window step');
  const { app } = session;
  switch (step.kind) {
    case 'route':
      await page.evaluate((route) => {
        window.location.hash = route.slice(1);
      }, step.route);
      await page.waitForFunction((route) => window.location.hash === route, step.route, { timeout: ROUTE_TIMEOUT_MS });
      return;
    case 'click':
      await page.locator(step.selector).first().click({ timeout: step.timeoutMs });
      return;
    case 'fill':
      await page.locator(step.selector).first().fill(step.text, { timeout: step.timeoutMs });
      return;
    case 'type':
      await page.keyboard.type(step.text);
      return;
    case 'press':
      await page.keyboard.press(step.key);
      return;
    case 'wait':
      await page.waitForTimeout(step.ms);
      return;
    case 'waitFor':
      await page.locator(step.selector).first().waitFor({ state: 'visible', timeout: step.timeoutMs });
      return;
    case 'expect': {
      const target = page.locator(step.selector).first();
      await target.waitFor({ state: 'visible', timeout: step.timeoutMs });
      if (step.text !== null) {
        const want = step.text;
        const deadline = Date.now() + step.timeoutMs;
        let seen = '';
        for (;;) {
          seen = (await target.innerText()).trim();
          if (seen.includes(want)) break;
          if (Date.now() > deadline) throw new Error(`${step.selector} shows "${seen.slice(0, 200)}", not "${want}"`);
          await page.waitForTimeout(100);
        }
      }
      return;
    }
    case 'expectExternal': {
      const deadline = Date.now() + step.timeoutMs;
      for (;;) {
        const opened = await session.external();
        if (opened.some((u) => u.includes(step.text))) break;
        if (Date.now() > deadline) throw new Error(`no link with "${step.text}" went to the system browser; it got ${JSON.stringify(opened)}`);
        await page.waitForTimeout(100);
      }
      return;
    }
    case 'command':
      await (await app.browserWindow(page)).evaluate((win, payload) => win.webContents.send(payload.channel, payload.event), {
        channel: EVENT,
        event: { type: 'command' as const, command: step.command },
      });
      return;
    case 'menu': {
      const id = await (await app.browserWindow(page)).evaluate((win) => win.id);
      // No named helpers inside these: tsx wraps them in a __name call that the main process does not define.
      const tree = await app.evaluate(({ Menu }) => {
        const root: MenuNode[] = [];
        const queue = [{ from: Menu.getApplicationMenu()?.items ?? [], into: root }];
        for (let next = queue.shift(); next; next = queue.shift()) {
          for (const it of next.from) {
            const node: MenuNode = { label: it.label, visible: it.visible, enabled: it.enabled, items: [] };
            next.into.push(node);
            if (it.submenu) queue.push({ from: it.submenu.items, into: node.items });
          }
        }
        return root;
      });
      const indices = resolveMenuPath(tree, step.path);
      if (!Array.isArray(indices)) throw new Error(indices.error);
      const error = await app.evaluate(({ BrowserWindow, Menu }, input) => {
        let items = Menu.getApplicationMenu()?.items ?? [];
        let item: (typeof items)[number] | undefined;
        for (const i of input.indices) {
          item = items[i];
          items = item?.submenu?.items ?? [];
        }
        if (!item) return 'the menu changed under the step';
        const win = BrowserWindow.fromId(input.id) ?? undefined;
        item.click(undefined, win, win?.webContents);
        return null;
      }, { indices, id });
      if (error) throw new Error(error);
      return;
    }
    case 'window':
      session.page = await session.pick(step.target, step.timeoutMs);
      await session.page.waitForLoadState('domcontentloaded');
      await session.style(session.page);
      await session.page.bringToFront();
      return;
    case 'openWindow': {
      const opened = app.waitForEvent('window', { timeout: step.timeoutMs });
      await page.evaluate((route) => {
        const bridge = (window as unknown as { omniDesktop?: DesktopBridge }).omniDesktop;
        if (!bridge) throw new Error('this window has no desktop bridge');
        bridge.openWindow(route);
      }, step.route);
      session.page = await opened;
      await session.page.waitForLoadState('domcontentloaded');
      await session.page.waitForSelector('#root > *', { timeout: step.timeoutMs });
      await session.style(session.page);
      return;
    }
    case 'appearance': {
      session.appearance = step.appearance;
      const mode = step.appearance;
      await app.evaluate(({ nativeTheme }, m) => {
        nativeTheme.themeSource = m;
      }, mode);
      for (const w of app.windows()) if (!w.isClosed()) await session.style(w);
      return;
    }
    case 'zoom':
      await setZoom(app, page, step.factor);
      return;
    case 'size': {
      const size = step.size;
      await (await app.browserWindow(page)).evaluate((win, s) => win.setSize(s.width, s.height), size);
      return;
    }
    case 'screenshot': {
      const win = await app.browserWindow(page);
      // A hidden window draws no frames, so its frame wait and its capture would never answer.
      if (!(await win.evaluate((w) => w.isVisible() && !w.isMinimized()))) throw new Error('the window is hidden or minimized; show it or pick another with a window step');
      // A blank window is a failed load, not a screenshot worth keeping.
      const drawn = await page.evaluate(() => {
        const body = document.body;
        return !!body && (body.innerText.trim().length > 0 || !!body.querySelector('img, svg, canvas, video'));
      });
      // Two frames, so the capture holds what the last step changed and not the frame before it. A window the OS
      // reports as covered may draw no frames until the capture wakes it, so the wait is capped and not required.
      await withDeadline(page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))), 2_000, 'no frame').catch(() => {});
      // The window's own capture: Playwright's page.screenshot crops a zoomed page to its CSS viewport.
      const png = await withDeadline(
        win.evaluate(async (w) => (await w.webContents.capturePage()).toPNG().toString('base64')),
        15_000,
        'the window capture did not answer in 15s',
      );
      const file = join(session.out, `${step.name}.png`);
      writeFileSync(file, Buffer.from(png, 'base64'));
      files.push(file);
      if (!drawn) throw new Error('the window drew nothing');
      return;
    }
    case 'quit':
      return;
    default: {
      const unexpected: never = step;
      throw new Error(`unknown step ${JSON.stringify(unexpected)}`);
    }
  }
}

/** Through the bridge, as the View menu does, so the setting and the window agree; then on the window directly. */
export async function setZoom(app: ElectronApplication, page: Page, factor: number): Promise<void> {
  await page.evaluate(async (z) => {
    const bridge = (window as unknown as { omniDesktop?: DesktopBridge }).omniDesktop;
    if (bridge) await bridge.settings.set({ zoom: z });
  }, factor);
  await (await app.browserWindow(page)).evaluate((win, z) => win.webContents.setZoomFactor(z), factor);
}
