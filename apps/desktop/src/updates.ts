// The app's own updates, from the GitHub Releases its build names (electron-builder.config.cjs). It checks at start
// and every 4 hours, downloads in the background and tells every window. Relaunch to update runs the quit flow
// first (quit.ts: the question about running turns, then the server stops), and installs only once that let go.
import { app, autoUpdater as squirrel } from 'electron';
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AppUpdater } from 'electron-updater';
import type { DesktopUpdateView } from '@omni/shared/desktop-bridge.ts';
import type { AppContext } from './context.ts';
import { handle, on } from './handle.ts';
import { onQuitCancelled } from './quit.ts';
import { initialView, reduceUpdate, releasesPage, sameView, shouldCheck, updateErrorText, type UpdateHost, type UpdaterEvent } from './update-state.ts';

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
/** How long a held quit waits for Squirrel.Mac to take over before the app exits anyway. */
const MAC_INSTALL_WAIT_MS = 30_000;

function writable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Squirrel.Mac replaces Omni.app in its folder. A translocated copy runs from a read-only mount. */
function macBundleReplaceable(): boolean {
  const bundle = resolve(process.execPath, '../../..');
  return !bundle.includes('/AppTranslocation/') && writable(bundle) && writable(dirname(bundle));
}

function host(): UpdateHost {
  const appImage = process.env.APPIMAGE || undefined;
  const installDirWritable = process.platform === 'darwin' ? macBundleReplaceable() : appImage ? writable(dirname(appImage)) : false;
  return {
    packaged: app.isPackaged,
    platform: process.platform,
    hasFeed: app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml')),
    appImage,
    installDirWritable,
  };
}

/** The releases page this build's feed names, for a Download link while checks fail. */
function downloadUrl(): string | undefined {
  try {
    return releasesPage(readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8')) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Starts `file` with `args` once this process has exited, from a shell that does not depend on it. */
function startAfterExit(file: string, args: string[]): void {
  const script = 'while kill -0 "$0" 2>/dev/null; do sleep 0.2; done; shift; exec "$@"';
  spawn('/bin/sh', ['-c', script, String(process.pid), '--', file, ...args], { detached: true, stdio: 'ignore' }).unref();
}

export function installUpdates(ctx: AppContext): void {
  let view: DesktopUpdateView = initialView(host());
  let updater: AppUpdater | null = null;
  const download = view.state === 'unsupported' ? undefined : downloadUrl();

  const apply = (event: UpdaterEvent) => {
    const next = reduceUpdate(view, event);
    if (sameView(next, view)) return;
    view = next;
    ctx.broadcast({ type: 'update', update: view });
  };

  const check = async () => {
    if (!updater || !shouldCheck(view)) return;
    try {
      await updater.checkForUpdates();
    } catch (err) {
      apply({ type: 'error', message: updateErrorText(err), downloadUrl: download });
    }
  };

  handle('omni:updates:get', () => view);
  handle('omni:updates:check', async () => {
    await check();
    return view;
  });

  let installing = false;
  let handedOff = false;
  on('omni:updates:install', () => {
    if (!updater || view.state !== 'ready') return;
    installing = true;
    app.quit();
  });
  // Cancel in the question about running turns keeps the app, and the next ordinary quit must not relaunch it.
  onQuitCancelled(() => {
    installing = false;
  });
  // will-quit comes after the quit flow has asked and stopped the server, and while the app can still wait. Held
  // here, the updater quits it again itself.
  app.on('will-quit', (event) => {
    if (!installing || handedOff || !updater) return;
    event.preventDefault();
    handedOff = true;
    const appImage = process.env.APPIMAGE;
    if (process.platform !== 'linux' || !appImage) {
      // Squirrel.Mac swaps the bundle and opens the new copy. It has the update already (ready waits for it), so
      // this quits at once. If it does not, the app has no window and no server left: exit rather than linger.
      setTimeout(() => {
        console.error('[omni] update: the install did not take over, quitting');
        app.exit(0);
      }, MAC_INSTALL_WAIT_MS);
      try {
        updater.quitAndInstall(true, true);
      } catch (err) {
        console.error('[omni] update:', updateErrorText(err));
        app.exit(0);
      }
      return;
    }
    // The new AppImage replaces this one now. Started by electron-updater it would get no arguments, so it starts
    // here with this launch's own (--port, --data-dir), once this process has gone and let go of the instance lock.
    // A plain sh outside the AppImage waits for that: app.relaunch's helper runs from this AppImage's mount, which
    // goes away as the app quits. A versioned file name moves to the new version's.
    let next = appImage;
    updater.once('appimage-filename-updated', (path: string) => {
      next = path;
    });
    updater.quitAndInstall(true, false);
    if (existsSync(next)) startAfterExit(next, process.argv.slice(1));
    // An install that failed leaves the app open with its windows closed and its server stopped: quit anyway.
    setImmediate(() => app.quit());
  });

  if (view.state === 'unsupported') return;

  void import('electron-updater').then(({ autoUpdater }) => {
    updater = autoUpdater;
    // Its own logger prints each failed check's whole stack and HTTP answer. One line is enough.
    autoUpdater.logger = {
      info: () => {},
      warn: (message: unknown) => console.warn('[omni] update:', updateErrorText(message)),
      error: (message: unknown) => console.error('[omni] update:', updateErrorText(message)),
    };
    autoUpdater.autoDownload = true;
    // A downloaded update also installs at an ordinary quit, without the relaunch.
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => apply({ type: 'checking' }));
    autoUpdater.on('update-available', (info) => apply({ type: 'available', version: info.version }));
    autoUpdater.on('update-not-available', () => apply({ type: 'not-available', at: new Date().toISOString() }));
    autoUpdater.on('download-progress', (progress) => apply({ type: 'progress', percent: progress.percent }));
    if (process.platform === 'darwin') {
      // electron-updater's update-downloaded only means the zip is here. Squirrel.Mac then fetches it from
      // electron-updater's local server and checks its signature (autoInstallOnAppQuit starts that), and only once
      // Squirrel has it can Relaunch install. Its errors come through autoUpdater's error.
      let version = '';
      autoUpdater.on('update-downloaded', (info) => {
        version = info.version;
        apply({ type: 'progress', percent: 100 });
      });
      squirrel.on('update-downloaded', () => apply({ type: 'downloaded', version }));
    } else {
      autoUpdater.on('update-downloaded', (info) => apply({ type: 'downloaded', version: info.version }));
    }
    autoUpdater.on('error', (err) => apply({ type: 'error', message: updateErrorText(err), downloadUrl: download }));
    void check();
    setInterval(() => void check(), CHECK_EVERY_MS).unref();
  });
}
