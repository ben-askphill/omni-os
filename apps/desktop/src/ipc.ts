// The IPC between the preload (the page's `window.omniDesktop`) and the main process. One table of channels, so
// the preload and each feature that answers one agree on names and shapes.
import type {
  DesktopPlatform,
  DesktopServerInfo,
  DesktopSettings,
  DesktopSettingsPatch,
  DesktopUpdateView,
  NativeBrowserShot,
  QuickPromptStatus,
} from '@omni/shared/desktop-bridge.ts';

/** Answered once, synchronously, as the preload runs: the facts the bridge exposes as plain properties. */
export interface Bootstrap {
  platform: DesktopPlatform;
  version: string;
  packaged: boolean;
  loginItemSupported: boolean;
}

export const BOOTSTRAP = 'omni:bootstrap';
export const EVENT = 'omni:event';

/** Request and reply, through ipcRenderer.invoke and ipcMain.handle. */
export interface InvokeChannels {
  'omni:settings:get': { args: []; result: DesktopSettings };
  'omni:settings:set': { args: [DesktopSettingsPatch]; result: DesktopSettings };
  'omni:updates:get': { args: []; result: DesktopUpdateView };
  'omni:updates:check': { args: []; result: DesktopUpdateView };
  'omni:server:info': { args: []; result: DesktopServerInfo };
  'omni:quick-prompt:status': { args: []; result: QuickPromptStatus };
  'omni:native-browser:capture': { args: [webContentsId: number]; result: NativeBrowserShot };
}

/** One way, page to main, through ipcRenderer.send and ipcMain.on. */
export interface SendChannels {
  'omni:open-window': [route: string];
  'omni:focus': [];
  'omni:appearance': [mode: 'system' | 'light' | 'dark'];
  'omni:quick-prompt:done': [route?: string];
  'omni:quick-prompt:open': [];
  'omni:quick-prompt:resize': [height: number];
  'omni:wispr': [action: 'start' | 'stop'];
  'omni:updates:install': [];
  'omni:server:show-log': [];
}

export type InvokeChannel = keyof InvokeChannels;
export type SendChannel = keyof SendChannels;
