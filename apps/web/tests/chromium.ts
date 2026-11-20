import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';

// A fixture page under tests/fixtures served by Vite and driven in a real Chromium, for what happy-dom does not model
// (the top layer, showModal(), close requests, popovers). `executablePath` is null where no Chromium or Chrome is
// installed, and the suites skip; OMNI_TEST_CHROMIUM names one.

// Loaded by a name TypeScript does not follow: playwright's types bring Electron's globals, which clash with the
// web app's own WebviewTag (NativeBrowser.tsx). The handful of calls the tests make need no more than this.
type Locator = { boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>; count(): Promise<number>; click(): Promise<void> };
export type Page = {
  goto(url: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  waitForSelector(selector: string, options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden' }): Promise<unknown>;
  waitForFunction<A = undefined>(fn: (arg: A) => boolean, arg?: A, options?: { timeout: number }): Promise<unknown>;
  evaluate<T, A = void>(fn: (arg: A) => T, arg?: A): Promise<T>;
  emulateMedia(options: { reducedMotion: 'reduce' | 'no-preference' }): Promise<void>;
  locator(selector: string): Locator;
  getByRole(role: string, options: { name: string }): Locator;
  focus(selector: string): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  inputValue(selector: string): Promise<string>;
  keyboard: { press(key: string): Promise<void>; type(text: string): Promise<void> };
  mouse: { click(x: number, y: number): Promise<void>; move(x: number, y: number): Promise<void>; down(): Promise<void>; up(): Promise<void>; wheel(dx: number, dy: number): Promise<void> };
  close(): Promise<void>;
};
export type Browser = { newPage(options: { viewport: { width: number; height: number } }): Promise<Page>; close(): Promise<void> };
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

export const executablePath = await findChromium();

/** Chromium alone, for a test that serves its own pages (thread-find-browser.test.ts runs the whole Web UI). */
export async function launchChromium(): Promise<Browser> {
  const chromium = await loadChromium();
  return chromium.launch({ executablePath: executablePath! });
}

/** Serve tests/fixtures/<name> and launch Chromium on it. */
export async function startFixture(name: string): Promise<{ url: string; browser: Browser; stop: () => Promise<void> }> {
  const { createServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const { default: tailwindcss } = await import('@tailwindcss/vite');
  const server: ViteDevServer = await createServer({
    configFile: false,
    root: join(import.meta.dirname, 'fixtures', name),
    plugins: [react(), tailwindcss()],
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
  await server.listen();
  const chromium = await loadChromium();
  const browser = await chromium.launch({ executablePath: executablePath! });
  return {
    url: server.resolvedUrls!.local[0]!,
    browser,
    stop: async () => {
      await browser.close();
      await server.close();
    },
  };
}
