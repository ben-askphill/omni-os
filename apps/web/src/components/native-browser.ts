// The desktop app's Web tab (NativeBrowser.tsx), apart from React so it can be tested: what an address bar entry loads,
// the page each channel last showed, and the link to the pick preload in the <webview>'s page (apps/desktop/src/
// pick-preload.ts), which reads the page for Annotate with the scripts the server runs in its Chrome.
import {
  NATIVE_PICK_ANSWER,
  NATIVE_PICK_ASK,
  NATIVE_PICK_EVENT,
  type NativeGuestEvent,
  type NativePageLook,
  type NativePickRequest,
} from '@omni/shared/desktop-bridge.ts';
import { readAddress, SEARCH_URL } from '@omni/shared/address-bar.ts';

/**
 * What the address bar loads (@omni/shared/address-bar.ts, as the agent's Browser tab reads it). Null for blank input.
 * Only http, https and about:blank load: `file:` or `javascript:` becomes a search for its words.
 */
export function resolveAddress(input: string): string | null {
  const address = readAddress(input);
  if (!address) return null;
  return address.kind === 'refused' ? SEARCH_URL + encodeURIComponent(input.trim()) : address.url;
}

/** How much webview.sendInputEvent's pixels exceed the page's: it takes them before the page's zoom, which follows the app's View > Zoom. */
export function inputScale(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/** A point in the page's CSS pixels as webview.sendInputEvent takes it. */
export function inputPoint(p: { x: number; y: number }, zoom: number): { x: number; y: number } {
  const z = inputScale(zoom);
  return { x: Math.round(p.x * z), y: Math.round(p.y * z) };
}

/** A page that Annotate can capture: a web page, not a blank or an error. */
export const isWebPage = (url: string) => /^https?:\/\//i.test(url);

/**
 * The page as it must still be for a pick on its screenshot to mean the same thing: the address, the window and the
 * scroll, within a pixel (a page settling), as the server holds its own browser to.
 */
export function pageMatches(a: NativePageLook, b: NativePageLook) {
  return a.url === b.url && a.width === b.width && a.height === b.height && Math.abs(a.scrollX - b.scrollX) <= 1 && Math.abs(a.scrollY - b.scrollY) <= 1;
}

/** What the page said about itself, or null when it is not that shape. */
export function lookOf(raw: unknown): NativePageLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  const [width, height, scrollX, scrollY] = [num(r.width), num(r.height), num(r.scrollX), num(r.scrollY)];
  if (typeof r.url !== 'string' || width === null || height === null || scrollX === null || scrollY === null) return null;
  return { url: r.url, title: typeof r.title === 'string' ? r.title : '', width, height, scrollX: Math.max(0, scrollX), scrollY: Math.max(0, scrollY) };
}

const KEY = (channel: string) => `omni.nativeBrowser.${channel}`;

/** The web page this channel's Web tab last showed, kept across launches. */
export function savedAddress(channel: string, storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  try {
    const url = storage.getItem(KEY(channel));
    return url && isWebPage(url) ? url : null;
  } catch {
    return null;
  }
}

/** Keeps only web pages: a blank tab or an error page leaves the last one. */
export function saveAddress(channel: string, url: string, storage: Pick<Storage, 'setItem'> = localStorage) {
  if (!isWebPage(url) || url.length > 4000) return;
  try {
    storage.setItem(KEY(channel), url);
  } catch {
    // Storage full or off: the tab still works, it only forgets.
  }
}

/** The part of the <webview> element the link uses. */
export interface GuestView {
  send(channel: string, ...args: unknown[]): void;
}

/** What a request answers with when the page does not: it navigated, or it has no preload yet. */
const ASK_TIMEOUT_MS = 1500;

/**
 * Questions to the page's pick preload and its answers, matched by id. An answer that never comes resolves null, as
 * does one the page gives for another request. Unasked events (scroll, keys) are handed back from `receive`.
 */
export class GuestLink {
  private next = 1;
  private waiting = new Map<number, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    private view: GuestView,
    private timeoutMs = ASK_TIMEOUT_MS,
  ) {}

  ask(request: { op: 'look' } | { op: 'inspect' | 'pick'; x: number; y: number }): Promise<unknown> {
    const id = this.next++;
    const message = { ...request, id } as NativePickRequest;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(id, null), this.timeoutMs);
      this.waiting.set(id, { resolve, timer });
      try {
        this.view.send(NATIVE_PICK_ASK, message);
      } catch {
        // The webview is not attached yet.
        this.settle(id, null);
      }
    });
  }

  async look(): Promise<NativePageLook | null> {
    return lookOf(await this.ask({ op: 'look' }));
  }

  /** One `ipc-message` from the webview. Returns the page's own event, if that is what it was. */
  receive(channel: string, args: readonly unknown[]): NativeGuestEvent | null {
    const [payload] = args;
    if (channel === NATIVE_PICK_ANSWER) {
      const p = payload as { id?: unknown; value?: unknown } | null;
      if (p && typeof p.id === 'number') this.settle(p.id, p.value ?? null);
      return null;
    }
    if (channel !== NATIVE_PICK_EVENT || !payload || typeof payload !== 'object') return null;
    const e = payload as Record<string, unknown>;
    if (e.type === 'scroll' && typeof e.x === 'number' && typeof e.y === 'number' && Number.isFinite(e.x) && Number.isFinite(e.y)) return { type: 'scroll', x: e.x, y: e.y };
    if (e.type === 'key' && typeof e.down === 'boolean' && (e.key === 'Escape' || e.key === 'Alt' || e.key === 'l' || e.key === 'r' || e.key === '[' || e.key === ']')) return { type: 'key', key: e.key, down: e.down };
    return null;
  }

  /** Every open question answers null: the page went away. */
  reset() {
    for (const id of [...this.waiting.keys()]) this.settle(id, null);
  }

  private settle(id: number, value: unknown) {
    const w = this.waiting.get(id);
    if (!w) return;
    this.waiting.delete(id);
    clearTimeout(w.timer);
    w.resolve(value);
  }
}

/** Why a screenshot could not be taken, in Ben's words, and whether trying again can work. */
export class NativeCaptureError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** What a page must be before its screenshot is taken: a loaded web page with a size. */
export function captureProblem(page: NativePageLook | null, loading: boolean): NativeCaptureError | null {
  if (!page) return new NativeCaptureError('There is no page to annotate.', false);
  if (!isWebPage(page.url)) return new NativeCaptureError('Only a web page can be annotated. Open one in the browser first.', false);
  if (loading) return new NativeCaptureError('The page is still loading. Try again once it has loaded.', true);
  if (!(page.width > 0 && page.height > 0)) return new NativeCaptureError('The browser has no size yet. Try again.', true);
  return null;
}

/** The query of POST /channels/:id/browser/capture/native (apps/server/browser-capture.ts): the page's numbers. */
export function nativeCaptureQuery(thread: string, page: NativePageLook) {
  const q = new URLSearchParams({
    thread,
    url: page.url,
    title: page.title.slice(0, 1000),
    vw: String(page.width),
    vh: String(page.height),
    sx: String(page.scrollX),
    sy: String(page.scrollY),
  });
  return q.toString();
}
