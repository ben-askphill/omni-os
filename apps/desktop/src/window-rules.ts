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

/** True for the Web UI's own document, not a file the server serves at another path (an artifact, an upload). */
export function isWebUiDocument(url: string | undefined, appUrl: string): boolean {
  if (!url) return false;
  try {
    const target = new URL(url);
    return target.origin === new URL(appUrl).origin && (target.pathname === '/' || target.pathname === '');
  } catch {
    return false;
  }
}

/**
 * What the Web UI asks the browser for: writing the clipboard, full screen, notifications and dictation's
 * microphone. Electron grants every permission unless told otherwise.
 */
const WEB_UI_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen', 'notifications', 'media']);

/**
 * A permission for a page in the app's own session: only the Web UI's top frame gets one. An agent's HTML (an
 * artifact in a sandboxed frame, or opened as a page of its own under /api) gets none, and nothing gets
 * `openExternal`, which would hand a link in any scheme to the app registered for it, without a click.
 */
export function appPermissionAllowed(permission: string, details: { isMainFrame: boolean; requestingUrl?: string }, appUrl: string): boolean {
  return WEB_UI_PERMISSIONS.has(permission) && details.isMainFrame && isWebUiDocument(details.requestingUrl, appUrl);
}

/** What a frame inside an Omni window may load: a web page, or a document of its own. No other app's scheme. */
export function subframeNavigationAllowed(url: string): boolean {
  try {
    return ['http:', 'https:', 'about:', 'blob:', 'data:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * How long after a click or key press a page may open a window, a browser tab or another app. A script on a timer,
 * or a page nobody touched, cannot: Electron has no popup blocker of its own, and WebKit blocked popups without one.
 */
export const GESTURE_MS = 1000;

const GESTURES = new Set(['mouseDown', 'mouseUp', 'rawKeyDown', 'keyDown', 'char', 'gestureTap', 'touchEnd']);

/** True for an input event that is Ben acting on the page, not the pointer passing over it. */
export function isGesture(type: string): boolean {
  return GESTURES.has(type);
}

/** True when the page's last click or key press was recent enough to open something. */
export function recentGesture(lastGesture: number | null, now: number): boolean {
  return lastGesture !== null && now - lastGesture >= 0 && now - lastGesture <= GESTURE_MS;
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
