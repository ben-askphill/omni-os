// The desktop app's main process: one instance, the server behind it, the windows, and the OS hooks the Web UI
// cannot reach from a browser (ADR 0010).
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DesktopEvent } from '@omni/shared/desktop-bridge.ts';
import { Backend } from './backend/index.ts';
import { chooseDataDir } from './backend/data-dir.ts';
import { checkoutMessage, checkoutProblem } from './backend/launch.ts';
import type { AppContext, AppPaths } from './context.ts';
import { handle, on, trusted, trustOrigins } from './handle.ts';
import { BOOTSTRAP, EVENT, type Bootstrap } from './ipc.ts';
import { installLoginItem, LOGIN_ITEM_SUPPORTED } from './login-item.ts';
import { installMenu, showServerLog } from './menu.ts';
import { desktopPlatform } from './menu-template.ts';
import { installNativeBrowser } from './native-browser.ts';
import { parseOptions, safeRoute } from './options.ts';
import { defaultDataDir, logsDir, serverLogFile, type PlatformDirs } from './paths.ts';
import { installQuickPrompt } from './quick-prompt.ts';
import { installQuitHold } from './quit.ts';
import { focusServerScreen, showServerFailure } from './server-screen.ts';
import { openSettings } from './settings.ts';
import { installSystemEvents } from './system.ts';
import { installUpdates } from './updates.ts';
import { bringForward, createOmniWindow, reloadIfFailed, routeUrl, secureAppSession } from './windows.ts';

app.setName('Omni');

const parsed = parseOptions(process.argv.slice(app.isPackaged ? 1 : 2));
if ('error' in parsed) {
  console.error(`omni: ${parsed.error}`);
  app.exit(2);
}

if (!app.requestSingleInstanceLock()) app.exit(0);

async function boot(): Promise<void> {
  if ('error' in parsed) return;
  const options = parsed;
  const dev = options.dev || !app.isPackaged;
  // dist/main.cjs sits in apps/desktop/dist, three folders below the checkout.
  const repo = dev ? resolve(__dirname, '../../..') : null;
  const paths: AppPaths = {
    appRoot: repo ?? join(process.resourcesPath, 'omni'),
    bundled: !dev,
    preload: join(__dirname, 'preload.cjs'),
    pickPreload: join(__dirname, 'pick-preload.cjs'),
    icon: existsSync(join(__dirname, '../resources/icon.png')) ? join(__dirname, '../resources/icon.png') : null,
  };
  if (repo) {
    const problem = checkoutProblem(repo, existsSync);
    if (problem) {
      dialog.showErrorBox('Omni', checkoutMessage(problem, repo));
      app.exit(1);
      return;
    }
  }

  const home = homedir();
  const dirs: PlatformDirs = {
    platform: process.platform,
    home,
    env: process.env,
    userData: app.getPath('userData'),
    logs: logsDir({
      platform: process.platform,
      home,
      env: process.env,
      userData: app.getPath('userData'),
      electronLogs: app.getPath('logs'),
      customUserData: app.commandLine.hasSwitch('user-data-dir'),
    }),
  };
  const settings = openSettings(join(dirs.userData, 'settings.json'));
  const dataDir =
    options.dataDir !== null
      ? resolve(options.dataDir)
      : await chooseDataDir({ dirs, fallback: defaultDataDir(dirs, { dev, repo }), dev });
  if (dataDir === null) {
    app.quit();
    return;
  }
  const backend = new Backend({
    port: options.port,
    dataDir,
    logFile: serverLogFile(dirs),
    bundled: paths.bundled,
    appRoot: paths.appRoot,
    binary: process.execPath,
    // Written when this app starts a server, not when it attaches to one that runs on another launch's binary.
    shimDir: dev ? null : join(dirs.userData, 'bin'),
    recordFile: join(dirs.userData, `server-${options.port}.json`),
    home: dirs.home,
  });

  let main: BrowserWindow | null = null;
  let quitting = false;
  app.on('before-quit', (event) => {
    // quit.ts holds a quit while it asks about running turns; Cancel leaves the app open.
    quitting = !event.defaultPrevented;
  });

  const ctx: AppContext = {
    options,
    paths,
    settings,
    backend,
    appUrl: () => options.appUrl ?? backend.origin(),
    mainWindow: () => (main && !main.isDestroyed() ? main : null),
    showMain(route) {
      const open = ctx.mainWindow();
      if (open) {
        // A window opened before the server was up shows an error page: it loads again, now that it is.
        if (!reloadIfFailed(ctx, open, route) && route) void open.loadURL(routeUrl(ctx.appUrl(), route));
        bringForward(open);
        return open;
      }
      main = createOmniWindow(ctx, { kind: 'main', route: route ?? options.route });
      return main;
    },
    openWindow: (route) => createOmniWindow(ctx, { kind: 'secondary', route }),
    broadcast(event: DesktopEvent) {
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(EVENT, event);
    },
    quitting: () => quitting,
  };

  secureAppSession(ctx);
  trustOrigins(() => [new URL(ctx.appUrl()).origin, backend.origin()]);
  ipcMain.on(BOOTSTRAP, (event) => {
    const boot: Bootstrap = {
      platform: desktopPlatform(),
      version: app.getVersion(),
      packaged: app.isPackaged,
      loginItemSupported: LOGIN_ITEM_SUPPORTED,
    };
    event.returnValue = trusted(event) ? boot : null;
  });
  handle('omni:settings:get', () => settings.get());
  handle('omni:settings:set', (_event, patch) => settings.update(patch));
  settings.onChange((next) => ctx.broadcast({ type: 'settings', settings: next }));
  on('omni:open-window', (_event, route) => {
    const safe = safeRoute(route);
    if (safe) ctx.openWindow(safe);
  });
  on('omni:focus', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) bringForward(win);
  });
  handle('omni:server:info', () => backend.info());
  on('omni:server:show-log', () => showServerLog(ctx));

  installMenu(ctx);
  installSystemEvents(ctx);
  installNativeBrowser(ctx);
  installUpdates(ctx);
  installQuitHold(ctx);
  installLoginItem(ctx);

  // Opening the app again while it runs: the main window once the server is up, else the failure screen. A start
  // still under way opens the main window itself when it is ready (below, and the screen's Try Again).
  app.on('second-instance', () => {
    const state = backend.current;
    if (state.kind === 'ready') ctx.showMain();
    else if (!focusServerScreen() && state.kind === 'failed') showServerFailure(ctx, state.message);
  });
  app.on('activate', () => {
    if (backend.current.kind === 'ready') ctx.showMain();
  });
  app.on('window-all-closed', () => {
    // On a Mac the app stays in the Dock, and the Quick Prompt keeps answering its shortcut.
    if (process.platform !== 'darwin') app.quit();
  });

  backend.onState((state) => {
    if (state.kind === 'failed') showServerFailure(ctx, state.message);
  });
  const state = await backend.start();
  if (state.kind === 'ready') {
    ctx.showMain();
    installQuickPrompt(ctx);
  }
}

app.whenReady().then(boot, (err: unknown) => {
  console.error('[omni] could not start:', err);
  app.exit(1);
});
