// Omni's windows: each one the Web UI, with the bridge's preload. Links to other sites open in the default browser;
// a link to an Omni route opens an Omni window. The main window opens where it was last closed.
import { app, BrowserWindow, Menu, screen, session, shell, type WebContents } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clampZoom, ZOOM_STEP } from '@omni/shared/desktop-bridge.ts';
import type { AppContext } from './context.ts';
import { editMenuTemplate } from './menu-template.ts';
import { safeRoute } from './options.ts';
import {
  appPermissionAllowed,
  isGesture,
  linkTarget,
  nextWindowState,
  parseWindowState,
  recentGesture,
  restoreBounds,
  staysInWindow,
  subframeNavigationAllowed,
  trafficLights,
  type WindowState,
} from './window-rules.ts';

export type WindowKind = 'main' | 'secondary';

const MAC = process.platform === 'darwin';
const MIN = { width: 640, height: 420 };

/** The Web UI's windows, apart from the Quick Prompt panel and windows on other pages (the activity monitor). */
const omni = new Set<BrowserWindow>();

export function omniWindows(): BrowserWindow[] {
  return [...omni].filter((win) => !win.isDestroyed());
}

/** The Omni window a menu command is for: the focused one, else the main window, else the last one opened. */
export function focusedOmniWindow(ctx: AppContext): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && omni.has(focused) && !focused.isDestroyed()) return focused;
  return ctx.mainWindow() ?? omniWindows().at(-1) ?? null;
}

/** Restores, shows and focuses a window. */
export function bringForward(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** One step of View > Zoom, or back to 100%. Ctrl and the scroll wheel take the same steps. */
export function stepZoom(ctx: AppContext, to: 'in' | 'out' | 'reset'): void {
  const current = ctx.settings.get().zoom;
  const next = to === 'reset' ? 1 : clampZoom(current + (to === 'in' ? ZOOM_STEP : -ZOOM_STEP));
  if (next !== current) ctx.settings.update({ zoom: next });
}

/** Sets every Omni window's zoom. The Web tab's <webview> pages follow their host window's zoom, as part of its page. */
export function applyZoom(factor: number): void {
  for (const win of omniWindows()) {
    win.webContents.setZoomFactor(factor);
    placeTrafficLights(win, factor);
  }
}

/** Keeps the traffic lights where the page leaves room for them, which moves when the layout does. */
function placeTrafficLights(win: BrowserWindow, zoom: number): void {
  if (MAC) win.setWindowButtonPosition(trafficLights(win.getContentBounds().width, zoom));
}

export function routeUrl(appUrl: string, route: string | null | undefined): string {
  return `${appUrl}/${safeRoute(route) ?? ''}`;
}

/**
 * The app's session, which every Omni window, the Quick Prompt panel and a server file's window share. Electron
 * grants a page any permission it asks for: here only the Web UI's own top frame gets the few it uses, so an agent's
 * HTML in a sandboxed frame can neither start another app through a link in its scheme nor post notifications as
 * Omni. Its frames load web pages only. (The Web tab has a session of its own: native-browser.ts.)
 */
export function secureAppSession(ctx: AppContext): void {
  const appSession = session.defaultSession;
  appSession.setPermissionRequestHandler((_contents, permission, callback, details) => callback(appPermissionAllowed(permission, details, ctx.appUrl())));
  appSession.setPermissionCheckHandler((_contents, permission, _origin, details) => appPermissionAllowed(permission, details, ctx.appUrl()));
  appSession.setDevicePermissionHandler(() => false);
  app.on('web-contents-created', (_event, contents) => {
    if (contents.session !== appSession || contents.getType() === 'webview') return;
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && !subframeNavigationAllowed(event.url)) event.preventDefault();
    });
  });
}

/**
 * Whether the page in `contents` was clicked or typed in within the last second. A window, a browser tab or another
 * app opens only then: a page's script on a timer opens nothing, as a browser's popup blocker has it. A click in a
 * frame of another process (an artifact's sandboxed frame) reaches before-mouse-event but not input-event, and a key
 * press reaches before-input-event wherever the focus is.
 */
function trackGestures(contents: WebContents): () => boolean {
  let last: number | null = null;
  const seen = (type: string) => {
    if (isGesture(type)) last = Date.now();
  };
  contents.on('input-event', (_event, input) => seen(input.type));
  contents.on('before-mouse-event', (_event, mouse) => seen(mouse.type));
  contents.on('before-input-event', (_event, input) => seen(input.type));
  return () => recentGesture(last, Date.now());
}

/** Main windows whose last load failed (the server was not up yet): showMain loads them again. */
const failedLoads = new WeakSet<BrowserWindow>();

/** Loads an Omni window again if its last load failed. True when it did. */
export function reloadIfFailed(ctx: AppContext, win: BrowserWindow, route?: string | null): boolean {
  if (!failedLoads.has(win)) return false;
  void load(ctx, win, { kind: ctx.mainWindow() === win ? 'main' : 'secondary', route });
  return true;
}

const stateFile = () => join(app.getPath('userData'), 'window-state.json');

function savedState(): WindowState | null {
  try {
    return parseWindowState(JSON.parse(readFileSync(stateFile(), 'utf8')));
  } catch {
    return null;
  }
}

function saveState(win: BrowserWindow): void {
  if (win.isFullScreen()) return;
  const state: WindowState = nextWindowState(savedState(), { bounds: win.getBounds(), maximized: win.isMaximized() });
  try {
    writeFileSync(stateFile(), `${JSON.stringify(state)}\n`, { mode: 0o600 });
  } catch (err) {
    console.error('[omni] could not save the window position:', err);
  }
}

export function createOmniWindow(ctx: AppContext, input: { kind: WindowKind; route?: string | null }): BrowserWindow {
  const main = input.kind === 'main';
  const saved = main ? savedState() : null;
  const bounds = saved?.bounds ? restoreBounds(saved.bounds, screen.getAllDisplays().map((d) => d.workArea), MIN) : null;
  const win = new BrowserWindow({
    ...(bounds ?? { width: main ? 1320 : 980, height: main ? 860 : 760 }),
    minWidth: MIN.width,
    minHeight: MIN.height,
    show: false,
    title: 'Omni',
    // The Web UI's --chrome, dark in both schemes, so the window does not flash another colour before the page draws.
    backgroundColor: '#0c0d0f',
    // The page draws its own title bar: index.css leaves room for these at the sidebar's top left.
    titleBarStyle: MAC ? 'hiddenInset' : 'default',
    trafficLightPosition: MAC ? trafficLights((bounds ?? { width: main ? 1320 : 980 }).width, ctx.settings.get().zoom) : undefined,
    // Off the Mac the Web UI is the whole window; Alt shows the menu bar.
    autoHideMenuBar: !MAC,
    icon: ctx.paths.icon ?? undefined,
    webPreferences: {
      preload: ctx.paths.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The Web tab's real browser (native-browser.ts vets every <webview> before it attaches).
      webviewTag: true,
      spellcheck: true,
    },
  });
  omni.add(win);
  win.on('closed', () => omni.delete(win));
  if (main && saved?.maximized) win.maximize();
  if (main) win.on('close', () => saveState(win));

  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(ctx.settings.get().zoom));
  win.on('resize', () => placeTrafficLights(win, ctx.settings.get().zoom));
  // Ctrl and the scroll wheel, or a pinch: the same steps as View > Zoom.
  win.webContents.on('zoom-changed', (_event, direction) => stepZoom(ctx, direction));
  win.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    // -3 is a load replaced by another, such as a click while it loads.
    if (isMainFrame && code !== -3) failedLoads.add(win);
  });
  win.webContents.on('did-navigate', () => failedLoads.delete(win));

  const origins = () => ({ app: ctx.appUrl(), server: ctx.backend.origin() });
  const gesture = trackGestures(win.webContents);
  win.webContents.setWindowOpenHandler(({ url }) => {
    // The Web UI opens windows from a click; an agent's HTML in the page could try on a timer, or in a loop.
    if (!gesture()) return { action: 'deny' };
    const target = linkTarget(url, origins());
    switch (target.kind) {
      case 'omni':
        ctx.openWindow(target.route);
        return { action: 'deny' };
      case 'server':
        // A file the server serves, such as an image or an export. It shares the app's session, so it is signed in.
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 980,
            height: 760,
            autoHideMenuBar: true,
            backgroundColor: '#0c0d0f',
            webPreferences: { preload: undefined, contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },
          },
        };
      case 'external':
        void shell.openExternal(target.url);
        return { action: 'deny' };
      case 'none':
        return { action: 'deny' };
    }
  });
  win.webContents.on('did-create-window', (child) => {
    const childGesture = trackGestures(child.webContents);
    child.webContents.setWindowOpenHandler(({ url }) => {
      const target = linkTarget(url, origins());
      if (target.kind === 'external' && childGesture()) void shell.openExternal(target.url);
      return { action: 'deny' };
    });
    child.webContents.on('will-navigate', (event, url) => {
      if (staysInWindow(url, origins())) return;
      event.preventDefault();
      const target = linkTarget(url, origins());
      if (target.kind === 'external' && childGesture()) void shell.openExternal(target.url);
    });
  });

  // The window stays on Omni: a link that would navigate it elsewhere opens in the default browser.
  win.webContents.on('will-navigate', (event, url) => {
    if (staysInWindow(url, origins())) return;
    event.preventDefault();
    const target = linkTarget(url, origins());
    if (target.kind === 'external' && gesture()) void shell.openExternal(target.url);
  });

  // Text fields and selections get the system's Cut, Copy and Paste, with spelling suggestions. Electron only hears
  // of a right-click the page did not take itself (ContextMenuHost takes threads, folders and channels).
  win.webContents.on('context-menu', (_event, params) => {
    const template = editMenuTemplate(params, {
      replaceMisspelling: (word) => win.webContents.replaceMisspelling(word),
      learnWord: (word) => win.webContents.session.addWordToSpellCheckerDictionary(word),
    });
    if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
  });

  void load(ctx, win, input);
  return win;
}

async function load(ctx: AppContext, win: BrowserWindow, input: { kind: WindowKind; route?: string | null }): Promise<void> {
  failedLoads.delete(win);
  try {
    if (input.kind === 'main') {
      // Pairing sets the API cookie for this app's session; the server then sends the window to its UI.
      await win.loadURL(`${ctx.backend.origin()}/api/auth/desktop-pair`);
      if (ctx.appUrl() === ctx.backend.origin() && !input.route) return;
    }
    await win.loadURL(routeUrl(ctx.appUrl(), input.route));
  } catch (err) {
    // A load the user replaced with another (a click while loading) rejects too. A failed one is marked by
    // did-fail-load, and showMain loads the window again once the server is up.
    if (!win.isDestroyed() && failedLoads.has(win)) console.error('[omni] window load failed:', err);
  }
}
