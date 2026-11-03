// Runs in every Omni window before the page. Exposes `window.omniDesktop` (DesktopBridge) and nothing else:
// the page gets named calls, never ipcRenderer itself.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopBridge, DesktopEvent } from '@omni/shared/desktop-bridge.ts';
import { BOOTSTRAP, EVENT, type Bootstrap, type InvokeChannel, type InvokeChannels, type SendChannel, type SendChannels } from './ipc.ts';

const boot = ipcRenderer.sendSync(BOOTSTRAP) as Bootstrap;

const invoke = <C extends InvokeChannel>(channel: C, ...args: InvokeChannels[C]['args']): Promise<InvokeChannels[C]['result']> =>
  ipcRenderer.invoke(channel, ...args) as Promise<InvokeChannels[C]['result']>;

const send = <C extends SendChannel>(channel: C, ...args: SendChannels[C]): void => ipcRenderer.send(channel, ...args);

const bridge: DesktopBridge = {
  platform: boot.platform,
  version: boot.version,
  packaged: boot.packaged,
  loginItemSupported: boot.loginItemSupported,
  onEvent(listener) {
    const wrapped = (_event: IpcRendererEvent, payload: DesktopEvent) => listener(payload);
    ipcRenderer.on(EVENT, wrapped);
    return () => {
      ipcRenderer.off(EVENT, wrapped);
    };
  },
  openWindow: (route) => send('omni:open-window', route),
  focus: () => send('omni:focus'),
  setAppearance: (mode) => send('omni:appearance', mode),
  settings: {
    get: () => invoke('omni:settings:get'),
    set: (patch) => invoke('omni:settings:set', patch),
  },
  quickPrompt: {
    done: (route) => send('omni:quick-prompt:done', route),
    status: () => invoke('omni:quick-prompt:status'),
    open: () => send('omni:quick-prompt:open'),
    resize: (height) => send('omni:quick-prompt:resize', height),
  },
  wispr: (action) => send('omni:wispr', action),
  updates: {
    get: () => invoke('omni:updates:get'),
    check: () => invoke('omni:updates:check'),
    install: () => send('omni:updates:install'),
  },
  server: {
    info: () => invoke('omni:server:info'),
    showLog: () => send('omni:server:show-log'),
  },
  nativeBrowser: {
    capture: (webContentsId) => invoke('omni:native-browser:capture', webContentsId),
  },
};

contextBridge.exposeInMainWorld('omniDesktop', bridge);
