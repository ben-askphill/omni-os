// What every feature of the main process gets: the server behind the windows, the settings, and the windows.
// main.ts builds one and hands it to each install*(ctx) in turn.
import type { BrowserWindow } from 'electron';
import type { DesktopEvent } from '@omni/shared/desktop-bridge.ts';
import type { Backend } from './backend/index.ts';
import type { LaunchOptions } from './options.ts';
import type { SettingsStore } from './settings.ts';

export interface AppPaths {
  /** The copy of the repo layout the server runs from: the packaged bundle, or the checkout in development. */
  appRoot: string;
  bundled: boolean;
  /** dist/preload.cjs: the bridge, in every Omni window. */
  preload: string;
  /** dist/pick-preload.cjs: element picking, in the Web tab's pages only. */
  pickPreload: string;
  /** The app's icon, for windows and notifications on Linux. */
  icon: string | null;
}

export interface AppContext {
  options: LaunchOptions;
  paths: AppPaths;
  settings: SettingsStore;
  backend: Backend;
  /** Where windows load the Web UI: the server, or --app-url. */
  appUrl(): string;
  /** The main window, if it is open. */
  mainWindow(): BrowserWindow | null;
  /** Opens or focuses the main window, at `route` when one is given. */
  showMain(route?: string): BrowserWindow;
  /** A window of its own on a hash route, such as a thread. */
  openWindow(route: string): BrowserWindow;
  /** Sends an event to every Omni window's page. */
  broadcast(event: DesktopEvent): void;
  /** True once quitting has been decided, so a closing window does not hold the app open. */
  quitting(): boolean;
}
