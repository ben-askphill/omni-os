import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readAddress } from '@omni/shared/address-bar.ts';

/** The channel browser's types and pure helpers: viewport clamping, tab icons, key commands, Chrome lookup and URL normalizing. */

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  /** The page's icon, or its origin's /favicon.ico. Absent for blank and non-web pages. */
  favicon?: string;
}

export interface BrowserState {
  running: boolean;
  url: string;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  tabs: BrowserTab[];
  active: string | null;
  /** The viewport the page lays out at, in CSS pixels: the viewer's size while one is watching. */
  viewport: { width: number; height: number };
}

export interface BrowserFrame {
  /** base64 JPEG */
  data: string;
  /** The page viewport in CSS pixels, so clients can map a click on the scaled image back. */
  width: number;
  height: number;
  /** How far the page was scrolled in this frame, in CSS pixels, so an annotation drawn on an earlier frame can follow it. */
  scrollX?: number;
  scrollY?: number;
}

export type BrowserEvent = { type: 'state'; state: BrowserState } | ({ type: 'frame' } & BrowserFrame);

/**
 * What the active page is at one moment, for a capture to compare before and after (browser-capture.ts). Anything that
 * differs between the two means the screenshot may not show the page the record describes.
 */
export interface PageObservation {
  tab: string | null;
  url: string;
  title: string;
  /** Main-frame navigations so far. A reload to the same address still counts. */
  navigations: number;
  /** The viewport and scroll in CSS pixels. */
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
}

export type Listener = (e: BrowserEvent) => void;

export const VIEWPORT = { width: 1280, height: 800 };
/** The window's page area at VIEWPORT, what the agent gets with no viewer resizing it. */
export const WINDOW_PAGE = { width: 1280, height: 713 };

/** A viewer's size, clamped to what a page can sensibly lay out at. */
/** Sharp enough that text reads like a native browser's; 100 costs several times the bytes for no visible gain. */
export const SCREENCAST_QUALITY = 95;

export function clampViewport(width: number, height: number, scale = 1) {
  const clamp = (n: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, n || lo)));
  return { width: clamp(width, 320, 2560), height: clamp(height, 240, 1600), scale: Math.min(2, Math.max(1, scale || 1)) };
}

/** The origin's /favicon.ico for a web page, the default a page without a <link rel=icon> gets. */
export function defaultFavicon(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? safeIcon(`${u.origin}/favicon.ico`) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Only web and inline images for a tab's icon, never file:// or chrome://. The clients load it
 * themselves, so nothing on this machine either: a page must not point Omni's UI at localhost.
 */
export function safeIcon(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined;
  if (/^data:image\/(png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml)[;,]/i.test(href)) return href.length < 64_000 ? href : undefined;
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/i.test(u.hostname) || u.hostname.endsWith('.localhost')) return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

/**
 * The editing commands a Cmd shortcut runs in the page. On macOS Chrome maps these from the menu,
 * which CDP key events never reach, so they go along with the key event.
 */
export function keyCommands(key: string, modifiers: number): string[] | undefined {
  const meta = (modifiers & 4) !== 0;
  const shift = (modifiers & 8) !== 0;
  if (!meta) return undefined;
  switch (key.toLowerCase()) {
    case 'a':
      return ['selectAll'];
    case 'z':
      return [shift ? 'redo' : 'undo'];
    case 'arrowleft':
      return [shift ? 'moveToBeginningOfLineAndModifySelection' : 'moveToBeginningOfLine'];
    case 'arrowright':
      return [shift ? 'moveToEndOfLineAndModifySelection' : 'moveToEndOfLine'];
    case 'arrowup':
      return [shift ? 'moveToBeginningOfDocumentAndModifySelection' : 'moveToBeginningOfDocument'];
    case 'arrowdown':
      return [shift ? 'moveToEndOfDocumentAndModifySelection' : 'moveToEndOfDocument'];
    case 'backspace':
      return ['deleteToBeginningOfLine'];
  }
  return undefined;
}
/** With nobody watching and no thread attached, the browser closes after this long. */
export const IDLE_MS = 5 * 60_000;

/** What {@link findChrome} looks at, so a test can stand in for the machine. */
export interface ChromeLookup {
  platform: NodeJS.Platform;
  home: string;
  /** The PATH to search on Linux. */
  path: string;
  exists(path: string): boolean;
  list(dir: string): string[];
}

/** Chromium-family browsers a Linux machine may have on PATH, Google Chrome first. */
const LINUX_BROWSERS = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'brave-browser', 'brave'];

/**
 * Google Chrome if it is installed (the profiles were made with it), else another Chromium-family browser on Linux,
 * else the newest Playwright Chromium.
 */
export function findChrome(at: ChromeLookup): string | null {
  const candidates: string[] = [];
  let cache: string;
  let builds: string[];
  if (at.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    cache = join(at.home, 'Library', 'Caches', 'ms-playwright');
    builds = ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'];
  } else if (at.platform === 'linux') {
    candidates.push('/opt/google/chrome/chrome');
    const dirs = at.path.split(':').filter(Boolean);
    for (const name of LINUX_BROWSERS) for (const dir of dirs) candidates.push(join(dir, name));
    cache = join(at.home, '.cache', 'ms-playwright');
    builds = ['chrome-linux64/chrome', 'chrome-linux/chrome'];
  } else return null;
  for (const bin of candidates) if (at.exists(bin)) return bin;
  if (!at.exists(cache)) return null;
  const dirs = at.list(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    for (const build of builds) {
      const bin = join(cache, d, build);
      if (at.exists(bin)) return bin;
    }
  }
  return null;
}

/** The browser Omni runs: OMNI_CHROME_BIN, else {@link findChrome} on this machine. */
export function chromeBinary(): string | null {
  if (process.env.OMNI_CHROME_BIN) return process.env.OMNI_CHROME_BIN;
  return findChrome({ platform: process.platform, home: homedir(), path: process.env.PATH ?? '', exists: existsSync, list: readdirSync });
}

/** Only web pages and blank tabs: nothing internal, no navigating the browser to file:// or chrome://. */
export function normalizeUrl(input: string): string | null {
  const address = readAddress(input);
  return address && address.kind !== 'refused' ? address.url : null;
}
