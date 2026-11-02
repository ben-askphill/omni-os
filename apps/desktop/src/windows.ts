// Omni's windows: each one the Web UI, with the bridge's preload. Links to other sites open in the default browser;
// a link to an Omni route opens an Omni window. The main window opens where it was last closed.
import { app, BrowserWindow, Menu, nativeTheme, screen, shell } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clampZoom, ZOOM_STEP } from '@omni/shared/desktop-bridge.ts';
import type { AppContext } from './context.ts';
import { editMenuTemplate } from './menu-template.ts';
import { safeRoute } from './options.ts';
import { linkTarget, nextWindowState, parseWindowState, restoreBounds, staysInWindow, trafficLights, type WindowState } from './window-rules.ts';

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

/** Sets every Omni window's zoom. <webview> guests are web contents of their own and keep theirs. */
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

/** The hash route of an Omni URL, or null for any other URL. */
export function omniRoute(appUrl: string, url: string): string | null {
  const target = linkTarget(url, { app: appUrl, server: appUrl });
  return target.kind === 'omni' ? target.route : null;
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
    // The Web UI's --chrome, so the window does not flash another colour before the page draws.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0d0f' : '#ffffff',
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
  win.webContents.on('zoom-changed', (_event, direction) => {
    const zoom = ctx.settings.get().zoom;
    ctx.settings.update({ zoom: clampZoom(zoom + (direction === 'in' ? ZOOM_STEP : -ZOOM_STEP)) });
  });

  const origins = () => ({ app: ctx.appUrl(), server: ctx.backend.origin() });
  win.webContents.setWindowOpenHandler(({ url }) => {
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
            backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0d0f' : '#ffffff',
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
    child.webContents.setWindowOpenHandler(({ url }) => {
      const target = linkTarget(url, origins());
      if (target.kind === 'external') void shell.openExternal(target.url);
      return { action: 'deny' };
    });
    child.webContents.on('will-navigate', (event, url) => {
      if (staysInWindow(url, origins())) return;
      event.preventDefault();
      const target = linkTarget(url, origins());
      if (target.kind === 'external') void shell.openExternal(target.url);
    });
  });

  // The window stays on Omni: a link that would navigate it elsewhere opens in the default browser.
  win.webContents.on('will-navigate', (event, url) => {
    if (staysInWindow(url, origins())) return;
    event.preventDefault();
    const target = linkTarget(url, origins());
    if (target.kind === 'external') void shell.openExternal(target.url);
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
  try {
    if (input.kind === 'main') {
      // Pairing sets the API cookie for this app's session; the server then sends the window to its UI.
      await win.loadURL(`${ctx.backend.origin()}/api/auth/desktop-pair`);
      if (ctx.appUrl() === ctx.backend.origin() && !input.route) return;
    }
    await win.loadURL(routeUrl(ctx.appUrl(), input.route));
  } catch (err) {
    // A load the user replaced with another (a click while loading) rejects too; only an empty window needs a retry.
    if (!win.isDestroyed() && win.webContents.getURL() === '') console.error('[omni] window load failed:', err);
  }
}
