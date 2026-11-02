// Pure rules for Omni's windows (windows.ts): where a link goes, and where the main window opens again.
import { safeRoute } from './options.ts';

export type LinkTarget =
  /** A Web UI route: an Omni window. */
  | { kind: 'omni'; route: string }
  /** Another path on the server, such as a file under /api: a plain window, which has the app's login cookie. */
  | { kind: 'server'; url: string }
  /** Anything on the web: the default browser. */
  | { kind: 'external'; url: string }
  | { kind: 'none' };

export function linkTarget(url: string, origins: { app: string; server: string }): LinkTarget {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { kind: 'none' };
  }
  const app = new URL(origins.app).origin;
  const server = new URL(origins.server).origin;
  if (target.origin === app && (target.pathname === '/' || target.pathname === '')) {
    const route = target.hash ? safeRoute(target.hash) : '#/';
    return route ? { kind: 'omni', route } : { kind: 'none' };
  }
  if (target.origin === app || target.origin === server) return { kind: 'server', url: target.href };
  if (target.protocol === 'http:' || target.protocol === 'https:' || target.protocol === 'mailto:') return { kind: 'external', url: target.href };
  return { kind: 'none' };
}

/** A navigation the window may make itself: the Web UI and the server (pairing redirects through /api/auth). */
export function staysInWindow(url: string, origins: { app: string; server: string }): boolean {
  try {
    const origin = new URL(url).origin;
    return origin === new URL(origins.app).origin || origin === new URL(origins.server).origin;
  } catch {
    return false;
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  /** The size and place it opens at, or un-maximizes to. Null: the default, centred. */
  bounds: Rect | null;
  maximized: boolean;
}

function parseRect(raw: unknown): Rect | null {
  if (!raw || typeof raw !== 'object') return null;
  const rect = raw as Partial<Rect>;
  const nums = [rect.x, rect.y, rect.width, rect.height];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const { x, y, width, height } = rect as Rect;
  if (width < 200 || height < 150) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export function parseWindowState(raw: unknown): WindowState | null {
  if (!raw || typeof raw !== 'object') return null;
  const { bounds, maximized } = raw as { bounds?: unknown; maximized?: unknown };
  const rect = parseRect(bounds);
  if (!rect && maximized !== true) return null;
  return { bounds: rect, maximized: maximized === true };
}

/**
 * What to save as the window closes. A maximized window keeps the bounds saved before: its normal bounds can be
 * the minimum size, as under a tiling window manager that never gave it a size of its own.
 */
export function nextWindowState(previous: WindowState | null, closing: { bounds: Rect; maximized: boolean }): WindowState {
  if (closing.maximized) return { bounds: previous?.bounds ?? null, maximized: true };
  return { bounds: closing.bounds, maximized: false };
}

/**
 * The saved bounds, if the window's top edge still lands on a screen (a display may have gone since), shrunk to fit
 * that screen. Null opens the window at the default size, centred.
 */
export function restoreBounds(saved: Rect, workAreas: readonly Rect[], min: { width: number; height: number }): Rect | null {
  const topMiddle = { x: saved.x + saved.width / 2, y: saved.y + 10 };
  const area = workAreas.find((a) => topMiddle.x >= a.x && topMiddle.x < a.x + a.width && topMiddle.y >= a.y && topMiddle.y < a.y + a.height);
  if (!area) return null;
  const width = Math.max(min.width, Math.min(saved.width, area.width));
  const height = Math.max(min.height, Math.min(saved.height, area.height));
  const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

/** Below this many CSS pixels the Web UI shows its phone layout (useIsMobile in apps/web/src/store.tsx). */
export const PHONE_LAYOUT_BELOW = 768;

/**
 * Where the macOS traffic lights go: beside the wordmark in the sidebar's top row, or in the strip index.css puts
 * above the phone layout. The page's width in CSS pixels is the window's divided by the zoom.
 */
export function trafficLights(contentWidth: number, zoom: number): { x: number; y: number } {
  return contentWidth / zoom < PHONE_LAYOUT_BELOW ? { x: 12, y: 7 } : { x: 18, y: 29 };
}
