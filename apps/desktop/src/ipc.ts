// The IPC between the preload (the page's `window.omniDesktop`) and the main process. One table of channels, so
// the preload and each feature that answers one agree on names and shapes.
import type {
  DesktopLayout,
  DesktopPlatform,
  DesktopServerInfo,
  DesktopSettings,
  DesktopSettingsPatch,
  DesktopUpdateView,
  FolderPickRequest,
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
/** Main to page: `(id, url, deadline)`, a link for the page to open itself if it can before `deadline` (bridge `routeLinks`). */
export const LINK = 'omni:link';

/** Request and reply, through ipcRenderer.invoke and ipcMain.handle. */
export interface InvokeChannels {
  'omni:settings:get': { args: []; result: DesktopSettings };
  'omni:settings:set': { args: [DesktopSettingsPatch]; result: DesktopSettings };
  'omni:updates:get': { args: []; result: DesktopUpdateView };
  'omni:updates:check': { args: []; result: DesktopUpdateView };
  'omni:updates:download': { args: []; result: DesktopUpdateView };
  'omni:server:info': { args: []; result: DesktopServerInfo };
  'omni:quick-prompt:status': { args: []; result: QuickPromptStatus };
  'omni:native-browser:capture': { args: [webContentsId: number]; result: NativeBrowserShot };
  /** Onboarding's sample notification. False when the system cannot show one. */
  'omni:notifications:test': { args: []; result: boolean };
  /** The system folder dialog. The chosen folder's absolute path, or null when cancelled. */
  'omni:pick-folder': { args: [request?: FolderPickRequest]; result: string | null };
}

/** One way, page to main, through ipcRenderer.send and ipcMain.on. */
export interface SendChannels {
  'omni:open-window': [route: string];
  'omni:focus': [];
  'omni:pair-again': [route?: string];
  'omni:appearance': [mode: 'system' | 'light' | 'dark'];
  'omni:layout': [layout: DesktopLayout];
  /** The page takes links (`routeLinks`), or stopped. */
  'omni:links:routing': [on: boolean];
  /** The page's answer to a LINK: it opened the link itself, or the browser should. */
  'omni:links:answer': [id: number, routed: boolean];
  'omni:quick-prompt:done': [route?: string];
  'omni:quick-prompt:open': [];
  'omni:quick-prompt:resize': [height: number];
  'omni:wispr': [action: 'start' | 'stop'];
  'omni:updates:install': [];
  'omni:server:show-log': [];
}

export type InvokeChannel = keyof InvokeChannels;
export type SendChannel = keyof SendChannels;
