// Omni's windows: each one the Web UI, with the bridge's preload. Links to other sites open in the default browser;
// a link to an Omni route opens an Omni window.
import { BrowserWindow, nativeTheme, shell } from 'electron';
import type { AppContext } from './context.ts';
import { safeRoute } from './options.ts';

export type WindowKind = 'main' | 'secondary';

const MAC = process.platform === 'darwin';

export function routeUrl(appUrl: string, route: string | null | undefined): string {
  return `${appUrl}/${safeRoute(route) ?? ''}`;
}

/** The hash route of an Omni URL, or null for any other URL. */
export function omniRoute(appUrl: string, url: string): string | null {
  try {
    const target = new URL(url);
    const base = new URL(appUrl);
    if (target.origin !== base.origin) return null;
    return safeRoute(target.hash) ?? '#/';
  } catch {
    return null;
  }
}

export function createOmniWindow(ctx: AppContext, input: { kind: WindowKind; route?: string | null }): BrowserWindow {
  const main = input.kind === 'main';
  const win = new BrowserWindow({
    width: main ? 1320 : 980,
    height: main ? 860 : 760,
    minWidth: 640,
    minHeight: 420,
    show: false,
    title: 'Omni',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#ffffff',
    titleBarStyle: MAC ? 'hiddenInset' : 'default',
    trafficLightPosition: MAC ? { x: 14, y: 14 } : undefined,
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

  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(ctx.settings.get().zoom));

  win.webContents.setWindowOpenHandler(({ url }) => {
    const route = omniRoute(ctx.appUrl(), url);
    if (route) ctx.openWindow(route);
    else if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // The window stays on Omni: a link that would navigate it elsewhere opens in the default browser.
  win.webContents.on('will-navigate', (event, url) => {
    if (omniRoute(ctx.appUrl(), url) !== null || url.startsWith(ctx.backend.origin())) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
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
