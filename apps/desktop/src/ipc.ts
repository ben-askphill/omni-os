// The IPC between the preload (the page's `window.omniDesktop`) and the main process. One table of channels, so
// the preload and each feature that answers one agree on names and shapes.
import type {
  DesktopEvent,
  DesktopPlatform,
  DesktopServerInfo,
  DesktopSettings,
  DesktopSettingsPatch,
  DesktopUpdateView,
} from '@omni/shared/desktop-bridge.ts';

/** Answered once, synchronously, as the preload runs: the facts the bridge exposes as plain properties. */
export interface Bootstrap {
  platform: DesktopPlatform;
  version: string;
  packaged: boolean;
  loginItemSupported: boolean;
  nativeBrowser: { partition: string; preload: string };
}

export const BOOTSTRAP = 'omni:bootstrap';
export const EVENT = 'omni:event';

/** Request and reply, through ipcRenderer.invoke and ipcMain.handle. */
export interface InvokeChannels {
  'omni:settings:get': { args: []; result: DesktopSettings };
  'omni:settings:set': { args: [DesktopSettingsPatch]; result: DesktopSettings };
  'omni:open-path': { args: [string]; result: string };
  'omni:updates:get': { args: []; result: DesktopUpdateView };
  'omni:updates:check': { args: []; result: DesktopUpdateView };
  'omni:server:info': { args: []; result: DesktopServerInfo };
}

/** One way, page to main, through ipcRenderer.send and ipcMain.on. */
export interface SendChannels {
  'omni:open-window': [route: string];
  'omni:focus': [];
  'omni:show-in-folder': [path: string];
  'omni:appearance': [mode: 'system' | 'light' | 'dark'];
  'omni:quick-prompt:done': [route?: string];
  'omni:wispr': [action: 'start' | 'stop'];
  'omni:updates:install': [];
  'omni:server:show-log': [];
}

export type InvokeChannel = keyof InvokeChannels;
export type SendChannel = keyof SendChannels;
export type { DesktopEvent };
