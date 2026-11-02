// The desktop app's main process: one instance, the server behind it, the windows, and the OS hooks the Web UI
// cannot reach from a browser (ADR 0010).
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DesktopEvent } from '@omni/shared/desktop-bridge.ts';
import { Backend } from './backend/index.ts';
import { chooseDataDir } from './backend/data-dir.ts';
import { checkoutMessage, checkoutProblem } from './backend/launch.ts';
import { writeNodeShim } from './backend/process.ts';
import type { AppContext, AppPaths } from './context.ts';
import { handle, on, trusted, trustOrigins } from './handle.ts';
import { BOOTSTRAP, EVENT, type Bootstrap } from './ipc.ts';
import { installLoginItem } from './login-item.ts';
import { installMenu } from './menu.ts';
import { installNativeBrowser, NATIVE_BROWSER_PARTITION } from './native-browser.ts';
import { parseOptions, safeRoute } from './options.ts';
import { defaultDataDir, serverLogFile, type PlatformDirs } from './paths.ts';
import { installQuickPrompt } from './quick-prompt.ts';
import { installQuitHold } from './quit.ts';
import { showServerFailure } from './server-screen.ts';
import { openSettings } from './settings.ts';
import { installSystemEvents } from './system.ts';
import { installUpdates } from './updates.ts';
import { createOmniWindow } from './windows.ts';

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

  const dirs: PlatformDirs = {
    platform: process.platform,
    home: homedir(),
    env: process.env,
    userData: app.getPath('userData'),
    logs: app.getPath('logs'),
  };
  const settings = openSettings(join(dirs.userData, 'settings.json'));
  const dataDir =
    options.dataDir !== null
      ? resolve(options.dataDir)
      : await chooseDataDir({ dirs, fallback: defaultDataDir(dirs, { dev, repo }), dev });
  const backend = new Backend({
    port: options.port,
    dataDir,
    logFile: serverLogFile(dirs),
    bundled: paths.bundled,
    appRoot: paths.appRoot,
    binary: process.execPath,
    shimDir: dev ? null : writeNodeShim(join(dirs.userData, 'bin'), process.execPath),
    home: dirs.home,
  });

  let main: BrowserWindow | null = null;
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
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
        if (route) void open.loadURL(`${ctx.appUrl()}/${safeRoute(route) ?? ''}`);
        if (open.isMinimized()) open.restore();
        open.show();
        open.focus();
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

  trustOrigins(() => [new URL(ctx.appUrl()).origin, backend.origin()]);
  ipcMain.on(BOOTSTRAP, (event) => {
    const boot: Bootstrap = {
      platform: process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
      version: app.getVersion(),
      packaged: app.isPackaged,
      loginItemSupported: process.platform === 'darwin' || process.platform === 'win32',
      nativeBrowser: { partition: NATIVE_BROWSER_PARTITION, preload: `file://${paths.pickPreload}` },
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
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  handle('omni:open-path', (_event, path) => (typeof path === 'string' && path.startsWith('/') ? shell.openPath(path) : 'Not a local path.'));
  on('omni:show-in-folder', (_event, path) => {
    if (typeof path === 'string' && path.startsWith('/')) shell.showItemInFolder(path);
  });
  handle('omni:server:info', () => backend.info());
  on('omni:server:show-log', () => void shell.openPath(backend.config.logFile));

  installMenu(ctx);
  installSystemEvents(ctx);
  installNativeBrowser(ctx);
  installUpdates(ctx);
  installQuitHold(ctx);
  installLoginItem(ctx);

  app.on('second-instance', () => ctx.showMain());
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
