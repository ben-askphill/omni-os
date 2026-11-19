import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as listen } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LONG_THREAD } from '@omni/test-fixtures/long-thread.ts';
import { executablePath, launchChromium, type Browser, type Page } from './chromium.ts';
import { OUTPUT_NEEDLE, seedLongThread } from './find-seed.ts';

// Find in a thread, end to end in Chromium: a real server on a temp data dir with the fake CLIs, the Web UI through
// Vite, and a long thread whose early rows the client does not hold when it opens. Cmd/Ctrl+F opens the bar, a term
// only an early message has is counted, loaded, scrolled to and highlighted; Enter and Shift+Enter step; Esc clears.

const ROOT = join(import.meta.dirname, '../../..');
const FX = join(ROOT, 'packages/test-fixtures');
const TOKEN = 'find-test-token-0123456789abcdef0123456789abcdef';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = listen().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

describe.skipIf(!executablePath)('find in a thread, in Chromium', () => {
  let dir: string;
  let server: ChildProcess;
  let vite: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let api: string;
  let threadId: string;

  const call = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${api}${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...init?.headers } });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const until = async (what: string, ok: () => Promise<boolean>, ms = 60_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
      if (await ok().catch(() => false)) return;
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  /** The find bar's count, the current match's text and where it sits in the transcript's scroller. */
  const state = () =>
    page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('[data-key]')?.closest<HTMLElement>('.overflow-y-auto');
      const range = [...(CSS.highlights.get('thread-find-current') ?? [])][0] as Range | undefined;
      const r = range?.getBoundingClientRect();
      const box = scroller?.getBoundingClientRect();
      const event = range?.startContainer.parentElement?.closest('[data-find-event]')?.getAttribute('data-find-event');
      return {
        count: document.querySelector('[role="search"] [aria-live]')?.textContent ?? null,
        current: range?.toString() ?? null,
        event: event ? Number(event) : null,
        visible: !!(r && box && r.height > 0 && r.top >= box.top && r.bottom <= box.bottom),
        hits: CSS.highlights.get('thread-find')?.size ?? 0,
      };
    });

  /** Until the current match is painted and inside the transcript's view. */
  const landed = () =>
    page.waitForFunction(
      () => {
        const r = [...(CSS.highlights.get('thread-find-current') ?? [])][0] as Range | undefined;
        const box = document.querySelector('[data-key]')?.closest('.overflow-y-auto')?.getBoundingClientRect();
        const rect = r?.getBoundingClientRect();
        return !!(rect && box && rect.height > 0 && rect.top >= box.top && rect.bottom <= box.bottom);
      },
      undefined,
      { timeout: 20_000 },
    );

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'omni-find-'));
    const data = join(dir, 'data');
    // Onboarded, so no first-run dialog covers the thread.
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'omni.config.json'), JSON.stringify({ onboardedAt: '2026-01-01T00:00:00.000Z' }));
    const port = await freePort();
    api = `http://127.0.0.1:${port}/api`;
    server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/index.ts'], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        OMNI_TOKEN: TOKEN,
        OMNI_PORT: String(port),
        OMNI_DATA_DIR: data,
        OMNI_BRAIN_DIR: join(dir, 'brain'),
        OMNI_CLAUDE_BIN: join(FX, 'fake-claude.mjs'),
        OMNI_CODEX_BIN: join(FX, 'fake-codex.mjs'),
        OMNI_CURSOR_BIN: join(FX, 'fake-cursor.mjs'),
        OMNI_BROWSER: '0',
        OMNI_SUGGESTIONS: '0',
        OMNI_UPDATE_CHECK: '0',
        OMNI_SUPERVISOR: '',
        OMNI_CAFFEINATE: '0',
        OMNI_CLAUDE_LOGIN_SYNC: '0',
        OMNI_ACCESS_DEFAULT: 'full',
        OMNI_HERMES_URL: '',
        OMNI_CURSOR_API_URL: 'http://127.0.0.1:9',
        OMNI_NATIVE_MCP: join(dir, 'no-omni-mcp'),
      },
    });
    await until('the server', async () => !!(await call('/channels')));
    const made = await call<{ id: string }>('/threads', { method: 'POST', body: JSON.stringify({ channel: 'inbox', title: 'Long thread', prompt: 'Start' }) });
    threadId = made.id;
    await until('the first turn', async () => (await call<{ thread: { status: string } }>(`/threads/${threadId}`)).thread.status !== 'running');
    seedLongThread(join(data, 'omni.db'), threadId);

    process.env.OMNI_PORT = String(port);
    const { createServer } = await import('vite');
    vite = await createServer({ configFile: join(ROOT, 'apps/web/vite.config.ts'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
    await vite.listen();
    browser = await launchChromium();
    page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(`${vite.resolvedUrls!.local[0]}#/t/${threadId}?pair=${TOKEN}`);
    await page.waitForSelector('[data-key]');
  }, 180_000);

  afterAll(async () => {
    await page?.close();
    await browser?.close();
    await vite?.close();
    if (server?.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        /* gone */
      }
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('finds an early message the client does not hold, loads it, scrolls to it and highlights it', async () => {
    const { hits } = await call<{ hits: { event: number }[] }>(`/threads/${threadId}/find?q=${LONG_THREAD.oldNeedle}`);
    const needle = hits[0].event;
    // Opened on its newest page: the early message is not on the page at all.
    expect(await page.evaluate((id) => !!document.querySelector(`[data-key="${id}"]`), needle)).toBe(false);
    expect(await page.evaluate((t) => document.body.textContent?.includes(t), LONG_THREAD.oldNeedle)).toBe(false);

    await page.keyboard.press('Control+f');
    await page.waitForSelector('[role="search"] input');
    await page.keyboard.type(LONG_THREAD.oldNeedle.toUpperCase());
    await page.waitForFunction(() => [...(CSS.highlights.get('thread-find-current') ?? [])].length === 1, undefined, { timeout: 20_000 });
    const s = await state();
    expect(s.count).toBe('1 of 1');
    expect(s.current).toBe(LONG_THREAD.oldNeedle);
    expect(s.event).toBe(needle);
    expect(s.visible).toBe(true);
  });

  it('opens the folded steps an early tool output sits in', async () => {
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[role="search"] input')!;
      input.select();
    });
    await page.keyboard.type(OUTPUT_NEEDLE);
    await page.waitForFunction((t) => [...(CSS.highlights.get('thread-find-current') ?? [])][0]?.toString() === t, OUTPUT_NEEDLE, { timeout: 20_000 });
    const s = await state();
    expect(s.count).toBe('1 of 1');
    expect(s.visible).toBe(true);
  });

  it('steps with Enter and Shift+Enter, scrolling each match into view, and Esc clears it', async () => {
    await page.evaluate(() => document.querySelector<HTMLInputElement>('[role="search"] input')!.select());
    // In every turn's first message ("Turn 12: ..."), on top of the pelican's: one per turn, the early ones not held.
    await page.keyboard.type('Turn 1');
    await page.waitForFunction(() => /^\d+ of \d+$/.test(document.querySelector('[role="search"] [aria-live]')?.textContent ?? ''), undefined, { timeout: 20_000 });
    await landed();
    const first = await state();
    const [at, total] = first.count!.split(' of ').map(Number);
    expect(total).toBeGreaterThan(3);
    const seen = [first];
    for (const key of ['Enter', 'Enter', 'Shift+Enter']) {
      const before = seen.at(-1)!;
      await page.keyboard.press(key);
      await page.waitForFunction((c) => document.querySelector('[role="search"] [aria-live]')?.textContent !== c, before.count, { timeout: 10_000 });
      await landed();
      seen.push(await state());
    }
    const index = (c: string | null) => Number(c!.split(' of ')[0]);
    expect(seen.map((s) => index(s.count))).toEqual([at, (at % total) + 1, ((at + 1) % total) + 1, (at % total) + 1]);
    expect(seen.every((s) => s.visible && s.current?.toLowerCase() === 'turn 1')).toBe(true);
    // Enter, then Shift+Enter, lands back on the same match.
    expect(seen[3].event).toBe(seen[1].event);

    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="search"]', { state: 'detached' });
    expect(await page.evaluate(() => CSS.highlights.has('thread-find') || CSS.highlights.has('thread-find-current'))).toBe(false);
  });
});
